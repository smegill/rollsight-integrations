# Installing Rollsight Real Dice Reader on The Forge VTT

The Forge does not give you filesystem access to Foundry’s `Data` folder. You install modules using Foundry’s **Install Module** flow and a **Manifest URL**. This guide covers both: how to install on The Forge (for GMs), and how to publish the module so that manifest URL works (for maintainers).

---

## For GMs: Install on Your Forge World

1. **Get the Manifest URL** from the module author or the project’s README. For this repo:
   ```text
   https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json
   ```
   Installing via this URL gives access only to the Foundry module (the release zip); it does not expose the rest of the repository.

2. **In Foundry (your Forge instance):**
   - Go to **Setup** → **Add-on Modules**.
   - Click **Install Module**.
   - In **Manifest URL**, paste the manifest URL.
   - Click **Install**.
   - Foundry will download the module and place it in `Data/modules/rollsight-integration/`.

3. **Enable the module in your world:**
   - Open your **world**.
   - Go to **Settings** → **Manage Modules**.
   - Enable **Rollsight Real Dice Reader**.
   - Reload or continue.

4. **(Optional)** Configure **Roll request URL** and **Fallback to chat** under **Configure Settings** → **Rollsight Real Dice Reader**. Players choose **Rollsight (Physical Dice)** per die in **Setup** → **Dice Configuration** (Foundry v12+).

**If you get "Failed to fetch package manifest" or the download link is Not Found:** see **TROUBLESHOOT_FORGE_INSTALL.md**. Usually the repo must be **public** and a **Release** with the zip attached must exist.

---

## For Maintainers: Publish So the Manifest URL Works

For **Install Module** to work on The Forge (or any Foundry host), two things must be true:

1. The **manifest URL** returns the module’s `module.json` (with a valid `download` URL).
2. The **download URL** (in that `module.json`) returns a **zip file** that, when extracted, gives a folder `rollsight-integration` containing `module.json`, `rollsight.js`, and the rest of the module files.

### Step 1: URLs in `module.json`

Foundry needs a **public** repo. This project uses **rollsight-integrations** (`smegill/rollsight-integrations`) for the manifest and releases; your main repo (rollsight) can stay private. In `foundry_module/rollsight-integration/module.json` the URLs are:

- **url**: `https://github.com/smegill/rollsight-integrations`
- **manifest**: `https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json`
- **download**: `https://github.com/smegill/rollsight-integrations/releases/latest/download/rollsight-integration.zip`

Use the branch name you actually use (e.g. `main`) in the manifest URL.

### Step 2: Release (one command)

From the **dicecam** repo root, run:

```bash
./foundry_module/release.sh
```

That bumps the version, builds the zip, commits, pushes to **rollsight-integrations** (public repo), optionally pushes to **origin** (private), and creates a GitHub release with the zip on the public repo (if `gh` is installed). Use `./foundry_module/release.sh -y` to skip the confirmation prompt. See **foundry_module/RELEASE.md** for details.

If you don't use `gh`, after the script pushes: go to https://github.com/smegill/rollsight-integrations/releases/new, create tag `vX.Y.Z`, upload `foundry_module/rollsight-integration.zip`, publish.

The **download** URL in `module.json` should match how GitHub serves the asset:

- **Latest release:**  
  `https://github.com/OWNER/dicecam/releases/latest/download/rollsight-integration.zip`  
  (GitHub redirects “latest” to the newest release.)

- **Specific version:**  
  `https://github.com/OWNER/dicecam/releases/download/v1.0.0/rollsight-integration.zip`

If you use `releases/latest/download/...`, every new release that includes `rollsight-integration.zip` will be used when users install or update.

### Step 4: Share the manifest URL with users

Give GMs this URL to paste in **Install Module**:

```text
https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json
```

Only the Foundry module (the release zip) is downloaded when they install; the rest of the repo is not exposed.

---

## Checklist (maintainers)

- [ ] `module.json` has correct url/manifest/download for the public repo (smegill/rollsight-integrations).
- [ ] Ran `./foundry_module/build-release-zip.sh` and have `rollsight-integration.zip`.
- [ ] Created a GitHub Release and attached `rollsight-integration.zip`.
- [ ] Manifest URL (raw `module.json`) is public and returns JSON.
- [ ] Shared the manifest URL with Forge (and other) users.

After that, anyone on The Forge (or any Foundry host) can install the module via **Setup** → **Add-on Modules** → **Install Module** → paste manifest URL.
