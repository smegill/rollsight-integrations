# Foundry VTT Module Implementation Guide

This guide walks you through implementing the Rollsight integration module for Foundry VTT.

## Overview

The Rollsight integration works by:
1. **Receiving Rolls**: Rollsight connects to Foundry via Socket.io and emits roll events
2. **Sending Requests**: Foundry sends HTTP POST requests to Rollsight's webhook server

## Architecture

### Socket.io Communication (Rollsight → Foundry)

Rollsight connects to Foundry's Socket.io server and emits events:
- `rollsight:roll` - When dice are rolled
- `rollsight:amendment` - When a roll is corrected

### HTTP Webhook (Foundry → Rollsight)

Foundry sends HTTP POST requests to:
- `http://localhost:8765/foundry/roll-request`

## Step-by-Step Implementation

### Step 1: Module Structure

Create the following directory structure:

```
foundry_module/
└── rollsight-integration/
    ├── module.json
    ├── rollsight.js
    ├── socket-handler.js
    ├── chat-handler.js
    ├── dice-handler.js
    ├── roll-request-handler.js
    ├── templates/
    │   └── roll-message.html
    └── README.md
```

### Step 2: Module Manifest (module.json)

The `module.json` file defines your module:

```json
{
  "id": "rollsight-integration",
  "title": "Rollsight Integration",
  "version": "1.0.0",
  "compatibility": {
    "minimum": "10",
    "verified": "12"
  },
  "esmodules": ["rollsight.js"],
  "socket": true
}
```

### Step 3: Main Module (rollsight.js)

The main module file:
- Initializes on `init` hook
- Sets up socket handlers
- Provides API (`game.rollsight`)
- Handles incoming rolls and amendments

### Step 4: Socket Handler (socket-handler.js)

**Important**: Foundry doesn't directly support external Socket.io connections. We need to use Foundry's hook system.

**Option A: Use Foundry Hooks (Recommended)**

Rollsight will call Foundry hooks directly:

```javascript
// In Rollsight (Python)
# After connecting to Foundry via socket.io
socket.emit('hook', {
    hook: 'rollsight.roll',
    data: rollData
})
```

Then in Foundry:
```javascript
Hooks.on("rollsight.roll", (rollData) => {
    game.rollsight.handleRoll(rollData);
});
```

**Option B: Custom Socket Events**

If you have a way to register custom socket events in Foundry, you can listen for `rollsight:roll` directly.

### Step 5: Chat Handler (chat-handler.js)

Creates and updates chat messages:
- Uses Foundry's `ChatMessage.create()`
- Includes roll data for 3D dice
- Updates messages when amendments arrive

### Step 6: Dice Handler (dice-handler.js)

Triggers 3D dice animations:
- Checks if Dice3D module is available
- Creates animations for each die
- Uses Foundry's built-in dice system

### Step 7: Roll Request Handler (roll-request-handler.js)

Sends roll requests to Rollsight:
- HTTP POST to webhook URL
- Includes formula and context
- Returns response

## Integration with Rollsight

### Connecting to Foundry

Rollsight connects to Foundry's Socket.io server. The connection happens in `foundry.py`:

```python
# In foundry.py
socket.connect(f"{foundry_url}/socket.io")
```

### Emitting Roll Events

When a roll is sent, Rollsight emits:

```python
socket.emit('hook', {
    'hook': 'rollsight.roll',
    'data': foundry_roll_data
})
```

Or if using custom events:

```python
socket.emit('rollsight:roll', foundry_roll_data)
```

### Receiving Roll Requests

Rollsight's webhook server listens on port 8765 and handles POST requests from Foundry.

## Testing

### Test Roll Receiving

1. Start Foundry VTT
2. Enable the Rollsight module
3. Start Rollsight and connect to Foundry
4. Roll dice in Rollsight
5. Check Foundry chat for the roll

### Test Roll Requests

1. In Foundry console, run:
   ```javascript
   game.rollsight.requestRoll("8d6", {description: "Test roll"});
   ```
2. Check Rollsight for the request dialog

### Test Amendments

1. Roll dice in Rollsight (appears in Foundry)
2. Correct a die in Rollsight
3. Check Foundry chat - message should update

## Troubleshooting

### "Rolls not appearing in Foundry"

- Check Foundry console (F12) for errors
- Verify module is enabled
- Check that Rollsight is connected
- Verify socket events are being received

### "Socket.io connection issues"

- Check Foundry URL in Rollsight settings
- Verify Foundry is running
- Check firewall settings
- Review Foundry console for connection errors

### "3D dice not animating"

- Ensure Dice3D module is installed (if using)
- Check Foundry's 3D dice setting is enabled
- Verify roll data includes dice terms

## Advanced: Custom Socket Events

If you need to use custom socket events instead of hooks:

1. Register custom socket handler in Foundry
2. Listen for `rollsight:roll` and `rollsight:amendment` events
3. Update `socket-handler.js` to use custom events

Example:
```javascript
// In rollsight.js init()
game.socket.on("module.rollsight-integration", (data) => {
    if (data.type === "roll") {
        this.handleRoll(data.rollData);
    }
});
```

## Next Steps

1. Install the module in Foundry
2. Test basic roll receiving
3. Test roll requests
4. Test amendments
5. Customize chat message templates
6. Add additional features (roll history, settings UI, etc.)









