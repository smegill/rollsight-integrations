# Troubleshooting: "Failed to fetch package manifest" on The Forge

If Forge (or Foundry) reports **"Failed to install module: Failed to fetch package manifest"** or the **download link** returns **Not Found**, both URLs must be publicly reachable. Fix the following.

---

## 1. Repo must be public

**raw.githubusercontent.com** and **GitHub release asset** URLs return **404** for **private** repositories when accessed without authentication. Foundry/Forge do not send your GitHub token, so they get 404.

**Fix:** Make the repo public.

- GitHub: **Settings** → **General** → **Danger Zone** → **Change repository visibility** → **Public**.

After the repo is public, open the manifest URL in an incognito window. You should see JSON (the contents of `module.json`), not a login or 404 page:

```text
https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json
```

---

## 2. Download URL needs a release with the zip

The **download** URL in `module.json` is:

```text
https://github.com/smegill/rollsight-integrations/releases/latest/download/rollsight-integration.zip
```

That URL only works if:

1. At least one **Release** exists (e.g. tag `v1.0.0`).
2. That release has an **asset** named **`rollsight-integration.zip`** attached.

**Fix:** Create a release and attach the zip.

1. **Build the zip** (from repo root):
   ```bash
   ./foundry_module/build-release-zip.sh
   ```
   This creates `foundry_module/rollsight-integration.zip`.

2. **Create a GitHub Release:**
   - Repo → **Releases** → **Create a new release**.
   - **Choose a tag** (e.g. `v1.0.0`). Create the tag if needed (e.g. "v1.0.0").
   - **Attach** `foundry_module/rollsight-integration.zip`.
   - The asset **name** must be exactly **`rollsight-integration.zip`** (so "latest" points to it).
   - Publish the release.

3. **Check the download URL** in an incognito window:
   ```text
   https://github.com/smegill/rollsight-integrations/releases/latest/download/rollsight-integration.zip
   ```
   It should download the zip, not show Not Found.

---

## 3. Foundry still sees an old version (e.g. 1.0.0 after releasing 1.0.1)

The **manifest** is served from the **default branch** of the repo (the raw `module.json` file), **not** from the release. The release only provides the zip. So Foundry sees the version that is in `module.json` on whatever branch the manifest URL points to.

**Do this:**

1. **Confirm the default branch on GitHub**  
   Open the repo (e.g. `https://github.com/smegill/rollsight-integrations`). The default branch is shown near the top (often **main** or **master**).

2. **Use that branch in the manifest URL**  
   - If the default branch is **main**, use:
     ```text
     https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json
     ```
   - If the default branch is **master**, use:
     ```text
     https://raw.githubusercontent.com/smegill/rollsight-integrations/master/rollsight-integration/module.json
     ```
   Foundry (and “Check for Updates”) use whatever manifest URL you installed from. If you originally used `main` but the repo’s default is `master` (or the other way around), the raw URL can 404 or serve an old file. **Re-install the module using the correct manifest URL** (with the right branch), then Check for Updates.

3. **Verify the raw URL in a browser**  
   Open the manifest URL in a private/incognito window. You should see JSON with `"version": "1.0.1"` (or the version you expect). If you see 1.0.0 or 404, then:
   - The version bump isn’t on that branch → push a commit that sets `"version": "1.0.1"` in `rollsight-integration/module.json` on the public repo’s default branch (run `./foundry_module/release.sh` from the private repo to subtree-push).
   - The branch in the URL is wrong → use the default branch (step 1).
   - The repo or path is wrong → fix the repo name or path in the URL.

4. **Re-add the module in Foundry**  
   **Setup** → **Add-on Modules** → remove **Rollsight Real Dice Reader** if needed → **Install Module** → paste the **correct** manifest URL (with the right branch) → Install. Foundry will fetch the manifest from that URL and show the version from that file.

---

## 4. Checklist

- [ ] Repo **smegill/rollsight-integrations** is **Public**.
- [ ] You can open the **manifest** URL in incognito and see JSON:  
  `https://raw.githubusercontent.com/smegill/rollsight-integrations/main/rollsight-integration/module.json`
- [ ] At least one **Release** exists with asset **rollsight-integration.zip**.
- [ ] You can open the **download** URL in incognito and get the zip:  
  `https://github.com/smegill/rollsight-integrations/releases/latest/download/rollsight-integration.zip`

Then try **Install Module** on Forge again with the manifest URL.

---

## 5. Optional: use jsDelivr for the manifest (public repos only)

If raw.githubusercontent.com is slow or blocked, you can use **jsDelivr** for the **manifest** URL only (the zip still comes from GitHub Releases):

**Manifest URL (jsDelivr):**
```text
https://cdn.jsdelivr.net/gh/smegill/rollsight-integrations@main/rollsight-integration/module.json
```

In that case, the **download** URL in `module.json` should still point to GitHub Releases (as above). Do **not** change the download URL to jsDelivr unless you host the zip there separately.

If you use the jsDelivr manifest URL, paste that into Forge’s **Manifest URL** instead of the raw.githubusercontent.com URL.
