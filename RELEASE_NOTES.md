## v1.1.33 - 2026-03-22

- **Roll proof in chat (RollSight GIF):** When RollSight sends a `roll_proof_url`, the module appends a **collapsible “Roll proof”** section to the **same** chat message as the roll (not a separate line by default). Expanding it shows the proof as a **native animated GIF** (`<img>`). Styling matches a compact footer row (summary line + chevron); new stylesheet `styles/rollsight-roll-proof.css` is registered in `module.json`.
- **System / Forge rolls (`Roll#toMessage`):** A `preCreateChatMessage` hook merges the roll-proof HTML into **`flavor`** for the next qualifying message from the current user (messages that include roll data). **`_queueRollProofForNextChatMessage`** queues attach; if nothing matches within ~4.5s, a **fallback** chat message is still created with the same collapsible block in **`content`**.
- **Pending uploads:** If `roll_proof_pending` is true, the panel shows the note and link only (no `<img>`) until the file is ready.
- **Direct `ChatHandler.createRollMessage` (unprompted / fallback chat):** Roll proof is still embedded in **`flavor`** via shared helper **`roll-proof-html.js`** (`buildRollProofFlavorHtml`). **`_clearRollProofAttachQueue()`** avoids double attach when this path runs.
- **`/roll` command fallback:** If direct message creation fails, the `/roll … # …` path still adds only a **text** URL + note in the description (no collapsible HTML on that card).

## v1.1.30 - 2026-03-21

- **Chat `/r` post:** `resolver.roll` after fulfillment could lack `toMessage` (not a Roll instance). Resolve posting roll via `_rollForChatToMessage` (prefer original formula roll, else `Roll.fromJSON`). `_ensureRollEvaluatedForChat` + ChatHandler guard satisfy v12 `ChatMessage` validation (“rolls must be evaluated”). Avoids `Cannot read properties of undefined (reading 'id')` when create fails.

## v1.1.29 - 2026-03-21

- **Desktop bridge / Windows:** If the module setting used `http://localhost:8766`, Foundry’s fetch could target IPv6 `::1` while RollSight’s bridge binds **IPv4 127.0.0.1 only**, so polls never reached the queue (no “Received roll” logs). `_getDesktopBridgeBaseUrl()` now normalizes `localhost` and `::1` to `127.0.0.1`. Setting hint updated.

## v1.1.28 - 2026-03-21

- **Chat rolls not appearing:** `toMessage` was skipped when `roll.total` was still undefined (only `_total` set). We always attempt `toMessage`, run a non-interactive `evaluate()` when needed, and fall back to `ChatHandler.createRollMessage` on failure.
- **Concurrent `/r` (e.g. two `/r 2d20kh`):** A single `_correctedRollForEvaluate` caused `preCreateChatMessage` to apply the wrong correction or miss a match so the message had no usable roll data. Pending chat injects now push a **FIFO `_chatRollCorrectionQueue`** (matched by normalized formula); `preCreateChatMessage` dequeues the matching entry; `Roll.evaluate` patch finds the matching correction in the queue.

## v1.1.27 - 2026-03-20

- Foundry chat `/r` race: after one manual roll finished, a new `/r` could stop receiving RollSight dice because the **previous** session’s `finally` cleared global `_pendingChatResolver` and removed the **new** roll from `Roll.RESOLVERS`. Each chat session now owns a `chatOutcomeSession` token; `toMessage` uses this invocation’s `resolver`/`roll` only; `finally` only clears global pending when it still matches this session, while always deleting **this** session’s `roll` from the map.

## v1.1.26 - 2026-03-21

- Published to rollsight-integrations: desktop bridge, manifest cleanup, chat `2d20 kh` normalize, partial 2d20 inject fix, bridge poll backoff
- acc842f Foundry module: normalize 2d20 kh chat formulas; defer kh/total until all dice filled (v1.1.26)

## v1.1.23 - 2026-03-20

- 56fc162 Foundry: desktop bridge polling for desktop app (no browser extension)

## v1.0.83 - 2026-02-02

- (no Foundry module changes detected)

## v1.0.84 - 2026-02-02

- (no Foundry module changes detected)

## v1.0.93 - 2026-02-02

- (no Foundry module changes detected)

## v1.0.94 - 2026-02-02

- (no Foundry module changes detected)

## v1.0.95 - 2026-02-03

- (no Foundry module changes detected)

## v1.0.96 - 2026-02-03

- (no Foundry module changes detected)

## v1.0.97 - 2026-02-03

- (no Foundry module changes detected)

## v1.0.98 - 2026-02-03

- (no Foundry module changes detected)

## v1.0.99 - 2026-02-03

- (no Foundry module changes detected)

## v1.0.100 - 2026-02-03

- (no Foundry module changes detected)

## v1.0.101 - 2026-02-03

- (no Foundry module changes detected)

## v1.1.1 - 2026-02-03

- (no Foundry module changes detected)

## v1.1.2 - 2026-02-03

- (no Foundry module changes detected)

## v1.1.3 - 2026-02-03

- (no Foundry module changes detected)

## v1.1.4 - 2026-02-03

- (no Foundry module changes detected)

## v1.1.5 - 2026-02-03

- (no Foundry module changes detected)

## v1.1.6 - 2026-02-03

- (no Foundry module changes detected)

## v1.1.7 - 2026-02-03

- (no Foundry module changes detected)

## v1.1.8 - 2026-02-03

- (no Foundry module changes detected)

## v1.1.9 - 2026-02-03

- (no Foundry module changes detected)

## v1.1.10 - 2026-02-03

- (no Foundry module changes detected)

## v1.1.11 - 2026-02-03

- (no Foundry module changes detected)

## v1.1.12 - 2026-02-04

- (no Foundry module changes detected)

## v1.1.13 - 2026-02-04

- (no Foundry module changes detected)

## v1.1.14 - 2026-02-04

- (no Foundry module changes detected)

## v1.1.15 - 2026-02-04

- (no Foundry module changes detected)

## v1.1.16 - 2026-02-05

- 05206fb Beta Release 1

## v1.1.17 - 2026-02-05

- (no Foundry module changes detected)

## v1.1.18 - 2026-02-05

- (no Foundry module changes detected)

## v1.1.19 - 2026-02-05

- (no Foundry module changes detected)

## v1.1.20 - 2026-02-05

- (no Foundry module changes detected)

## v1.1.21 - 2026-02-05

- (no Foundry module changes detected)

