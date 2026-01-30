# Initiative Rolls with Rollsight

When a player (e.g. Quin) is placed into combat and Foundry pauses to wait for an initiative roll, Rollsight can be used instead of rolling inside Foundry. There are two ways this can work.

## 1. Dice Configuration (RollResolver path)

If the game system uses Foundry’s standard Roll with **Dice Configuration** (Foundry v12+):

1. The **player** (or GM for that player) sets the initiative die (usually **d20**) to use **Rollsight (Physical Dice)** in **Setup → Dice Configuration**.
2. When initiative is rolled, Foundry opens the **RollResolver** dialog and waits for a result.
3. The module sends a roll request to Rollsight (if **Roll request URL** is set), and when the player rolls in Rollsight, the result is applied to the initiative roll.

If the system does **not** open RollResolver for initiative (e.g. uses a custom dialog), this path never runs. Use the fallback below.

## 2. Fallback: Apply Rollsight roll to pending initiative

When **RollResolver does not open** for initiative (e.g. Foundry shows a different dialog and the player is forced to roll inside Foundry), the module can still use Rollsight:

1. **Combat must be started** (encounter is active).
2. The **current user** must have at least one **combatant** that has **no initiative yet** (hasn’t rolled).
3. When the player rolls **a single d20** in Rollsight (e.g. from the Play tab), the module treats it as an initiative roll and applies the **total** to that combatant’s initiative.

**Flow:**

- GM starts combat; Quin’s character is in the encounter and has no initiative.
- Foundry may show a dialog asking Quin to roll (or the combat tracker shows “—” for initiative).
- **Instead of rolling in that dialog**, Quin rolls a **single d20** in Rollsight (same machine, browser extension connected).
- The module sees: no active RollResolver, active combat, current user has one combatant with no initiative, roll is 1d20 → applies the total to that combatant’s initiative and shows a notification (e.g. “Quin: Initiative 14 (Rollsight)”).

**Settings:**

- **Apply Rollsight rolls to pending initiative** (world setting, default: on): when the above conditions are met, a single d20 Rollsight roll is applied to the first pending initiative for the current user. The GM can turn this off if they want initiative only via the normal Foundry dialog.

**Limitations:**

- Only **one** pending combatant per user is considered; if the same user has multiple combatants without initiative, the first one in turn order gets the roll.
- Only **single d20** rolls are applied (formula `1d20` or `d20`, or one die with shape/faces d20). Other rolls still go to chat (or fulfillment) as before.

## Summary

| Situation | What to do |
|----------|------------|
| System uses RollResolver for initiative | Set **Dice Configuration** so d20 uses Rollsight; RollResolver will wait and Rollsight roll fulfills it. |
| System does not use RollResolver for initiative | Leave **Apply Rollsight rolls to pending initiative** on; player rolls **one d20** in Rollsight when it’s their turn to roll initiative; the module applies it to their pending combatant. |

Players should have the **Rollsight browser extension** installed and **Rollsight** running so rolls from the app reach Foundry (via the bridge). The GM should enable the **Rollsight Integration** module for the world.
