# Foundry Roll Scenarios Accommodated by Rollsight Real Dice Reader

This document lists the Foundry VTT roll contexts and chat commands that the Rollsight module supports so physical dice can be used via RollResolver.

---

## 1. Chat roll commands (intercepted by the module)

The module intercepts **all** Foundry roll slash commands when the formula uses dice set to Rollsight in Dice Configuration. It opens RollResolver, waits for physical dice from Rollsight, then posts the result to chat with the **correct visibility**.

| Command | Short | Visibility |
|--------|-------|------------|
| `/roll` | `/r` | Public (all players) |
| `/publicroll` | `/pr` | Public |
| `/gmroll` | `/gmr` | Roller + GM only |
| `/blindroll` | `/br` or `/broll` | GM only (roller cannot see result) |
| `/selfroll` | `/sr` | Roller only |

**Formula support** (same for every command above):

- Simple: `1d20`, `3d6`, `1d20 + 4`
- Advantage (keep highest): `2d20kh`, `2d20kh + 5`
- Disadvantage (keep lowest): `2d20kl`, `2d20kl + 3`
- Keep/drop: `4d6kh3`, `3d6dl`, etc.
- Modifiers: Any Foundry dice modifiers; RollResolver applies kh/kl and arithmetic after physical rolls are fed in.

**Example:** `/gmr 2d20kh + 4` opens the resolver for two d20s; after you roll in Rollsight, the result is posted as a GM-only roll (roller + GM see it).

---

## 2. Roll.evaluate() path (patched by the module)

When game systems or macros create a `Roll` and call `roll.evaluate()` (e.g. attack rolls, saves, ability checks), the module **patches** `Roll.evaluate` so that:

- If the roll has any die term set to Rollsight in Dice Configuration, `allowInteractive: true` is forced.
- Foundry then opens the **RollResolver** for that roll; Rollsight results are fed in via `Roll.registerResult()`.

**Accommodated:**

- Sheet rolls (attacks, saves, skills) that use the core Roll class and Dice Configuration.
- Macros that call `new Roll("2d20kh").evaluate()`.
- Any flow that uses `Roll.evaluate()` with Rollsight-configured dice.

**Not accommodated:** Flows that never call `Roll.evaluate()` (e.g. some systems roll digitally and then send a pre-computed total to chat). For those, use **Fallback to chat** or type the roll in chat (e.g. `/r 2d20kh`).

---

## 3. Initiative rolls

When combat has started and a combatant has no initiative yet, a **single d20** roll from Rollsight can be applied to that combatant’s initiative. The module tries to apply from:

- An open “Configure Roll” / initiative dialog (formula and modifiers from the dialog).
- Otherwise, the combatant’s initiative formula from the system.

See **INITIATIVE_ROLLS.md** for details.

---

## 4. Roll requests (optional)

If **Roll request URL** is set in module settings, when a RollResolver opens for a Rollsight-configured die, the module **POSTs** the formula (and context) to that URL. Rollsight can show “Foundry is waiting for: 1d20” (or the current formula). This is optional and does not change roll behavior.

---

## 5. Fallback to chat

When **no** RollResolver is open (no pending chat roll, no sheet roll waiting), a roll from Rollsight can still be sent to chat if **Fallback to chat** is enabled in module settings. The roll is sent as a `/roll <total> # <description>` message (always public). Roll visibility commands (/gmr, /br, /sr) apply only when the user types the roll in Foundry chat; fallback sends a single public roll.

---

## 6. Inline rolls in chat

Messages can contain **inline rolls** like `I attack! [[2d20kh + 5]]`. When the message is sent, Foundry parses and evaluates those rolls. If the system uses `Roll.evaluate()` for them and Dice Configuration uses Rollsight for the relevant dice, the **Roll.evaluate patch** forces the interactive path, so RollResolver opens and Rollsight can fulfill them. Support depends on how the game system or core chat processes inline rolls.

---

## 7. PoolTerm and complex formulas

The module detects Rollsight dice in:

- **Die terms** (e.g. `2d20kh`, `4d6`) with modifiers.
- **PoolTerm** (e.g. pool-style rolls where Foundry uses a PoolTerm with inner rolls).

So pool-style formulas that use Rollsight dice open RollResolver when the formula is entered in chat or evaluated via `Roll.evaluate()`.

---

## Summary

| Scenario | How it’s accommodated |
|----------|------------------------|
| `/roll`, `/r`, `/gmroll`, `/gmr`, `/blindroll`, `/br`, `/broll`, `/selfroll`, `/sr`, `/publicroll`, `/pr` + formula | Intercepted; RollResolver opens; result posted with correct roll mode |
| Sheet/macro rolls using `Roll.evaluate()` | Patched to force allowInteractive when roll has Rollsight dice |
| Initiative (no roll yet) | Single d20 from Rollsight applied to combatant initiative when possible |
| Roll request URL | Optional POST when resolver opens |
| No resolver open | Fallback to chat (if enabled) |
| Inline rolls `[[ ... ]]` | If evaluated via Roll.evaluate(), patch applies |
| PoolTerm / complex formulas | rollHasRollsightTerms and denominations recurse into PoolTerm |
