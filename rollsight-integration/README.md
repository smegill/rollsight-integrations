# RollSight Integration for Foundry VTT

This Foundry VTT module integrates with RollSight to receive physical dice rolls and send roll requests.

**Handoff note:** Rolls reach Foundry by one of three paths: **browser extension** (`postMessage` to the page), **local HTTP bridge** (Foundry desktop or any client that can reach the player’s RollSight machine), or **cloud room** (HTTPS long-poll to `rollsight.com` with a GM **room key** and per-user **player key**). The desktop app chooses local vs cloud when starting a **play session**; see the private repo’s `docs/ROLLSIGHT_PLAY_SESSION.md` and the site guide under `website/app/guides/foundry-vtt/`.

## Features

- **In-context rolls (Foundry v12+)**: In **Dice Configuration**, set die types you roll physically to **Manual** (not a separate “RollSight” fulfillment menu entry). The module intercepts the Manual / RollResolver flow and fills results from RollSight.
- **Receive physical rolls**: Rolls from RollSight are either fed into the active RollResolver (in-context) or, if none is open, sent to chat (configurable).
- **3D dice**: Triggers Foundry's 3D dice when a roll is fulfilled or sent to chat.
- **Roll amendments**: Updates chat messages when rolls are corrected in RollSight.
- **Roll requests**: Optional: when a RollResolver opens for physical dice, the module can POST to RollSight so the app shows "Foundry is waiting for: 1d20" (set **Roll request URL** in module settings).
- **Cloud room**: When enabled in module settings, the client polls **`GET /api/rollsight-room/events`** on the configured **RollSight API base URL** (default production site) using the **room key**; each player uses a **player key** from the RollSight desktop session dialog so publishes are attributed correctly.

## Installation

**Server / host:** For what must be loaded on the Foundry server and install options (manual copy, script, or manifest), see **SERVER_INSTALL.md** in the parent `foundry_module` folder.

### Method 1: Manual Installation

1. Copy the `rollsight-integration` folder into your Foundry VTT `Data/modules/` directory (see SERVER_INSTALL.md for Data paths).
2. Restart Foundry VTT (or reload the world).
3. In the world: **Settings** → **Manage Modules** → enable **RollSight Integration**.

### Method 2: Module Manifest (Recommended)

1. Add this module's manifest URL to Foundry's module browser
2. Install through Foundry's module installer

## Configuration

### 1. Enable the Module (GM)

1. Open your world in Foundry VTT (as GM).
2. Go to **Settings** → **Manage Modules**.
3. Enable **RollSight Integration**.
4. The module then runs for **all users** (GM and players). Players do not enable the module themselves; each player needs either the **extension + local RollSight**, **desktop Foundry + local bridge**, or **cloud room keys** plus the RollSight desktop app running with a matching play session, depending on the table’s chosen path.

**Making it available to everyone:** Once the GM enables the module in Manage Modules, it is active for every connected client. If your host (e.g. The Forge) has an option like "Include for players" or "Available to players" for this module, ensure it is set so the module loads for players. Players can confirm the module is active by opening **Configure Settings** → **RollSight Integration** and seeing the "RollSight Integration (this client)" option.

### 2. Dice Configuration (Foundry v12+)

To use physical dice **in-context** (e.g. for attack rolls, spell rolls):

1. Open **Setup** → **Dice Configuration** (or the equivalent in your Foundry version).
2. For each die type (d4, d6, d20, etc.) choose **Manual** as the fulfillment method for dice you will roll in RollSight.
3. When you roll (e.g. attack), Foundry opens the roll dialog; roll in RollSight and the module merges the result into that roll.

### 3. Configure RollSight Connection

The module receives rolls via one or more of:

- **RollSight VTT Bridge** browser extension (`postMessage` into the Foundry tab).
- **Desktop bridge** — HTTP poll against the PC running RollSight (default `http://127.0.0.1:8766`), required for **Foundry’s desktop app** where extensions do not run.
- **Cloud room** — HTTPS long-poll to the **RollSight API base URL** with **Room key** and **Player key** from the GM / player setup in the desktop app (no extension or LAN bridge required for that path).

**Local paths**

- **Browser (Chrome/Edge, etc.)**: Install the RollSight VTT Bridge extension; leave Desktop bridge **off** on that client unless you intentionally use poll-only delivery.
- **Foundry desktop app**: In **Configure Settings → Module Settings → RollSight Real Dice Reader**, enable **Desktop bridge (Foundry app — poll HTTP bridge)**. Keep RollSight running with an active play session that uses **Foundry (local bridge)** so its HTTP bridge is listening. Adjust **Desktop bridge base URL** only if you changed the bridge port in RollSight.

Do **not** enable Desktop bridge and the browser extension on the **same machine** for the same session — they share one roll queue and would compete for rolls.

**Cloud room:** Enable the cloud-room options in module settings, paste the **room key** the GM copied from RollSight, and **Generate / paste player key** per user (from each player’s RollSight session). The module polls **`/api/rollsight-room/events`**; the desktop app publishes to **`/api/rollsight-room/publish`**. Server operators need Supabase + `ROLLSIGHT_PLAYER_TOKEN_SECRET` configured (see private repo `docs/ROLLSIGHT_ENVIRONMENT_VARIABLES.md`).

**Desktop bridge not receiving rolls (Windows):** The module polls `http://127.0.0.1:8766` by default. If nothing happens, try **`http://localhost:8766`** as the Desktop bridge base URL, or update RollSight so its HTTP bridge binds to IPv4 (RollSight builds after 2026-03-21 bind `127.0.0.1` so `127.0.0.1` works reliably).

**`net::ERR_CONNECTION_REFUSED` on `/poll`:** Foundry can reach your machine, but **nothing is listening on that port** — usually RollSight is not running, the main window was never opened (bridge may not start), or the bridge failed to bind (e.g. port already in use). With RollSight open, confirm `http://127.0.0.1:8766/health` in a normal browser returns JSON.

### 4. Configure Webhook (Optional – Roll Requests)

To have RollSight show "Foundry is waiting for: 1d20" when a roll dialog opens:

1. In module settings, set **Roll request URL** (e.g. `http://localhost:8765/foundry/roll-request`).
2. When a RollResolver opens for a RollSight-configured die, the module POSTs the formula to that URL.

## Usage

### Automatic Roll Receiving

When dice are rolled in RollSight:

- **If a RollResolver is open** (e.g. you just clicked "Attack" and chose RollSight for d20): the result is applied to that roll in-context, then the roll completes (e.g. attack roll with your physical d20).
- **If combat has started and you have a combatant with no initiative yet**: a **single d20** roll from RollSight is applied to that combatant's initiative (so you are not forced to roll inside Foundry). See **INITIATIVE_ROLLS.md** for details.
- **If no roll is waiting**: the roll is sent to chat (unless **Fallback to chat** is disabled in module settings).
- 3D dice animate when enabled; the roll is attributed to the current user.

### Requesting Rolls from Foundry

To request a roll from RollSight (e.g., for a spell):

1. Use the module's API or create a macro
2. Example macro:
   ```javascript
   game.rollsight.requestRoll("8d6", {
     description: "Fireball damage"
   });
   ```
3. RollSight will prompt the user to roll manually or digitally

### Handling Corrections

When a roll is corrected in RollSight:
- The module receives an amendment
- The original chat message is updated with corrected values
- A note is added indicating the roll was corrected

## API Reference

### Request a Roll

```javascript
// Request a roll from RollSight
game.rollsight.requestRoll("8d6", {
  description: "Fireball damage",
  rollType: "normal" // or "advantage", "disadvantage"
});
```

### Check Connection Status

```javascript
// Check if connected to RollSight
game.rollsight.isConnected();
```

## Troubleshooting

### "Not connected to RollSight"

- Ensure RollSight is running
- Check that RollSight is configured to connect to Foundry
- Verify Foundry URL in RollSight settings matches your Foundry instance

### "Rolls not appearing"

- Check Foundry console (F12) for errors
- Verify module is enabled
- Check socket.io connection status

### "Roll requests not working"

- Verify webhook server is running in RollSight
- Check webhook port (default: 8765)
- Test webhook endpoint: `curl http://localhost:8765`

## Module Structure

```
rollsight-integration/
├── module.json                      # Module manifest
├── rollsight.js                     # Main module entry / hooks
├── rollsight.configure-roll-interception.js  # Manual resolver interception, cloud poll, desktop bridge
├── rollsight-settings.js            # Module settings UI (bridge, cloud room, URLs)
├── fulfillment-provider.js        # Manual-dice / RollResolver helpers (legacy naming)
├── socket-handler.js              # Socket.io-related helpers
├── chat-handler.js                # Chat message creation and amendments
├── dice-handler.js                # 3D dice integration
├── http-handler.js                # HTTP ingress (where used)
├── roll-proof-html.js             # Optional roll replay HTML in chat
└── README.md
```

For architecture and options (fulfillment API, communication, fallback), see **FOUNDRY_FULFILLMENT_DESIGN.md** in the parent `foundry_module` folder.

## Development

See **[`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md)** (repository root `docs/`) for desktop development setup; this module’s **[`DEVELOPMENT.md`](DEVELOPMENT.md)** covers module-specific notes.









