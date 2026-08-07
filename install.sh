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

# Copy everything except dev/runtime artifacts that get regenerated on first launch
# (node_modules/dist) or are machine-specific (agent.config.json, .coding-agent sessions).
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

chmod +x \
  "$INSTALL_DIR/Start Coding Agent.sh" \
  "$INSTALL_DIR/Change Model Key.sh" \
  "$INSTALL_DIR/Change Project Folder.sh" \
  "$INSTALL_DIR/scripts/launch.sh" \
  "$INSTALL_DIR/scripts/open-browser-when-ready.sh" \
  "$INSTALL_DIR/scripts/launch-config.js"

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
