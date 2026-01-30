# Rollsight Integration for Foundry VTT

This Foundry VTT module integrates with Rollsight to receive physical dice rolls and send roll requests.

## Features

- **In-context rolls (Foundry v12+)**: When you choose "Rollsight" in **Dice Configuration** for a die type (e.g. d20), attack/spell/save rolls wait for physical dice and use your Rollsight result in the same roll—no chat-only fallback.
- **Receive physical rolls**: Rolls from Rollsight are either fed into the active RollResolver (in-context) or, if none is open, sent to chat (configurable).
- **3D dice**: Triggers Foundry's 3D dice when a roll is fulfilled or sent to chat.
- **Roll amendments**: Updates chat messages when rolls are corrected in Rollsight.
- **Roll requests**: Optional: when a RollResolver opens for Rollsight, the module can POST to Rollsight so the app shows "Foundry is waiting for: 1d20" (set **Roll request URL** in module settings).

## Installation

**Server / host:** For what must be loaded on the Foundry server and install options (manual copy, script, or manifest), see **SERVER_INSTALL.md** in the parent `foundry_module` folder.

### Method 1: Manual Installation

1. Copy the `rollsight-integration` folder into your Foundry VTT `Data/modules/` directory (see SERVER_INSTALL.md for Data paths).
2. Restart Foundry VTT (or reload the world).
3. In the world: **Settings** → **Manage Modules** → enable **Rollsight Integration**.

### Method 2: Module Manifest (Recommended)

1. Add this module's manifest URL to Foundry's module browser
2. Install through Foundry's module installer

## Configuration

### 1. Enable the Module (GM)

1. Open your world in Foundry VTT (as GM).
2. Go to **Settings** → **Manage Modules**.
3. Enable **Rollsight Integration**.
4. The module then runs for **all users** (GM and players). Players do not need to enable anything; they just need the Rollsight browser extension and Rollsight app to send rolls from their client.

**Making it available to everyone:** Once the GM enables the module in Manage Modules, it is active for every connected client. If your host (e.g. The Forge) has an option like "Include for players" or "Available to players" for this module, ensure it is set so the module loads for players. Players can confirm the module is active by opening **Configure Settings** → **Rollsight Integration** and seeing the "Rollsight Integration (this client)" option.

### 2. Dice Configuration (Foundry v12+)

To use physical dice **in-context** (e.g. for attack rolls, spell rolls):

1. Open **Setup** → **Dice Configuration** (or the equivalent in your Foundry version).
2. For each die type (d4, d6, d20, etc.) choose **Rollsight (Physical Dice)** as the fulfillment method.
3. When you roll (e.g. attack), Foundry will open the roll dialog and wait for a result; roll in Rollsight and the value is applied to that same roll.

### 3. Configure Rollsight Connection

The module receives rolls via the browser extension (postMessage). For cloud Foundry, use the extension; for self-hosted, the same or a local bridge can be used.

### 4. Configure Webhook (Optional – Roll Requests)

To have Rollsight show "Foundry is waiting for: 1d20" when a roll dialog opens:

1. In module settings, set **Roll request URL** (e.g. `http://localhost:8765/foundry/roll-request`).
2. When a RollResolver opens for a Rollsight-configured die, the module POSTs the formula to that URL.

## Usage

### Automatic Roll Receiving

When dice are rolled in Rollsight:

- **If a RollResolver is open** (e.g. you just clicked "Attack" and chose Rollsight for d20): the result is applied to that roll in-context, then the roll completes (e.g. attack roll with your physical d20).
- **If combat has started and you have a combatant with no initiative yet**: a **single d20** roll from Rollsight is applied to that combatant's initiative (so you are not forced to roll inside Foundry). See **INITIATIVE_ROLLS.md** for details.
- **If no roll is waiting**: the roll is sent to chat (unless **Fallback to chat** is disabled in module settings).
- 3D dice animate when enabled; the roll is attributed to the current user.

### Requesting Rolls from Foundry

To request a roll from Rollsight (e.g., for a spell):

1. Use the module's API or create a macro
2. Example macro:
   ```javascript
   game.rollsight.requestRoll("8d6", {
     description: "Fireball damage"
   });
   ```
3. Rollsight will prompt the user to roll manually or digitally

### Handling Corrections

When a roll is corrected in Rollsight:
- The module receives an amendment
- The original chat message is updated with corrected values
- A note is added indicating the roll was corrected

## API Reference

### Request a Roll

```javascript
// Request a roll from Rollsight
game.rollsight.requestRoll("8d6", {
  description: "Fireball damage",
  rollType: "normal" // or "advantage", "disadvantage"
});
```

### Check Connection Status

```javascript
// Check if connected to Rollsight
game.rollsight.isConnected();
```

## Troubleshooting

### "Not connected to Rollsight"

- Ensure Rollsight is running
- Check that Rollsight is configured to connect to Foundry
- Verify Foundry URL in Rollsight settings matches your Foundry instance

### "Rolls not appearing"

- Check Foundry console (F12) for errors
- Verify module is enabled
- Check socket.io connection status

### "Roll requests not working"

- Verify webhook server is running in Rollsight
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
├── roll-request-handler.js # Optional roll-request POST to Rollsight
└── README.md
```

For architecture and options (fulfillment API, communication, fallback), see **FOUNDRY_FULFILLMENT_DESIGN.md** in the parent `foundry_module` folder.

## Development

See `DEVELOPMENT.md` for development setup and contribution guidelines.









