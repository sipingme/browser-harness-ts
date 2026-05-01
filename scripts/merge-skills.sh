#!/usr/bin/env bash
#
# Mode 2 helper: symlink upstream domain-skills into your custom workspace so
# Python's goto_url() auto-detects both libraries under one BH_AGENT_WORKSPACE.
#
# Idempotent — safe to rerun after upstream adds new skills. Existing entries
# (symlinks or real dirs) are left alone.
#
# After running this, export BH_AGENT_WORKSPACE to the custom workspace and
# reload the daemon:
#     export BH_AGENT_WORKSPACE="$(pwd)/agent-workspace"
#     browser-harness --reload

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="$REPO_ROOT/browser-harness/agent-workspace/domain-skills"
CUSTOM="$REPO_ROOT/agent-workspace/domain-skills"

if [ ! -d "$UPSTREAM" ]; then
  echo "ERR upstream skills not found at $UPSTREAM" >&2
  echo "    did you run 'npm run setup' yet?" >&2
  exit 1
fi

mkdir -p "$CUSTOM"
linked=0
skipped=0

for d in "$UPSTREAM"/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  target="$CUSTOM/$name"
  if [ -e "$target" ] || [ -L "$target" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  # Relative symlink so the tree stays portable if the repo moves
  ln -s "../../browser-harness/agent-workspace/domain-skills/$name" "$target"
  linked=$((linked + 1))
done

echo "merged: $linked new symlink(s), $skipped already present"
echo ""
echo "!!! these symlinks are PER-MACHINE — do NOT commit them."
echo "    when adding your own sites to git, use a specific path:"
echo "      git add agent-workspace/domain-skills/<your-site>/"
echo ""
echo "next:"
echo "    export BH_AGENT_WORKSPACE=\"$REPO_ROOT/agent-workspace\""
echo "    browser-harness --reload"
