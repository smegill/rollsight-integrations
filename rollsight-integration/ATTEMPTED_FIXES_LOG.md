# Attempted Fixes Log — Duplicate Values & Extra Dice

**Problem:** Chat rolls and initiative rolls show duplicate/extra dice values (e.g. 2d20kh displays 6–8 dice instead of 2, 1d20 displays 3 dice instead of 1). Duplicate chat messages. Resolver dialog sometimes stays open.

**Context:** Dice Config is **Manual**. Foundry opens RollResolver. Rollsight injects physical dice via postMessage. We replace the resolver UI.

---

## Attempts That Have NOT Worked

### 1. Call `resolver.submit()` instead of/in addition to `resolver.close()`
**Why tried:** Thought Foundry needs submit() to trigger _fulfillRoll and create the message.
**Result:** **FAILED.** Foundry's _fulfillRoll reads form data and overwrites our injected roll with wrong/multiplied values. Produces 6–8 dice instead of 2 for 2d20kh.
**Do not repeat.**

### 2. Remove `toMessage()`, rely only on `resolver.close()` (first attempt)
**Why tried:** Thought close() would trigger Foundry to create the message from resolver.roll.
**Result:** **FAILED.** Resolver dialog stayed open; user had to click X. Results only posted when user manually closed.
**Do not repeat** (unless we confirm close() actually creates the message in current Foundry version).

### 3. Use `registerResult("manual", denomination, value)` for Manual dice
**Why tried:** User asked to use Foundry's built-in Manual flow.
**Result:** **FAILED.** registerResult does NOT update term.results. Form stayed empty (values.length=0). Submit/close produced wrong data.
**Do not repeat.**

### 4. Use registerResult + injection (both)
**Why tried:** registerResult didn't populate term.results; added injection to fill them for form population.
**Result:** **FAILED. Worse.** Double-feeding — both registerResult AND injection added values. Produced 8 dice instead of 2 for 2d20kh.
**Do not repeat.**

### 5. Call both `close()` and `toMessage()`
**Why tried:** close() to dismiss dialog; toMessage() to post our trimmed roll.
**Result:** **FAILED.** Duplicate messages — Foundry's processMessage creates one when close() resolves, we create another via toMessage(). Also saw extra dice (3 for 1d20, 6 for 2d20kh).
**Do not repeat.**

### 6. _populateResolverFormFromRoll before submit()
**Why tried:** Ensure form has our values before Foundry's _fulfillRoll reads it.
**Result:** **Insufficient.** Form population alone doesn't fix submit() — _fulfillRoll still produces wrong data. Form structure or Foundry's read logic may be the issue.
**Do not rely on submit() + form population.**

---

## Attempts That Helped (Partial)

### 7. Use _getDiceTermsInOrder for _populateResolverFormFromRoll
**Why tried:** PoolTerm formulas (2d20kh) need recursive term traversal.
**Result:** **Helped.** Form population now correctly extracts values for PoolTerm. But submit() still corrupts, so this alone doesn't fix the pipeline.
**Keep this change.**

### 8. Injection-only (no registerResult), trim, close(), toMessage()
**Why tried:** Single source of truth; avoid registerResult duplication.
**Result:** **Partial.** Our trimmed roll has correct data (logs show resultsLen=2 values=[10,15]). But we get duplicate messages (close + toMessage), and displayed message still shows extra dice.
**Unclear if extra dice come from our toMessage() or Foundry's processMessage message.**

---

## Current State (Latest Attempt)

### 9. Remove toMessage(), only call close()
**Why tried:** Fix duplicate messages by relying solely on Foundry to create the message when close() resolves. We've modified resolver.roll in place.
**Result:** **FAILED.** Message from processMessage (when close resolves) has wrong data — 3 dice for 1d20, total 12 instead of 6. Foundry does NOT use our modified resolver.roll for that message.
**Do not repeat.**

### 10. toMessage() first, then close(), then delete wrong message
**Why tried:** Direction #3 from log. Create our correct message via toMessage(), close() (Foundry creates wrong message), then find and delete the wrong one (has more dice than expected).
**Result:** **FAILED.** Wrong message is processed first (initiative, automation) — deleting retroactively doesn't help.
**Do not repeat.**

---

## Attempt #11 (Current) — Fix at Source

### 11a. Route Manual dice through our flow (_handleChatRollWithFulfillment)
**Why tried:** For chat/initiative that goes through processMessage, handle ourselves; never call Foundry → no wrong message.
**Implementation:** `usesRollsight = denominations.some(d => getMethodForDenomination(d) === 'rollsight' || getMethodForDenomination(d) === 'manual')`.

### 11b. Patch Roll.evaluate to return our corrected roll
**Why tried:** Initiative that calls evaluate() directly bypasses processMessage; we must fix the roll at the source before it gets used.
**Implementation:** When we complete a replaced resolver, store `_correctedRollForEvaluate = { roll, formula, at }`. Roll.evaluate patch: when Promise resolves, if we have a recent corrected roll with matching formula, return it instead of Foundry's result.

### 11c. Include Manual in rollHasRollsightTerms
**Why tried:** Force allowInteractive for Manual dice so RollResolver opens when initiative uses evaluate() directly.
**Implementation:** In fulfillment-provider.js, `if (method === METHOD_ID || method === "manual") return true`.

### 11d. preCreateChatMessage hook — fix roll before message exists
**Why tried:** Initiative: Foundry creates the message with wrong roll before evaluate() returns. The evaluate() patch returns our roll, but the message already has wrong data. We must fix the roll in the pending document before it's created.
**Implementation:** Hooks.on("preCreateChatMessage", ..., -1000). When we have _correctedRollForEvaluate and the pending message has too many dice, document.updateSource({ rolls: [correctedRoll.toJSON()] }).
**Refinements (after initiative still wrong):** (1) Do NOT clear _correctedRollForEvaluate in the evaluate() patch. (2) Also register preCreateDocument (order -1001). (3) Read formula/rolls from document.rolls, data.rolls, or document._source.rolls. (4) Fallback: setTimeout 3.5s to clear _correctedRollForEvaluate. (5) Debug log (docFormula, cf, match). (6) **Extra debugging:** Log BEFORE updateSource (rollData.terms.length, correctedDiceCount); AFTER updateSource (document.rolls length, firstRoll.terms.length, diceCount). (7) **Also mutate data.rolls = [rollData]** in case creation uses initial data. (8) **createChatMessage (post-create) hook** logs message.id, formula, terms.length, diceCount, total — to see what actually got created.
**Result:** Snapshot (before form) showed diceCount=1 total=25, but chat still showed 40 in dice breakdown and initiative logged 45. preCreateChatMessage logged correctedDiceCount=2 (so rollData had 2 results when applied). **Third cause:** The snapshot object we passed to updateSource/data.rolls was being mutated (by Foundry merge or reference sharing), so the message ended up with mixed/wrong dice data. **Fix:** (1) When storing snapshot, store a **deep clone** (`JSON.parse(JSON.stringify(rollDataSnapshot))`) so nothing can mutate it. (2) In preCreateChatMessage, pass a **fresh deep clone** of corrected.rollData to updateSource and data.rolls so we never pass our stored reference. (3) Log `usingSnapshot=` so we confirm we're using corrected.rollData.

### 11e. Mutate original roll in Roll.evaluate (initiative uses same instance)
**Why tried:** Chat shows correct total (8) but combat tracker initiative was 11 (3+3+5). Foundry uses the **same roll instance** after `await roll.evaluate()` (e.g. `roll.total`), not the promise return value. Returning a new Roll.fromData() was ignored; initiative still read the original (wrong) roll.
**Implementation:** In the evaluate() patch .then(): build corrected roll from corrected.rollData via fromData(), then **mutate result in place**: `result._total = correctTotal`, `result.terms = correctedRoll.terms`. Return `result` (same reference) so whatever code uses the original roll gets the correct total and term count.

---

## Constraints / Observations

1. **resolver.roll** — We modify it in place (inject + trim). Our logs show correct term.results (e.g. d20: number=2 resultsLen=2 values=[10,15]).
2. **resolver.close()** — Resolves Foundry's evaluate() Promise; processMessage then continues and may create a ChatMessage.
3. **resolver.submit()** — Triggers _fulfillRoll; reads form; produces wrong/multiplied dice. Do not use.
4. **registerResult()** — Does not update term.results. Using it + injection causes double-feeding.
5. **toMessage(trimmedRoll)** — Creates a message. If we also get one from processMessage (on close), we get duplicates.
6. **recentRollsFromUser=0** in message fallback — We often can't find an existing message to replace; resolver.object is undefined for chat-opened resolvers.

---

## Directions Not Yet Tried

1. **Close with options** — Does resolver.close({ cancelled: true }) or similar prevent message creation?
2. **Intercept processMessage** — Prevent it from creating a message when we've already handled the roll (would need to detect our flow).
3. **Delete duplicate after the fact** — Attempt #10 failed: wrong message is processed first.
4. **Don't close, only toMessage** — Create our message; leave dialog open. User closes manually. Risk: does manual close also create a message?
5. **Different roll structure** — Maybe the roll we're modifying isn't the one Foundry uses for the message. Check if resolver.object or another reference exists.

---

*Last updated: 2026-02-02. Attempt #11: Route Manual through our flow; evaluate() returns corrected roll; preCreateChatMessage/preCreateDocument fix message (don't clear _correctedRollForEvaluate in evaluate). **Check this log before attempting any new fix.***
