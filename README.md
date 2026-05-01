# browser-harness-ts

**English** · [简体中文](./README.zh-CN.md)

A thin TypeScript client that bundles and talks to the Python
[`browser-harness`](./browser-harness) daemon. One Chrome, one daemon, one
JSON protocol — usable from both Python and TS agents at the same time.

```
┌──────────────┐       ┌──────────────────┐       ┌────────────────────┐
│ TS agent     │ ────▶ │ Python daemon    │ ────▶ │ Real Chrome (CDP)  │
│ (this pkg)   │  unix │ (./browser-      │   ws  │                    │
│              │  sock │  harness/)       │       │                    │
└──────────────┘       └──────────────────┘       └────────────────────┘
        ▲
        │ (also: Python agent via `browser-harness -c '...'` — same daemon)
```

Zero Node runtime dependencies (stdlib `net` + `fs` only). The Python
`./browser-harness/` subdirectory handles the hard parts — CDP handshake,
stale-session recovery, profile discovery, remote cloud browsers, and 76
domain-skills — and updates via `git pull` inside that directory.

## Why this approach

Browser automation is a domain where Chrome's internals leak through every
abstraction — CDP protocol drift, profile-picker flows, stale sessions, 15
variants of user-data-dir paths. Rewriting all of that in TypeScript would
burn weeks and keep burning weeks as Chrome ships new versions. Keeping the
battle-tested Python daemon and putting a thin TS skin on it gives you:

### 1. First-class TS ecosystem integration

The daemon is a black box you talk to via Promises — exactly the shape every
modern TS agent framework expects:

- **Vercel AI SDK** / **Mastra** / **LangChain.js** / **Claude Agent SDK (TS)**
  / **OpenAI Agents SDK (TS)** can register `BH` methods as typed tools
  directly, no subprocess marshaling or stdout parsing.
- **Electron / Tauri / VS Code extensions** can embed the TS client without
  shipping a Python runtime to end users (the daemon runs on the dev/admin
  machine where Chrome already lives).
- **Monorepo-friendly** — drop the package into a pnpm/turborepo workspace,
  share types across frontend + automation code, use the same ESLint / Vitest
  / `tsc --noEmit` pipeline as everything else.
- **Native fetch, native Promise, native ESM** — no adapter layer, no
  `child_process.spawn` dance, no stdout parsing.

### 2. Types flow all the way through

```ts
// CDP protocol types for free
import type { Protocol } from "devtools-protocol";
const targets = await bh.cdp<Protocol.Target.GetTargetsResponse>("Target.getTargets");

// DOM types inside injected JS — editor catches typos, completes APIs
const titles = await bh.js<string[]>(
  () => [...document.querySelectorAll<HTMLAnchorElement>("a.titleline")]
          .map((a) => a.textContent ?? ""),
);
```

The injected function is a *real* function in your editor — full refactor,
rename, go-to-definition support. Python's `js("document.title")` is just a
string; typos surface only at runtime.

### 3. Inherit Python's 2 years of edge-case fixes — free

The `./browser-harness/` daemon already solves:

- Chrome M144 "Allow remote debugging" dialog flow
- Chrome M136 default-profile lockdown
- Chrome 147+ `/json/version` HTTP discovery removal
- Stale DevTools WebSocket recovery
- Omnibox-popup-pretending-to-be-a-tab filtering
- 15 different Chrome/Edge/Arc/Brave/Comet profile paths across macOS/Linux/Windows
- Windows AF_UNIX fallback via TCP loopback

You don't re-discover any of these. `git -C browser-harness pull` brings the
latest fixes. Meanwhile your TS client stays ~500 lines of pure JSON RPC.

### 4. The hybrid sweet spot: share one Chrome across languages

This is the trick only a hybrid delivers:

```bash
# Exploration / knowledge capture in Python (LLM-friendly one-liners)
browser-harness -c '
new_tab("https://some-new-site.com")
# poke around, figure out selectors...
# save findings to agent-workspace/domain-skills/some-new-site/scraping.md
'

# Production pipeline in TS (typed, composable, testable)
# — operating on the SAME Chrome tab, same login, same cookies
npm run cli -- -c 'await bh.pageInfo(); await bh.helpers.doTheRealWork();'
```

Python agents (Claude Code / Codex) and TS agents (your app) see the same
browser. Login state, cookies, session storage persist across the language
boundary. No "authenticate twice" / "replay the captcha" problems.

### 5. Inherit the community skill library, not just the code

76 `domain-skills/<site>/*.md` files under `./browser-harness/agent-workspace/`
capture **what actually works** on real sites — stable selectors, private
APIs, framework quirks, traps. Markdown is language-neutral: Python agents
and TS agents both read them. A full TS rewrite would inherit them as
read-only docs; here they remain live reference material wired into the
Python `agent_helpers.py` hot-load path.

### 6. Escape hatches stay open

If you ever want pure TS (for a specific deployment, or to drop Python
entirely), nothing in your codebase blocks it — the daemon protocol is just
JSON lines. You can grow this client into a full TS daemon later by
replacing the RPC target, without touching any caller code.

## Repository layout

```
browser-harness-ts/
├── browser-harness/         ← Python harness, bundled in-tree (has its own .git, .gitignored here)
├── src/                     ← this TS client
├── agent-workspace/         ← TS-side agent-editable helpers (hot-reload)
├── bin/bhts.ts              ← `bhts -c '...'` CLI
├── examples/basic.ts        ← smoke demo
├── scripts/setup.sh         ← one-shot bootstrap (uv install + tsc build)
└── package.json
```

## Install

**First time — one command:**

```bash
npm install
npm run setup          # installs ./browser-harness via uv, builds the TS client,
                       # then prompts you to run `browser-harness --setup`
```

`npm run setup` does this for you:

1. Verifies `./browser-harness/` is present (errors with a clear hint if missing).
2. Verifies `uv` is installed (prints install command if not).
3. `uv tool install --force -e ./browser-harness` — puts `browser-harness` on your PATH.
4. Builds the TS client (`tsc` → `dist/`).
5. Prints the final step: `browser-harness --setup` to attach to your running Chrome.

**Manual one-time attach** (only after the command is on PATH):

```bash
browser-harness --setup     # interactive — guides chrome://inspect if needed
npm run doctor              # verify everything is green
```

**If `browser-harness` isn't found after setup**, add uv's bin dir to PATH:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

**Don't have `uv` yet?**

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh     # official
# or
brew install uv
```

## Quickstart

```ts
import { BH } from "browser-harness-ts";

const bh = await BH.connect();

await bh.newTab("https://news.ycombinator.com");
await bh.waitForLoad();

const info = await bh.pageInfo();
console.log(info);

const titles = await bh.js<string[]>(
  () => [...document.querySelectorAll(".titleline a")].map((a) => a.textContent ?? ""),
);
console.log(titles.slice(0, 5));

await bh.captureScreenshot({ path: "/tmp/hn.png" });
```

Run it:

```bash
npx tsx examples/basic.ts
```

## CLI (`bhts`)

TypeScript twin of `browser-harness -c '...'` — useful in shell scripts and
for LLM agents that expect a subprocess-style interface:

```bash
npx tsx bin/bhts.ts -c '
  await bh.newTab("https://example.com");
  await bh.waitForLoad();
  console.log(await bh.pageInfo());
'
```

Inside the `-c` snippet: `bh` is a connected `BH` instance, `h` aliases
`bh.helpers` (see below), top-level `await` works.

## Agent-editable helpers (hot reload)

Drop task-specific helpers into `agent-workspace/agent_helpers.ts`:

```ts
// agent-workspace/agent_helpers.ts
import type { BH } from "../src/harness.js";

export async function starRepo(bh: BH, owner: string, repo: string) {
  await bh.gotoUrl(`https://github.com/${owner}/${repo}`);
  await bh.waitForLoad();
  await bh.clickAtXy(/* x */ 920, /* y */ 220);   // star button, measure once
}
```

They auto-load on `BH.connect()` and are callable via `bh.helpers.starRepo(...)`.
For long-running processes, call `bh.reloadAgentHelpers()` to pick up edits.

Durable site knowledge (URL patterns, stable selectors, traps) still goes in
the **bundled** Python repo at `./browser-harness/agent-workspace/domain-skills/<site>/`
as markdown — language-neutral, readable by both Python and TS agents.

## API Summary

All methods are async unless noted.

| Area | Method |
|---|---|
| Navigation | `gotoUrl(url)`, `newTab(url?)`, `waitForLoad(sec?)`, `pageInfo()` |
| Input | `clickAtXy(x, y, button?, clicks?)`, `typeText(s)`, `pressKey(k, mod?)`, `scroll(x, y, dy?, dx?)` |
| JS | `js<T>(stringOrFn, { targetId? })` |
| Visual | `captureScreenshot({ path?, full? })` |
| Tabs | `listTabs(includeChrome?)`, `currentTab()`, `switchTab(t)`, `ensureRealTab()`, `iframeTarget(substr)` |
| Files | `uploadFile(selector, paths)` |
| Raw | `cdp<T>(method, params?, sessionId?)` — everything the helpers don't cover |
| Daemon | `drainEvents()`, `pendingDialog()`, `reloadAgentHelpers()` |

Types are strict. CDP responses are `unknown` by default — use the generic
on `cdp<T>` or `js<T>` when you know the shape, or install
`devtools-protocol` for typed CDP params (already a devDep here).

## How it compares

|  | Python original | This package (hybrid) | Full TS rewrite |
|---|---|---|---|
| Chrome attach edge cases | ✅ battle-tested | ✅ inherited | ❌ re-discover |
| 76 domain-skills | ✅ authoritative | ✅ shared | ⚠️ read-only |
| Upstream updates | ✅ `git pull` | ✅ `git pull` | ❌ re-translate |
| Native TS types | ❌ | ✅ | ✅ |
| In-process Promises | ❌ (subprocess) | ✅ | ✅ |
| Extra runtime | Python | Python + Node | Node |

## Environment

| Var | Meaning |
|---|---|
| `BU_NAME` | Daemon namespace. Default `default`. Use per-agent names for parallel work. |
| `BH_AGENT_WORKSPACE` | Override path to the TS `agent-workspace` directory. |
| `BH_TMP_DIR` | Match the Python side's socket location when using isolated tmpdirs. |

## Not (yet) implemented

Deliberately left to the Python side or out of scope for the skeleton:

- Daemon lifecycle (`ensure_daemon`, `run_doctor`, `run_update`, `start_remote_daemon`)
- `http_get` via the fetch-use proxy — use Node `fetch` directly
- Screenshot downscaling (`max_dim`) — install `sharp` and add a resize step if needed
- Profile sync (`list_cloud_profiles`, `sync_local_profile`)

If you need any of those from TS, just spawn the Python CLI:

```ts
import { spawn } from "node:child_process";
spawn("browser-harness", ["--doctor"], { stdio: "inherit" });
```

## License

MIT — same as the Python original.
