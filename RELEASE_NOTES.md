## v1.1.44 - 2026-03-26

- **RollSight cloud room:** World setting for a shared `rs_…` room key; polls `rollsight.com` so physical rolls reach the table without the browser extension or local HTTP bridge (Forge-friendly). **Create RollSight room** button for GMs. Desktop bridge polling is skipped when a cloud key is set.

## v1.1.40 - 2026-03-22

- **Roll replay GIF retry:** If the proof GIF 404s while upload is still finishing, the module polls with cache-busting while the replay panel is open until the image loads (capped attempts).
- **`renderChatMessage`:** Binds retry on `.rollsight-roll-replay-details` even when the block already exists so re-renders still recover from late-ready files.
- **`/roll` fallback:** Shortened replay text in the description to **RollSight replay:** + URL.

## v1.1.38 - 2026-03-22

- **Roll replay panel:** After expanding **Roll replay**, a short hint explains chat-sized preview vs full size. The GIF is wrapped in a link (click image or **Open full-size replay in browser**) to open the same GIF URL in a new tab at native resolution.

## v1.1.37 - 2026-03-22

- **Stock roll card preserved:** Roll replay is stored on **`flags.rollsight-integration.rollReplayPayload`** and appended in **`renderChatMessage`** under `.message-content` (fallback: `section.content`), not merged into `content` (which hid core/system dice UI).
- **Chat `/r` + unrendered RollResolver:** Replay is now queued when injection completes even if the resolver was not rendered (`resolverNotRendered`), so `/r 1d20` + RollSight gets a replay row like sheet rolls.
- **Collapsed by default:** Replay is a **`<details>`** summary “Roll replay” (closed until expanded). Inline `<img>` + link stay inside the panel.

## v1.1.36 - 2026-03-22

- **Rename Roll proof → Roll replay** (UI strings, link text, `/roll` fallback description).
- **Numeric result with replay:** When `content` is set, Foundry v12 often hides the dice card — the message now includes an explicit **`formula → total`** line above the replay block.
- **GIF on the card:** The replay `<img>` is always in the message body (not hidden inside a closed `<details>`). While upload is pending, the same URL loads when the file appears; Supabase direct URLs in payloads are rewritten to **`https://www.rollsight.com/rp/…`** for `<img>` and links when possible.

## v1.1.35 - 2026-03-22

- **Roll proof visible on Foundry v12 roll cards:** The proof block is merged into **`content`** (including `ChatHandler.createRollMessage` and the `preCreateChatMessage` attach hook). Foundry v12 often **does not show `flavor`** on dice roll messages, so proof could appear only in the browser console before.
- **Back-to-back rolls / chat debounce:** `_rollFingerprint` now includes `roll_id`, `roll_proof_url`, or desktop-bridge queue timestamp (`_rollsightBridgeTs`) so identical formula/total rolls still post. Same logic in `rollsight.configure-roll-interception.js`.

## v1.1.33 - 2026-03-22

- **Roll proof in chat (RollSight GIF):** When RollSight sends a `roll_proof_url`, the module appends a **collapsible “Roll proof”** section to the **same** chat message as the roll (not a separate line by default). Expanding it shows the proof as a **native animated GIF** (`<img>`). Styling matches a compact footer row (summary line + chevron); new stylesheet `styles/rollsight-roll-proof.css` is registered in `module.json`.
- **System / Forge rolls (`Roll#toMessage`):** A `preCreateChatMessage` hook merges roll-proof HTML into the outgoing message (see v1.1.35: **`content`**, not `flavor`, for v12 visibility). **`_queueRollProofForNextChatMessage`** queues attach; if nothing matches within ~4.5s, a **fallback** chat message is still created with the same collapsible block in **`content`**.
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

## v1.1.57 - 2026-03-27

- 4c7dec6 Cloud relay: player codes, per-player publish, idempotent Supabase SQL

