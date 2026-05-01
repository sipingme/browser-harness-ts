/**
 * JSON-line IPC client for the Python browser-harness daemon.
 *
 * POSIX:   AF_UNIX at /tmp/bu-<NAME>.sock   (or $BH_TMP_DIR/bu.sock when isolated)
 * Windows: TCP loopback, port in /tmp/bu-<NAME>.port
 *
 * Protocol: one JSON line per request, one JSON line per response, then close.
 * Must stay byte-compatible with src/browser_harness/_ipc.py.
 */
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

export const IS_WINDOWS = process.platform === "win32";

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function checkName(name: string): string {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `invalid BU_NAME ${JSON.stringify(name)}: must match [A-Za-z0-9_-]{1,64}`,
    );
  }
  return name;
}

const BH_TMP_DIR = process.env.BH_TMP_DIR;
export const TMP = BH_TMP_DIR ?? (IS_WINDOWS ? os.tmpdir() : "/tmp");

function stem(name: string): string {
  checkName(name);
  return BH_TMP_DIR ? "bu" : `bu-${name}`;
}

export function sockPath(name: string): string {
  return path.join(TMP, `${stem(name)}.sock`);
}

export function portPath(name: string): string {
  return path.join(TMP, `${stem(name)}.port`);
}

export function logPath(name: string): string {
  return path.join(TMP, `${stem(name)}.log`);
}

export function sockAddr(name: string): string {
  if (!IS_WINDOWS) return sockPath(name);
  try {
    const port = fs.readFileSync(portPath(name), "utf8").trim();
    return `127.0.0.1:${port}`;
  } catch {
    return `tcp:${stem(name)}`;
  }
}

function openConnection(name: string, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err: Error | null, sock?: net.Socket) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else if (sock) resolve(sock);
    };

    let sock: net.Socket;
    if (IS_WINDOWS) {
      let port: number;
      try {
        port = Number(fs.readFileSync(portPath(name), "utf8").trim());
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
          err.message = `daemon ${name} not running: ${portPath(name)} missing. start it with: browser-harness --setup`;
        }
        return done(err);
      }
      if (!Number.isFinite(port) || port <= 0) {
        return done(new Error(`invalid port in ${portPath(name)}`));
      }
      sock = net.createConnection({ port, host: "127.0.0.1" });
    } else {
      const p = sockPath(name);
      if (!fs.existsSync(p)) {
        return done(
          new Error(
            `daemon ${name} not running: ${p} missing. start it with: browser-harness --setup`,
          ),
        );
      }
      sock = net.createConnection({ path: p });
    }

    const timer = setTimeout(() => {
      sock.destroy();
      done(new Error(`connect to daemon ${name} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    sock.once("connect", () => {
      clearTimeout(timer);
      done(null, sock);
    });
    sock.once("error", (err) => {
      clearTimeout(timer);
      done(err);
    });
  });
}

/**
 * Send one request, read one response, close. Mirrors `_send()` in helpers.py.
 * Throws on transport error; callers interpret {error} at the protocol layer.
 */
export async function request<T = unknown>(
  name: string,
  payload: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> {
  const sock = await openConnection(name, Math.min(timeoutMs, 5_000));
  const line = JSON.stringify(payload) + "\n";

  return new Promise<T>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`request to daemon ${name} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.endsWith("\n")) {
        clearTimeout(timer);
        try {
          const r = JSON.parse(buf) as { error?: string } & T;
          sock.end();
          if (r && typeof r === "object" && "error" in r && r.error) {
            reject(new Error(String(r.error)));
          } else {
            resolve(r as T);
          }
        } catch (e) {
          sock.destroy();
          reject(e as Error);
        }
      }
    });
    sock.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    sock.on("close", () => {
      if (!buf.endsWith("\n") && buf.length > 0) {
        clearTimeout(timer);
        reject(new Error(`daemon ${name} closed connection before newline`));
      }
    });

    sock.write(line);
  });
}

export async function isDaemonAlive(name: string): Promise<boolean> {
  try {
    const sock = await openConnection(name, 1_000);
    sock.destroy();
    return true;
  } catch {
    return false;
  }
}
