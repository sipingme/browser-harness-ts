#!/usr/bin/env node
/**
 * bhts — a TS twin of `browser-harness -c '...'`.
 *
 * Usage:
 *   bhts -c 'await bh.newTab("https://example.com"); console.log(await bh.pageInfo());'
 *
 * The snippet runs inside an async IIFE with `bh` (a connected BH) and `h`
 * (alias for bh.helpers) already in scope. No imports needed.
 *
 * Requires the Python daemon to be running (see `browser-harness --setup`).
 */
import { BH } from "./index.js";

const HELP = `bhts — TypeScript client for browser-harness

Usage:
  bhts -c 'await bh.clickAtXy(100, 200); console.log(await bh.pageInfo())'
  bhts --version
  bhts --help

Snippet context:
  bh         — connected BH instance (workspace hot-loaded)
  h          — alias for bh.helpers (agent-workspace/agent_helpers.ts)
  console    — Node console

Env:
  BU_NAME            daemon namespace (default "default")
  BH_AGENT_WORKSPACE override agent-workspace directory
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv[0] === "--version") {
    // Keep cheap — no I/O for something this small.
    process.stdout.write("browser-harness-ts 0.1.0\n");
    return 0;
  }
  if (argv[0] !== "-c" || argv.length < 2) {
    process.stderr.write(HELP);
    return 2;
  }
  const code = argv[1]!;

  const bh = await BH.connect();
  const h = bh.helpers;

  // AsyncFunction lets the snippet use top-level `await` naturally. Variables
  // `bh` and `h` are passed as real parameters so the snippet sees them as
  // bindings, not as properties on some mystery `this`.
  const AsyncFn = Object.getPrototypeOf(async function () {
    /* noop */
  }).constructor as new (...args: string[]) => (bh: BH, h: typeof bh.helpers) => Promise<unknown>;

  const fn = new AsyncFn("bh", "h", code);
  await fn(bh, h);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`bhts: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  });
