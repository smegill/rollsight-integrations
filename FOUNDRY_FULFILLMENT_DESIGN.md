# Foundry Integration: Fulfillment-Based Design

This document inventories options and defines the architecture for a robust Rollsight–Foundry integration using Foundry VTT v12+ **Dice Fulfillment** and **RollResolver**, so physical rolls apply in-context (spells, attacks, saves) instead of only chat.

---

## 1. Current Limitations

| Issue | Current behavior | Goal |
|-------|------------------|------|
| **Context** | Rolls are pushed as `/roll` or chat messages only; spell/attack/save rolls are not fulfilled. | Physical dice fulfill the *same* roll instance that Foundry created (e.g. attack roll). |
| **Connection** | Browser extension + `postMessage` + optional HTTP bridge (port 8766). Extension can disconnect; bridge must run. | More robust, self-recovering path where possible; keep extension as fallback for cloud Foundry. |
| **Player choice** | World setting (auto-connect). | Per-player: “Use Rollsight for dice I’ve configured” via Foundry’s Dice Configuration. |
| **Recovery** | No explicit reconnection or “roll in Foundry” fallback. | If Rollsight isn’t ready, user can “Roll in Foundry” from the same RollResolver. |

---

## 2. Foundry APIs and Concepts (v12+)

### 2.1 Dice Fulfillment (`CONFIG.Dice.fulfillment`)

- **`defaultMethod`** (string): Default fulfillment method.
- **`dice`** (Record): Per-denomination config (label, icon). Systems can extend for custom dice (e.g. d10p).
- **`methods`** (Record): Registered fulfillment methods. Each entry is a **DiceFulfillmentMethod** (id → `{ label, icon, … }`).

Modules (e.g. GoDice, Pixels Dice, **Rollsight**) add an entry to `CONFIG.Dice.fulfillment.methods` so they appear in **Dice Configuration** and can be chosen per die type (d4, d6, d20, etc.).

### 2.2 RollResolver (`foundry.applications.dice.RollResolver`)

- Shown when a roll has **unfulfilled** dice terms (terms whose denomination is configured for a non-default method, e.g. “Rollsight”).
- **`fulfillable`**: `Map<string, DiceTermFulfillmentDescriptor>` of terms waiting for results.
- **`registerResult(method, denomination, result)`**: Registers one fulfilled die (e.g. `registerResult("rollsight", "d20", 17)`).
- **`awaitFulfillment()`**: Used by core to wait until all terms are fulfilled.
- **`roll`**: The `Roll` instance being resolved.

So: when a player has set e.g. “d20 → Rollsight” in Dice Configuration and does an attack roll, Foundry creates a Roll, sees fulfillable terms, opens RollResolver, and waits. Our job is to (1) register as a method, and (2) call `registerResult` when we receive physical dice from Rollsight (or let the user choose “Roll in Foundry” in the same UI).

### 2.3 Roll Class (`foundry.dice.Roll`)

- **`Roll.RESOLVERS`**: `Map<Roll, RollResolver>` of active resolvers.
- **`Roll.registerResult(method, denomination, result)`** (static): Registers a result with the **active** RollResolver. Returns `boolean | void` (whether consumed; `undefined` if no resolver).
- **`identifyFulfillableTerms(terms)`** (static): Which terms need external fulfillment (based on user’s Dice Configuration).

So we do **not** create the Roll ourselves for attacks/spells; Foundry does. We only register our method and, when we get roll data (postMessage or socket), call `Roll.registerResult("rollsight", denomination, value)` for each die. If a RollResolver is open and waiting for that method/denomination, the result is consumed and the roll completes in context.

### 2.4 Hooks and Socket

- **Hooks**: `Hooks.on`, `Hooks.call`; some hooks can prevent default by returning `false`.
- **`game.socket`**: Socket.io; events must be `module.<moduleId>`. Data must be JSON-serializable. Only the **server** can emit to all clients; clients emit to server.

So for **cloud Foundry**, the browser (extension or page script) is the only thing that can receive HTTP/WS from Rollsight and then inject into Foundry (e.g. postMessage or by having the page emit via a server-mediated socket). For **self-hosted**, a local bridge could in theory connect to Foundry’s socket from the same machine; in practice, the same browser bridge (extension + postMessage) is the most portable.

---

## 3. Inventory of Options

### 3.1 Roll Interception and Context

| Option | Description | Use |
|--------|-------------|-----|
| **Fulfillment method** | Register in `CONFIG.Dice.fulfillment.methods`; user selects “Rollsight” per die in Dice Configuration. | **Primary.** RollResolver appears automatically for any roll that has terms configured for Rollsight. No need to intercept “all” rolls. |
| **Hook into roll creation** | e.g. `preCreateChatMessage` or system-specific hooks. | Only if we needed to change *who* gets a RollResolver; fulfillment already handles “which method.” |
| **Manual /roll in chat** | Current: post roll as `/roll` or chat message. | **Fallback** when no RollResolver is active (e.g. user rolled in Rollsight without a pending Foundry roll). |

We do **not** need to intercept “any automatic or requested roll” at a generic level; we rely on **Dice Configuration** + **RollResolver**. When the user has chosen Rollsight for some dice, Foundry already pauses and shows the resolver; we only need to feed results via `Roll.registerResult`.

### 3.2 Communication (Rollsight → Foundry)

| Option | Pros | Cons |
|--------|------|------|
| **postMessage from extension** | Works in cloud Foundry; no server config. | Extension must be installed and active; tab must be Foundry; can feel brittle. |
| **game.socket (module.rollsight-integration)** | Native Foundry path; all clients can receive. | Only server can emit to clients; something in the browser (e.g. extension or a local relay) must send to Foundry server first. |
| **HTTP bridge (e.g. 8766) → extension → Foundry** | Rollsight talks HTTP to local process; extension talks to that process and posts to Foundry. | Bridge must run; extension must connect to it; two links to fail. |
| **WebSocket from Foundry page to local Rollsight** | Page opens WS to localhost; no extension. | Only works when Foundry is on same machine as Rollsight (self-hosted); cloud Foundry can’t open WS to user’s localhost. |

**Recommendation:**

- **Primary (all deployments):** Keep **postMessage** from the existing browser extension (or a small in-page bridge) as the way to deliver roll payloads into the Foundry page. Module listens for `rollsight-roll` (and optionally `rollsight-amendment`) and calls `Roll.registerResult` for each die.
- **Resilience:** In the module, on receipt of a roll, check `Roll.RESOLVERS` (or try `Roll.registerResult`); if no resolver consumes the result, **fallback**: create a chat message or `/roll` so the roll is not lost. Optionally show a short “No pending roll; sent to chat” notification.
- **Self-hosted only (future):** Optionally allow a **local WebSocket** from the Foundry page to a small local server (e.g. started by Rollsight) so that the same machine can work without the extension; document as optional.

### 3.3 Connection Resilience and Fallback

| Mechanism | Description |
|-----------|-------------|
| **RollResolver “Roll in Foundry”** | Built-in: user can choose to roll digitally in the same dialog. No change needed. |
| **Fallback to chat** | If we receive a Rollsight roll but `Roll.registerResult` returns `undefined` (no active resolver), post to chat so the roll is still visible. |
| **Optional roll-request to Rollsight** | When a RollResolver opens for Rollsight method, we can POST to `http://localhost:8765/foundry/roll-request` (or configurable URL) with formula/context so Rollsight can show “Foundry is waiting for: 1d20”. |
| **Extension reconnection** | Out of scope for the module; document that the extension should retry/refresh. Module can show a “Rollsight connected” indicator based on recent postMessage traffic. |

### 3.4 Player-Specific Behavior

- **Dice Configuration** (Foundry v12+): Per-user, per-die setting for fulfillment method (default, manual, Rollsight, etc.). So “enable Rollsight for me” = player selects Rollsight for the die types they want in **Setup → Dice Configuration** (or equivalent).
- **World vs. client:** We can keep a world setting for “Rollsight integration enabled” (e.g. allow roll-request URL, or enable socket listener). Player-level “use Rollsight” is already expressed by choosing Rollsight in Dice Configuration.

---

## 4. Target Architecture

1. **Module registers Rollsight as a fulfillment method**  
   In `init`, add to `CONFIG.Dice.fulfillment.methods` (e.g. `rollsight` → `{ label: "Rollsight (Physical Dice)", icon: "…" }`). No custom “companion” window is required; the built-in RollResolver UI is used. Optionally register custom denominations in `CONFIG.Dice.fulfillment.dice` if we need e.g. d10p.

2. **Incoming rolls → active RollResolver or chat**  
   - On `rollsight-roll` (postMessage) or `module.rollsight-integration` socket event:
     - Normalize payload to a list of `{ denomination, value }` (e.g. d20 → 17, d6 → 4). Map our shapes (d10p, d10, etc.) to Foundry denominations (d10, d100 as needed).
     - For each die, call `Roll.registerResult("rollsight", denomination, value)`.
     - If we have dice left over (no resolver consumed them), or we never had an active resolver: **fallback** to current behavior (e.g. `/roll` or chat message) and optionally notify “Roll sent to chat (no pending roll).”

3. **Optional roll-request (RollResolver opened for Rollsight)**  
   - When we detect a RollResolver open for our method (e.g. by listening for the resolver’s render or by checking `Roll.RESOLVERS` when we have a “pending” request), POST to Rollsight’s roll-request URL with formula and context so the app can display “Foundry is waiting for: 2d20 + 5.”

4. **Communication paths**  
   - **Always:** Module listens for `window` postMessage (`rollsight-roll`, `rollsight-amendment`) and, when applicable, socket `module.rollsight-integration` (if the server ever emits based on bridge/extension).  
   - **Optional (self-hosted):** Document or add a small in-page WebSocket client to `localhost` for environments where the extension is not used.

5. **Settings**  
   - World: “Rollsight roll-request URL” (optional), “Allow fallback to chat when no resolver” (default true).  
   - Player-level “use Rollsight” = Dice Configuration (Foundry core).

---

## 5. Implementation Checklist

- [ ] Register `rollsight` in `CONFIG.Dice.fulfillment.methods` in `init` (label, icon).
- [ ] On roll payload (postMessage / socket): map dice to `(denomination, value)`; call `Roll.registerResult("rollsight", denom, value)` per die.
- [ ] If any dice unused or no resolver: fallback to current chat/`/roll` behavior; optional notification.
- [ ] Optional: when RollResolver is open for Rollsight, send roll-request to Rollsight (configurable URL).
- [ ] Optional: add `CONFIG.Dice.fulfillment.dice` entries for d10p if needed.
- [ ] Keep existing socket handler and postMessage listener; add `Roll.registerResult` as the primary path when a resolver is active.
- [ ] Document: Dice Configuration for player choice; extension + bridge for cloud; optional WS for self-hosted.

This yields a **fulfillment-based**, **in-context** integration (spells, attacks, saves), with **fallback to chat** and **optional roll-request** to Rollsight, and keeps the current extension/bridge as the main link for cloud Foundry while leaving room for a self-hosted WebSocket path later.
