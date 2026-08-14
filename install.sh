#!/usr/bin/env bash
# Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
# Unauthorized copying, modification, or distribution is prohibited.
# See LICENSE for details.
#
# Linux installer: copies this project to a per-user install location, adds a
# `wrexlyn` command to ~/.local/bin, and registers a desktop launcher entry.
# Run it from inside the project directory: ./install.sh
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${WREXLYN_INSTALL_DIR:-$HOME/.local/share/wrexlyn}"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"

echo "Installing Wrexlyn to: $INSTALL_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Note: Node.js 18+ wasn't found on this system. Wrexlyn needs it to run — install it before"
  echo "first launch, e.g.:"
  echo "  Debian/Ubuntu: sudo apt install nodejs npm"
  echo "  Fedora:        sudo dnf install nodejs npm"
  echo "  Arch:          sudo pacman -S nodejs npm"
  echo "  Or: https://nodejs.org"
  echo ""
fi

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR"

if [ -d "$SOURCE_DIR/.git" ] && command -v git >/dev/null 2>&1; then
  # Copy exactly what git tracks (respects .gitignore) rather than "everything except a
  # hand-maintained blocklist" -- the old blocklist approach shipped any stray untracked
  # file sitting in the working tree (a build artifact, a scratch file, anything) straight
  # into every install. `installer/` is tracked but Windows-only packaging, so it's the one
  # thing still excluded explicitly even from the tracked-files list.
  if command -v rsync >/dev/null 2>&1; then
    (cd "$SOURCE_DIR" && git ls-files -z -- . ':!installer') |
      rsync -a --from0 --files-from=- "$SOURCE_DIR/" "$INSTALL_DIR/"
  else
    (cd "$SOURCE_DIR" && git ls-files -z -- . ':!installer') |
      tar -C "$SOURCE_DIR" --null -T - -cf - | tar -C "$INSTALL_DIR" -xf -
  fi
else
  echo "Warning: $SOURCE_DIR isn't a git checkout -- falling back to a name-based exclude" >&2
  echo "list, which (unlike a git-tracked-files copy) can't tell source files from stray" >&2
  echo "untracked ones that happen to be sitting in this directory." >&2
  EXCLUDES=(--exclude node_modules --exclude dist --exclude .git --exclude .coding-agent \
            --exclude agent.config.json --exclude '*.log' --exclude installer)
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "${EXCLUDES[@]}" "$SOURCE_DIR/" "$INSTALL_DIR/"
  else
    find "$SOURCE_DIR" -mindepth 1 -maxdepth 1 \
      ! -name node_modules ! -name dist ! -name .git ! -name .coding-agent \
      ! -name agent.config.json ! -name '*.log' ! -name installer \
      -exec cp -r {} "$INSTALL_DIR/" \;
  fi
fi

chmod +x \
  "$INSTALL_DIR/Start Coding Agent.sh" \
  "$INSTALL_DIR/Change Model Key.sh" \
  "$INSTALL_DIR/Change Project Folder.sh" \
  "$INSTALL_DIR/scripts/launch.sh" \
  "$INSTALL_DIR/scripts/open-browser-when-ready.sh" \
  "$INSTALL_DIR/scripts/launch-config.js"

# Stamp the source commit into the installed copy so check-update.js (run on every
# launch) has something to compare against — the installed copy has no .git of its own.
if command -v git >/dev/null 2>&1 && [ -d "$SOURCE_DIR/.git" ]; then
  commit="$(cd "$SOURCE_DIR" && git rev-parse HEAD 2>/dev/null || true)"
  if [ -n "$commit" ]; then
    printf '{\n  "commit": "%s"\n}\n' "$commit" > "$INSTALL_DIR/version.json"
  fi
fi

cat > "$BIN_DIR/wrexlyn" <<EOF
#!/usr/bin/env bash
exec "$INSTALL_DIR/Start Coding Agent.sh" "\$@"
EOF
chmod +x "$BIN_DIR/wrexlyn"

cat > "$DESKTOP_DIR/wrexlyn.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Wrexlyn
Comment=Free AI coding agent with a web UI
Exec=$INSTALL_DIR/Start Coding Agent.sh
Terminal=true
Categories=Development;
EOF
chmod +x "$DESKTOP_DIR/wrexlyn.desktop"

echo ""
echo "Installed. Launch it with any of:"
echo "  wrexlyn"
echo "  $INSTALL_DIR/Start Coding Agent.sh"
echo "  or find \"Wrexlyn\" in your desktop's application menu"
echo ""

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo "Note: $BIN_DIR isn't on your PATH yet, so the \`wrexlyn\` command above won't be found until you add it."
    echo "Add this line to your ~/.bashrc or ~/.zshrc, then restart your terminal:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

echo ""
echo "To uninstall later: rm -rf \"$INSTALL_DIR\" \"$BIN_DIR/wrexlyn\" \"$DESKTOP_DIR/wrexlyn.desktop\""
