# Setting Up Rollsight with The Forge

This guide explains how to connect Rollsight to a Foundry VTT instance hosted on The Forge, and how to enable it for all players.

## Overview

When using The Forge (cloud-hosted Foundry), each player needs to:
1. Install and run Rollsight on their local machine
2. Configure Rollsight to connect to your Forge world URL
3. Connect to the same Foundry instance

## Step 1: Get Your Forge World URL

1. Log into your Forge world
2. Your world URL will be something like: `https://your-world-name.forge-vtt.com`
3. Note this URL - you'll need it for each player's configuration

## Step 2: Configure Rollsight for Each Player

Each player needs to configure Rollsight on their local machine:

### Option A: Edit Configuration File

1. Find your `camera_config.json` file (usually in the project root or `~/.rollsight/`)
2. Add or update the Foundry configuration:

```json
{
  "foundry_vtt": {
    "enabled": true,
    "auto_connect": true,
    "url": "https://your-world-name.forge-vtt.com",
    "api_key": "",
    "user_id": "",
    "webhook_port": 8765
  }
}
```

**Important**: Replace `your-world-name.forge-vtt.com` with your actual Forge world URL.

### Option B: Use UI Settings (If Available)

If Rollsight has a settings UI:
1. Open Settings → VTT Integration
2. Enter your Forge URL: `https://your-world-name.forge-vtt.com`
3. Enable "Auto-Connect"
4. Save settings

## Step 3: Player Setup Instructions

Share these instructions with your players:

### For Each Player:

1. **Install Rollsight** (if not already installed)
   - Download from your repository
   - Install dependencies
   - Set up camera

2. **Configure Connection**
   - Open `camera_config.json`
   - Set `foundry_vtt.url` to: `https://your-world-name.forge-vtt.com`
   - Set `foundry_vtt.enabled` to: `true`
   - Set `foundry_vtt.auto_connect` to: `true`

3. **Start Rollsight**
   - Launch Rollsight
   - It should automatically connect to your Forge world
   - Check the status indicator - it should show "Connected to Foundry VTT"

4. **Test Connection**
   - Roll some dice in Rollsight
   - Check Foundry chat - rolls should appear automatically

## Step 4: Verify Connection

### In Foundry:

1. Open Foundry console (F12)
2. Check for connection messages
3. Look for: `Rollsight Integration | Ready`

### In Rollsight:

1. Check status indicator
2. Should show: "Connected to Foundry VTT"
3. If not connected, check:
   - URL is correct
   - Foundry world is running
   - No firewall blocking connection

## Step 5: Player-Specific Configuration

Each player may need different settings:

### Webhook Port

Each player needs a unique webhook port (for roll requests):

```json
{
  "foundry_vtt": {
    "url": "https://your-world-name.forge-vtt.com",
    "webhook_port": 8765  // Player 1
  }
}
```

```json
{
  "foundry_vtt": {
    "url": "https://your-world-name.forge-vtt.com",
    "webhook_port": 8766  // Player 2
  }
}
```

**Note**: The webhook port is only needed if you want Foundry to request rolls from players. For basic roll sending, it's optional.

## Troubleshooting

### "Cannot connect to Foundry VTT"

**Possible causes:**
1. **Wrong URL**: Verify the URL is exactly `https://your-world-name.forge-vtt.com`
2. **HTTPS required**: The Forge uses HTTPS - make sure you're using `https://` not `http://`
3. **World not running**: Make sure the Foundry world is active
4. **Firewall**: Check if firewall is blocking the connection
5. **CORS issues**: The Forge may have CORS restrictions

**Solutions:**
- Double-check the URL
- Try connecting manually first
- Check Foundry console for errors
- Verify socket.io connection in browser console

### "Connection works but rolls don't appear"

**Possible causes:**
1. Module not enabled for player
2. Socket events not being received
3. Permission issues

**Solutions:**
- Ensure module is enabled in world settings
- Check Foundry console for errors
- Verify socket events are being received
- Check player permissions

### "Multiple players can't connect"

**Possible causes:**
1. Socket.io connection limits
2. Same webhook port conflicts
3. Network issues

**Solutions:**
- Each player should use a unique webhook port
- Check The Forge connection limits
- Verify each player has correct URL

## Security Considerations

### For The Forge:

1. **HTTPS**: The Forge uses HTTPS, which is secure
2. **Authentication**: Consider adding API keys if needed
3. **User IDs**: Each player should use their Foundry user ID

### Recommended Configuration:

```json
{
  "foundry_vtt": {
    "enabled": true,
    "auto_connect": true,
    "url": "https://your-world-name.forge-vtt.com",
    "api_key": "optional-api-key",
    "user_id": "foundry-user-id",
    "webhook_port": 8765
  }
}
```

## Advanced: Player-Specific Setup Script

You can create a setup script for players:

```python
# setup_forge.py
import json
import os

FORGE_URL = input("Enter your Forge world URL: ")
USER_ID = input("Enter your Foundry user ID (optional): ")
WEBHOOK_PORT = int(input("Enter webhook port (default 8765): ") or "8765")

config = {
    "foundry_vtt": {
        "enabled": True,
        "auto_connect": True,
        "url": FORGE_URL,
        "user_id": USER_ID or "",
        "webhook_port": WEBHOOK_PORT
    }
}

# Load existing config
config_path = "camera_config.json"
if os.path.exists(config_path):
    with open(config_path, 'r') as f:
        existing = json.load(f)
        existing.update(config)
        config = existing

# Save config
with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)

print("Configuration saved!")
```

## Testing Multi-Player Setup

1. **GM Setup**: Configure and test first
2. **Player 1**: Configure with unique webhook port
3. **Player 2**: Configure with different webhook port
4. **Test**: Have each player roll dice
5. **Verify**: All rolls appear in Foundry chat

## Next Steps

- Test basic roll sending
- Test roll requests (if using)
- Test amendments
- Customize chat message appearance
- Add player-specific features




