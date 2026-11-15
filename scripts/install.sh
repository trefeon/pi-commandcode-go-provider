#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/trefeon/pi-commandcode-go-provider.git"
EXT_DIR="$HOME/.omp/agent/extensions"
TARGET_DIR="$EXT_DIR/pi-commandcode-go-provider"
LOADER_FILE="$EXT_DIR/commandcode-go.ts"

echo "=== Installing Command Code Go Provider for OMP ==="

mkdir -p "$EXT_DIR"

if [ -d "$TARGET_DIR/.git" ]; then
  echo "Existing installation found. Pulling latest updates..."
  git -C "$TARGET_DIR" pull --ff-only
else
  echo "Cloning repository into $TARGET_DIR..."
  git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
fi

echo "Registering auto-loader in $LOADER_FILE..."
cat << 'EOF' > "$LOADER_FILE"
import extension from "./pi-commandcode-go-provider/index.ts";
export default extension;
EOF

echo ""
echo "=== Installation Complete! ==="
echo "The provider is now automatically loaded by OMP."
echo "Use:"
echo "  omp --model commandcode-go/deepseek/deepseek-v4.1-flash"
echo "  or inside an interactive session: /model commandcode-go/deepseek/deepseek-v4.1-flash"
echo "To update anytime, run /commandcode-go-update inside OMP or re-run this script."
