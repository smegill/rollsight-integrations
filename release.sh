#!/usr/bin/env bash
# One-command Foundry module release: bump version, build zip, push to public repo, create GitHub release.
# Foundry needs a PUBLIC repo (rollsight-integrations). Your main repo (rollsight) stays private.
# Run from repo root: ./foundry_module/release.sh
# Requires: git, zip, remote "rollsight-integrations", and optionally `gh` for creating the release.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_JSON="${REPO_ROOT}/foundry_module/rollsight-integration/module.json"
BUILD_SCRIPT="${REPO_ROOT}/foundry_module/build-release-zip.sh"
ZIP_PATH="${REPO_ROOT}/foundry_module/rollsight-integration.zip"
RELEASE_NOTES_FILE="${REPO_ROOT}/foundry_module/RELEASE_NOTES.md"

if [ ! -f "$MODULE_JSON" ]; then
  echo "Error: module.json not found at $MODULE_JSON"
  exit 1
fi

# Read current version (e.g. "1.0.2")
CURRENT=$(grep '"version"' "$MODULE_JSON" | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/')
if [ -z "$CURRENT" ]; then
  echo "Error: could not read version from module.json"
  exit 1
fi

# Bump patch (1.0.2 -> 1.0.3)
MAJOR=$(echo "$CURRENT" | cut -d. -f1)
MINOR=$(echo "$CURRENT" | cut -d. -f2)
PATCH=$(echo "$CURRENT" | cut -d. -f3)
PATCH=$((PATCH + 1))
NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

echo "Foundry module release: ${CURRENT} -> ${NEW_VERSION}"

# Update version in module.json (macOS and Linux compatible)
if sed --version 2>/dev/null | grep -q GNU; then
  sed -i "s/\"version\": \"${CURRENT}\"/\"version\": \"${NEW_VERSION}\"/" "$MODULE_JSON"
else
  sed -i '' "s/\"version\": \"${CURRENT}\"/\"version\": \"${NEW_VERSION}\"/" "$MODULE_JSON"
fi

# Build zip
"$BUILD_SCRIPT"

# Build release notes (append to RELEASE_NOTES.md)
RELEASE_DATE="$(date +%Y-%m-%d)"
LAST_RELEASE_COMMIT=$(git log -1 --grep "Release Foundry module v" --format="%H" 2>/dev/null || true)
if [ -n "$LAST_RELEASE_COMMIT" ]; then
  CHANGE_RANGE="${LAST_RELEASE_COMMIT}..HEAD"
else
  CHANGE_RANGE="HEAD"
fi

# Collect changes limited to Foundry module files
CHANGES=$(git log --oneline $CHANGE_RANGE -- \
  foundry_module/rollsight-integration \
  foundry_module/*.md \
  foundry_module/*.sh 2>/dev/null || true)

if [ -z "$CHANGES" ]; then
  CHANGES="(no Foundry module changes detected)"
fi

{
  echo "## v${NEW_VERSION} - ${RELEASE_DATE}"
  echo ""
  echo "$CHANGES" | sed -E 's/^/- /'
  echo ""
} >> "$RELEASE_NOTES_FILE"

# Create a notes file for the GitHub release
RELEASE_NOTES_TMP="$(mktemp)"
{
  echo "## Changes"
  echo ""
  echo "$CHANGES" | sed -E 's/^/- /'
  echo ""
  echo "## Install"
  echo ""
  echo "Manifest: https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json"
  echo ""
} > "$RELEASE_NOTES_TMP"

# Commit and push
cd "$REPO_ROOT"
git add foundry_module/rollsight-integration/module.json "$RELEASE_NOTES_FILE"
git status --short
if [ "$1" != "-y" ] && [ "$1" != "--yes" ]; then
  echo "Commit and push Foundry module v${NEW_VERSION}? (y/n)"
  read -r CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Aborted. Restore version with: sed -i '' 's/${NEW_VERSION}/${CURRENT}/' $MODULE_JSON"
    exit 0
  fi
fi
git commit -m "Release Foundry module v${NEW_VERSION}"

# Push only foundry_module subtree to public repo (VTT integrations only).
# If this fails (e.g. first time), run the one-time setup in PUBLIC_REPO_SETUP.md.
echo "Pushing to rollsight-integrations (public, foundry_module only)..."
git subtree push rollsight-integrations main --prefix=foundry_module

# Optionally push to private repo to keep in sync
if git remote get-url origin &>/dev/null; then
  echo "Pushing to origin (private)..."
  git push origin main 2>/dev/null || echo "  (origin push skipped or failed - OK if private)"
fi

# Create GitHub release on the PUBLIC repo (Foundry downloads from here)
if command -v gh &>/dev/null; then
  echo "Creating GitHub release v${NEW_VERSION} on rollsight-integrations..."
  gh release create "v${NEW_VERSION}" "$ZIP_PATH" \
    --repo smegill/rollsight-integrations \
    --title "Foundry module v${NEW_VERSION}" \
    --notes-file "$RELEASE_NOTES_TMP"
  echo "Done. Foundry users can Check for Updates or install from the manifest URL."
else
  echo "GitHub CLI (gh) not installed. Create release manually on the PUBLIC repo:"
  echo "  1. Go to https://github.com/smegill/rollsight-integrations/releases/new"
  echo "  2. Tag: v${NEW_VERSION}  Title: Foundry module v${NEW_VERSION}"
  echo "  3. Upload: ${ZIP_PATH}"
  echo "  4. Publish"
  echo "  Manifest URL: https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json"
fi

# Cleanup
rm -f "$RELEASE_NOTES_TMP"
