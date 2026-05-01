/**
 * Smoke test: connect, list tabs, screenshot, run a bit of JS.
 *
 * Prereq: the Python daemon is already running — start it with
 *   browser-harness --setup
 * from the browser-harness repo (or just run `browser-harness -c 'print(1)'`).
 *
 * Run:  npx tsx examples/basic.ts
 */
import { BH } from "../src/index.js";

const bh = await BH.connect();

console.log("connected to daemon:", bh.name);
console.log("log file:", bh.logPath);

const tabs = await bh.listTabs(false);
console.log(`open real tabs: ${tabs.length}`);
for (const t of tabs.slice(0, 5)) {
  console.log(`  - ${t.title.slice(0, 40)}  ${t.url.slice(0, 60)}`);
}

await bh.ensureRealTab();
const info = await bh.pageInfo();
console.log("page_info:", JSON.stringify(info, null, 2));

if ("url" in info) {
  const domain = new URL(info.url).hostname;
  console.log(`current page domain: ${domain}`);
}

const shotPath = await bh.captureScreenshot();
console.log("screenshot saved:", shotPath);

// Hot-reload helpers the agent wrote into agent_helpers.ts
await bh.reloadAgentHelpers();
console.log("available helpers:", Object.keys(bh.helpers));

// Tiny js() demo, string + function forms both work
const readyState = await bh.js<string>("document.readyState");
const ua = await bh.js<string>(() => navigator.userAgent);
console.log("readyState:", readyState);
console.log("userAgent:", ua.slice(0, 80));
