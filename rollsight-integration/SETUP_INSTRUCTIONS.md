# Foundry VTT Module Setup Instructions

## Quick Start

### 1. Install the Module

**Option A: Manual Installation**

1. Download the `rollsight-integration` folder
2. Copy it to your Foundry VTT `Data/modules/` directory
   - Windows: `%localappdata%/FoundryVTT/Data/modules/`
   - macOS: `~/Library/Application Support/FoundryVTT/Data/modules/`
   - Linux: `~/.local/share/FoundryVTT/Data/modules/`
3. Restart Foundry VTT

**Option B: Module Manifest URL**

1. In Foundry, go to **Setup** → **Add-on Modules** → **Install Module**
2. Enter manifest URL: `https://your-repo-url/module.json`
3. Click **Install**

### 2. Enable the Module

1. Open your world in Foundry VTT
2. Click **Settings** (gear icon) → **Manage Modules**
3. Check the box next to **Rollsight Integration**
4. Click **Update Modules**

### 3. Configure Rollsight

In Rollsight's `camera_config.json`, add:

```json
{
  "foundry_vtt": {
    "enabled": true,
    "auto_connect": true,
    "url": "http://localhost:30000"
  }
}
```

**Note**: Replace `localhost:30000` with your Foundry server URL if different.

### 4. Test Connection

1. Start Foundry VTT
2. Start Rollsight
3. Roll dice in Rollsight
4. Check Foundry chat - rolls should appear automatically

## Configuration Options

### Module Settings

The module has these settings (accessible via Foundry's module settings):

- **Auto-Connect**: Automatically connect when world loads
- **Webhook URL**: URL for sending roll requests (default: `http://localhost:8765`)
- **Show 3D Dice**: Enable/disable 3D dice animations
- **Chat Format**: Choose how rolls appear in chat

### Rollsight Settings

Configure in `camera_config.json`:

```json
{
  "foundry_vtt": {
    "enabled": true,
    "auto_connect": true,
    "url": "http://localhost:30000",
    "api_key": "optional-api-key",
    "user_id": "optional-user-id",
    "webhook_port": 8765
  }
}
```

## Usage Examples

### Basic Roll

1. Roll dice in Rollsight
2. Roll appears in Foundry chat automatically
3. 3D dice animate (if enabled)

### Request Roll from Foundry

Create a macro in Foundry:

```javascript
// Request 8d6 for Fireball
game.rollsight.requestRoll("8d6", {
  description: "Fireball damage",
  rollType: "normal"
});
```

Rollsight will prompt the user to roll manually or digitally.

### Correct a Roll

1. Roll appears in Foundry
2. Notice incorrect value
3. Correct it in Rollsight (click die or table)
4. Foundry chat message updates automatically

## Troubleshooting

### Module Not Appearing

- Check module is in correct directory
- Verify `module.json` is valid JSON
- Check Foundry console (F12) for errors
- Restart Foundry VTT

### Rolls Not Appearing

- Verify module is enabled
- Check Rollsight is connected (status in Rollsight)
- Check Foundry console for errors
- Verify socket.io connection

### Roll Requests Not Working

- Check webhook URL is correct
- Verify Rollsight webhook server is running
- Test webhook: `curl http://localhost:8765`
- Check Foundry console for errors

### 3D Dice Not Animating

- Install Dice3D module (if using)
- Enable 3D dice in Foundry settings
- Check Dice3D is compatible with your Foundry version

## Development

See `IMPLEMENTATION_GUIDE.md` for detailed implementation instructions.








