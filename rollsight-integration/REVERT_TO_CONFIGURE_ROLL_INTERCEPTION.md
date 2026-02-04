# Revert to Configure Roll Button Interception

If you want to restore the previous approach (intercepting Configure Roll / initiative dialog button clicks instead of using the Manual workflow), do this:

## Quick revert

1. Backup the current `rollsight.js` (optional, if you want to keep both):
   ```bash
   cp foundry_module/rollsight-integration/rollsight.js foundry_module/rollsight-integration/rollsight.manual-workflow.js
   ```

2. Restore the configure-roll-interception version:
   ```bash
   cp foundry_module/rollsight-integration/rollsight.configure-roll-interception.js foundry_module/rollsight-integration/rollsight.js
   ```

3. Reload the Foundry world.

## What each approach does

| Approach | How it works | When to use |
|----------|--------------|-------------|
| **Manual workflow** (current) | Set Dice Config to **Manual** for dice you want to roll physically. Foundry opens RollResolver everywhere (initiative, attacks, etc.); Rollsight feeds into it. Enable "Use Manual workflow for Rollsight" in module settings. | When Configure Roll / initiative and other flows work with Manual. |
| **Configure Roll interception** (backup) | Intercept Normal/Advantage/Disadvantage button clicks in the Configure Roll dialog; open Rollsight flow; block the system's digital roll. | When Manual workflow doesn't work (e.g. system bypasses fulfillment) or you prefer Rollsight in Dice Config. |

## Files

- `rollsight.js` – current implementation (Manual workflow)
- `rollsight.configure-roll-interception.js` – backup of the button-interception approach
- `rollsight.manual-workflow.js` – optional backup of current if you revert
