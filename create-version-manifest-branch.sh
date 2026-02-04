#!/usr/bin/env bash
# Create a branch for testing a specific module version on Forge.
# The branch contains that version's code and a module.json with version-specific
# manifest and download URLs, so you can point Forge at this branch's manifest URL.
#
# Usage: ./foundry_module/create-version-manifest-branch.sh 1.0.81
# Then:  git push rollsight-integrations manifest/v1.0.81
#
# Manifest URL to use on Forge (replace 1.0.81 with your version):
#   https://raw.githubusercontent.com/smegill/rollsight-integrations/manifest/v1.0.81/foundry_module/rollsight-integration/module.json

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_JSON="${REPO_ROOT}/foundry_module/rollsight-integration/module.json"
GITHUB_REPO="${GITHUB_REPO:-smegill/rollsight-integrations}"

# Version -> commit (release commits for Foundry module)
declare -A VERSION_COMMIT=(
  [1.0.81]=e8004b5
  [1.0.82]=16a7c44
  [1.0.83]=6ed4bcd
  [1.0.84]=fde6344
  [1.0.85]=a9867ad
  [1.0.86]=fb1aac5
  [1.0.87]=63445ae
  [1.0.88]=e0ed1fb
  [1.0.89]=9a5025a
  [1.0.90]=8a65aa5
  [1.0.91]=4b9eb71
  [1.0.92]=a62ecb8
)

VERSION="$1"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 1.0.81"
  echo "Creates branch manifest/v1.0.81 and sets version-specific manifest/download URLs."
  exit 1
fi

COMMIT="${VERSION_COMMIT[$VERSION]}"
if [ -z "$COMMIT" ]; then
  echo "Unknown version: $VERSION. Supported: ${!VERSION_COMMIT[*]}"
  exit 1
fi

BRANCH="manifest/v${VERSION}"
cd "$REPO_ROOT"

if git show-ref --quiet "refs/heads/$BRANCH"; then
  echo "Branch $BRANCH already exists. Use it or delete it first: git branch -D $BRANCH"
  exit 1
fi

echo "Creating branch $BRANCH from commit $COMMIT (v$VERSION)..."
git checkout -b "$BRANCH" "$COMMIT"

MANIFEST_URL="https://raw.githubusercontent.com/${GITHUB_REPO}/${BRANCH}/foundry_module/rollsight-integration/module.json"
DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/rollsight-integration.zip"

# Update module.json to version-specific URLs (macOS and Linux compatible)
if sed --version 2>/dev/null | grep -q GNU; then
  sed -i "s|\"manifest\": \"[^\"]*\"|\"manifest\": \"${MANIFEST_URL}\"|" "$MODULE_JSON"
  sed -i "s|\"download\": \"[^\"]*\"|\"download\": \"${DOWNLOAD_URL}\"|" "$MODULE_JSON"
else
  sed -i '' "s|\"manifest\": \"[^\"]*\"|\"manifest\": \"${MANIFEST_URL}\"|" "$MODULE_JSON"
  sed -i '' "s|\"download\": \"[^\"]*\"|\"download\": \"${DOWNLOAD_URL}\"|" "$MODULE_JSON"
fi

git add "$MODULE_JSON"
git commit -m "Manifest branch for v${VERSION}: version-specific manifest and download URLs"

echo ""
echo "Done. Next steps:"
echo "  1. Push to public repo:  git push rollsight-integrations $BRANCH"
echo "  2. On Forge, use Manifest URL:"
echo "     $MANIFEST_URL"
echo ""
echo "Then install or update the module on Forge with that URL to test v$VERSION."
