#!/usr/bin/env bash
#
# One-shot bootstrap for browser-harness-ts.
#
# 1. Ensures `uv` is installed.
# 2. Runs `uv tool install -e ./browser-harness` so the `browser-harness`
#    command becomes available on PATH.
# 3. Builds the TS client (dist/).
# 4. Prints the final step for attaching Chrome.
#
# Re-running this script is safe — every step is idempotent.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY_DIR="$REPO_ROOT/browser-harness"

blue()  { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
green() { printf "\033[1;32m ok\033[0m %s\n" "$*"; }
warn()  { printf "\033[1;33m!!!\033[0m %s\n" "$*" >&2; }
fail()  { printf "\033[1;31mERR\033[0m %s\n" "$*" >&2; exit 1; }

# --- 1. Bundled Python repo must be present ---------------------------------
if [ ! -d "$PY_DIR/src/browser_harness" ]; then
  fail "expected Python browser-harness at ./browser-harness, but it's missing.
    this repo ships the Python daemon as a subdirectory — restore it with:
      git clone https://github.com/browser-use/browser-harness browser-harness"
fi
green "python harness present at ./browser-harness"

# --- 2. uv is installed -------------------------------------------------------
if ! command -v uv >/dev/null 2>&1; then
  warn "uv not found. install it with one of:"
  printf "    curl -LsSf https://astral.sh/uv/install.sh | sh\n"
  printf "    brew install uv\n"
  fail "please install uv and rerun: npm run setup"
fi
green "uv installed: $(uv --version)"

# --- 3. Install browser-harness as an editable uv tool ------------------------
blue "installing browser-harness (editable) -> \$PATH"
(
  cd "$PY_DIR"
  # --force keeps the install in sync if the Python code changed on disk.
  uv tool install --force -e .
)

if ! command -v browser-harness >/dev/null 2>&1; then
  warn "uv tool bin dir is not on \$PATH."
  warn "add this to your shell profile (~/.zshrc or ~/.bashrc):"
  printf "    export PATH=\"\$HOME/.local/bin:\$PATH\"\n"
  fail "rerun this script after fixing PATH"
fi
green "browser-harness ready: $(browser-harness --version)"

# --- 4. Build TS ---------------------------------------------------------------
if [ -d "$REPO_ROOT/node_modules" ]; then
  blue "building TS client"
  (cd "$REPO_ROOT" && npx tsc)
  green "dist/ ready"
else
  warn "node_modules missing — run: npm install"
fi

# --- 5. Offer to attach to Chrome ---------------------------------------------
printf "\n"
if [ "${BH_NO_SETUP:-}" = "1" ]; then
  blue "skipping browser-harness --setup (BH_NO_SETUP=1)"
else
  blue "next: attach the daemon to your running Chrome"
  printf "    browser-harness --setup\n"
  printf "\n"
  printf "or skip and verify manually:\n"
  printf "    browser-harness --doctor\n"
fi
