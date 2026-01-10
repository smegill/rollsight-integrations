# Foundry VTT Module Implementation Walkthrough

This document provides a step-by-step walkthrough for implementing the Rollsight integration module for Foundry VTT.

## Understanding the Communication

### How Rollsight Connects to Foundry

1. **Rollsight** (Python) uses `python-socketio` to connect to Foundry
2. Foundry runs a Socket.io server (usually on port 30000)
3. Rollsight connects to: `http://localhost:30000/socket.io`
4. Rollsight emits events that Foundry modules can listen for

### Foundry's Socket System

Foundry uses a custom socket system built on Socket.io. Modules can:
- Listen for events via `game.socket.on("module.module-name", ...)`
- Emit events via `game.socket.emit("module.module-name", ...)`

**Important**: Foundry's socket system is namespaced by module ID.

## Implementation Steps

### Step 1: Create Module Structure

```
foundry_module/rollsight-integration/
├── module.json
├── rollsight.js
├── socket-handler.js
├── chat-handler.js
├── dice-handler.js
├── roll-request-handler.js
└── templates/
    └── roll-message.html
```

### Step 2: Module Manifest

Create `module.json`:

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

Key points:
- `"socket": true` enables socket functionality
- `"esmodules"` lists JavaScript files to load
- Module ID must match folder name

### Step 3: Main Module File

In `rollsight.js`:

```javascript
Hooks.once('init', () => {
    // Initialize module
    const rollsight = new RollsightIntegration();
    rollsight.init();
    
    // Make API available
    game.rollsight = rollsight;
});
```

### Step 4: Socket Event Handling

**Challenge**: Foundry's socket system works differently than standard Socket.io.

**Solution**: We need to handle this in two ways:

#### Option A: Direct Socket Events (If Possible)

If Foundry allows external Socket.io connections:

```javascript
// In socket-handler.js
game.socket.on("module.rollsight-integration", (data) => {
    if (data.type === "roll") {
        this.handleRoll(data.rollData);
    }
});
```

#### Option B: Foundry Hooks (Recommended)

Use Foundry's hook system:

```javascript
// Rollsight emits: socket.emit('hook', {hook: 'rollsight.roll', data: rollData})
Hooks.on("rollsight.roll", (rollData) => {
    game.rollsight.handleRoll(rollData);
});
```

**Note**: This requires Foundry to support hook emission via socket, which may need custom implementation.

### Step 5: Receiving Rolls

When a roll arrives:

1. **Parse Roll Data**: Convert Rollsight format to Foundry format
2. **Create Roll Object**: Use Foundry's `Roll` class
3. **Create Chat Message**: Use `ChatMessage.create()`
4. **Animate Dice**: Trigger 3D dice if available

Example:

```javascript
handleRoll(rollData) {
    // Create Foundry Roll
    const roll = this.createFoundryRoll(rollData);
    
    // Create chat message
    const message = await ChatMessage.create({
        user: game.user.id,
        content: this.formatRollContent(roll, rollData),
        roll: roll,
        type: CONST.CHAT_MESSAGE_TYPES.ROLL
    });
    
    // Animate dice
    this.animateDice(roll);
}
```

### Step 6: Handling Amendments

When an amendment arrives:

1. **Find Original Message**: Look up by roll_id
2. **Create Corrected Roll**: Build new Roll object
3. **Update Message**: Use `message.update()`

Example:

```javascript
handleAmendment(amendmentData) {
    const rollId = amendmentData.roll_id;
    const historyEntry = this.rollHistory.get(rollId);
    
    if (historyEntry && historyEntry.chatMessage) {
        const correctedRoll = this.createFoundryRoll(amendmentData.corrected);
        
        await historyEntry.chatMessage.update({
            content: this.formatRollContent(correctedRoll, amendmentData.corrected, true),
            roll: correctedRoll
        });
    }
}
```

### Step 7: Sending Roll Requests

To request a roll from Rollsight:

```javascript
async requestRoll(formula, options) {
    const response = await fetch("http://localhost:8765/foundry/roll-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            vtt: "Foundry VTT",
            formula: formula,
            roll_type: options.rollType || "normal",
            context: options.context || {}
        })
    });
    
    return await response.json();
}
```

## Critical Implementation Details

### Foundry Socket.io Connection

**Important**: Foundry's Socket.io server may not accept external connections by default. You may need to:

1. **Use Foundry's API**: Instead of Socket.io, use Foundry's REST API
2. **Custom Hook System**: Create a custom hook endpoint
3. **Module Socket**: Use Foundry's module socket system (if available)

### Recommended Approach: Hybrid

Use a combination:

1. **For Rolls**: Use Foundry's module socket system or hooks
2. **For Requests**: Use HTTP webhook (already implemented)

### Alternative: REST API

If Socket.io doesn't work, use Foundry's REST API:

```javascript
// In Rollsight (Python)
import requests

def send_roll_via_api(foundry_url, roll_data):
    response = requests.post(
        f"{foundry_url}/api/rollsight/roll",
        json=roll_data,
        headers={"Authorization": f"Bearer {api_key}"}
    )
    return response.json()
```

This would require creating a Foundry API endpoint (more complex).

## Testing Checklist

- [ ] Module loads without errors
- [ ] Socket connection established
- [ ] Rolls appear in chat
- [ ] 3D dice animate
- [ ] Amendments update messages
- [ ] Roll requests work
- [ ] Error handling works
- [ ] Multiple users can use simultaneously

## Next Steps

1. **Install Module**: Copy to Foundry modules directory
2. **Test Basic Roll**: Send a test roll from Rollsight
3. **Debug Connection**: Check console for errors
4. **Refine Formatting**: Customize chat message appearance
5. **Add Features**: Roll history, settings UI, etc.

## Common Issues and Solutions

### Issue: Socket Events Not Received

**Solution**: 
- Check Foundry version compatibility
- Verify socket events are registered correctly
- Try using hooks instead
- Check Foundry console for errors

### Issue: Rolls Not Creating Messages

**Solution**:
- Verify Roll object is valid
- Check user permissions
- Verify ChatMessage.create() is awaited
- Check console for errors

### Issue: 3D Dice Not Working

**Solution**:
- Install Dice3D module
- Enable 3D dice in Foundry settings
- Check Dice3D API compatibility
- Verify dice terms are correct

## Code Examples

See the provided files:
- `rollsight.js` - Main module
- `socket-handler.js` - Socket handling
- `chat-handler.js` - Chat messages
- `dice-handler.js` - 3D dice
- `roll-request-handler.js` - Roll requests









