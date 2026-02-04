# Rollsight → Foundry Roll Pipeline: Thorough Walkthrough and Bug Audit

Step-by-step flow from “user sends `/r 2d20kh`” to “chat message appears,” then where bugs can occur.

---

## 1. User sends roll command (e.g. `/r 2d20kh`)

| Step | Code / behavior |
|------|------------------|
| 1.1 | `ui.chat.processMessage(message)` is our wrapper; Foundry’s original is not called yet. |
| 1.2 | We match roll command + formula with `ROLL_CMD_REGEX`. If no match → `return false` → `original(message)` runs (normal Foundry). |
| 1.3 | We create `roll = RollClass.fromFormula(formula)`. One Roll object; for `2d20kh` it has one Die term with `term.number = 2`. |
| 1.4 | We get denominations from the roll and check Dice Config: `usesRollsight = denominations.some(d => getMethodForDenomination(d) === 'rollsight')`. If **false** (e.g. “manual”) → `return false` → normal Foundry path. |
| 1.5 | We set `_handlingChatRollMessage = msg` to block duplicate handling of the same message. |
| 1.6 | We create `resolver = new RollResolverClass({ roll })`. Foundry’s resolver keeps a reference to the **same** `roll`. We do **not** call `resolver.render()`. |
| 1.7 | We set `_pendingChatResolver = { resolver, roll, formula, description, rollMode, resolveOutcome, resolverNotRendered: true, consumedFingerprints: new Set() }`. So `resolver.roll` and `_pendingChatResolver.roll` are the same object. |
| 1.8 | We register `Roll.RESOLVERS.set(roll, resolver)`. |
| 1.9 | We show our dialog via `_showRollsightWaitDialog(formula, resolver, resolveOutcome, game)` and **await** `outcomePromise` (resolved when user cancels, clicks “Complete with Digital,” or we call `resolveOutcome("fulfilled")` from `handleRoll`). |

**State after 1:** One Roll, one Resolver (not rendered), one dialog. No chat message yet.

---

## 2. Physical roll arrives (Rollsight → Foundry)

| Step | Code / behavior |
|------|------------------|
| 2.1 | App sends roll to bridge; extension polls; content script gets `rollData` (e.g. `{ formula: '2d20', total: 27, dice: [{ value: 11 }, { value: 16 }] }`). |
| 2.2 | Content script does `window.postMessage({ type: 'rollsight-roll', rollData })`. |
| 2.3 | Our `window` listener runs → `_queueRollAndProcess(event.data.rollData)`. |
| 2.4 | If `_pendingChatResolver` exists we call `handleRoll(rollData)` immediately; else we wait up to 800 ms for a resolver, then call `handleRoll(rollData)`. |

**State after 2:** We are in `handleRoll` with exactly the dice we received (e.g. two values).

---

## 3. handleRoll: pending chat resolver path

| Step | Code / behavior |
|------|------------------|
| 3.1 | **Dedupe (global):** `rollFp = _rollFingerprint(rollData)`. If same fingerprint was processed in last 2 s → return null. Else set `_lastProcessedRollFingerprint`, `_lastProcessedRollAt`. |
| 3.2 | **“Already complete” clear:** If `_pendingChatResolver` exists and `_isResolverComplete(resolver)` is true (all dice slots already filled), we call `resolveOutcome("fulfilled")`, set `_pendingChatResolver = null`, delete from `Roll.RESOLVERS`, and **do not return** — we fall through so this roll can go to other handlers (e.g. fallback to chat). The continuation in `_handleChatRollWithFulfillment` will still run and will use `resolver.roll` (still in closure). |
| 3.3 | **Dialog gone:** If our dialog element is no longer in the DOM we clear `_pendingChatResolver` and unregister the roll. |
| 3.4 | **Pairs:** `pairs = rollDataToFulfillmentPairs(rollData)` → e.g. `[{ denomination: 'd20', value: 11 }, { denomination: 'd20', value: 16 }]`. If no pairs but we have `rollData.total` and pending resolver has terms, we infer one pair from the first needed denomination. |
| 3.5 | **Per-resolver dedupe:** If `_pendingChatResolver.consumedFingerprints.has(rollFp)` → return null. Else add `rollFp` to `consumedFingerprints`. |
| 3.6 | **Injection:** `_injectRollIntoResolver(resolver, pairs)`. Uses `resolver.roll` (or `_pendingChatResolver.roll` if resolver has no roll). For each pair, finds matching dice term by denomination and merges one value into `term.results` (fill first empty slot or push). **Does not** shorten `term.results`; if Foundry pre-allocated 8 slots we may have 2 filled and 6 still present. Then applies modifiers (kh/kl) and sets `roll._total`. Returns `{ injected, complete }`. |
| 3.7 | **If injected and complete:** We **always** trim and recalc (no longer gated by `resolverNotRendered`): for each dice term we injected into, `term.results = (term.results ?? []).slice(0, n)`; for other dice terms we zero out; re-run `_evaluateModifiers`; recompute `roll._total` and set `roll._evaluated = true`. |
| 3.8 | **If resolver was rendered:** We call `_populateResolverFormFromRoll(resolver)` and `resolver.submit()`. For chat flow we do **not** render the resolver (`resolverNotRendered: true`), so we skip submit. |
| 3.9 | We call `_pendingChatResolver.resolveOutcome("fulfilled")`. That resolves `outcomePromise` in `_handleChatRollWithFulfillment`. |
| 3.10 | We return null (so we don’t fall through to registerResult or fallback to chat). |

**State after 3:** The same Roll object now has `term.results` trimmed to length `term.number` (e.g. 2) and correct `_total`. Outcome promise is resolved.

---

## 4. Continuation in _handleChatRollWithFulfillment (after await outcomePromise)

| Step | Code / behavior |
|------|------------------|
| 4.1 | If we have a fallback dialog we call `fallbackDialog.close()`. |
| 4.2 | If `winner === "cancelled"` we close the resolver and return true (no message). |
| 4.3 | **Fulfilled:** `fulfilledRoll = this._pendingChatResolver?.resolverNotRendered ? this._pendingChatResolver.roll : resolver.roll`. For chat flow `resolverNotRendered` is true and we haven’t cleared `_pendingChatResolver` yet, so `fulfilledRoll = _pendingChatResolver.roll` (same as `resolver.roll`). If we had cleared in the “already complete” branch, `_pendingChatResolver` is null so we take the else branch: `resolver.roll` (still in closure). |
| 4.4 | If `fulfilledRoll?.total !== undefined` we call `fulfilledRoll.toMessage(messageData, options)`. So the chat message is built from **that** Roll’s current `terms` and `results`. |
| 4.5 | We try `resolver.close()`. |
| 4.6 | **finally:** We delete the roll from `Roll.RESOLVERS` (if we still have `_pendingChatResolver.roll`) and set `_pendingChatResolver = null`, `_handlingChatRollMessage = null`. |

**State after 4:** One chat message created from the trimmed Roll. Pipeline for this request is done.

---

## 5. Where values come from (no extra sources)

- **Only source of truth for the chat message** in this path is `fulfilledRoll` (i.e. `resolver.roll` / `_pendingChatResolver.roll`).
- We do **not** call `resolver.submit()` for the chat flow, so Foundry’s form handler never runs. The message is created only via `fulfilledRoll.toMessage(...)`.
- So extra values can only appear if **that** Roll’s `term.results` still has more entries than `term.number` when `toMessage()` runs. That was the bug: we used to skip the trim when `resolverNotRendered` was true. Now we always trim when we inject and complete.

---

## 6. Bugs and edge cases (audit)

### 6.1 Fixed: Trim skipped for chat flow

- **Was:** Trim and recalc ran only when `!resolverNotRendered`. Chat flow sets `resolverNotRendered: true`, so we never trimmed → `term.results` could have 8 entries → `toMessage()` showed 8 dice.
- **Fix:** Trim and recalc run whenever we have injected and complete; only `_populateResolverFormFromRoll` and `resolver.submit()` are skipped when `resolverNotRendered` is true.

### 6.2 options.rollMode when _pendingChatResolver was cleared

- **Risk:** After “resolver already complete” we set `_pendingChatResolver = null`. In the continuation we do `options = { rollMode: this._pendingChatResolver?.rollMode ?? 'publicroll' }`. So we correctly fall back to `'publicroll'`. No bug.

### 6.3 PoolTerm formulas (e.g. `{2d20,4d6}kh`)

- **Risk:** `_injectRollIntoResolver` only iterates `roll.terms`. If the roll has a **PoolTerm** (inner rolls), we do not recurse; we only match top-level Die terms. So pool formulas might not get any injection.
- **Status:** Known limitation. `_getDenominationsFromRoll` does recurse into PoolTerm for display/checks, but injection does not. Document for now; fix would require recursing into PoolTerm and matching inner terms.

### 6.4 registerResult fallback after failed injection

- **Risk:** When injection doesn’t place (`injected === false`) we call `resolver.registerResult("rollsight", denomination, value)` for each pair. Foundry’s `registerResult` can append one result per call; if the resolver has multiple “slots” for that denomination it might consume one per call. If we have 2 pairs and the resolver has 8 slots, we might only fill 2 — correct. But if the API applies one value to **all** remaining slots we could get duplication. We avoid using this path when injection succeeded.
- **Status:** We return immediately after successful injection and never call registerResult in that case. Fallback is only when injection didn’t match (e.g. wrong term structure).

### 6.5 Double resolveOutcome

- **Risk:** User clicks “Complete with Digital” at the same time a physical roll arrives. Both could call `resolveOutcome("fulfilled")`. Promise resolves only once; the first call wins. The second is a no-op. Acceptable.

### 6.6 _updatePendingDialogSlots before trim

- **Observation:** We call `_updatePendingDialogSlots(resolver)` before we trim. So the dialog may briefly show more slots (e.g. 2 filled + 6 “Pending”) if `term.results` had 8 entries. Then we trim; the roll used for `toMessage()` is correct. Only cosmetic.

### 6.7 Replaced resolvers (non-chat) path

- **Flow:** When the resolver **was** rendered (e.g. from a sheet), we use `_replacedResolvers`, inject, then `_submitCompleteReplacedResolvers()` which trims, recalculates, populates form, and calls `resolver.submit()`. Form and submit are used there; we rely on trim + form populate + disabled extra inputs to avoid extra values. If Foundry ever reads form in a way that includes disabled inputs, duplication could reappear for that path only.

---

## 7. Summary

| Phase | What happens |
|------|-------------------------------|
| Request | We intercept `/r`, create one Roll + one Resolver (not rendered), show our dialog, await outcome. |
| Roll in | Bridge → extension → postMessage → handleRoll. |
| Satisfy | Inject into `resolver.roll`, **always** trim to `term.number` and recalc, then resolveOutcome("fulfilled"). We do **not** submit the resolver in the chat flow. |
| Message | Continuation uses `fulfilledRoll` (same Roll) and calls `fulfilledRoll.toMessage()`. Extra values could only come from that Roll still having too many `term.results`; the trim step is what prevents that. |

**Critical invariant:** For the chat flow, the Roll we pass to `toMessage()` is the same object we mutated; we trim it before resolving the outcome, so by the time the continuation runs the Roll already has exactly `term.number` results per term.
