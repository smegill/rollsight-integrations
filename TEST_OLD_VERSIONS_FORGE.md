# Testing Older Module Versions on The Forge

On Forge you install via **Manifest URL**. Foundry fetches that URL (your `module.json`), then uses the **download** URL inside it to get the zip. So to test an old version you need a manifest URL that serves that version’s `module.json` **and** that file must point at that version’s zip (not `latest`).

**Current (main) install URL:**  
`https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json`  
(The public repo only contains VTT code; see PUBLIC_REPO_SETUP.md.)

## Quick approach: versioned manifest branches

Create a branch for each version you want to test. That branch contains the module code for that version and a `module.json` with **version-specific** manifest and download URLs. You then use that branch in the manifest URL on Forge.

### 1. Create a manifest branch for one version

From the repo root (e.g. `dicecam`), run the helper script:

```bash
./foundry_module/create-version-manifest-branch.sh 1.0.81
```

This will:

- Create a branch `manifest/v1.0.81` from the commit that released 1.0.81.
- Update `module.json` so that:
  - **manifest** = `https://raw.githubusercontent.com/smegill/rollsight-integrations/manifest/v1.0.81/foundry_module/rollsight-integration/module.json`
  - **download** = `https://github.com/smegill/rollsight-integrations/releases/download/v1.0.81/rollsight-integration.zip`
- Commit the change.

### 2. Push the branch to the public repo

Push the new branch to the repo Forge uses (e.g. `rollsight-integrations`):

```bash
git push rollsight-integrations manifest/v1.0.81
```

(If your remote for the public repo has another name, use that instead.)

### 3. Install / reinstall on Forge with that manifest

1. In Foundry: **Setup → Add-on Modules**.
2. If the module is already installed, remove it (or use **Update** only if you’re testing a branch you’ve used before).
3. **Install Module** → paste this as the **Manifest URL**:

   ```
   https://raw.githubusercontent.com/smegill/rollsight-integrations/manifest/v1.0.81/foundry_module/rollsight-integration/module.json
   ```

4. Install. Foundry will load the manifest from that branch and the zip from the **v1.0.81** release.

### 4. Test and repeat for other versions

- Test 1.0.81. If it’s good, try the next (e.g. 1.0.82).
- For 1.0.82:

  ```bash
  ./foundry_module/create-version-manifest-branch.sh 1.0.82
  git push rollsight-integrations manifest/v1.0.82
  ```

  Then use this manifest URL on Forge:

  ```
  https://raw.githubusercontent.com/smegill/rollsight-integrations/manifest/v1.0.82/foundry_module/rollsight-integration/module.json
  ```

Repeat for 1.0.83, 1.0.84, … until you see the version where things break.

## Requirement: release zips must exist

The **download** URL uses GitHub Releases:  
`releases/download/v1.0.81/rollsight-integration.zip`

So for each version you want to test (e.g. 1.0.81, 1.0.82), there must be a **Release** on the public repo with tag **v1.0.81** (or v1.0.82, etc.) and an asset **rollsight-integration.zip**. If you’ve been releasing with `release.sh` and `gh`, those releases and zips should already be there. If a version was never released, create that release (and upload the zip) once, then the manifest branch for that version will work.

## Version → commit map (for reference)

| Version | Commit   |
|---------|----------|
| 1.0.81  | e8004b5  |
| 1.0.82  | 16a7c44  |
| 1.0.83  | 6ed4bcd  |
| 1.0.84  | fde6344  |
| 1.0.85  | a9867ad  |
| 1.0.86  | fb1aac5  |
| 1.0.87  | 63445ae  |
| 1.0.88  | e0ed1fb  |
| 1.0.89  | 9a5025a  |
| 1.0.90  | 8a65aa5  |
| 1.0.91  | 4b9eb71  |
| 1.0.92  | a62ecb8  |

## Summary

- You do **not** copy files to the Forge server; you point Foundry at a **manifest URL**.
- To test an old version, use a **manifest URL that points at a branch** (or tag) where `module.json` has a **version-specific download** URL for that version’s zip.
- The script creates that branch and updates `module.json`. You push the branch and use its raw `module.json` URL on Forge.
