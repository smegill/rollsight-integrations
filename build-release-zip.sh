#!/usr/bin/env bash
# Build rollsight-integration.zip for uploading to a GitHub Release.
# Foundry expects the zip to extract to a folder containing module.json, etc.
#
# Usage: from repo root, run:
#   ./foundry_module/build-release-zip.sh
#
# Output: foundry_module/rollsight-integration.zip

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_SRC="${SCRIPT_DIR}/rollsight-integration"
ZIP_NAME="rollsight-integration.zip"
OUTPUT_ZIP="${SCRIPT_DIR}/${ZIP_NAME}"

if [ ! -f "${MODULE_SRC}/module.json" ]; then
  echo "Error: ${MODULE_SRC}/module.json not found."
  exit 1
fi

cd "$SCRIPT_DIR"
rm -f "$ZIP_NAME"
if command -v zip >/dev/null 2>&1; then
  zip -r "$ZIP_NAME" rollsight-integration -x "*.git*" -x "*__MACOSX*" -x "*.DS_Store"
elif command -v powershell.exe >/dev/null 2>&1; then
  # Git Bash on Windows often lacks `zip`; PowerShell Compress-Archive works.
  powershell.exe -NoProfile -Command "Compress-Archive -Path 'rollsight-integration' -DestinationPath '${ZIP_NAME}' -Force"
else
  echo "Error: need 'zip' or PowerShell to build the release archive."
  exit 1
fi

echo "Built: ${OUTPUT_ZIP}"
echo "Upload this file to your GitHub Release as ${ZIP_NAME}."
