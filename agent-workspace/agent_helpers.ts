/**
 * Agent-editable TS helpers.
 *
 * Every exported (non-underscore, non-`default`) function here becomes available
 * as `bh.helpers.<name>(...)` after `BH.connect()` or `bh.reloadAgentHelpers()`.
 *
 * Convention: first arg is always the `BH` instance so helpers can call core
 * primitives like `bh.gotoUrl`, `bh.clickAtXy`, `bh.js`, etc.
 *
 * Keep this file small and task-specific. For durable site knowledge, write a
 * markdown skill under `<browser-harness>/agent-workspace/domain-skills/<site>/`.
 *
 * Example — delete/edit as you accumulate real helpers:
 */

import type { BH } from "../src/harness.js";

/** Open a Xiaohongshu post by id+xsec_token, preserving the tokenized URL. */
export async function xhsOpenPost(
  bh: BH,
  noteId: string,
  xsecToken: string,
): Promise<void> {
  const url =
    `https://www.xiaohongshu.com/explore/${encodeURIComponent(noteId)}` +
    `?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_search`;
  await bh.gotoUrl(url);
  await bh.waitForLoad();
}

/** Scroll the current page to the bottom, pausing for lazy-load. */
export async function scrollToBottom(bh: BH, stepPx = 800, pauseMs = 400): Promise<void> {
  let lastHeight = -1;
  for (let i = 0; i < 50; i++) {
    const h = await bh.js<number>("document.documentElement.scrollHeight");
    if (h === lastHeight) return;
    lastHeight = h;
    await bh.scroll(400, 400, stepPx);
    await bh.wait(pauseMs / 1000);
  }
}
