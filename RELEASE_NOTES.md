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

