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
echo "        Coding Agent"
echo "==================================="
echo ""

# Best-effort — never blocks startup even if this fails or times out.
node "$ROOT/scripts/check-update.js"

if [ ! -d "$ROOT/node_modules" ]; then
  echo "First-time setup: installing dependencies (this can take a minute)..."
  npm install
fi

if [ ! -f "$ROOT/dist/index.js" ]; then
  echo "Building..."
  npm run build
fi

eval "$(node "$ROOT/scripts/launch-config.js" "$@")"

echo ""
echo "Working directory: $FOLDER"

PORT=4390
if [ -n "${APIKEY:-}" ] && [ -n "${PROVIDER:-}" ]; then
  echo "Model: $PROVIDER (upgraded)"
  ARGS=(--web --cwd "$FOLDER" --port "$PORT" --provider "$PROVIDER" --api-key "$APIKEY")
else
  echo "Model: Pollinations / openai (default free model - tool-calling may not work, see README)"
  ARGS=(--web --cwd "$FOLDER" --port "$PORT")
fi

echo "Starting server and opening your browser..."
echo "(Close this terminal, or Ctrl+C, at any time to stop the agent.)"
echo ""

bash "$ROOT/scripts/open-browser-when-ready.sh" "$PORT" &
disown

exec node "$ROOT/dist/index.js" "${ARGS[@]}"
