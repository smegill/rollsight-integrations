# Public Repo (rollsight-integrations): VTT-Only Layout

The **public** repo `smegill/rollsight-integrations` should contain **only VTT integration code** (the Foundry module and release tooling), not the full dicecam app (website, scripts, pico firmware, etc.). The full project stays in your **private** repo (rollsight/dicecam).

## How it works

- **Private repo (dicecam):** Full codebase — Rollsight app, website, scripts, pico_firmware, **and** `foundry_module/`.
- **Public repo (rollsight-integrations):** Only the contents of `foundry_module/` at the **root**. So the public repo has:
  - `rollsight-integration/` (the Foundry module)
  - `release.sh`, `build-release-zip.sh`, docs, etc.
  - No `website/`, `scripts/`, `pico_firmware/`, etc.

Pushing to the public repo is done with **git subtree push** so only `foundry_module/` is sent. The manifest URL for Foundry is:

`https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json`

(No `foundry_module/` in the path, because that folder's contents are at the public repo root.)

## One-time cleanup: VTT-only history (retroactive wipe)

If the public repo has ever had the full dicecam tree (website, scripts, pico_firmware, etc.), **all history** can be rewritten so every commit and every release contains only VTT files. Use the wipe script.

**From your private repo root (dicecam):**

```bash
# Preview what would be done
./foundry_module/wipe-public-repo-history.sh --dry-run

# Apply: rewrite public repo history to VTT-only and re-tag releases
./foundry_module/wipe-public-repo-history.sh
```

The script: (1) subtree-splits `foundry_module/` into a new branch where every commit has only that content at repo root; (2) force-pushes that branch to `rollsight-integrations` `main`; (3) re-tags so each version tag (v1.0.81, v1.0.82, …) points to the correct commit in the new history (existing GitHub Releases and zip assets stay); (4) deletes the temporary local branch.

After this, the public repo has **no** non-VTT files in any commit or release. Then use `./foundry_module/release.sh` for normal releases (subtree push).

**Optional:** If you previously pushed version-test branches (e.g. `manifest/v1.0.81`) that contained the full repo, delete them on the remote: `git push rollsight-integrations --delete manifest/v1.0.81` (repeat for each such branch).

**Warning:** Force-push overwrites `main` and updates tags. Anyone who cloned the old repo will see a different history. That's expected for this one-time wipe.

## Normal releases (after one-time setup)

Run from repo root:

```bash
./foundry_module/release.sh
```

This will:

1. Bump version in `module.json`
2. Build the zip
3. Commit the version bump
4. **Subtree push** only `foundry_module/` to `rollsight-integrations` `main`
5. Push to origin (private) if configured
6. Create a GitHub release with the zip (if `gh` is installed)

No app code, website, or scripts are pushed to the public repo.
