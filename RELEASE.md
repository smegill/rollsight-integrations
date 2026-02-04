# Foundry Module Release (Simple Pipeline)

**One command.** Foundry needs a **public** repo; your main repo (rollsight) stays private. The public repo is **rollsight-integrations**. Manifest uses raw GitHub (no CDN cache).

## Install manifest URL (for Foundry)

Use this when installing or updating the module in Foundry:

```
https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json
```

Foundry fetches the manifest and zip from the **public** repo `smegill/rollsight-integrations`.

## How to release a new Foundry version

From the repo root:

```bash
./foundry_module/release.sh
```

That script:

1. Bumps the patch version in `module.json` (e.g. 1.0.2 → 1.0.3)
2. Builds `foundry_module/rollsight-integration.zip`
3. Subtree-pushes only **foundry_module/** to **rollsight-integrations** (public repo has VTT code only — see PUBLIC_REPO_SETUP.md for one-time cleanup)
4. Optionally pushes to **origin** (your private rollsight repo) to keep it in sync
5. Creates a GitHub release with the zip on **rollsight-integrations** (if `gh` is installed), or prints manual steps

**Non-interactive:** `./foundry_module/release.sh -y` skips the "Commit and push? (y/n)" prompt.

**Without GitHub CLI:** After the script pushes, create a release on the **public** repo: https://github.com/smegill/rollsight-integrations/releases/new — tag `vX.Y.Z`, upload `foundry_module/rollsight-integration.zip`.

## First-time setup

- **Remote `rollsight-integrations`:** Add the public repo if needed: `git remote add rollsight-integrations https://github.com/smegill/rollsight-integrations.git`
- **Public repo VTT-only (one-time):** If the public repo currently has the full dicecam tree, run the one-time steps in **foundry_module/PUBLIC_REPO_SETUP.md** so only the Foundry module (and release tooling) is on the public repo. After that, `release.sh` uses subtree push so only VTT code is pushed.
- **GitHub CLI (`gh`):** Install and `gh auth login` so the script can create releases on the public repo. Optional; you can create releases in the browser instead.

## Summary

| Before | After |
|--------|--------|
| Push to origin, then push to rollsight-integrations by hand | One command: push to rollsight-integrations + optional origin |
| Manifest from jsDelivr, cache issues | Manifest from raw GitHub (rollsight-integrations main) |
| Bump version, build zip, commit, push, create release, upload zip by hand | `./foundry_module/release.sh` (or `-y`) |

**Why two repos?** Foundry (and users) need a **public** repo to fetch the manifest and zip. Your main repo (rollsight) stays **private**. The release script pushes to the public repo and creates the release there.
