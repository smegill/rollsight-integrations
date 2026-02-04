#!/usr/bin/env bash
# Copy the Rollsight Real Dice Reader module into Foundry VTT Data/modules/
# so it can be loaded by the Foundry server.
#
# Usage:
#   FOUNDRY_DATA=/path/to/FoundryVTT/Data ./install-to-foundry.sh
#   ./install-to-foundry.sh /path/to/FoundryVTT/Data
#
# Default FOUNDRY_DATA (if unset and no arg):
#   macOS:  ~/Library/Application Support/FoundryVTT/Data
#   Linux: ~/.local/share/FoundryVTT/Data
#   Windows (Git Bash): $LOCALAPPDATA/FoundryVTT/Data

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_SRC="${SCRIPT_DIR}/rollsight-integration"
MODULE_NAME="rollsight-integration"

# Resolve target Data directory
if [ -n "$1" ]; then
  FOUNDRY_DATA="$1"
elif [ -n "$FOUNDRY_DATA" ]; then
  :
elif [ "$(uname -s)" = "Darwin" ]; then
  FOUNDRY_DATA="${HOME}/Library/Application Support/FoundryVTT/Data"
elif [ "$(uname -s)" = "Linux" ]; then
  FOUNDRY_DATA="${HOME}/.local/share/FoundryVTT/Data"
else
  FOUNDRY_DATA="${LOCALAPPDATA:-$HOME/AppData/Local}/FoundryVTT/Data"
fi

TARGET="${FOUNDRY_DATA}/modules/${MODULE_NAME}"

if [ ! -d "$MODULE_SRC" ]; then
  echo "Error: Module source not found: $MODULE_SRC"
  exit 1
fi

if [ ! -f "$MODULE_SRC/module.json" ]; then
  echo "Error: $MODULE_SRC/module.json not found. Is this the dicecam foundry_module directory?"
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"

echo "Installing Rollsight Real Dice Reader module"
echo "  From: $MODULE_SRC"
echo "  To:   $TARGET"
echo ""

if [ -d "$TARGET" ]; then
  echo "Target already exists; syncing (copy over)."
  rsync -a --delete --exclude='.git' "$MODULE_SRC/" "$TARGET/" 2>/dev/null || {
    echo "rsync not found; using cp (existing files will be overwritten)."
    rm -rf "$TARGET"
    cp -R "$MODULE_SRC" "$TARGET"
  }
else
  cp -R "$MODULE_SRC" "$TARGET"
fi

echo "Done. Restart Foundry or reload the world, then enable 'Rollsight Real Dice Reader' in Manage Modules."
