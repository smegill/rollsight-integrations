# RollSight Integration for Foundry VTT

This Foundry VTT module integrates with RollSight to receive physical dice rolls and send roll requests.

## Features

- **In-context rolls (Foundry v12+)**: When you choose "RollSight" in **Dice Configuration** for a die type (e.g. d20), attack/spell/save rolls wait for physical dice and use your RollSight result in the same roll—no chat-only fallback.
- **Receive physical rolls**: Rolls from RollSight are either fed into the active RollResolver (in-context) or, if none is open, sent to chat (configurable).
- **3D dice**: Triggers Foundry's 3D dice when a roll is fulfilled or sent to chat.
- **Roll amendments**: Updates chat messages when rolls are corrected in RollSight.
- **Roll requests**: Optional: when a RollResolver opens for RollSight, the module can POST to RollSight so the app shows "Foundry is waiting for: 1d20" (set **Roll request URL** in module settings).

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
4. The module then runs for **all users** (GM and players). Players do not need to enable anything; they just need the RollSight browser extension and RollSight app to send rolls from their client.

**Making it available to everyone:** Once the GM enables the module in Manage Modules, it is active for every connected client. If your host (e.g. The Forge) has an option like "Include for players" or "Available to players" for this module, ensure it is set so the module loads for players. Players can confirm the module is active by opening **Configure Settings** → **RollSight Integration** and seeing the "RollSight Integration (this client)" option.

### 2. Dice Configuration (Foundry v12+)

To use physical dice **in-context** (e.g. for attack rolls, spell rolls):

1. Open **Setup** → **Dice Configuration** (or the equivalent in your Foundry version).
2. For each die type (d4, d6, d20, etc.) choose **RollSight (Physical Dice)** as the fulfillment method.
3. When you roll (e.g. attack), Foundry will open the roll dialog and wait for a result; roll in RollSight and the value is applied to that same roll.

### 3. Configure RollSight Connection

The module receives rolls via the **RollSight VTT Bridge** browser extension (`postMessage`) or, for **Foundry’s desktop application** (where extensions do not run), via **Desktop bridge (poll HTTP bridge)** in module settings.

- **Browser (Chrome/Edge, etc.)**: Install the RollSight VTT Bridge extension; leave Desktop bridge **off** on that client.
- **Foundry desktop app**: In **Configure Settings → Module Settings → RollSight Real Dice Reader**, enable **Desktop bridge (Foundry app — poll HTTP bridge)**. Keep RollSight running so its HTTP bridge is available (default `http://127.0.0.1:8766`). Adjust **Desktop bridge base URL** only if you changed the bridge port in RollSight.

Do **not** enable Desktop bridge and the browser extension on the **same machine** for the same session — they share one roll queue and would compete for rolls.

For cloud-hosted Foundry in a normal browser, keep using the extension; the desktop bridge only helps the local Foundry app (or any client that can reach your machine’s bridge URL).

**Desktop bridge not receiving rolls (Windows):** The module polls `http://127.0.0.1:8766` by default. If nothing happens, try **`http://localhost:8766`** as the Desktop bridge base URL, or update RollSight so its HTTP bridge binds to IPv4 (RollSight builds after 2026-03-21 bind `127.0.0.1` so `127.0.0.1` works reliably).

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
├── module.json             # Module manifest
├── rollsight.js            # Main module code
├── fulfillment-provider.js # Foundry v12+ Dice Fulfillment registration & routing
├── socket-handler.js       # Socket.io event handlers
├── chat-handler.js         # Chat message creation
├── dice-handler.js         # 3D dice integration
├── roll-request-handler.js # Optional roll-request POST to RollSight
└── README.md
```

For architecture and options (fulfillment API, communication, fallback), see **FOUNDRY_FULFILLMENT_DESIGN.md** in the parent `foundry_module` folder.

## Development

See `DEVELOPMENT.md` for development setup and contribution guidelines.









