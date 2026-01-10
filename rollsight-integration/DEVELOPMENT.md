# Development Guide for Rollsight Foundry Module

## Architecture Overview

The module uses Foundry's hook system and socket events to communicate with Rollsight.

## Communication Flow

### Rollsight → Foundry (Rolls)

1. Rollsight connects to Foundry via Socket.io
2. When dice are rolled, Rollsight emits: `rollsight:roll` or `hook` event
3. Foundry module receives the event
4. Creates Foundry Roll object
5. Creates chat message
6. Triggers 3D dice animation

### Foundry → Rollsight (Requests)

1. Foundry module calls `game.rollsight.requestRoll()`
2. Sends HTTP POST to Rollsight webhook
3. Rollsight receives request
4. Shows dialog to user
5. User rolls dice
6. Roll sent back to Foundry (see above)

## Key Files

### rollsight.js
Main module file. Handles:
- Initialization
- Roll processing
- Amendment handling
- API exposure

### socket-handler.js
Handles Socket.io communication:
- Listens for roll events
- Listens for amendment events
- Manages connection state

### chat-handler.js
Creates and updates chat messages:
- Formats roll data for display
- Updates messages on amendment
- Handles message flags

### dice-handler.js
3D dice integration:
- Checks for Dice3D module
- Triggers animations
- Handles dice term conversion

### roll-request-handler.js
Sends roll requests to Rollsight:
- HTTP POST to webhook
- Error handling
- Response processing

## Foundry API Usage

### Creating Rolls

```javascript
const roll = new Roll({
    formula: "8d6",
    terms: [/* dice terms */],
    data: {}
});
roll.evaluate({ async: false });
```

### Creating Chat Messages

```javascript
const message = await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ user: game.user }),
    content: "Roll content",
    type: CONST.CHAT_MESSAGE_TYPES.ROLL,
    roll: roll
});
```

### Updating Messages

```javascript
await message.update({
    content: "Updated content",
    roll: newRoll
});
```

### 3D Dice

```javascript
if (typeof Dice3D !== "undefined") {
    const dice3d = new Dice3D();
    dice3d.showForRoll(roll, game.user, true, faces, [result]);
}
```

## Socket Events

### Receiving Events

Foundry modules can listen for socket events via:

```javascript
game.socket.on("module.rollsight-integration", (data) => {
    // Handle data
});
```

Or via hooks:

```javascript
Hooks.on("rollsight.roll", (rollData) => {
    // Handle roll
});
```

## Testing

### Local Testing

1. Start Foundry VTT locally
2. Enable module in test world
3. Use Rollsight to send test rolls
4. Check Foundry console and chat

### Debug Mode

Enable debug logging:

```javascript
CONFIG.debug.hooks = true; // In Foundry console
```

## Common Issues

### Socket Events Not Received

- Check Foundry version compatibility
- Verify socket events are registered
- Check console for errors
- Try using hooks instead of direct socket events

### Rolls Not Creating Messages

- Verify Roll object is valid
- Check ChatMessage.create() permissions
- Verify user has permission to create messages

### 3D Dice Not Working

- Check Dice3D module is installed
- Verify Dice3D API compatibility
- Check Foundry's 3D dice setting

## Extending the Module

### Adding Settings

```javascript
game.settings.register("rollsight-integration", "settingKey", {
    name: "Setting Name",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
});
```

### Adding Hooks

```javascript
Hooks.on("rollsight.customEvent", (data) => {
    // Handle custom event
});
```

### Custom Chat Templates

Create templates in `templates/` directory and use:

```javascript
const content = await renderTemplate(
    "modules/rollsight-integration/templates/custom.html",
    { data: data }
);
```









