/**
 * Main BH class — mirrors Python browser_harness.helpers function-for-function.
 *
 * All methods talk to the Python daemon over JSON-line IPC. No direct CDP
 * WebSocket here: the daemon holds the one Chrome WS and multiplexes us.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import { request, isDaemonAlive, logPath, sockAddr, checkName } from "./ipc.js";

export const INTERNAL_URL_PREFIXES = [
  "chrome://",
  "chrome-untrusted://",
  "devtools://",
  "chrome-extension://",
  "about:",
] as const;

export interface PageInfo {
  url: string;
  title: string;
  w: number;
  h: number;
  sx: number;
  sy: number;
  pw: number;
  ph: number;
}

export interface DialogInfo {
  dialog: {
    type: "alert" | "confirm" | "prompt" | "beforeunload";
    message: string;
    url?: string;
    defaultPrompt?: string;
    hasBrowserHandler?: boolean;
  };
}

export interface TabInfo {
  targetId: string;
  title: string;
  url: string;
}

export interface BHOptions {
  /** BU_NAME — namespaces socket/pid/log. Default: $BU_NAME or "default". */
  name?: string;
  /** Path to agent-workspace dir. Default: $BH_AGENT_WORKSPACE or ./agent-workspace */
  workspace?: string;
  /** Request timeout in ms for each RPC call. Default: 30000. */
  timeoutMs?: number;
}

export type JsExpression = string | (() => unknown);

type RuntimeEvaluateResult = {
  result?: {
    value?: unknown;
    unserializableValue?: string;
    description?: string;
    subtype?: string;
  };
  exceptionDetails?: {
    exception?: { description?: string; value?: unknown; className?: string };
    text?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
};

function decodeUnserializable(v: string): unknown {
  if (v === "NaN") return NaN;
  if (v === "Infinity") return Infinity;
  if (v === "-Infinity") return -Infinity;
  if (v === "-0") return -0;
  if (v.endsWith("n")) {
    try {
      return BigInt(v.slice(0, -1));
    } catch {
      return v;
    }
  }
  return v;
}

/**
 * Cheap heuristic: does the expression start with a `return` outside of
 * string/comment context? Used to auto-wrap in IIFE, matching helpers.py.
 * Word-boundary check keeps us from misfiring on `returned`, `_return`, etc.
 */
function hasTopLevelReturn(expr: string): boolean {
  return /(^|[^A-Za-z0-9_])return([^A-Za-z0-9_]|$)/.test(expr);
}

export class BH {
  readonly name: string;
  readonly workspace: string;
  readonly timeoutMs: number;
  private custom: Record<string, (...args: unknown[]) => unknown> = {};

  constructor(options: BHOptions = {}) {
    this.name = checkName(options.name ?? process.env.BU_NAME ?? "default");
    this.workspace =
      options.workspace ??
      process.env.BH_AGENT_WORKSPACE ??
      path.resolve(process.cwd(), "agent-workspace");
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /**
   * Connect to an already-running daemon. Throws with a helpful message when
   * it's not there. Matches the Python-side expectation that `browser-harness
   * --setup` (or a prior `browser-harness -c`) has spun up the daemon.
   */
  static async connect(options: BHOptions = {}): Promise<BH> {
    const bh = new BH(options);
    if (!(await isDaemonAlive(bh.name))) {
      throw new Error(
        `browser-harness daemon "${bh.name}" not running at ${sockAddr(bh.name)}.\n` +
          `Start it from the bundled Python side first:\n` +
          `  npm run setup                       # first time only\n` +
          `  browser-harness --setup             # attach to your Chrome\n` +
          `(or from this repo root: ./scripts/setup.sh)\n` +
          `Log: ${logPath(bh.name)}`,
      );
    }
    await bh.loadAgentHelpers();
    return bh;
  }

  // ---------- core RPC ----------

  /** Raw CDP passthrough. Prefer typed helpers when available. */
  async cdp<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const resp = await request<{ result?: T }>(
      this.name,
      { method, params, session_id: sessionId ?? null },
      this.timeoutMs,
    );
    return (resp.result ?? ({} as T));
  }

  /** Drain buffered CDP events since the last call (Page.load, Network.*, etc.). */
  async drainEvents(): Promise<Array<Record<string, unknown>>> {
    const r = await request<{ events: Array<Record<string, unknown>> }>(
      this.name,
      { meta: "drain_events" },
      this.timeoutMs,
    );
    return r.events;
  }

  async pendingDialog(): Promise<DialogInfo["dialog"] | null> {
    const r = await request<{ dialog: DialogInfo["dialog"] | null }>(
      this.name,
      { meta: "pending_dialog" },
      this.timeoutMs,
    );
    return r.dialog ?? null;
  }

  // ---------- navigation / page ----------

  /** Navigate the currently attached tab. Follow with waitForLoad(). */
  async gotoUrl(url: string): Promise<Record<string, unknown>> {
    return this.cdp("Page.navigate", { url });
  }

  /** Viewport + scroll + page size. Returns {dialog} when a native dialog is up. */
  async pageInfo(): Promise<PageInfo | DialogInfo> {
    const dlg = await this.pendingDialog();
    if (dlg) return { dialog: dlg };
    const json = await this.js<string>(
      "JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})",
    );
    return JSON.parse(json) as PageInfo;
  }

  async waitForLoad(timeoutSec = 15): Promise<boolean> {
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      const state = await this.js<string>("document.readyState");
      if (state === "complete") return true;
      await this.wait(0.3);
    }
    return false;
  }

  // ---------- input ----------

  async clickAtXy(
    x: number,
    y: number,
    button: "left" | "right" | "middle" = "left",
    clicks = 1,
  ): Promise<void> {
    await this.cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      clickCount: clicks,
    });
    await this.cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      clickCount: clicks,
    });
  }

  async typeText(text: string): Promise<void> {
    await this.cdp("Input.insertText", { text });
  }

  /** Modifiers bitfield: 1=Alt, 2=Ctrl, 4=Meta(Cmd), 8=Shift. */
  async pressKey(key: string, modifiers = 0): Promise<void> {
    const KEYS: Record<string, [number, string, string]> = {
      Enter: [13, "Enter", "\r"],
      Tab: [9, "Tab", "\t"],
      Backspace: [8, "Backspace", ""],
      Escape: [27, "Escape", ""],
      Delete: [46, "Delete", ""],
      " ": [32, "Space", " "],
      ArrowLeft: [37, "ArrowLeft", ""],
      ArrowUp: [38, "ArrowUp", ""],
      ArrowRight: [39, "ArrowRight", ""],
      ArrowDown: [40, "ArrowDown", ""],
      Home: [36, "Home", ""],
      End: [35, "End", ""],
      PageUp: [33, "PageUp", ""],
      PageDown: [34, "PageDown", ""],
    };
    const [vk, code, text] =
      KEYS[key] ?? [key.length === 1 ? key.charCodeAt(0) : 0, key, key.length === 1 ? key : ""];
    const base = {
      key,
      code,
      modifiers,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
    };
    await this.cdp("Input.dispatchKeyEvent", {
      type: "keyDown",
      ...base,
      ...(text ? { text } : {}),
    });
    if (text && text.length === 1) {
      await this.cdp("Input.dispatchKeyEvent", { type: "char", text, ...base });
    }
    await this.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  async scroll(x: number, y: number, dy = -300, dx = 0): Promise<void> {
    await this.cdp("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: dx,
      deltaY: dy,
    });
  }

  // ---------- visual ----------

  /**
   * Save a PNG of the current viewport. `full=true` captures beyond viewport.
   * `maxDim` isn't implemented yet (would need sharp/jimp); pass a path.
   */
  async captureScreenshot(
    options: { path?: string; full?: boolean } = {},
  ): Promise<string> {
    const outPath = options.path ?? path.join(os.tmpdir(), "shot.png");
    const r = await this.cdp<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: !!options.full,
    });
    fs.writeFileSync(outPath, Buffer.from(r.data, "base64"));
    return outPath;
  }

  // ---------- tabs ----------

  async listTabs(includeChrome = true): Promise<TabInfo[]> {
    const r = await this.cdp<{ targetInfos: Array<{ type: string; targetId: string; title?: string; url?: string }> }>(
      "Target.getTargets",
    );
    const out: TabInfo[] = [];
    for (const t of r.targetInfos) {
      if (t.type !== "page") continue;
      const url = t.url ?? "";
      if (!includeChrome && INTERNAL_URL_PREFIXES.some((p) => url.startsWith(p))) continue;
      out.push({ targetId: t.targetId, title: t.title ?? "", url });
    }
    return out;
  }

  async currentTab(): Promise<TabInfo> {
    const r = await this.cdp<{ targetInfo?: { targetId?: string; title?: string; url?: string } }>(
      "Target.getTargetInfo",
    );
    const t = r.targetInfo ?? {};
    return { targetId: t.targetId ?? "", title: t.title ?? "", url: t.url ?? "" };
  }

  async switchTab(target: string | TabInfo): Promise<string> {
    const targetId = typeof target === "string" ? target : target.targetId;
    // Unmark old tab's 🟢 title marker (best-effort, matches helpers.py)
    try {
      await this.cdp("Runtime.evaluate", {
        expression:
          "if(document.title.startsWith('\\uD83D\\uDFE2 '))document.title=document.title.slice(2)",
      });
    } catch {
      /* stale session is fine */
    }
    await this.cdp("Target.activateTarget", { targetId });
    const att = await this.cdp<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const sid = att.sessionId;
    await request(
      this.name,
      { meta: "set_session", session_id: sid, target_id: targetId },
      this.timeoutMs,
    );
    return sid;
  }

  /**
   * Create a blank tab then navigate — same race-avoidance as helpers.py
   * (passing url to createTarget sometimes races with attach).
   */
  async newTab(url = "about:blank"): Promise<string> {
    const r = await this.cdp<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    });
    await this.switchTab(r.targetId);
    if (url !== "about:blank") await this.gotoUrl(url);
    return r.targetId;
  }

  async ensureRealTab(): Promise<TabInfo | null> {
    const tabs = await this.listTabs(false);
    if (tabs.length === 0) return null;
    try {
      const cur = await this.currentTab();
      if (cur.url && !INTERNAL_URL_PREFIXES.some((p) => cur.url.startsWith(p))) {
        return cur;
      }
    } catch {
      /* fall through */
    }
    const first = tabs[0]!;
    await this.switchTab(first.targetId);
    return first;
  }

  /** First iframe target whose URL contains `urlSubstr`. Use with js({ targetId }). */
  async iframeTarget(urlSubstr: string): Promise<string | null> {
    const r = await this.cdp<{ targetInfos: Array<{ type: string; targetId: string; url?: string }> }>(
      "Target.getTargets",
    );
    for (const t of r.targetInfos) {
      if (t.type === "iframe" && (t.url ?? "").includes(urlSubstr)) return t.targetId;
    }
    return null;
  }

  // ---------- JavaScript ----------

  /**
   * Run JS in the attached tab (or an iframe target).
   *
   * Accepts a string expression or a zero-arg function (serialized via
   * `.toString()` — the function cannot close over outer scope variables,
   * same as Playwright's `evaluate`). Top-level `return` is auto-wrapped.
   */
  async js<T = unknown>(
    expression: JsExpression,
    options: { targetId?: string } = {},
  ): Promise<T> {
    let expr: string;
    if (typeof expression === "function") {
      expr = `(${expression.toString()})()`;
    } else if (hasTopLevelReturn(expression) && !expression.trim().startsWith("(")) {
      expr = `(function(){${expression}})()`;
    } else {
      expr = expression;
    }

    let sid: string | undefined;
    if (options.targetId) {
      const att = await this.cdp<{ sessionId: string }>("Target.attachToTarget", {
        targetId: options.targetId,
        flatten: true,
      });
      sid = att.sessionId;
    }

    const r = await this.cdp<RuntimeEvaluateResult>(
      "Runtime.evaluate",
      { expression: expr, returnByValue: true, awaitPromise: true },
      sid,
    );

    const result = r.result ?? {};
    const details = r.exceptionDetails;
    if (details || result.subtype === "error") {
      const desc =
        result.description ??
        details?.exception?.description ??
        (details?.exception && "value" in details.exception
          ? String(details.exception.value)
          : undefined) ??
        details?.exception?.className ??
        details?.text ??
        "JavaScript evaluation failed";
      const loc =
        details?.lineNumber !== undefined && details?.columnNumber !== undefined
          ? ` at line ${details.lineNumber}, column ${details.columnNumber}`
          : "";
      const snippet = expr.length > 160 ? expr.slice(0, 157) + "..." : expr;
      throw new Error(`JavaScript evaluation failed${loc}: ${desc}; expression: ${snippet}`);
    }
    if ("value" in result) return result.value as T;
    if (result.unserializableValue !== undefined) {
      return decodeUnserializable(result.unserializableValue) as T;
    }
    return undefined as T;
  }

  /** Set files on a file input via DOM.setFileInputFiles. `paths` absolute. */
  async uploadFile(selector: string, paths: string | string[]): Promise<void> {
    const doc = await this.cdp<{ root: { nodeId: number } }>("DOM.getDocument", {
      depth: -1,
    });
    const q = await this.cdp<{ nodeId: number }>("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector,
    });
    if (!q.nodeId) throw new Error(`no element for ${selector}`);
    await this.cdp("DOM.setFileInputFiles", {
      files: Array.isArray(paths) ? paths : [paths],
      nodeId: q.nodeId,
    });
  }

  // ---------- utility ----------

  wait(seconds = 1): Promise<void> {
    return new Promise((r) => setTimeout(r, seconds * 1000));
  }

  /**
   * Agent-editable helpers loaded from `<workspace>/agent_helpers.(ts|mjs|js)`.
   * Accessible via `bh.helpers.<name>(...)`. Call `reloadAgentHelpers()` to
   * pick up freshly-written code in a long-running process.
   */
  get helpers(): Record<string, (...args: unknown[]) => unknown> {
    return this.custom;
  }

  async loadAgentHelpers(): Promise<void> {
    const candidates = ["agent_helpers.ts", "agent_helpers.mjs", "agent_helpers.js"];
    for (const rel of candidates) {
      const p = path.join(this.workspace, rel);
      if (!fs.existsSync(p)) continue;
      // Cache-bust so re-imports pick up the latest file contents. Accumulates
      // module entries over time; acceptable for dev / agent-iteration loops.
      const url = pathToFileURL(p).href + `?t=${Date.now()}`;
      try {
        const mod = (await import(url)) as Record<string, unknown>;
        const next: Record<string, (...args: unknown[]) => unknown> = {};
        for (const [k, v] of Object.entries(mod)) {
          if (k.startsWith("_") || k === "default") continue;
          if (typeof v === "function") {
            next[k] = v as (...args: unknown[]) => unknown;
          }
        }
        this.custom = next;
      } catch (e) {
        // Don't crash the whole harness if an agent wrote broken helpers.
        // Surface via console so the agent can see it on next run.
        console.error(`[browser-harness-ts] failed to load ${p}:`, (e as Error).message);
      }
      return;
    }
  }

  async reloadAgentHelpers(): Promise<void> {
    return this.loadAgentHelpers();
  }

  /** Daemon log file path — useful for debugging attach failures. */
  get logPath(): string {
    return logPath(this.name);
  }
}
