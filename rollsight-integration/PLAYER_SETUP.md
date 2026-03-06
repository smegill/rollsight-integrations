# Player Setup Guide for RollSight + The Forge

This is a quick setup guide for players who want to use RollSight with a Foundry VTT game hosted on The Forge.

## Prerequisites

- Foundry VTT world hosted on The Forge
- RollSight installed on your local machine
- Camera connected and working
- GM has enabled the "RollSight Integration" module

## Quick Setup (5 minutes)

### Step 1: Get Your Connection Info

Ask your GM for:
- **Forge World URL**: Something like `https://your-world-name.forge-vtt.com`
- **Your Foundry User ID** (optional, for better attribution)

### Step 2: Configure RollSight

1. Find your `camera_config.json` file
2. Add or update this section:

```json
{
  "foundry_vtt": {
    "enabled": true,
    "auto_connect": true,
    "url": "https://your-world-name.forge-vtt.com",
    "webhook_port": 8765
  }
}
```

**Important**: 
- Replace `your-world-name.forge-vtt.com` with the URL your GM provided
- Use `https://` (not `http://`)
- If multiple players, each should use a different `webhook_port` (8765, 8766, 8767, etc.)

### Step 3: Start RollSight

1. Open terminal/command prompt
2. Navigate to RollSight directory
3. Run: `python3 scripts/roll_capture/roll_capture_ui.py --cam 0`
4. RollSight should automatically connect to Foundry

### Step 4: Verify Connection

- Check RollSight status - should show "Connected to Foundry VTT"
- Roll some dice
- Check Foundry chat - your rolls should appear automatically!

## Troubleshooting

### "Cannot connect"

- ✅ Check URL is correct (ask GM to verify)
- ✅ Make sure you're using `https://` not `http://`
- ✅ Ensure Foundry world is running
- ✅ Check firewall isn't blocking connection

### "Rolls don't appear in Foundry"

- ✅ Make sure module is enabled (ask GM)
- ✅ Check Foundry console (F12) for errors
- ✅ Verify connection status in RollSight

### "Port already in use"

- Change `webhook_port` to a different number (8766, 8767, etc.)

## Tips

- **Start RollSight before joining Foundry** - it will auto-connect
- **Keep RollSight running** during the game
- **Roll dice normally** - results appear in Foundry automatically
- **Correct mistakes** - if you correct a die, Foundry chat updates automatically

## Need Help?

Ask your GM or check the main documentation:
- `FORGE_SETUP_GUIDE.md` - Full setup instructions
- `SETUP_INSTRUCTIONS.md` - General setup guide









