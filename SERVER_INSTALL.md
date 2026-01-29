# Loading Rollsight Integration on the Foundry Server

This guide covers what must be present on the machine where Foundry VTT runs so the Rollsight Integration module can be loaded and used.

---

## 1. What the Foundry Server Loads

Foundry loads **modules** from its **Data** directory. The module is **client-side**: it runs in each player’s browser when they have the world open. The “server” only needs to:

- Have the module **files** in `Data/modules/rollsight-integration/`
- Serve those files to the client when the world loads

No custom server-side code or Node processes are required for the module itself.

---

## 2. Install the Module on the Foundry Server

### Option A: Manual copy (recommended for development)

1. **Locate Foundry’s Data directory** on the server:
   - **Windows**: `%localappdata%\FoundryVTT\Data\`
   - **macOS**: `~/Library/Application Support/FoundryVTT/Data/`
   - **Linux**: `~/.local/share/FoundryVTT/Data/` or your configured path
   - **Docker / custom**: Use the path where you mounted or configured `Data/`

2. **Copy the module** into `Data/modules/`:
   - Source: the `rollsight-integration` folder from this repo (`foundry_module/rollsight-integration/`)
   - Target: `Data/modules/rollsight-integration/`

   The target folder must contain at least:
   - `module.json`
   - `rollsight.js`
   - `fulfillment-provider.js`
   - `socket-handler.js`
   - `chat-handler.js`
   - `dice-handler.js`
   - `roll-request-handler.js`
   - `templates/roll-message.html` (if used)

3. **Restart Foundry** (or reload the world) so it picks up the new module.

### Option B: Install script (from this repo)

From the **dicecam** repo root:

```bash
# Set your Foundry Data path, then run:
export FOUNDRY_DATA="$HOME/Library/Application Support/FoundryVTT/Data"   # macOS example
./foundry_module/install-to-foundry.sh
```

Or with an explicit path:

```bash
./foundry_module/install-to-foundry.sh "/path/to/FoundryVTT/Data"
```

The script copies `foundry_module/rollsight-integration` to `Data/modules/rollsight-integration/`. See the script for details.

### Option C: Manifest URL (The Forge and other hosts)

**On The Forge** you don’t have filesystem access; install via **Setup** → **Add-on Modules** → **Install Module** using the **Manifest URL**. See **FORGE_INSTALL.md** for the exact steps and the URL to use.

To **publish** the module so that manifest URL works (create release, zip, upload):

1. Edit `module.json`: replace `YOUR_GITHUB_USERNAME` in `url`, `manifest`, and `download` with your GitHub user/org (see FORGE_INSTALL.md).
2. Run `./foundry_module/build-release-zip.sh` to create `rollsight-integration.zip`.
3. Create a GitHub Release and attach that zip; the `download` URL in `module.json` should point to it (e.g. `releases/latest/download/rollsight-integration.zip`).
4. Share the manifest URL (raw `module.json` from your repo) with users; they paste it in **Setup** → **Add-on Modules** → **Install Module**.

Foundry will then download and place the module under `Data/modules/` for you. **Forge users:** use this method; full details in **FORGE_INSTALL.md**.

---

## 3. Enable the Module in a World

After the module is under `Data/modules/`:

1. Open the **world** in Foundry (as GM).
2. Go to **Settings** → **Manage Modules**.
3. Enable **Rollsight Integration**.
4. Click **Update Modules** or reload the world.

The module will load in every client that joins that world.

---

## 4. World Settings (Optional)

Once the module is enabled, the GM can configure ( **Settings** → **Configure Settings** → **Rollsight Integration** ):

| Setting | Purpose |
|--------|--------|
| **Auto-connect to Rollsight** | Legacy; can be left off. Connection is via browser extension / postMessage. |
| **Fallback to chat when no pending roll** | When no RollResolver is open, send Rollsight rolls to chat. Default: on. |
| **Roll request URL** | If set, when a RollResolver opens for Rollsight the module POSTs the formula here (e.g. `http://localhost:8765/foundry/roll-request`) so Rollsight can show “Foundry is waiting for: 1d20”. |

Players choose **Rollsight (Physical Dice)** per die type in **Setup** → **Dice Configuration** (Foundry v12+).

---

## 5. Checklist for the Server Host

- [ ] Foundry Data directory identified (e.g. `Data/` on the server).
- [ ] `rollsight-integration` folder copied to `Data/modules/rollsight-integration/` with all JS files and `module.json`.
- [ ] Foundry restarted or world reloaded.
- [ ] In the world: **Manage Modules** → **Rollsight Integration** enabled.
- [ ] (Optional) **Roll request URL** set if using roll-request notifications to Rollsight.

No extra services or ports are required on the Foundry server for the module to load. Rollsight and the browser extension run on the **player’s machine** and communicate with the Foundry **client** in the browser (e.g. via postMessage).
