# Rollsight Integration for Foundry VTT

This Foundry VTT module integrates with Rollsight to receive physical dice rolls and send roll requests.

## Features

- **Receive Physical Rolls**: Automatically receives dice rolls from Rollsight
- **Chat Integration**: Creates chat messages with roll results
- **3D Dice**: Triggers Foundry's 3D dice animations
- **Roll Amendments**: Updates chat messages when rolls are corrected
- **Roll Requests**: Can request rolls from Rollsight (e.g., for spells, attacks)

## Installation

### Method 1: Manual Installation

1. Download or clone this module
2. Place the `rollsight-integration` folder in your Foundry VTT `Data/modules/` directory
3. Restart Foundry VTT
4. Enable the module in your world's module settings

### Method 2: Module Manifest (Recommended)

1. Add this module's manifest URL to Foundry's module browser
2. Install through Foundry's module installer

## Configuration

### 1. Enable the Module

1. Open your world in Foundry VTT
2. Go to **Settings** → **Manage Modules**
3. Enable **Rollsight Integration**

### 2. Configure Rollsight Connection

The module will automatically connect to Rollsight when:
- Rollsight is running on the same machine
- Rollsight is configured to connect to Foundry (default: `http://localhost:30000`)

### 3. Configure Webhook (For Roll Requests)

To enable Foundry → Rollsight roll requests:

1. In Rollsight, note the webhook port (default: 8765)
2. The module will automatically send roll requests to: `http://localhost:8765/foundry/roll-request`

## Usage

### Automatic Roll Receiving

When dice are rolled in Rollsight:
- Roll appears in Foundry chat automatically
- 3D dice animate (if enabled)
- Roll is attributed to the current user

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
├── module.json          # Module manifest
├── rollsight.js         # Main module code
├── socket-handler.js    # Socket.io event handlers
├── chat-handler.js     # Chat message creation
├── dice-handler.js      # 3D dice integration
└── README.md           # This file
```

## Development

See `DEVELOPMENT.md` for development setup and contribution guidelines.








