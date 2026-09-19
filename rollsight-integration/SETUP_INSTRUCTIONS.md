# Foundry setup — development candidate

This guide describes the native dice-fulfillment candidate. Check `docs/FOUNDRY_V14_AUDIT.md` for tested versions and release gates. The candidate has not been published as a new public module release.

1. Install the candidate `rollsight-integration` folder in Foundry's `Data/modules/` directory, restart Foundry, and enable **RollSight Real Dice Reader** in the test world.
2. Sign in as the player whose dice you want to send. In Game Settings, open **RollSight Real Dice Reader**, leave receiving enabled, and copy your player code.
3. In the revised RollSight desktop app, choose **Connect dice**, paste the player code, and choose **Connect**. Wait for **Foundry cloud connected**. This works with local Foundry and Forge; no extension or local bridge is required.
4. In Foundry's core Dice Configuration, select **RollSight physical dice** for the die types you want to roll physically.
5. Start a roll in Foundry, such as `/r 1d20 - 1`. Leave its roll-resolution window open. Roll a d20 in the camera tray and send the reading from RollSight. Foundry applies its own modifiers and completes the native roll.
6. If several requests are waiting, choose **Use this roll** on the request to receive the next dice. Manual entry and cancellation remain available.

Keep the Foundry world open under the same player. Cloud connected means the relay accepted the code; it is not confirmation of a particular delivery. If connection fails, copy a fresh player code and retry. A code pasted without pressing Connect does not start sending.

**More options** in RollSight holds replay/streaming settings and other destinations. Use **Disconnect** when finished. Existing rolls and training data are retained.

The module's bundled, localized `help.html` covers request selection, duplicate/stale delivery rejection, and supported dice. The old direct socket connector and global roll interception are retired.
