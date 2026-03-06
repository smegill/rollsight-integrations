# Troubleshooting: Logs to Chase Down RollSight Not Pausing

When Dice Configuration is set to **RollSight (Physical Dice)** but Foundry still rolls digitally (chat `/roll` or `/r`, initiative, etc.), use these logs to see where the flow stops.

**Pipeline status:** Type **`/rollsight-status`** in chat to open a status dialog showing each link in the chain (RollSight app → bridge → extension → Foundry). Use this to see which part is broken when rolls stop working.

### No rolls coming through at all

Use two consoles to see where the pipeline stops:

1. **Background (extension):** `chrome://extensions` → RollSight VTT Bridge → click **"Service worker"** (or "Inspect views: background page") to open the extension’s console. Roll once in RollSight and watch for:
   - `🎲 Background: Poll response had keys: ... raw rolls count: N` — bridge returned rolls (N ≥ 1).
   - `🎲 Background: No VTT tab found` or `No active VTT or URL stored` — extension has no target tab or URL; **reload the Foundry game tab** so the content script sends `vtt_detected` again.
   - `🎲 Background: Forwarding to tab ... URL: ...` — extension is sending the roll to that tab.
   - `✅ Background: Roll forwarded to content script` — message was accepted by the content script.
   - `❌ Background: Error sending roll to content script` — content script threw or isn’t loaded; **refresh the Foundry tab** and try again.

2. **Foundry tab:** F12 → Console on the game tab. Roll once and watch for:
   - `RollSight: Content script received roll from background` — content script got the message.
   - `RollSight: Sending roll to Foundry via postMessage` / `postMessage sent` — content script posted to the page.
   - `RollSight Real Dice Reader | Received roll via postMessage` — Foundry module received the roll.

If you see the background “Forwarding” and “Roll forwarded” but **no** “Content script received” in the Foundry tab, the tab may not be the one the extension is targeting (e.g. wrong tab) or the content script didn’t load — refresh the game tab. If you see “Content script received” and “postMessage sent” but **no** “Received roll via postMessage”, the Foundry module’s listener may not be attached yet — ensure the world is fully loaded and try again.

### When it works for a bit then stops (brittleness)

The pipeline can stop accepting rolls after a while (e.g. browser tab idle, dialog closed in an unexpected way, extension service worker sleeping). Try these in order:

1. **Reload the Foundry game tab** (F5 or refresh). This re-injects the content script and re-detects the VTT; rolls often work again immediately.
2. **Reload the extension:** `chrome://extensions` → find RollSight VTT Bridge → click **Reload**. Then refresh the Foundry tab.
3. **Restart RollSight** so the bridge and webhook are fresh.
4. Run **`/rollsight-status`** and check which step shows ❌ (bridge, extension polling, last roll received). That narrows down where it broke.

The module now clears stuck state when you close a Roll Resolver dialog and shortens stale timeouts so it recovers sooner; the extension uses alarms to keep polling even when the browser has put the service worker to sleep.

**Unwanted "Roll Request from Foundry VTT" dialog in the RollSight app:** When you roll with advantage (e.g. 2d20kh) or any roll that opens the Roll Resolution dialog, Foundry used to notify the RollSight app, which showed a second dialog ("Roll Request from Foundry VTT" with Roll Manually / Roll Digitally). That dialog is **off by default** now. In module settings, **"Notify RollSight app when roll dialog opens"** is disabled — so you only see the Foundry prompt ("Roll 2d20kh in RollSight..."); roll in the tray and the app sends the result to Foundry as usual. Enable that setting only if you want the app to show the roll-request dialog.

**If you X out of the resolver and then the rolls appear in chat:** That’s expected. Closing the resolver clears the “pending” state, so any rolls that were still in the pipeline (or arrive right after) are sent to chat instead of into the dialog. You don’t lose the roll — it shows up as a RollSight roll in chat. If this happens often, rolls may be arriving a bit late; try rolling in the tray a moment after the dialog opens, or run `/rollsight-status` to confirm the bridge and extension are responsive.

Supported chat commands: `/roll`, `/r`, `/gmroll`, `/gmr`, `/blindroll`, `/br`, `/broll`, `/selfroll`, `/sr`, `/publicroll`, `/pr` — with any formula that uses RollSight dice (e.g. `1d20`, `2d20kh`, `2d20kl`, `2d20kh + 5`, `4d6kh3`, pool-style rolls). See **FOUNDRY_ROLL_SCENARIOS.md** for all accommodated scenarios.

---

## 1. Foundry (browser)

### Enable debug logging

1. **Configure Settings** → **RollSight Real Dice Reader** → turn on **"Debug logging (console)"**.
2. **Save** and **reload the world** (or refresh the tab).

### Open the console

1. Press **F12** (or right‑click → **Inspect** → **Console**).
2. In the console filter box, type **`RollSight`** so only module messages show.

### Reproduce the issue

1. Type **`/roll 1d20`** in chat and send.
2. Watch the console. You should see some of the following.

### What to look for

| Log message | Meaning |
|-------------|--------|
| `Roll.evaluate patched for N Roll class(es)` | Patch applied at load. N should be ≥ 1. |
| `[debug] CONFIG.Dice.fulfillment.dice at ready: {...}` | Template data (label, icon). The **selected method** (RollSight vs Default) is often not here; the module also reads `game.settings.get('core','diceConfiguration')`. |
| `[debug] game.settings.get('core','diceConfiguration'):` | **Important.** The user's actual Dice Configuration. If this is `undefined`, Foundry may use a different key; check the next log when you do `/roll 1d20` (`coreDiceConfig` in Chat /roll check). |
| `[debug] Roll.evaluate 1d20 hasRollSight: true/false` | When a roll is evaluated, whether the module thinks it has RollSight terms. If **false** here but you set RollSight in the UI, `CONFIG.Dice.fulfillment.dice` is likely wrong (see above). |
| `[debug] Forcing allowInteractive: true for 1d20` | The evaluate patch is forcing the interactive (RollResolver) path. If you never see this, either `Roll.evaluate` is not being used for this roll, or `hasRollSight` is false. |
| `[debug] Chat /roll check: {...}` | Chat interceptor saw a `/roll`. Check `fulfillmentDice` in the object: does it show `"rollsight"` for d20? |
| `[debug] Chat /roll denominations: [...] usesRollSight: true/false` | For the parsed formula, which denominations and whether any use RollSight. If **usesRollSight: false** but you set RollSight in the UI, again `CONFIG.Dice.fulfillment.dice` is not reflecting your choice. |
| `[debug] Chat /roll not handled by RollSight, passing to default` | Interceptor ran but did not open RollResolver (e.g. `usesRollSight` was false or RollResolver creation failed). |
| `Chat /roll fulfillment error: ...` | The interceptor tried to open RollResolver but threw (e.g. wrong API). The error text is the next place to look. |
| `[debug] Chat /roll registered resolver in Roll.RESOLVERS` | The chat-created RollResolver was registered with Foundry’s `Roll.RESOLVERS` so `Roll.registerResult()` (and thus incoming RollSight rolls) route to it. |
| `[debug] Pending chat resolver present, feeding N pairs for 1d20` | A RollSight roll arrived; the module is feeding it into the pending chat resolver (injection first, then registerResult). |
| `Injected roll into pending RollResolver for 1d20` | **Success.** RollSight result was injected into the resolver's roll and the resolver was submitted; the roll should complete in chat. |
| `[debug] inject failed: no roll.terms or no pairs` | Injection skipped (no roll terms or no dice in the incoming payload). |
| `[debug] inject failed: no dice terms matched (...)` | Injection ran but no terms in the roll matched dice (e.g. wrong Roll/Die class path). |
| `[debug] inject: no resolver.submit` | Injection wrote results into the roll but the resolver has no submit method. |
| `[debug] Injection skipped/failed, trying registerResult; fulfillable.size: N` | Injection didn't complete; module is falling back to resolver.registerResult. |
| `[debug] registerResult(rollsight, d20, 16): true/false` | Per-die result of feeding the pending resolver via registerResult. If **false**, the resolver may not have a slot for that denomination/method. |

### Common messages (not errors)

| Log / message | Meaning |
|---------------|---------|
| `rollHasRollSightTerms ... method: manual` | Dice Config is set to **Manual** (expected when using Manual workflow). RollResolver still opens; RollSight feeds into it. |
| `hasRollSight: false` when method is `manual` | Expected — we only force allowInteractive when method is **RollSight**. Foundry opens RollResolver for Manual natively. |
| `POST http://localhost:8765/... net::ERR_FAILED` | **Forge hosting**: Foundry on forge-vtt.com can't fetch localhost (CORS/Private Network Access). Roll requests are now routed through the RollSight extension. Install the extension and reload. If it still fails, RollSight may not be running. Roll requests are optional; rolls still work. |
| Token image 404 (e.g. `Wyrdgard Tokens/Quin.png`) | Foundry/world config — token image path is wrong. Not related to RollSight. |

### Copy and share

After reproducing, **right‑click in the console** → **Save as...** or copy the relevant lines (especially any `[debug]` and errors) and share them so we can see where the flow stops.

---

### Triplication debugging (one die showing as 19, 19, 19 in chat)

If a single physical roll (e.g. 1d20 = 19) appears in Foundry chat as three identical values (19, 19, 19) with a wrong total, use the **trace** logs to see where the extra values come from. These logs are always on (no need to enable debug).

1. **Extension (content script):** In the Foundry tab console, look for:
   - `RollSight: Sending roll to Foundry: 1d20 total= 19 dice.length= 1 dice.values= [19]`
   - If `dice.length` or `dice.values` shows more than one die, the app or bridge is sending multiple values; fix there first.

2. **Module (Foundry):** Filter console by `RollSight` and look for these in order:
   - `[trace] Roll state BEFORE injection: d20: number=1 resultsLen=… values=[…]`
   - `[trace] Injected value 19 into term denom= d20 number= 1 results length now 1`
   - `[trace] Roll state AFTER injection: …`
   - `[trace] Roll state BEFORE submit: …`

3. **How to interpret:**
   - If **BEFORE submit** shows `resultsLen=1 values=[19]` but chat shows three 19s, the bug is in Foundry’s submit/toMessage (how the resolver turns the roll into a chat message).
   - If **BEFORE submit** already shows `resultsLen=3 values=[19,19,19]`, the bug is in our injection (we’re writing the value into multiple slots) or in the roll’s initial structure (e.g. `term.number` is 3 for 1d20).
   - If **Slot build** shows `totalSlots=3` for a 1d20 roll, Foundry’s roll has three dice slots; that would explain triplication and we need to see why (e.g. initiative or system creating 3d20).

After one initiative roll, copy the lines containing `[trace]` and the extension “Sending roll to Foundry” line and share them.

---

### Replaced resolver path (2d20kh showing 8 dice / wrong total)

When you use `/roll 2d20kh` and Dice Configuration is **Manual** (or not RollSight), Foundry opens a Roll Resolver and the module **replaces** its content with the RollSight UI. Physical rolls are injected and then **replaced** resolvers are auto-submitted. Use these **always-on** trace logs to see where duplication happens:

1. **Replaced resolver path:**  
   `[trace] Replaced resolver path: formula= 2d20kh BEFORE submitComplete, term.results.lengths= [...] resolver.roll===resolver.object?.roll: true/false`  
   - `term.results.lengths` should be `[2]` for 2d20kh. If you see `[8]`, the roll had 8 slots before trim.
   - If `resolver.roll===resolver.object?.roll` is **false**, Foundry may use `resolver.object.roll` for the chat message; the module now trims both when they differ.

2. **After trim:**  
   `[trace] _submitCompleteReplacedResolvers AFTER TRIM: formula= 2d20kh term.results.lengths= [2] roll._total= 19`  
   - After trim, lengths should be `[2]` and `roll._total` should be 19 (keep highest). If lengths are still 8 here, trim didn't run or didn't apply to the right roll.

3. **Right before submit:**  
   `[trace] RIGHT BEFORE submit(): formula= 2d20kh state= d20: number=2 resultsLen=2 values=[10,19]`  
   - If this shows `resultsLen=2 values=[10,19]` but chat shows 8 dice, Foundry's `resolver.submit()` is building the message from something other than this roll (e.g. form inputs or a different roll reference).

4. **With Debug logging on:**  
   - `[debug] _populateResolverFormFromRoll: formula= 2d20kh values.length= 2 inputs.length= N`  
   - If `inputs.length` is 8 (or more than 2), Foundry's form has extra slots; we set the first 2 and disable the rest. If submit() reads all inputs anyway, that could explain duplication.

5. **Replace-message flow (always-on):**  
   - `[trace] Replace message: resolver.object= ... id= ...` — Whether Foundry gave us a message to replace (`resolver.object`). If **undefined**, we fall back to searching `game.messages`.
   - `[trace] Message fallback: game.messages.contents= ... totalMessages= ... userId= ... recentRollsFromUser= ... chosen= ...` — When `resolver.object` is undefined, we search recent roll messages from the current user; this shows collection shape, count, and whether we found one to delete.
   - `[trace] Replaced resolver: closing then replace. formula= ... msgToReplace= ... id= ... canDeleteMessage= ...` — Whether we have a message to delete and will call delete + toMessage.
   - `[trace] Deleting message id= ... then toMessage(trimmed roll)` or `[trace] No message to delete; posting trimmed roll via toMessage only` — Which branch we took.
   - `[trace] Replaced wrong message: delete + toMessage OK` or `[trace] toMessage(trimmed roll) OK` — Success. If you see `[trace] toMessage failed:` or `[trace] Replace message failed:`, that explains why the correct message didn't appear.
   - `[trace] No trimmed roll; cannot post correct message` — Internal state was missing; should not happen if injection ran.

Copy the `[trace]` and (if enabled) `[debug]` lines from one 2d20kh roll and share them to narrow down where the extra dice come from.

---

## 2. RollSight app / bridge (your software)

### Bridge server (Python)

If you start the bridge server from a terminal (e.g. when running the RollSight app), its logs go to **stdout** in that terminal.

- **Bridge poll: returning 1 roll to extension** – Bridge is sending a roll to the extension.
- **Bridge server received POST** – Bridge received a roll from the app.
- **Queued ... for extension pickup** – Roll was queued for the browser.

If Foundry never opens RollResolver, the bridge may still be receiving rolls from the app; the problem is then on the Foundry/extension side (e.g. extension not forwarding, or Foundry not opening the resolver). If the bridge never logs receiving a roll when you roll physically, the issue is between the RollSight app and the bridge.

### Browser extension

If you use a companion extension that talks to the bridge and Foundry:

1. Open the extension’s **background/service worker** (e.g. Chrome: `chrome://extensions` → your extension → **Service worker** or **Inspect views**).
2. Check its **Console** for errors or logs when you roll in RollSight or run `/roll 1d20` in Foundry.

### Increasing Python log level

To see more bridge detail (e.g. debug), set the log level before starting the app, for example:

```bash
export LOG_LEVEL=DEBUG
# then start your RollSight app / bridge
```

(Exact variable name depends on how your app configures `logging`.)

---

## 3. Quick checklist

1. **Module in Game Settings** – In **Configure Settings** (or **Game Settings**), the module appears in the **left sidebar** as **"RollSight Real Dice Reader"**. Scroll the sidebar if you don’t see it. If it’s missing, the module may not have loaded (check the console for errors after enabling it and reloading the world).
2. **Dice Configuration** – Click **"Configure Dice"** in the main settings area. In the Dice Configuration dialog, each die type (d4, d6, d8, d10, d12, d20, d100) should list **"RollSight (Physical Dice)"** as an option. If it doesn’t, do a **full world reload** (or restart Foundry) after enabling the module; the module registers this option at load. If it still doesn’t appear, check the browser console for `RollSight Real Dice Reader | Registered fulfillment method: rollsight`.
3. **Dice Configuration (choice)** – Set all desired dice (e.g. d20) to **RollSight (Physical Dice)** and **Save Changes**.
4. **Reload** – Full world reload (or refresh) after changing Dice Configuration or enabling debug.
5. **Same user** – Dice Configuration is per user; the **player who rolls** must have it set on their client.
6. **Foundry version** – Dice fulfillment / RollResolver exist in **v12+**. Confirm in **Setup → Configure Game** (or similar).
7. **Module enabled** – **Manage Modules** → **RollSight Real Dice Reader** is checked for the world.

### GM vs players (permissions)

The module does **not** require GM. It runs for every client when the GM enables it (and the host includes it for players). What often *is* restricted:

- **Setup → Dice Configuration** is often GM-only on hosted games. If only the GM can open it, only the GM can set dice to RollSight; players then can’t get the “wait for RollSight” flow unless the host allows players to configure dice or the GM sets it for the world.
- **Manage Modules** – only the GM can enable the module; once enabled, it runs for everyone (unless the host loads the module “for GM only”).

---

## 4. Auto-recovery (resilience)

If rolls stop reaching Foundry (chat or RollResolver) after a while, the integration recovers automatically:

- **Foundry (module)** – Every 30 seconds the module clears stale state: pending chat resolvers older than **5 minutes**, and duplicate-suppression state older than **60 seconds**. New rolls are then accepted again. With **Debug logging** on, you’ll see `[debug] Clearing stale ...` when this runs.
- **RollSight app** – If the last roll was sent more than **60 seconds** ago, the app resets its “roll already sent” flag so the next settled roll can be sent again (e.g. after a stuck connection).

You don’t need to reload the world or restart the app for recovery; wait up to 60 seconds (or 5 minutes if a RollResolver dialog was left open) and roll again.

---

### After training / correction (multi-die rolls)

If you had a multi-die request (e.g. 2d20 or 3d20), sent some dice, then confirmed or corrected the remaining die and Rescan sent only the high-confidence die again (the confirmed/corrected die never sent):

- **RollSight app** – When you click the **checkmark (✓)** to confirm a low-confidence prediction, the app now marks that die as 100% confidence so **Rescan Tray** includes it in the built roll. Without this, only dice above the confidence threshold were included, so the confirmed die was never sent. After a corrective dialog or table correction, the app also resets its “roll already sent” flag so Rescan can send the full roll. Rescan sends whatever high-confidence (and confirmed) dice you have and only marks the roll as “sent” after at least one integration succeeds.

---

## 5. What to report back

When asking for help, please share:

1. **Foundry console** – The **RollSight**-filtered lines from a run where you did `/roll 1d20`, especially:
   - `CONFIG.Dice.fulfillment.dice at ready`
   - Any `Roll.evaluate` / `Chat /roll` debug lines
   - Any red error lines
2. **Foundry version** (e.g. 12.xxx or 13.xxx).
3. **Game system** (e.g. dnd5e, pf2e).
4. Whether the **bridge** logs receiving a roll when you roll physically (if you have bridge logs available).
