# Foundry Not Waiting for Rollsight (Rolls Digitally Instead)

If you open the roll dialog, choose options (formula, advantage, etc.), click **Roll**, and Foundry immediately rolls a digital value instead of waiting for you to roll in Rollsight, the die type is **not** set to use Rollsight in Dice Configuration.

## Fix: Set Dice Configuration (Foundry v12+)

Foundry only opens the **RollResolver** (the “waiting for dice” step) when the **fulfillment method** for that die type is set to **Rollsight (Physical Dice)**.

1. **Open Dice Configuration**
   - **Setup** → **Dice Configuration**  
   - (On some hosts this may be under **Game Settings** or **Configure Game**.)

2. **Set each die you want to roll physically**
   - For **d20** (attacks, saves, initiative, etc.): choose **Rollsight (Physical Dice)**.
   - For **d4**, **d6**, **d8**, etc. if you use them with Rollsight: set those to **Rollsight (Physical Dice)** as well.
   - Leave other dice as **Default** (digital) if you don’t roll them in Rollsight.

3. **Who must set it**
   - **Per-user:** In many setups, Dice Configuration is **per user**. So the **player who rolls** (e.g. Quin) must open **Setup → Dice Configuration** **while logged in as that player**, set the die(s) to **Rollsight (Physical Dice)**, and click **Save Changes**. If only the GM has set it, the GM’s rolls use Rollsight; the player’s rolls still use the player’s own config (often Default = digital).
   - **GM:** The GM can also set it for themselves so their rolls use Rollsight. For a player’s roll to wait for Rollsight, that **player** must have it set on their client.

4. Click **Save Changes** in the Dice Configuration dialog, then **reload the world** (or at least close and reopen the roll dialog).

## After It’s Set

- When you click **Roll** in a roll dialog (attack, spell, initiative, etc.), Foundry will open the **RollResolver** and **wait** for a result.
- Roll the die in **Rollsight** (same machine, extension connected). The value is sent to Foundry and applied to that roll; the dialog then completes with your physical result.

## If Dice Configuration Is Greyed Out or Missing

- You need **Foundry v12 or newer** for Dice Configuration / fulfillment.
- On hosted games (e.g. The Forge), **Dice Configuration** can be GM-only; the GM may need to set **Rollsight (Physical Dice)** for the world or enable player access to dice settings.
- Ensure the **Rollsight Real Dice Reader** module is **enabled** (Manage Modules); otherwise “Rollsight (Physical Dice)” may not appear in the list.

## RollResolver Not Opening (Dice Set to Rollsight but No “Waiting” Dialog)

If you’ve set Dice Configuration to **Rollsight (Physical Dice)** and clicked **Save**, but when you click **Roll** in the roll dialog Foundry never opens the **RollResolver** (the “waiting for dice” step) and just rolls digitally:

1. **Confirm Foundry v12+**  
   Dice fulfillment and RollResolver exist in Foundry v12 and later. Check **Setup → Configure Game** (or similar) for the Foundry version.

2. **Full reload**  
   After changing Dice Configuration, do a **full world reload** (refresh the browser tab or re-enter the world). Then try the roll again.

3. **Same path as “manual entry”**  
   The module uses Foundry’s **same fulfillment path** as the GM “manual number” option: when a roll would be evaluated with “don’t prompt” (e.g. chat `/roll` or some dialogs), the module ensures **RollResolver** is used instead when the roll has dice set to Rollsight in Dice Configuration. So **`/roll 1d20`**, sheet rolls, and other flows that go through `Roll.evaluate()` open the same “waiting for dice” dialog; you then roll in Rollsight and the result is fed in via Foundry’s `Roll.registerResult`. No extra module setting is required. If a specific sheet/dialog still rolls digitally, that flow is not using Foundry’s standard `Roll.evaluate()` path (see next point).

4. **Game system may not use fulfillment**  
   Some game systems (e.g. certain dnd5e flows) create the roll and evaluate it themselves, so Foundry never gets a chance to open the RollResolver. In that case:
   - **Initiative:** Use the module’s fallback: leave **“Apply Rollsight rolls to pending initiative”** on; when it’s the player’s turn to roll initiative, they roll a **single d20** in Rollsight (no need to click Roll in Foundry); the module applies it to their combatant. See **INITIATIVE_ROLLS.md**.
   - **Other rolls (attacks, saves, etc.):** If the system never opens RollResolver, use **Fallback to chat**: roll in Rollsight and the result appears in chat. You can also use **`/roll 1d20`** (or the needed formula) in chat to get RollResolver and then roll in Rollsight.

## Summary

| Symptom | Cause | Fix |
|--------|--------|-----|
| Roll dialog rolls a value immediately | Die type not set to Rollsight **for the rolling user** | **The player who rolls** opens Setup → Dice Configuration (as that player), sets d20 etc. to **Rollsight (Physical Dice)**, Save, reload |
| GM set Rollsight but player’s roll still digital | Dice Configuration is per-user | Player (Quin) must set Dice Configuration **on their own client** when logged in as that player |
| “Rollsight” not in Dice Configuration | Module not enabled or Foundry &lt; v12 | Enable Rollsight Real Dice Reader module; use Foundry v12+ |
| Only GM can open Dice Configuration | Host permissions | GM sets Rollsight for the world if possible; or host must allow players to configure dice |
| Dice set to Rollsight but RollResolver never opens | System bypasses fulfillment, or config not applied | Full reload; module uses same path as “manual entry” so **`/roll 1d20`** and standard rolls open RollResolver; for flows that still roll digitally, use initiative fallback or Fallback to chat (see above) |
