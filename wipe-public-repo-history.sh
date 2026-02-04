#!/usr/bin/env bash
# Retroactively make the public repo (rollsight-integrations) VTT-only for ALL history.
# Runs: subtree split (so every commit only has foundry_module/), force-push, then
# re-tags so existing GitHub Releases (v1.0.81, etc.) point to the correct new commits.
#
# Run from the PRIVATE repo root (dicecam). Requires: git, remote "rollsight-integrations".
# Compatible with Bash 3.2 (macOS default).
#
# Usage: ./foundry_module/wipe-public-repo-history.sh [--dry-run]
# Use --dry-run to print what would be done without pushing or re-tagging.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
PUBLIC_BRANCH="public-main"
REMOTE="${REMOTE:-rollsight-integrations}"
DRY_RUN=false
[[ "$1" == "--dry-run" ]] && DRY_RUN=true
VERSION_MAP_FILE="${TMPDIR:-/tmp}/rollsight-version-map.$$"

echo "=== Wipe public repo history to VTT-only ==="
echo "Remote: $REMOTE (main will be replaced with subtree of foundry_module/)"
echo ""

# 1. Subtree split: new branch where every commit only has foundry_module/ at root
if git show-ref --quiet "refs/heads/$PUBLIC_BRANCH"; then
  echo "Branch $PUBLIC_BRANCH already exists; deleting so we can re-create..."
  git branch -D "$PUBLIC_BRANCH"
fi
echo "Creating VTT-only history (subtree split)..."
git subtree split --prefix=foundry_module -b "$PUBLIC_BRANCH"
echo "  -> Branch $PUBLIC_BRANCH created (root = contents of foundry_module/)."
echo ""

# 2. Build version -> commit map (Bash 3.2 safe: use a temp file instead of associative array)
echo "Mapping version -> commit in new history..."
: > "$VERSION_MAP_FILE"
while read -r commit; do
  version=$(git show "$commit:rollsight-integration/module.json" 2>/dev/null | grep '"version"' | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/' | head -1)
  if [[ -n "$version" ]]; then
    if ! grep -q "^${version} " "$VERSION_MAP_FILE" 2>/dev/null; then
      echo "$version $commit" >> "$VERSION_MAP_FILE"
    fi
  fi
done < <(git rev-list "$PUBLIC_BRANCH" -- rollsight-integration/module.json)

if [[ ! -s "$VERSION_MAP_FILE" ]]; then
  echo "  No versions found in module.json on $PUBLIC_BRANCH. Check subtree split."
  rm -f "$VERSION_MAP_FILE"
  exit 1
fi
echo "  Found versions: $(cut -d' ' -f1 "$VERSION_MAP_FILE" | sort -V | tr '\n' ' ')"
echo ""

# 3. Force-push to replace main
echo "Force-pushing $PUBLIC_BRANCH -> $REMOTE main (replaces existing history)..."
if $DRY_RUN; then
  echo "  [DRY-RUN] would run: git push $REMOTE $PUBLIC_BRANCH:main --force"
else
  git push "$REMOTE" "$PUBLIC_BRANCH:main" --force
fi
echo ""

# 4. Re-tag: point version tags to commits in the new history (overwrites remote tags)
echo "Re-tagging so releases point to new VTT-only commits..."
while read -r line; do
  version="${line%% *}"
  commit="${line#* }"
  tag="v$version"
  if $DRY_RUN; then
    echo "  [DRY-RUN] would tag $commit as $tag and force-push $tag to $REMOTE"
  else
    git tag -f "$tag" "$commit"
    git push "$REMOTE" "$tag" --force
  fi
done < <(sort -V "$VERSION_MAP_FILE")
rm -f "$VERSION_MAP_FILE"
echo ""

if $DRY_RUN; then
  echo "[DRY-RUN] Done. Run without --dry-run to apply."
  git branch -D "$PUBLIC_BRANCH" 2>/dev/null || true
  exit 0
fi

# 5. Clean up local branch
echo "Deleting local branch $PUBLIC_BRANCH..."
git branch -D "$PUBLIC_BRANCH" 2>/dev/null || true

echo ""
echo "=== Done ==="
echo "Public repo main and all tagged releases now contain only VTT files."
echo "Manifest URL: https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json"
echo "On GitHub: check that each Release (v1.0.81, etc.) still has its zip; re-point to the new tag if needed."
