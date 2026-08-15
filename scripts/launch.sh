#!/usr/bin/env bash
# Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
# Unauthorized copying, modification, or distribution is prohibited.
# See LICENSE for details.
#
# Double-click/terminal entry point for Linux — the bash equivalent of
# scripts/launch.ps1. Installs dependencies on first run, asks (once, via
# terminal prompts) which project the agent should work on and for an
# optional API key, starts the server, and opens the browser automatically.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is required but wasn't found. Install it, then run this again:" >&2
  echo "  Debian/Ubuntu: sudo apt install nodejs npm" >&2
  echo "  Fedora:        sudo dnf install nodejs npm" >&2
  echo "  Arch:          sudo pacman -S nodejs npm" >&2
  echo "  Or download from: https://nodejs.org" >&2
  exit 1
fi

echo ""
echo "==================================="
echo "        Wrexlyn"
echo "==================================="
echo ""

# Best-effort — never blocks startup even if this fails or times out.
node "$ROOT/scripts/check-update.js"

if [ ! -d "$ROOT/node_modules" ]; then
  echo "First-time setup: installing dependencies (this can take a minute)..."
  npm install
fi

# Rebuild if dist/ is missing OR stale relative to the checked-out commit — "missing" alone isn't enough:
# a `git pull` (manual, or from check-update.js if declined/skipped) leaves an old dist/index.js sitting
# there untouched, and the app would silently launch mismatched compiled output against new source/deps.
BUILD_SHA_PATH="$ROOT/dist/.build-sha"
CURRENT_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"

NEEDS_BUILD=0
if [ ! -f "$ROOT/dist/index.js" ]; then
  NEEDS_BUILD=1
elif [ -n "$CURRENT_SHA" ]; then
  BUILT_SHA="$(cat "$BUILD_SHA_PATH" 2>/dev/null || true)"
  if [ "$BUILT_SHA" != "$CURRENT_SHA" ]; then
    NEEDS_BUILD=1
  fi
fi

if [ "$NEEDS_BUILD" = "1" ]; then
  echo "Building..."
  npm run build
  if [ -n "$CURRENT_SHA" ]; then
    printf '%s' "$CURRENT_SHA" > "$BUILD_SHA_PATH"
  fi
fi

eval "$(node "$ROOT/scripts/launch-config.js" "$@")"

echo ""
echo "Working directory: $FOLDER"

PORT=4390
if [ -n "${APIKEY:-}" ] && [ -n "${PROVIDER:-}" ]; then
  echo "Model: $PROVIDER (upgraded)"
  ARGS=(--web --cwd "$FOLDER" --port "$PORT" --provider "$PROVIDER" --api-key "$APIKEY")
else
  echo "Model: Kilo / kilo-auto/free (default free model, no key needed - capped at 200 req/hour)"
  ARGS=(--web --cwd "$FOLDER" --port "$PORT")
fi

echo "Starting server and opening your browser..."
echo "(Close this terminal, or Ctrl+C, at any time to stop the agent.)"
echo ""

bash "$ROOT/scripts/open-browser-when-ready.sh" "$PORT" &
disown

exec node "$ROOT/dist/index.js" "${ARGS[@]}"
