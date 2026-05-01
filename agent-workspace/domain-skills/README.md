# Custom domain skills

> English | [中文](./README.zh-CN.md)

> The 76 upstream skills live in `../../browser-harness/agent-workspace/domain-skills/`
> and are the work of the **Browser Use** team in
> [`browser-use/browser-harness`](https://github.com/browser-use/browser-harness).
> The convention used below (one folder per hostname stem, markdown as the
> storage format, "map not diary" rule) is all theirs — credit to them.

Put your own site-specific knowledge here, one folder per site.

```
agent-workspace/domain-skills/
├── your-company-crm/
│   ├── login.md
│   └── reports.md
├── some-private-dashboard/
│   └── scraping.md
└── internal-booking-tool/
    └── upload.md
```

## Folder naming convention

Use the hostname stem — the part between `www.` and the first `.`:

- `https://app.notion.so/...`        → `notion/`
- `https://www.xiaohongshu.com/...`  → `xiaohongshu/`
- `https://my-internal.acme.com/...` → `my-internal/`

This matches the upstream `browser-harness/agent-workspace/domain-skills/` layout
and is what Python's `goto_url()` auto-lookup expects (see *Mode 2* below).

## What belongs in a skill file

A skill is a **map**, not a **diary** — durable knowledge the next agent needs
before it starts. For the detailed rubric see the upstream guide at
[`../../browser-harness/SKILL.md`](../../browser-harness/SKILL.md).

Good things to record:

- URL patterns, query params, redirect traps
- Private APIs (`XHR`/`fetch` endpoints the page calls, request shape, auth)
- Stable selectors (`data-*`, `aria-*`, `role`, semantic classes)
- Framework quirks ("this dropdown is a React combobox that only commits on `Escape`")
- Waits that `wait_for_load()` misses, with reasons
- Traps (stale drafts, legacy IDs that now `null`, unicode quirks, `beforeunload` dialogs)

**Don't record**:

- Raw pixel coordinates (break on viewport/zoom changes)
- A narration of one specific task you ran
- Secrets, cookies, session tokens — this directory is in your repo

## How the agent finds these

### Mode 1 (default, simple) — both workspaces are readable

The upstream 76 skills live in `browser-harness/agent-workspace/domain-skills/`.
Your custom skills live here. Agents just read from both:

```bash
# quick check across both libraries from a shell / agent
rg -l '' browser-harness/agent-workspace/domain-skills/ \
       browser-harness-ts/agent-workspace/domain-skills/
```

Tell your agent (in its system prompt or this README) to check both paths.
Python's `goto_url()` will only auto-detect the upstream one, but the LLM
can still read yours when directed.

### Mode 2 (advanced) — point Python at your workspace

Set `BH_AGENT_WORKSPACE` so Python's `goto_url()` auto-detects YOUR skills
and loads YOUR `agent_helpers.py`:

```bash
export BH_AGENT_WORKSPACE="$(pwd)/browser-harness-ts/agent-workspace"
browser-harness --reload      # daemon picks up the new workspace
```

Trade-off: Python will no longer auto-look up the upstream 76 skills via
`goto_url()`. To keep access to both, run the one-shot merge helper — it
symlinks every upstream skill folder into this directory:

```bash
npm run merge-skills     # from the repo root
```

Now `goto_url()` sees both upstream (via symlinks) and yours (real dirs)
under one `agent-workspace`. The symlinks are per-machine — don't commit
them; only `git add` the real folders you create for your own sites.
Re-run `merge-skills` after upstream adds new skills.

## Examples

Start by copying one of the upstream examples and adapting it:

```bash
cp -r ../../browser-harness/agent-workspace/domain-skills/xiaohongshu \
      ./my-internal-tool
# edit my-internal-tool/scraping.md
```
