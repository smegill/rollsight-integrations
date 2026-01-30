# Making Rollsight Integration Available to Everyone

The Rollsight Integration module is designed to run for **all users** (GM and players), not just the Gamemaster. Here’s how to ensure it’s active for everyone.

## 1. Enable the module (GM)

1. Open your world in Foundry VTT **as the Gamemaster**.
2. Go to **Settings** (gear icon) → **Manage Modules**.
3. Enable **Rollsight Integration**.
4. Reload the world or continue.

When the module is enabled for the world, Foundry loads it for **every connected client** (GM and players). There is no GM-only flag in the module itself.

## 2. Host-specific options (e.g. The Forge)

Some hosting platforms let you control whether a module is included for players:

- **The Forge / similar hosts:** Check the module’s options (e.g. in **Setup** → **Add-on Modules** or the module’s context menu) for anything like:
  - **Include for players**
  - **Available to players**
  - **Load for: Everyone** (vs “GM only”)

If such an option exists, set it so the module is **included for players** or **available to everyone**. Otherwise, the module might only load for the GM.

## 3. Confirm it’s active for players

- **Players:** Open **Configure Settings** (game settings) and look for **Rollsight Integration**. You should see **Rollsight Integration (this client)**. If it’s there, the module is loaded and active for that client.
- **GM:** After enabling the module, have a player join (or refresh) and ask them to check Configure Settings for Rollsight Integration.

## 4. Dice Configuration (Foundry v12+)

For **in-context** rolls (e.g. attack rolls using physical dice via Rollsight):

- **Dice Configuration** is usually under **Setup** → **Dice Configuration**, which is often GM-only.
- If only the GM can open Setup, the GM may need to set the **Rollsight (Physical Dice)** fulfillment method for the world, or your host may allow players to set their own dice method elsewhere.
- **Fallback to chat** (module setting) works for everyone: when no RollResolver is open, Rollsight rolls are sent to chat. That does not require players to open Dice Configuration.

## Summary

| Step | Who | Action |
|------|-----|--------|
| Enable module | GM | Settings → Manage Modules → enable **Rollsight Integration** |
| Host “include for players” | GM | If your host has this option, set it so the module loads for players |
| Confirm | Players | Configure Settings → see **Rollsight Integration (this client)** |
| Dice config (optional) | GM or players | Setup → Dice Configuration → choose Rollsight per die (if you use in-context rolls) |

The module does not restrict itself to the GM; it runs for every client when the GM enables it and the host (if applicable) includes it for players.
