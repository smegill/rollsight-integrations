/**
 * RollSight Real Dice Reader for Foundry VTT
 *
 * Receives physical dice rolls from RollSight and integrates them into Foundry.
 * Uses Foundry v12+ Dice Fulfillment so rolls apply in-context (spells, attacks, saves).
 */

import { SocketHandler } from './socket-handler.js';
import { ChatHandler } from './chat-handler.js';
import { DiceHandler } from './dice-handler.js';
import {
    registerFulfillmentMethod,
    tryFulfillActiveResolver,
    rollDataToFulfillmentPairs
} from './fulfillment-provider.js';
import {
    buildRollReplayInjectHtml,
    buildRollReplayStandaloneContentHtml,
    normalizeRollProofUrl,
    rollReplaySerializablePayload,
} from './roll-proof-html.js';

/** Default HTTPS API for RollSight cloud rooms (same host as license checks). */
const ROLLSIGHT_ROOM_API_DEFAULT = "https://www.rollsight.com/api";
/** Matches website short codes (no 0/O/1/I/L). */
const ROLLSIGHT_SHORT_CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/i;

class RollSightIntegration {
    constructor() {
        this.socketHandler = new SocketHandler(this);
        this.chatHandler = new ChatHandler(this);
        this.diceHandler = new DiceHandler(this);
        
        this.connected = false;
        this.rollHistory = new Map(); // Track rolls by ID for amendments
        /** When we opened RollResolver from chat /roll, so we can feed RollSight rolls into it. */
        this._pendingChatResolver = null;
        /** Message string we're currently handling (dedupe: chat can call processMessage twice for the same send). */
        this._handlingChatRollMessage = null;
        /** After fulfilling a pending resolver, ignore an immediate duplicate roll (same formula+value) so we don't send it to chat. */
        this._lastConsumedRollFingerprint = null;
        this._lastConsumedRollTime = 0;
        /** When we last completed a pending chat resolver (so we can suppress late/duplicate rolls that arrive after cleanup). */
        this._lastPendingResolverCompletedAt = 0;
        this._lastPendingResolverFormula = null;
        /** Formula and total of the roll we just consumed (for duplicate detection when fingerprint differs by dice order). */
        this._lastConsumedRollFormula = null;
        this._lastConsumedRollTotal = null;
        this._CONSUMED_ROLL_DEBOUNCE_MS = 15000;
        /** When we last sent a roll to chat (fallback); used to suppress exact duplicate sends within a short window (e.g. bridge resend after rescan). */
        this._lastSentRollFingerprint = null;
        this._lastSentRollTime = 0;
        this._SENT_ROLL_DEBOUNCE_MS = 10000;
        /** When the pending chat resolver was created (for stale cleanup). */
        this._pendingChatResolverCreatedAt = 0;
        /** Stale thresholds for auto-recovery: clear state so rolls are accepted again. */
        this._PENDING_RESOLVER_STALE_MS = 5 * 60 * 1000;   // 5 min
        /** When we intercepted a Configure Roll mousedown, so we block the subsequent click. */
        this._configureRollInterceptedAt = 0;
        this._configureRollInterceptedTarget = null;
        /** When we intercepted an Attack/Damage Roll dialog mousedown, so we block the subsequent click. */
        this._rollDialogInterceptedAt = 0;
        this._rollDialogInterceptedTarget = null;
        this._SENT_ROLL_STALE_MS = 60000;                   // 60s
        this._CONSUMED_STALE_MS = 60000;                    // 60s
        this._staleCleanupIntervalId = null;
        /** One-shot corrected roll snapshot for next Roll.evaluate (also see queue below). */
        this._correctedRollForEvaluate = null;
        /** FIFO corrections for chat toMessage — concurrent /r commands must not overwrite a single global. */
        this._chatRollCorrectionQueue = [];
        /** Roll JSON we last applied when closing a resolver (so we can re-apply to a duplicate combat resolver). */
        this._lastConsumedRollJson = null;
        /** Time window (ms) in which a newly rendered resolver for the same formula is treated as duplicate combat resolver. */
        this._JUST_COMPLETED_WINDOW_MS = 2500;
        /** When a second resolver is rendered for the same formula while we're still feeding the first (e.g. attack roll), store it here and close it after we close the first. */
        this._duplicateResolver = null;
        /** Desktop bridge: poll RollSight HTTP bridge (Foundry desktop app — no browser extension). */
        this._bridgePollIntervalId = null;
        this._bridgePollTimeoutId = null;
        this._bridgePollSince = 0;
        this._bridgePollInFlight = false;
        /** Throttle "bridge down" console warnings (ms). */
        this._bridgeLastUnreachableLog = 0;
        /** Last bridge roll that included a roll-proof URL (chat /roll path posts a supplement after toMessage). */
        this._lastRollProofRollData = null;
        /** Merge roll proof into the next ChatMessage via preCreateChatMessage (same card as system roll). */
        this._pendingAttachRollProof = null;
        this._rollProofAttachTimeoutId = null;
        /** Cloud room relay (HTTPS poll; no browser extension). */
        this._cloudPollTimeoutId = null;
        this._cloudPollSinceSeq = 0;
        this._cloudPollInFlight = false;
        this._cloudLastUnreachableLog = 0;
        /** When last cloud poll failed with unknown room (404); avoids generic "unreachable" spam. */
        this._cloudPollLastWasUnknownRoom = false;
        this._cloudUnknownRoomLastLog = 0;
        /** Throttle debug console lines when cloud poll returns 0 events */
        this._cloudPollDebugEmptyNextLog = 0;
    }

    /**
     * Cancel queued roll-proof attach (e.g. ChatHandler will embed proof in create data directly).
     */
    _clearRollProofAttachQueue() {
        if (this._rollProofAttachTimeoutId) {
            clearTimeout(this._rollProofAttachTimeoutId);
            this._rollProofAttachTimeoutId = null;
        }
        this._pendingAttachRollProof = null;
    }

    /**
     * When the replay opens before the GIF exists, the first request may 404 and never retry.
     * Poll with cache-busting query params while the section is open until the image loads or cap is hit.
     * @param {JQuery} $details
     */
    _bindRollReplayProofRetry($details) {
        const details = $details?.[0];
        if (!details || details.nodeName !== "DETAILS" || details.dataset.rollsightReplayBound === "1") return;
        details.dataset.rollsightReplayBound = "1";
        const base = details.getAttribute("data-rollsight-proof-url");
        if (!base) return;
        const img = details.querySelector("img.rollsight-roll-replay-gif");
        if (!img) return;

        const refreshCfg = this._getRollReplayRefreshConfig();
        let pollTimer = null;
        const pollEveryMs = refreshCfg.intervalMs;
        const maxPollWindowMs = refreshCfg.durationMs;
        let pollingUntil = 0;

        const clearPoll = () => {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        };

        const isLoadedOk = () =>
            img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;

        const bumpSrc = () => {
            if (!details.open || isLoadedOk()) {
                clearPoll();
                return;
            }
            if (Date.now() > pollingUntil) {
                clearPoll();
                return;
            }
            const sep = base.includes("?") ? "&" : "?";
            img.src = `${base}${sep}rs=${Date.now()}`;
        };

        img.addEventListener("load", () => {
            if (isLoadedOk()) clearPoll();
        });
        // Keep retries on a fixed cadence; avoid rapid-fire error loops from immediate re-request on 404.
        img.addEventListener("error", () => {});

        details.addEventListener("toggle", () => {
            clearPoll();
            if (!details.open) return;
            if (isLoadedOk()) return;
            pollingUntil = Date.now() + maxPollWindowMs;
            setTimeout(() => {
                if (!details.open || isLoadedOk()) return;
                bumpSrc();
                pollTimer = setInterval(bumpSrc, pollEveryMs);
            }, 400);
        });
    }

    /**
     * Per-user setting: auto-open RollSight replay details on render.
     */
    _shouldAutoExpandRollReplay() {
        try {
            const game = (typeof foundry !== "undefined" && foundry.game) ? foundry.game : globalThis.game;
            return !!game?.settings?.get("rollsight-integration", "autoExpandRollReplay");
        } catch (_) {
            return false;
        }
    }

    _getRollReplayRefreshConfig() {
        const cfg = { intervalMs: 3000, durationMs: 20000 };
        try {
            const game = (typeof foundry !== "undefined" && foundry.game) ? foundry.game : globalThis.game;
            const everyRaw = Number(game?.settings?.get("rollsight-integration", "rollReplayRefreshEverySeconds"));
            const maxRaw = Number(game?.settings?.get("rollsight-integration", "rollReplayRefreshMaxSeconds"));
            const every = Number.isFinite(everyRaw) ? everyRaw : 3;
            const maxSec = Number.isFinite(maxRaw) ? maxRaw : 20;
            cfg.intervalMs = Math.max(1, Math.min(30, every)) * 1000;
            cfg.durationMs = Math.max(5, Math.min(120, maxSec)) * 1000;
        } catch (_) {}
        return cfg;
    }

    /**
     * Attach roll proof to the next qualifying chat message (rolls), or post a fallback line after timeout.
     */
    _queueRollProofForNextChatMessage(rollData) {
        if (!rollData?.roll_proof_url) return;
        this._clearRollProofAttachQueue();
        this._pendingAttachRollProof = rollData;
        const self = this;
        const snapshot = rollData;
        this._rollProofAttachTimeoutId = setTimeout(() => {
            self._rollProofAttachTimeoutId = null;
            if (self._pendingAttachRollProof === snapshot) {
                self._postRollProofSupplement(snapshot);
                self._pendingAttachRollProof = null;
            }
        }, 4500);
    }

    /** Known roll dialog title substrings (Attack Roll, Damage Roll, Ability Check, etc.). Not Configure Roll / Initiative. */
    static get ROLL_DIALOG_TITLE_PATTERNS() {
        return [
            'attack roll',
            'damage roll',
            'ability check',
            'saving throw',
            'skill check',
            'skill roll',
            'death save',
            'death saving',
            'check roll',
            'spell attack',
            'spell save',
            'counteract check',
            'flat check',
            'recovery check'
        ];
    }

    /** Title patterns that identify Configure Roll / initiative dialogs (we do not treat these as roll dialogs). */
    static get CONFIGURE_ROLL_TITLE_PATTERNS() {
        return ['configure roll', 'roll config', 'roll for initiative', 'initiative'];
    }

    /** Clear duplicate-suppression state so subsequent rolls are not suppressed (e.g. after opening a new dialog or after we've suppressed one duplicate). */
    _clearConsumedRollState() {
        this._lastConsumedRollFingerprint = null;
        this._lastConsumedRollTime = 0;
        this._lastPendingResolverCompletedAt = 0;
        this._lastPendingResolverFormula = null;
        this._lastConsumedRollFormula = null;
        this._lastConsumedRollTotal = null;
        this._lastConsumedRollJson = null;
        this._duplicateResolver = null;
    }
    
    /**
     * Initialize the module
     */
    init() {
        console.log("RollSight Real Dice Reader | Initializing...");
        
        // Register socket handlers (defensive: v12+ may expose socket differently)
        try {
            this.socketHandler.register();
        } catch (err) {
            console.warn("RollSight Real Dice Reader | Socket registration skipped (rolls via extension/postMessage still work):", err?.message ?? err);
        }
        
        // Fix chat message roll data when Foundry creates a message with wrong/multiplied dice (e.g. after we close resolver without submit).
        const Hooks = (typeof foundry !== 'undefined' && foundry.Hooks) ? foundry.Hooks : globalThis.Hooks;
        Hooks.on("preCreateChatMessage", (document, data, _options) => {
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const module = game?.rollsight;
            const rolls = data?.rolls ?? document.getSource?.()?.rolls ?? document._source?.rolls;
            if (!Array.isArray(rolls) || rolls.length === 0) return;
            const firstRoll = rolls[0];
            const docFormula = (firstRoll?.formula ?? firstRoll?.roll ?? "").toString().trim().toLowerCase().replace(/\s/g, "");
            let correction = typeof module?._takeChatRollCorrectionForMessage === "function"
                ? module._takeChatRollCorrectionForMessage(docFormula)
                : null;
            if (!correction && module?._correctedRollForEvaluate) {
                const c = module._correctedRollForEvaluate;
                const normC = (c.formula ?? "").toString().trim().toLowerCase().replace(/\s/g, "");
                if (docFormula === normC) {
                    correction = c;
                    module._correctedRollForEvaluate = null;
                }
            }
            if (!correction) return;
            const rollData = correction.rollJson;
            if (!rollData || typeof rollData !== 'object') return;
            const correctedRolls = [JSON.parse(JSON.stringify(rollData))];
            document.updateSource({ rolls: correctedRolls });
            if (data && Object.prototype.hasOwnProperty.call(data, "rolls")) data.rolls = correctedRolls;
        }, -1000);

        Hooks.on("preCreateChatMessage", (document, data, _options) => {
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const attach = this._pendingAttachRollProof;
            if (!attach?.roll_proof_url || !game?.user || !data) return;
            const uid = data.user ?? data.author;
            if (uid !== game.user.id && uid !== game.userId) return;
            const rolls = data.rolls ?? document.getSource?.()?.rolls ?? document._source?.rolls;
            const hasRolls = Array.isArray(rolls) && rolls.length > 0;
            const legacyRoll = data.roll != null;
            if (!hasRolls && !legacyRoll && data.type !== "roll") return;
            const payload = rollReplaySerializablePayload(attach);
            if (!payload) return;
            const ns = "rollsight-integration";
            const prevNs = { ...(data.flags?.[ns] ?? {}) };
            if (prevNs.rollReplayPayload?.roll_proof_url) return;
            data.flags = { ...(data.flags ?? {}), [ns]: { ...prevNs, rollReplayPayload: payload } };
            if (this._rollProofAttachTimeoutId) {
                clearTimeout(this._rollProofAttachTimeoutId);
                this._rollProofAttachTimeoutId = null;
            }
            this._pendingAttachRollProof = null;
            this._lastRollProofRollData = null;
        }, -900);

        Hooks.on("renderChatMessage", (message, html /* , data */) => {
            try {
                const $root = html?.jquery ? html : (typeof jQuery !== "undefined" ? jQuery(html) : null);
                if (!$root?.find) return;
                const payload = message.flags?.["rollsight-integration"]?.rollReplayPayload;
                if (payload?.roll_proof_url && !$root.find(".rollsight-roll-replay-details").length) {
                    const frag = buildRollReplayInjectHtml(payload);
                    if (frag) {
                        let $slot = $root.find(".message-content");
                        if (!$slot.length) $slot = $root.find("section.content");
                        if (!$slot.length) $slot = $root;
                        $slot.append(frag);
                    }
                }
                $root.find(".rollsight-roll-replay-details").each((_, el) => {
                    const $det = jQuery(el);
                    this._bindRollReplayProofRetry($det);
                    if (this._shouldAutoExpandRollReplay()) {
                        const details = $det[0];
                        if (details && !details.open) details.open = true;
                    }
                });
            } catch (e) {
                console.warn("RollSight Real Dice Reader | renderChatMessage roll replay:", e);
            }
        });
        
        Hooks.once('ready', () => {
            this.onReady();
            // Make API available globally (using namespaced API for Foundry v13+ if available)
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            game.rollsight = this;
            
            // Listen for messages from browser extension (via window.postMessage)
            // When RollResolver opens (chat, manual entry, skill check, save, initiative, etc.): set as pending so we can feed RollSight rolls; optionally replace UI with RollSight prompt.
            // Do not overwrite _pendingChatResolver when we already opened one (e.g. from roll dialog) so that handleRoll's injection and resolveOutcome are not lost when Foundry later renders a resolver.
            Hooks.on('renderRollResolver', (resolver, element, _data) => {
                if (this._pendingChatResolver?.resolverNotRendered) return;
                const roll = resolver.roll || resolver.object?.roll;
                const formula = roll?.formula ?? "";
                const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s/g, "");
                const formulaNorm = norm(formula);
                // Combat/systems sometimes render a second resolver for the same roll after we already closed one. Re-apply the last consumed roll and close this duplicate without making it pending.
                if (roll && formula && this._lastPendingResolverFormula != null && norm(this._lastPendingResolverFormula) === formulaNorm && this._lastPendingResolverCompletedAt > 0 && (Date.now() - this._lastPendingResolverCompletedAt) < this._JUST_COMPLETED_WINDOW_MS && this._lastConsumedRollJson) {
                    const pairs = this._pairsFromRollJson(this._lastConsumedRollJson);
                    if (pairs.length > 0) {
                        const self = this;
                        this._injectRollIntoResolver(resolver, pairs).then(async () => {
                            const resolvedRoll = resolver?.roll ?? roll;
                            if (resolvedRoll?.toJSON) {
                                const rollJson = JSON.parse(JSON.stringify(resolvedRoll.toJSON()));
                                self._correctedRollForEvaluate = { rollJson, formula: formulaNorm };
                            }
                            if (typeof resolver.close === "function") await resolver.close();
                        }).catch(() => {}).finally(() => {
                            this._lastConsumedRollJson = null;
                        });
                        if (game.settings.get("rollsight-integration", "debugLogging")) {
                            console.log("RollSight Real Dice Reader | [debug] Duplicate resolver for same formula — re-applied last roll and closing");
                        }
                        return;
                    }
                }
                // Second resolver for same formula while we're still feeding the first (e.g. attack roll): don't replace pending; store as duplicate and we'll close it after closing the first.
                if (roll && formula && this._pendingChatResolver && norm(this._pendingChatResolver.formula) === formulaNorm) {
                    this._duplicateResolver = { resolver, formulaNorm };
                    if (game.settings.get("rollsight-integration", "debugLogging")) {
                        console.log("RollSight Real Dice Reader | [debug] Same-formula resolver rendered while feeding first — stored as duplicate to close after first");
                    }
                    return;
                }
                const replaceManual = game.settings.get("rollsight-integration", "replaceManualDialog") !== false;
                // Any rendered resolver becomes our pending one so handleRoll can feed it (works for Manual dice config: skill checks, saves, etc.).
                if (roll && formula) {
                    this._duplicateResolver = null;
                    this._pendingChatResolver = {
                        resolver,
                        roll,
                        formula: String(formula).trim(),
                        resolverNotRendered: false,
                        consumedFingerprints: new Set()
                    };
                    this._pendingChatResolverCreatedAt = Date.now();
                    if (game.settings.get("rollsight-integration", "debugLogging")) {
                        console.log("RollSight Real Dice Reader | [debug] RollResolver rendered, set as pending (replaceManualDialog:", replaceManual, ") formula:", formula);
                    }
                }
                if (replaceManual) {
                    this._replaceResolverWithRollSightPrompt(resolver, element, formula);
                }
                this._injectCompleteWithDigitalButton(resolver, element);
            });

            window.addEventListener('message', (event) => {
                // Only accept messages from our extension or same origin
                if (event.data && event.data.type === 'rollsight-roll') {
                    console.log("RollSight Real Dice Reader | Received roll via postMessage:", event.data.rollData);
                    this.handleRoll(event.data.rollData).catch(error => {
                        console.error("RollSight Real Dice Reader | Error handling roll from postMessage:", error);
                    });
                } else if (event.data && event.data.type === 'rollsight-test') {
                    console.log("🎲 RollSight Real Dice Reader | Received test message request");
                    this.sendTestMessage().catch(error => {
                        console.error("RollSight Real Dice Reader | Error sending test message:", error);
                    });
                } else if (event.data && event.data.type === 'rollsight-amendment') {
                    console.log("RollSight Real Dice Reader | Received amendment via postMessage:", event.data.amendmentData);
                    this.handleAmendment(event.data.amendmentData).catch(error => {
                        console.error("RollSight Real Dice Reader | Error handling amendment from postMessage:", error);
                    });
                } else if (event.data && event.data.type === 'rollsight-chat-text') {
                    const t = event.data.text;
                    this.postChatTextFromBridge(t).catch((error) => {
                        console.error("RollSight Real Dice Reader | Error posting chat text from extension:", error);
                    });
                }
            });

            // 1) Patch Roll.evaluate so RollSight dice always use interactive (RollResolver) path.
            this._patchRollEvaluateForRollSight();
            // 2) Intercept chat /roll so we open RollResolver when evaluate() isn't used (e.g. chat/initiative).
            this._wrapChatProcessMessage();
            // 3) Intercept roll dialogs (Attack/Damage/Ability Check/Saving Throw/etc.) first, then Configure Roll (initiative).
            // Use mousedown + pointerdown in capture phase; roll-dialog handler runs first so it takes precedence.
            const self = this;
            if (typeof document !== 'undefined' && document.body) {
                const rollDialogIntercept = (ev) => self._onRollDialogClick(ev);
                document.body.addEventListener('pointerdown', rollDialogIntercept, true);
                document.body.addEventListener('mousedown', rollDialogIntercept, true);
                document.body.addEventListener('click', (ev) => {
                    if (self._shouldBlockRollDialogClick(ev)) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation();
                    }
                }, true);
                const configureRollIntercept = (ev) => self._onConfigureRollDialogClick(ev);
                document.body.addEventListener('pointerdown', configureRollIntercept, true);
                document.body.addEventListener('mousedown', configureRollIntercept, true);
                document.body.addEventListener('click', (ev) => {
                    if (self._shouldBlockConfigureRollClick(ev)) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation();
                    }
                }, true);
            }
            const v = game?.release?.version ?? game?.data?.version ?? game?.version ?? "?";
            console.log("RollSight Real Dice Reader | Fully loaded (Foundry " + v + "). Settings: Configure Settings → Module Settings → RollSight Real Dice Reader. Use Manual dice in Dice Configuration for physical RollSight dice.");

            const HooksForLifecycle = (typeof foundry !== 'undefined' && foundry.Hooks) ? foundry.Hooks : globalThis.Hooks;
            const self = this;
            HooksForLifecycle.on("closeGame", () => {
                self._stopDesktopBridgePoll();
                self._stopCloudRoomPoll();
            });
            HooksForLifecycle.on("settingChange", (namespace, key, _value) => {
                if (namespace !== "rollsight-integration") return;
                if (key === "desktopBridgePoll" || key === "desktopBridgeUrl") {
                    self._restartDesktopBridgePoll();
                    self._restartCloudRoomPoll();
                }
                if (key === "cloudRoomKey" || key === "cloudRoomApiBase" || key === "cloudPlayerKey") {
                    self._cloudPollSinceSeq = 0;
                    self._restartCloudRoomPoll();
                    self._restartDesktopBridgePoll();
                }
                if (key === "cloudRoomKey") {
                    void self._autoProvisionPlayerCodeOnly();
                }
            });

            void (async () => {
                try {
                    await self._autoProvisionRollSightCloudRelay();
                } catch (err) {
                    console.warn("RollSight Real Dice Reader | Cloud auto-provision:", err);
                }

                // One-time check: is the RollSight extension on this tab? (after cloud codes may exist)
                const useDesktopBridge = game.settings.get("rollsight-integration", "desktopBridgePoll");
                const useCloudRoom = Boolean(self._getCloudPollBearerKey());
                const statusTimeout = setTimeout(() => {
                    window.removeEventListener('message', onStatusResponse);
                    if (useDesktopBridge) {
                        console.log("RollSight Real Dice Reader | Desktop bridge polling enabled — rolls are read from the RollSight app HTTP bridge. No browser extension required.");
                        return;
                    }
                    if (useCloudRoom) {
                        console.log("RollSight Real Dice Reader | Cloud room / player key is set — rolls are delivered over the internet. No browser extension required.");
                        return;
                    }
                    console.warn("RollSight Real Dice Reader | Extension not detected on this tab. If rolls don't reach Foundry: install/reload the RollSight VTT Bridge extension, enable Desktop bridge polling in module settings for the Foundry desktop app, ensure RollSight app + bridge are running, then refresh this page.");
                }, 2500);
                function onStatusResponse(event) {
                    if (event.data?.type !== 'rollsight-status-response') return;
                    clearTimeout(statusTimeout);
                    window.removeEventListener('message', onStatusResponse);
                    if (event.data?.contentScriptLoaded) {
                        console.log("RollSight Real Dice Reader | Extension is active on this tab. Roll in RollSight to send rolls here.");
                    }
                }
                window.addEventListener('message', onStatusResponse);
                window.postMessage({ type: 'rollsight-status-request' }, '*');

                self._startDesktopBridgePollIfEnabled();
                self._startCloudRoomPollIfEnabled();
            })();
        });
    }

    /**
     * Patch Roll.evaluate so that any roll with dice set to RollSight in Dice Configuration
     * always uses allowInteractive: true, so Foundry opens RollResolver (same as manual entry).
     * Patch both base Roll and any game-system classes in CONFIG.Dice.rolls.
     */
    _patchRollEvaluateForRollSight() {
        const CONFIG = (typeof foundry !== 'undefined' && foundry.CONFIG) ? foundry.CONFIG : globalThis.CONFIG;
        const rollClasses = [];
        const baseRoll = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
        if (baseRoll?.prototype?.evaluate) rollClasses.push(baseRoll);
        const configRolls = CONFIG?.Dice?.rolls;
        if (Array.isArray(configRolls)) {
            for (const R of configRolls) {
                if (R?.prototype?.evaluate && !rollClasses.includes(R)) rollClasses.push(R);
            }
        }
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        for (const RollClass of rollClasses) {
            if (RollClass.prototype._rollsightEvaluatePatched) continue;
            const originalEvaluate = RollClass.prototype.evaluate;
            RollClass.prototype.evaluate = function evaluate(options = {}) {
                const hasRollSight = rollHasRollSightTerms(this);
                const replaceManual = game?.settings?.get("rollsight-integration", "replaceManualDialog") !== false;
                const hasManual = replaceManual && rollHasManualTerms(this);
                if (game?.settings?.get("rollsight-integration", "debugLogging")) {
                    console.log("RollSight Real Dice Reader | [debug] Roll.evaluate", this.formula, "hasRollSight:", hasRollSight, "hasManual:", hasManual, "allowInteractive:", options?.allowInteractive);
                }
                if (hasRollSight || hasManual) {
                    options = { ...options, allowInteractive: true };
                    if (game?.settings?.get("rollsight-integration", "debugLogging")) {
                        console.log("RollSight Real Dice Reader | [debug] Forcing allowInteractive: true for", this.formula);
                    }
                }
                const applyCorrection = () => {
                    const module = game?.rollsight;
                    const normalize = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase();
                    const formula = normalize(this.formula);
                    const q = module?._chatRollCorrectionQueue || [];
                    let correction = q.find((c) => normalize(c.formula) === formula);
                    if (!correction && module?._correctedRollForEvaluate && normalize(module._correctedRollForEvaluate.formula) === formula) {
                        correction = module._correctedRollForEvaluate;
                    }
                    if (!correction) return;
                    try {
                        // Apply stored roll data: copy Die term results by dice order (not term index) so modifiers (e.g. 1d20 - 1) stay correct.
                        const data = typeof correction.rollJson === 'string'
                            ? JSON.parse(correction.rollJson)
                            : correction.rollJson;
                        if (!data || typeof data !== 'object') return;
                        const storedTerms = data.terms;
                        const DieClass = (typeof foundry !== 'undefined' && foundry.dice?.terms?.Die) ? foundry.dice.terms.Die : globalThis.Die;
                        const isStoredDie = (t) => t && Array.isArray(t?.results) && t.results.length > 0 && (t.faces != null || t.denomination != null || t.class === 'Die');
                        const thisDiceTerms = (this.terms ?? []).filter(t => t instanceof DieClass);
                        const storedDiceTerms = (Array.isArray(storedTerms) ? storedTerms : []).filter(isStoredDie);
                        if (thisDiceTerms.length > 0 && storedDiceTerms.length > 0) {
                            for (let i = 0; i < Math.min(thisDiceTerms.length, storedDiceTerms.length); i++) {
                                const term = thisDiceTerms[i];
                                const stored = storedDiceTerms[i];
                                if (stored?.results?.length) {
                                    term.results = stored.results.map(r => typeof r === 'object' ? r : { result: r, active: true, discarded: false });
                                    term._evaluated = true;
                                }
                            }
                        }
                        const total = data._total ?? data.total;
                        if (typeof total === 'number' && !Number.isNaN(total)) {
                            this._total = total;
                        }
                        if (typeof data.result === 'string') {
                            this.result = data.result;
                        }
                        this._evaluated = true;
                        if (game?.settings?.get("rollsight-integration", "debugLogging")) {
                            console.log("RollSight Real Dice Reader | [debug] Applied corrected roll to evaluate:", this.formula);
                        }
                    } catch (err) {
                        console.warn("RollSight Real Dice Reader | Could not apply corrected roll:", err);
                    }
                };
                const result = originalEvaluate.call(this, options);
                if (result && typeof result.then === 'function') {
                    return result.then((res) => {
                        applyCorrection();
                        return res;
                    });
                }
                applyCorrection();
                return result;
            };
            RollClass.prototype._rollsightEvaluatePatched = true;
        }
        if (game?.settings?.get("rollsight-integration", "debugLogging")) {
            const CONFIG = (typeof foundry !== 'undefined' && foundry.CONFIG) ? foundry.CONFIG : globalThis.CONFIG;
            const coreDice = game?.settings?.get("core", "diceConfiguration");
            console.log("RollSight Real Dice Reader | [debug] CONFIG.Dice.fulfillment.dice at ready:", JSON.stringify(CONFIG?.Dice?.fulfillment?.dice ?? {}));
            console.log("RollSight Real Dice Reader | [debug] game.settings.get('core','diceConfiguration'):", coreDice);
        }
        console.log("RollSight Real Dice Reader | Roll.evaluate patched for", rollClasses.length, "Roll class(es) (RollResolver for RollSight dice)");
    }

    /**
     * Wrap ui.chat.processMessage so /roll <formula> opens RollResolver when Dice Config uses RollSight.
     * Fallback for when chat (or other code) doesn't use Roll.evaluate() with interactive path.
     */
    _wrapChatProcessMessage() {
        const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
        if (!ui?.chat?.processMessage) return;
        const self = this;
        const original = ui.chat.processMessage.bind(ui.chat);
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        ui.chat.processMessage = async function processMessage(message) {
            try {
                const handled = await self._handleChatRollWithFulfillment(message, original);
                if (handled) return;
                if (game?.settings?.get("rollsight-integration", "debugLogging") && typeof message === "string" && /^\/(?:roll|r|gmroll|gmr|blindroll|br|broll|selfroll|sr|publicroll|pr)\s/i.test(message)) {
                    console.log("RollSight Real Dice Reader | [debug] Chat roll command not handled by RollSight, passing to default:", message.slice(0, 60));
                }
                const normalized = self._normalizeDiceCommandMessageForFoundry(message);
                return original(normalized);
            } catch (err) {
                console.error("RollSight Real Dice Reader | Chat interceptor error (falling back to default):", err);
                return original(self._normalizeDiceCommandMessageForFoundry(message));
            }
        };
        console.log("RollSight Real Dice Reader | Chat /roll and /r interceptor active");
    }

    /**
     * Map Foundry chat roll command to CONFIG.Dice.rollModes key for toMessage(options.rollMode).
     * Supports: /roll, /r, /publicroll, /pr (public); /gmroll, /gmr (GM only); /blindroll, /br, /broll (blind); /selfroll, /sr (self).
     * @param {string} cmd - Leading command e.g. "/gmr" or "/roll"
     * @returns {string} rollMode key for toMessage
     */
    _chatRollCommandToRollMode(cmd) {
        if (!cmd || typeof cmd !== 'string') return 'publicroll';
        const c = cmd.trim().toLowerCase();
        if (c === '/gmroll' || c === '/gmr') return 'gmroll';
        if (c === '/blindroll' || c === '/br' || c === '/broll') return 'blindroll';
        if (c === '/selfroll' || c === '/sr') return 'selfroll';
        if (c === '/publicroll' || c === '/pr' || c === '/roll' || c === '/r') return 'publicroll';
        return 'publicroll';
    }

    /**
     * Foundry / D&D5e chat often uses "2d20 kh" / "2d20 kl" with a space; BasicRoll.parse rejects that ("k" unexpected).
     * Collapse to "2d20kh" / "2d20kl" so Roll.fromFormula and default chat processing succeed.
     * @param {string} formula
     * @returns {string}
     */
    _normalizeChatRollFormula(formula) {
        if (!formula || typeof formula !== "string") return formula;
        let f = formula.trim().replace(/\s+/g, " ");
        f = f.replace(/\s+(kh|kl)(?=\s|$|[+\-])/gi, "$1");
        return f;
    }

    /**
     * Apply formula normalization to a full chat line so fallback original(message) does not throw on /r 2d20 kh.
     * @param {string} message
     * @returns {string}
     */
    _normalizeDiceCommandMessageForFoundry(message) {
        if (typeof message !== "string") return message;
        const ROLL_CMD_REGEX = /^(\/(?:roll|r|gmroll|gmr|blindroll|br|broll|selfroll|sr|publicroll|pr))\s+(.+?)(?:\s*#\s*(.*))?$/is;
        const match = message.match(ROLL_CMD_REGEX);
        if (!match) return message;
        const formula = this._normalizeChatRollFormula(match[2]);
        const desc = match[3] != null && String(match[3]).length ? ` # ${match[3]}` : "";
        return `${match[1]} ${formula}${desc}`;
    }

    /**
     * If message is a roll command (<cmd> <formula> [# description]) and any die uses RollSight in Dice Config,
     * open RollResolver, await fulfillment, then post to chat with the correct roll visibility.
     * Supports: /roll, /r, /gmroll, /gmr, /blindroll, /br, /broll, /selfroll, /sr, /publicroll, /pr.
     * Formulas: advantage (2d20kh), disadvantage (2d20kl), modifiers (2d20kh + 5).
     * Returns true if handled.
     */
    async _handleChatRollWithFulfillment(message, originalProcessMessage) {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const debug = game?.settings?.get("rollsight-integration", "debugLogging");
        const msg = typeof message === 'string' ? message.trim() : '';
        // Match any Foundry roll command, then formula, optional # description
        const ROLL_CMD_REGEX = /^(\/(?:roll|r|gmroll|gmr|blindroll|br|broll|selfroll|sr|publicroll|pr))\s+(.+?)(?:\s*#\s*(.*))?$/is;
        const match = msg.match(ROLL_CMD_REGEX);
        if (!match) return false;
        const rollCommand = match[1];
        // Normalize formula: trim, collapse spaces, fix "2d20 kh" -> "2d20kh" for Foundry's parser
        let formula = this._normalizeChatRollFormula(match[2].trim().replace(/\s+/g, ' '));
        const description = match[3]?.trim() || '';

        if (description && /RollSight/i.test(description)) {
            if (debug) console.log("RollSight Real Dice Reader | [debug] Chat /roll skipped (RollSight-originated)");
            return false;
        }

        const CONFIG = (typeof foundry !== 'undefined' && foundry.CONFIG) ? foundry.CONFIG : globalThis.CONFIG;
        const RollClass = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
        const RollResolverClass = RollClass?.resolverImplementation ?? (typeof foundry !== 'undefined' && foundry.applications?.dice?.RollResolver ? foundry.applications.dice.RollResolver : null);
        const rollMode = this._chatRollCommandToRollMode(rollCommand);
        if (debug) {
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const rawSetting = game?.settings?.get("core", "diceConfiguration");
            console.log("RollSight Real Dice Reader | [debug] Chat roll check:", { command: rollCommand, rollMode, formula, hasFulfillmentDice: !!CONFIG?.Dice?.fulfillment?.dice, hasRollClass: !!RollClass, hasRollResolverClass: !!RollResolverClass, coreDiceConfig: rawSetting });
        }
        if (!RollClass || !RollResolverClass) return false;

        let roll;
        try {
            roll = RollClass.fromFormula ? RollClass.fromFormula(formula) : new RollClass(formula);
        } catch (_) {
            if (debug) console.log("RollSight Real Dice Reader | [debug] Chat /roll parse failed for formula:", formula);
            return false;
        }

        const denominations = this._getDenominationsFromRoll(roll);
        const usesManual = denominations.some(denom => this._getMethodForDenomination(denom) === 'manual');
        if (debug) {
            console.log("RollSight Real Dice Reader | [debug] Chat roll denominations:", denominations, "usesManual:", usesManual, "methods:", denominations.map(d => this._getMethodForDenomination(d)));
        }
        if (!usesManual) return false;

        if (this._handlingChatRollMessage === msg) {
            if (debug) console.log("RollSight Real Dice Reader | [debug] Chat /roll duplicate call, skipping (already handling this message)");
            return true;
        }
        this._handlingChatRollMessage = msg;
        let chatOutcomeSession = null;

        try {
            if (debug) console.log("RollSight Real Dice Reader | [debug] Chat /roll opening RollResolver for", formula);
            this._pendingChatResolver = null;
            this._clearConsumedRollState();
            const resolver = new RollResolverClass({ roll });
            let resolveOutcomeForPending;
            const outcomePromise = new Promise((resolve) => { resolveOutcomeForPending = resolve; });
            // Tie this chat session to a unique object so finally/toMessage never clobber a newer /r that replaced global _pendingChatResolver.
            chatOutcomeSession = {};
            this._pendingChatResolver = { chatOutcomeSession, resolver, roll, formula, description, rollMode, resolveOutcome: resolveOutcomeForPending, resolverNotRendered: true, consumedFingerprints: new Set() };
            this._pendingChatResolverCreatedAt = Date.now();
            // Register with Roll.RESOLVERS so Roll.registerResult() routes to this resolver (e.g. from tryFulfillActiveResolver).
            const RollClassRef = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
            if (RollClassRef?.RESOLVERS instanceof Map) {
                RollClassRef.RESOLVERS.set(roll, resolver);
                if (debug) console.log("RollSight Real Dice Reader | [debug] Chat /roll registered resolver in Roll.RESOLVERS");
            }
            // Don't render the RollResolver window — show only our RollSight dialog so the user sees one dialog, not two.
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;

            const fallbackDialog = this._showRollSightWaitDialog(formula, resolver, resolveOutcomeForPending, game);
            if (fallbackDialog) this._pendingChatResolver.dialog = fallbackDialog;
            if (!fallbackDialog && ui?.notifications) {
                ui.notifications.info(`RollSight: Roll ${formula} — roll the dice in RollSight to fill in the result.`);
            }

            // Wait only on our dialog outcome (Complete / Cancel / or handleRoll will resolve when RollSight roll is injected).
            // Do NOT race with resolver.awaitFulfillment() — in v13 the resolver can have empty fulfillable when opened from chat, so awaitFulfillment() resolves immediately and the dialog would flash and disappear.
            const winner = await outcomePromise;

            if (fallbackDialog?.close) fallbackDialog.close();

            if (winner === "cancelled") {
                try {
                    if (typeof resolver.close === "function") await resolver.close();
                } catch (_) {}
                return true;
            }

            // Use a real Roll instance — resolver.roll may lack toMessage (plain/internal object after fulfillment).
            const fulfilledRoll = this._rollForChatToMessage(resolver, roll);
            if (fulfilledRoll && typeof fulfilledRoll.toMessage === "function") {
                try {
                    await this._ensureRollEvaluatedForChat(fulfilledRoll);
                } catch (preMsgErr) {
                    console.warn("RollSight Real Dice Reader | pre toMessage evaluate:", preMsgErr);
                }
                try {
                    const messageData = description ? { flavor: description } : {};
                    const options = { rollMode: rollMode ?? "publicroll" };
                    if (this._lastRollProofRollData?.roll_proof_url) {
                        this._queueRollProofForNextChatMessage(this._lastRollProofRollData);
                    }
                    await fulfilledRoll.toMessage(messageData, options);
                } catch (msgErr) {
                    console.error("RollSight Real Dice Reader | toMessage failed, trying ChatHandler.createRollMessage:", msgErr);
                    this._clearRollProofAttachQueue();
                    try {
                        await this._ensureRollEvaluatedForChat(fulfilledRoll);
                        const proof = this._lastRollProofRollData;
                        await this.chatHandler.createRollMessage(fulfilledRoll, {
                            formula: fulfilledRoll.formula ?? formula,
                            total: fulfilledRoll.total ?? fulfilledRoll._total,
                            dice: [],
                            roll_id: null,
                            ...(proof?.roll_proof_url ? {
                                roll_proof_url: proof.roll_proof_url,
                                roll_proof_note: proof.roll_proof_note,
                                roll_proof_pending: proof.roll_proof_pending
                            } : {})
                        });
                        this._lastRollProofRollData = null;
                    } catch (fbErr) {
                        console.error("RollSight Real Dice Reader | ChatHandler fallback failed:", fbErr);
                    }
                }
            } else {
                console.warn("RollSight Real Dice Reader | Chat fulfillment: no Roll with toMessage after outcome (resolver.roll vs formula roll)");
            }
            try {
                if (typeof resolver.close === "function") await resolver.close();
            } catch (_) {
                // Resolver was never rendered (chat flow); close() may expect element
            }
            return true;
        } catch (err) {
            console.error("RollSight Real Dice Reader | Chat /roll fulfillment error:", err);
            return false;
        } finally {
            const RollClassRef = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
            // Always unregister this chat line's Roll from RESOLVERS; do not delete another session's roll if a new /r started.
            if (RollClassRef?.RESOLVERS instanceof Map && roll) {
                RollClassRef.RESOLVERS.delete(roll);
            }
            if (this._pendingChatResolver?.chatOutcomeSession === chatOutcomeSession) {
                this._pendingChatResolver = null;
            }
            if (this._handlingChatRollMessage === msg) {
                this._handlingChatRollMessage = null;
            }
        }
    }

    /**
     * Normalize formula for matching chat corrections (same as preCreateChatMessage).
     * @param {string} f
     * @returns {string}
     */
    _normChatRollFormula(f) {
        return String(f ?? "").trim().toLowerCase().replace(/\s/g, "");
    }

    /**
     * Register a corrected roll for the next chat message + Roll.evaluate (pending chat inject).
     * @param {object} rollJson
     * @param {string} formulaRaw - e.g. pending chat formula "2d20kh"
     */
    _registerChatRollCorrection(rollJson, formulaRaw) {
        if (!rollJson || typeof rollJson !== "object") return;
        const formula = this._normChatRollFormula(formulaRaw);
        const entry = { rollJson, formula };
        this._chatRollCorrectionQueue.push(entry);
        if (this._chatRollCorrectionQueue.length > 16) {
            console.warn("RollSight Real Dice Reader | Chat correction queue overflow; dropping oldest");
            this._chatRollCorrectionQueue.shift();
        }
        this._correctedRollForEvaluate = entry;
    }

    /**
     * Remove and return the first queued correction whose formula matches the chat document (FIFO among same formula).
     * @param {string} docFormulaNorm
     * @returns {{ rollJson: object, formula: string } | null}
     */
    _takeChatRollCorrectionForMessage(docFormulaNorm) {
        const norm = String(docFormulaNorm ?? "").trim().toLowerCase().replace(/\s/g, "");
        if (!norm || !this._chatRollCorrectionQueue?.length) return null;
        const i = this._chatRollCorrectionQueue.findIndex((c) => c.formula === norm);
        if (i < 0) return null;
        const [entry] = this._chatRollCorrectionQueue.splice(i, 1);
        if (this._correctedRollForEvaluate === entry) {
            this._correctedRollForEvaluate = null;
        }
        return entry;
    }

    /**
     * After RollResolver fills dice, resolver.roll may be plain/internal data without toMessage.
     * Prefer the original Roll from chat, then rehydrate via Roll.fromJSON.
     * @param {*} resolver
     * @param {*} originalRoll - Roll instance from Roll.fromFormula
     * @returns {object|null} Roll with toMessage
     */
    _rollForChatToMessage(resolver, originalRoll) {
        const RollClass = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
        const rRes = resolver?.roll;
        const rOrig = originalRoll;
        if (typeof rRes?.toMessage === "function") return rRes;
        if (typeof rOrig?.toMessage === "function") return rOrig;
        const tryFrom = (src) => {
            if (!src || typeof src.toJSON !== "function" || !RollClass?.fromJSON) return null;
            try {
                const r = RollClass.fromJSON(src.toJSON());
                return typeof r?.toMessage === "function" ? r : null;
            } catch (_) {
                return null;
            }
        };
        return tryFrom(rRes) || tryFrom(rOrig);
    }

    /**
     * ChatMessage (v12+) requires rolls to be evaluated before create().
     * @param {*} roll
     */
    async _ensureRollEvaluatedForChat(roll) {
        if (!roll) return;
        if (roll._evaluated === true) return;
        const t = roll.total ?? roll._total;
        if (typeof t === "number" && !Number.isNaN(t)) {
            roll._evaluated = true;
            if (roll._total == null || Number.isNaN(roll._total)) roll._total = t;
            return;
        }
        if (typeof roll.evaluate === "function") {
            try {
                await roll.evaluate({ async: false, allowInteractive: false });
            } catch (_) {
                /* ignore */
            }
        }
        const t2 = roll.total ?? roll._total;
        if (typeof t2 === "number" && !Number.isNaN(t2)) {
            roll._evaluated = true;
        }
    }

    /**
     * Build a user-facing message for remaining dice (e.g. "Roll 5 more d6 in RollSight for 8d6").
     * @param {Map<string, object>} fulfillable - resolver.fulfillable (term key -> descriptor; descriptor may have denomination)
     * @param {string} formula - e.g. "8d6"
     */
    _formatRemainingDicePrompt(fulfillable, formula) {
        if (!fulfillable || !(fulfillable instanceof Map) || fulfillable.size === 0) {
            return `RollSight: result received. Still need more for ${formula}.`;
        }
        const n = fulfillable.size;
        const byDenom = new Map();
        for (const [, desc] of fulfillable) {
            const denom = (desc?.denomination ?? desc?.denom ?? "").toString();
            const d = denom.toLowerCase().startsWith("d") ? denom : (denom ? `d${denom}` : "d?");
            byDenom.set(d, (byDenom.get(d) || 0) + 1);
        }
        if (byDenom.size === 0) {
            return `RollSight: Roll ${n} more dice in RollSight for ${formula}.`;
        }
        const parts = [];
        for (const [denom, count] of byDenom) {
            parts.push(count === 1 ? `1 ${denom}` : `${count} ${denom}`);
        }
        return `RollSight: Roll ${parts.join(", ")} more in RollSight for ${formula}.`;
    }

    /**
     * Get list of die denominations (e.g. ["d20"], ["d6","d6"]) from a Roll's terms.
     * Supports Die terms (2d20kh, 2d20kl, 2d20kh + 5) and PoolTerm by recursing into inner rolls.
     */
    _getDenominationsFromRoll(roll) {
        const out = [];
        const Die = (typeof foundry !== 'undefined' && foundry.dice?.terms?.Die) ? foundry.dice.terms.Die : null;
        const PoolTerm = (typeof foundry !== 'undefined' && foundry.dice?.terms?.PoolTerm) ? foundry.dice.terms.PoolTerm : null;
        if (!roll?.terms || !Die) return out;
        for (const term of roll.terms) {
            if (term instanceof Die && term.faces != null) {
                const denom = term.denomination ?? `d${term.faces}`;
                const n = Math.max(1, term.number ?? 1);
                for (let i = 0; i < n; i++) out.push(denom);
            }
            if (PoolTerm && term instanceof PoolTerm && term.rolls && Array.isArray(term.rolls)) {
                for (const innerRoll of term.rolls) {
                    if (innerRoll?.terms) out.push(...this._getDenominationsFromRoll(innerRoll));
                }
            }
        }
        return out;
    }

    /**
     * Build fulfillment pairs from a Foundry roll JSON (e.g. from _correctedRollForEvaluate.rollJson).
     * Used to re-inject the same roll into a duplicate resolver (e.g. combat opening a second resolver).
     */
    _pairsFromRollJson(rollJson) {
        const data = typeof rollJson === "string" ? JSON.parse(rollJson) : rollJson;
        if (!data?.terms || !Array.isArray(data.terms)) return [];
        const pairs = [];
        for (const term of data.terms) {
            const isDie = term?.class === "Die" || (term?.faces != null && Array.isArray(term?.results));
            if (!isDie || !term.results?.length) continue;
            const denom = (term.denomination ?? (term.faces != null ? `d${term.faces}` : "")).toString().trim().toLowerCase();
            const d = denom.startsWith("d") ? denom : denom ? `d${denom}` : "";
            if (!d) continue;
            for (const r of term.results) {
                const val = r?.result != null ? Number(r.result) : NaN;
                if (!Number.isNaN(val)) pairs.push({ denomination: d, value: val });
            }
        }
        return pairs;
    }

    _getMethodForDenomination(denomination) {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        if (!game?.settings?.get) return null;
        const diceConfig = game.settings.get("core", "diceConfiguration");
        if (!diceConfig || !denomination) return null;
        const denom = denomination.toLowerCase();
        return diceConfig[denom] ?? diceConfig[denomination] ?? null;
    }

    /**
     * Show Foundry native "wait for RollSight" dialog. Prefer DialogV2 (v13) to avoid V1 deprecation warning.
     * @param {string} formula - e.g. "1d20"
     * @param {object} resolver - RollResolver instance
     * @param {function} resolveOutcome - ( "fulfilled" | "cancelled" ) => void
     * @param {object} game - game reference
     * @returns {{ close: function } | null} - dialog instance (with close) or null
     */
    /**
     * Build HTML for per-die slots (e.g. 8d6 → 8 slots showing "Pending" until filled).
     * @param {object} resolver - RollResolver with resolver.roll.terms
     * @returns {string} HTML fragment
     */
    _buildRollSlotHtml(resolver) {
        let roll = resolver?.roll;
        if (!roll?.terms?.length && this._pendingChatResolver?.roll?.terms?.length) roll = this._pendingChatResolver.roll;
        if (!roll?.terms?.length) return "";
        const isDiceTerm = (t) => t?.faces != null;
        let slotIndex = 0;
        const groups = [];
        for (const term of roll.terms) {
            if (!isDiceTerm(term)) continue;
            const n = Math.max(1, term.number ?? 1);
            const denom = (term.denomination ?? `d${term.faces}`).toString();
            const results = term.results ?? [];
            const slotStyle = "display:inline-block;min-width:2.2em;text-align:center;padding:3px 6px;margin:0 2px;border:1px solid #666;border-radius:4px;background:rgba(0,0,0,0.2);font-weight:bold;";
            const slots = [];
            for (let i = 0; i < n; i++) {
                const value = results[i]?.result;
                const text = value != null ? String(value) : "Pending";
                slots.push(`<span class="rollsight-slot" data-slot-index="${slotIndex}" title="${denom}" style="${slotStyle}">${text}</span>`);
                slotIndex++;
            }
            groups.push(`<div class="rollsight-dice-group" style="margin:0.5em 0;"><span class="rollsight-dice-label" style="font-weight:bold;margin-right:0.5em;">${n}${denom}</span> ${slots.join(" ")}</div>`);
        }
        if (groups.length === 0) return "";
        return `<div class="rollsight-dice-slots">${groups.join("")}</div>`;
    }

    /**
     * Sync resolver.roll dice results into the resolver's form inputs so that when submit() runs,
     * Foundry's _onSubmitForm / _fulfillRoll reads our values (we hid the form but submit still reads it).
     * @param {object} resolver - RollResolver instance
     */
    _syncResolverFormFromRoll(resolver) {
        const roll = resolver?.roll ?? this._pendingChatResolver?.roll;
        if (!roll?.terms?.length) return;
        const root = resolver?.element;
        const form = root?.querySelector?.("form") ?? root?.querySelector?.("[data-part='form']");
        if (!form?.querySelectorAll) return;
        const Die = (typeof foundry !== "undefined" && foundry.dice?.terms?.Die) ? foundry.dice.terms.Die : (typeof foundry !== "undefined" && foundry.dice?.terms?.die?.Die) ? foundry.dice.terms.die.Die : null;
        const isDiceTerm = (t) => (t?.faces != null) || (Die && t instanceof Die);
        const values = [];
        for (const term of roll.terms) {
            if (!isDiceTerm(term)) continue;
            const results = term.results ?? [];
            const n = Math.max(1, term.number ?? 1);
            for (let i = 0; i < n; i++) {
                const r = results[i];
                values.push(r?.result != null && r?.result !== undefined ? Number(r.result) : "");
            }
        }
        if (values.length === 0) return;
        // Foundry RollResolver form typically has number inputs per die slot (e.g. input[type="number"] or input[min][max]).
        let inputs = Array.from(form.querySelectorAll('input[type="number"]'));
        if (inputs.length === 0) inputs = Array.from(form.querySelectorAll("input[min][max]"));
        for (let i = 0; i < inputs.length; i++) {
            inputs[i].value = i < values.length ? values[i] : "";
        }
    }

    /**
     * Update slot elements in the pending dialog from resolver.roll.terms (Pending vs value).
     * Updates either our RollSight dialog (when resolverNotRendered) or the replacement prompt inside the resolver element.
     * @param {object} resolver - RollResolver instance
     */
    _updatePendingDialogSlots(resolver) {
        let container = null;
        const dialog = this._pendingChatResolver?.dialog;
        if (dialog?.element) container = dialog.element;
        else if (resolver?.element) container = resolver.element.querySelector?.(".rollsight-replace-prompt");
        if (!container?.querySelector) return;
        let roll = resolver?.roll;
        if (!roll?.terms?.length && this._pendingChatResolver?.roll?.terms?.length) roll = this._pendingChatResolver.roll;
        if (!roll?.terms) return;
        const isDiceTerm = (t) => t?.faces != null;
        let slotIndex = 0;
        for (const term of roll.terms) {
            if (!isDiceTerm(term)) continue;
            const n = Math.max(1, term.number ?? 1);
            const results = term.results ?? [];
            for (let i = 0; i < n; i++) {
                const el = container.querySelector(`[data-slot-index="${slotIndex}"]`);
                if (el) el.textContent = results[i]?.result != null ? String(results[i].result) : "Pending";
                slotIndex++;
            }
        }
    }

    _showRollSightWaitDialog(formula, resolver, resolveOutcome, game) {
        const _t = (key, fallback) => {
            const s = game.i18n?.localize?.(key);
            return (s && s !== key) ? s : fallback;
        };
        const title = _t("ROLLSIGHT.RollDialogTitle", `RollSight: Roll ${formula}`);
        const prompt = _t("ROLLSIGHT.RollDialogPrompt", `Roll <strong>${formula}</strong> in RollSight to fill in the result, or click below to complete with digital rolls.`);
        const labelDigital = _t("ROLLSIGHT.CompleteWithDigital", "Complete with Digital Rolls");
        const labelCancel = _t("ROLLSIGHT.Cancel", "Cancel");

        const slotsHtml = this._buildRollSlotHtml(resolver);
        const content = `<p class="rollsight-dialog-prompt rollsight-dialog-marker">${prompt}</p>${slotsHtml}`;

        const stripButtonPrefix = () => {
            const run = () => {
                const el = document.querySelector(".rollsight-dialog-marker");
                const dialog = el?.closest(".window-app") ?? el?.closest("[data-appid]") ?? el?.closest(".app");
                if (!dialog) return;
                dialog.querySelectorAll("button").forEach((btn) => {
                    const raw = btn.textContent || "";
                    if (raw.startsWith("> ")) btn.textContent = raw.slice(2);
                    else if (raw.startsWith(">")) btn.textContent = raw.slice(1);
                });
            };
            requestAnimationFrame(run);
            setTimeout(run, 100);
        };

        const DialogV2 = (typeof foundry !== "undefined" && foundry.applications?.api?.DialogV2) ? foundry.applications.api.DialogV2 : null;
        if (DialogV2) {
            const dlg = new DialogV2({
                window: { title },
                content,
                buttons: [
                    { action: "digital", label: labelDigital, icon: "<i class=\"fas fa-dice\"></i>", callback: async () => { await this._completeResolverWithDigitalRolls(resolver); resolveOutcome("fulfilled"); } },
                    { action: "cancel", label: labelCancel, icon: "<i class=\"fas fa-times\"></i>", "default": true, callback: () => resolveOutcome("cancelled") }
                ]
            });
            dlg.render({ force: true });
            stripButtonPrefix();
            return dlg;
        }

        const DialogClass = this._getFoundryDialogClass();
        if (DialogClass) {
            const dlg = new DialogClass({
                title,
                content,
                buttons: {
                    digital: { icon: "<i class=\"fas fa-dice\"></i>", label: labelDigital, callback: async () => { await this._completeResolverWithDigitalRolls(resolver); resolveOutcome("fulfilled"); } },
                    cancel: { icon: "<i class=\"fas fa-times\"></i>", label: labelCancel, callback: () => resolveOutcome("cancelled") }
                },
                "default": "cancel",
                close: () => { if (resolveOutcome) resolveOutcome("cancelled"); }
            }, { width: 380 });
            dlg.render(true);
            stripButtonPrefix();
            return dlg;
        }
        return null;
    }

    /**
     * Return true if the resolver's roll has all dice terms fully filled (no empty slots).
     * Used to detect duplicate/late rolls that arrive after we've already completed the resolver.
     */
    _isResolverComplete(resolver) {
        const roll = resolver?.roll ?? this._pendingChatResolver?.roll;
        if (!roll?.terms?.length) return false;
        const Die = (typeof foundry !== "undefined" && foundry.dice?.terms?.Die) ? foundry.dice.terms.Die : (typeof foundry !== "undefined" && foundry.dice?.terms?.die?.Die) ? foundry.dice.terms.die.Die : null;
        const isDiceTerm = (term) => {
            if (term?.faces == null) return false;
            if (Die && term instanceof Die) return true;
            return typeof term.denomination === "string" || typeof term.number === "number";
        };
        for (const term of roll.terms) {
            if (!isDiceTerm(term)) continue;
            const n = Math.max(1, term.number ?? 1);
            const results = term.results ?? [];
            const filled = results.filter(r => r?.result != null && r?.result !== undefined).length;
            if (filled < n) return false;
        }
        return true;
    }

    /**
     * Normalize denomination string for matching (e.g. "d20", "D20" -> "d20").
     */
    _termDenom(term) {
        const d = (term?.denomination ?? (term?.faces != null ? `d${term.faces}` : "")).toString().trim().toLowerCase();
        return d.startsWith("d") ? d : d ? `d${d}` : "";
    }

    /**
     * Inject RollSight results into the resolver's roll (merge into existing results). Does not submit.
     * Pairs are matched to terms by denomination. After injecting, applies term modifiers (kh, kl, etc.) so keep-highest/lowest are correct.
     * @param {object} resolver - RollResolver instance
     * @param {{ denomination: string, value: number }[]} pairs - from rollDataToFulfillmentPairs
     * @returns {Promise<{ injected: boolean, complete: boolean }>} - injected any; all dice terms have all results
     */
    async _injectRollIntoResolver(resolver, pairs) {
        let roll = resolver?.roll;
        if (!roll?.terms?.length && this._pendingChatResolver?.roll?.terms?.length) {
            roll = this._pendingChatResolver.roll;
        }
        const game = (typeof foundry !== "undefined" && foundry.game) ? foundry.game : globalThis.game;
        const debug = game?.settings?.get("rollsight-integration", "debugLogging");
        if (!roll?.terms || !pairs.length) {
            if (debug) console.log("RollSight Real Dice Reader | [debug] inject failed: no roll.terms or no pairs");
            return { injected: false, complete: false };
        }
        const Die = (typeof foundry !== "undefined" && foundry.dice?.terms?.Die) ? foundry.dice.terms.Die : (typeof foundry !== "undefined" && foundry.dice?.terms?.die?.Die) ? foundry.dice.terms.die.Die : null;
        const isDiceTerm = (term) => {
            if (term?.faces == null) return false;
            if (Die && term instanceof Die) return true;
            return typeof term.denomination === "string" || typeof term.number === "number";
        };
        let injected = false;
        let allComplete = true;
        for (const pair of pairs) {
            const pairDenom = (pair.denomination ?? "").toString().trim().toLowerCase();
            const wantD = pairDenom.startsWith("d") ? pairDenom : pairDenom ? `d${pairDenom}` : "";
            if (!wantD) continue;
            let placed = false;
            for (const term of roll.terms) {
                if (!isDiceTerm(term)) continue;
                const termDenom = this._termDenom(term);
                if (termDenom !== wantD) continue;
                const n = Math.max(1, term.number ?? 1);
                const existing = term.results ? [...term.results] : [];
                // Count filled slots (Foundry may pre-allocate results for unevaluated terms)
                const filledCount = existing.filter(r => r?.result != null && r?.result !== undefined).length;
                if (filledCount >= n) continue;
                // Place in first empty slot (by index or append)
                const emptyIdx = existing.findIndex(r => r?.result == null || r?.result === undefined);
                if (emptyIdx >= 0) {
                    existing[emptyIdx] = { ...(existing[emptyIdx] || {}), result: pair.value, active: true, discarded: false };
                } else {
                    existing.push({ result: pair.value, active: true, discarded: false });
                }
                term.results = existing;
                term._evaluated = existing.filter(r => r?.result != null).length >= n;
                injected = true;
                placed = true;
                break;
            }
            if (!placed && debug) console.log("RollSight Real Dice Reader | [debug] inject: no matching term for", wantD, "pair value", pair.value);
        }
        for (const term of roll.terms) {
            if (!isDiceTerm(term)) continue;
            const n = Math.max(1, term.number ?? 1);
            const filled = (term.results ?? []).filter(r => r?.result != null && r?.result !== undefined).length;
            if (filled < n) allComplete = false;
        }
        if (!injected) {
            const termInfo = roll.terms?.map(t => ({ denom: this._termDenom(t), faces: t?.faces, number: t?.number })) ?? [];
            console.log("RollSight Real Dice Reader | Injection failed: no term matched pairs. Roll terms:", termInfo, "pairs:", pairs.map(p => p.denomination + "=" + p.value));
            if (debug) console.log("RollSight Real Dice Reader | [debug] inject: no new pairs to merge (roll.terms:", roll.terms?.length, "pairs:", pairs.length, ")");
            return { injected: false, complete: false };
        }
        // Wait until every die slot is filled (e.g. 2d20 advantage needs two physical rolls). Running kh/kl or _evaluateTotal
        // with only one result yields Roll.safeEval errors and corrupts the roll.
        if (!allComplete) {
            roll._evaluated = false;
            if (debug) console.log("RollSight Real Dice Reader | [debug] inject: partial fill — skipping modifiers/total until all dice are in");
            return { injected: true, complete: false };
        }
        // Apply term modifiers (kh, kl, etc.) so keep-highest/lowest are applied; otherwise we'd sum all results.
        for (const term of roll.terms) {
            if (!isDiceTerm(term)) continue;
            const mods = term.modifiers;
            if (Array.isArray(mods) && mods.length > 0 && typeof term._evaluateModifiers === "function") {
                try {
                    await term._evaluateModifiers();
                } catch (e) {
                    if (debug) console.log("RollSight Real Dice Reader | [debug] _evaluateModifiers threw:", e);
                }
            }
        }
        roll._evaluated = true;
        // Use Foundry's _evaluateTotal() so operators (e.g. minus for 1d20 - 1) are applied correctly; fallback to operator-aware sum.
        let total = NaN;
        if (typeof roll._evaluateTotal === "function") {
            try {
                total = roll._evaluateTotal();
            } catch (e) {
                if (debug) console.log("RollSight Real Dice Reader | [debug] _evaluateTotal threw:", e);
            }
        }
        if (typeof total !== "number" || Number.isNaN(total)) {
            total = this._sumRollTermsWithOperators(roll);
        }
        if (typeof total === "number" && !Number.isNaN(total)) {
            roll._total = total;
        }
        return { injected: true, complete: true };
    }

    /**
     * Sum roll terms respecting OperatorTerms (e.g. minus) so 1d20 - 1 gives die - 1, not die + 1.
     */
    _sumRollTermsWithOperators(roll) {
        if (!roll?.terms?.length) return NaN;
        const terms = roll.terms;
        let sum = 0;
        let sign = 1;
        for (let i = 0; i < terms.length; i++) {
            const term = terms[i];
            const op = term?.operator;
            if (op === "-" || op === "+") {
                sign = op === "-" ? -1 : 1;
                continue;
            }
            let t = term?.total;
            if (t === undefined || t === null) {
                if (term?.results?.length) {
                    const results = term.results ?? [];
                    t = results.reduce((a, r) => a + (r?.discarded !== true && r?.active !== false ? (Number(r?.result) || 0) : 0), 0);
                } else if (term?.number != null) {
                    t = Number(term.number);
                }
            }
            if (typeof t === "number" && !Number.isNaN(t)) {
                sum += sign * t;
                sign = 1;
            }
        }
        return sum;
    }

    /**
     * Inject RollSight results and submit when complete (one-shot; use _injectRollIntoResolver for partial + _updatePendingDialogSlots for UI).
     */
    async _injectRollIntoResolverAndSubmit(resolver, pairs) {
        const result = await this._injectRollIntoResolver(resolver, pairs);
        if (!result.injected || !result.complete) return false;
        if (typeof resolver.submit === "function") {
            resolver.submit();
            return true;
        }
        return false;
    }

    /**
     * If a duplicate resolver was stored (same formula rendered while we were feeding the first), inject the same roll and close it.
     * Call after closing the main resolver and setting _lastConsumedRollJson.
     */
    async _closeDuplicateResolverIfAny() {
        const dup = this._duplicateResolver;
        if (!dup?.resolver || !this._lastConsumedRollJson) return;
        const pairs = this._pairsFromRollJson(this._lastConsumedRollJson);
        if (pairs.length === 0) {
            this._duplicateResolver = null;
            return;
        }
        try {
            await this._injectRollIntoResolver(dup.resolver, pairs);
            if (typeof dup.resolver.close === "function") await dup.resolver.close();
        } catch (e) {
            const game = (typeof foundry !== "undefined" && foundry.game) ? foundry.game : globalThis.game;
            if (game?.settings?.get("rollsight-integration", "debugLogging")) {
                console.warn("RollSight Real Dice Reader | [debug] Error closing duplicate resolver:", e);
            }
        } finally {
            this._duplicateResolver = null;
        }
        const game = (typeof foundry !== "undefined" && foundry.game) ? foundry.game : globalThis.game;
        if (game?.settings?.get("rollsight-integration", "debugLogging")) {
            console.log("RollSight Real Dice Reader | [debug] Closed duplicate resolver for", dup.formulaNorm);
        }
    }

    /**
     * Get Foundry's native Dialog class (v11: foundry.Dialog; v12/v13: may be foundry.appv1.api.Dialog).
     * @returns {typeof Dialog | null}
     */
    _getFoundryDialogClass() {
        if (typeof foundry !== "undefined") {
            if (foundry.appv1?.api?.Dialog) return foundry.appv1.api.Dialog;
            if (foundry.applications?.api?.Dialog) return foundry.applications.api.Dialog;
            if (foundry.Dialog) return foundry.Dialog;
        }
        return globalThis.Dialog ?? null;
    }

    /**
     * Replace the manual dice dialog content with a RollSight prompt so the user sees one consistent experience.
     * Hides the default manual entry form and shows "Roll in RollSight" message.
     */
    _replaceResolverWithRollSightPrompt(resolver, element, formula) {
        const root = element?.nodeType === 1 ? element : resolver?.element;
        if (!root?.querySelector) return;
        const form = root.querySelector("form") ?? root.querySelector("[data-part='form']") ?? root.querySelector(".window-content");
        if (!form) return;
        const existing = root.querySelector(".rollsight-replace-prompt");
        if (existing) return;
        const wrap = document.createElement("div");
        wrap.className = "rollsight-replace-prompt";
        wrap.style.cssText = "padding: 1em; text-align: center;";
        const slotsHtml = this._buildRollSlotHtml(resolver);
        wrap.innerHTML = `<p><i class="fas fa-dice-d20" style="font-size: 2em; margin-bottom: 0.5em;"></i></p><p><strong>Roll in RollSight</strong></p><p>Roll your dice in the RollSight app. The result will appear here when received.</p>${slotsHtml || ""}<p class="notes">Formula: ${(formula || "").replace(/</g, "&lt;")}</p>`;
        form.style.display = "none";
        form.setAttribute("data-rollsight-hidden", "true");
        form.parentNode.insertBefore(wrap, form);
    }

    /**
     * Inject a "Complete with Digital Rolls" button into the RollResolver dialog when there are unfulfilled terms.
     * Lets the user fill any remaining dice with Foundry's digital RNG instead of rolling more in RollSight.
     */
    _injectCompleteWithDigitalButton(resolver, element) {
        const root = element?.nodeType === 1 ? element : resolver?.element;
        if (!root || !root.querySelector) return;
        const fulfillable = resolver?.fulfillable;
        if (!fulfillable || !(fulfillable instanceof Map) || fulfillable.size === 0) return;

        const existing = root.querySelector(".rollsight-complete-digital-wrap");
        if (existing) existing.remove();

        const wrap = document.createElement("div");
        wrap.className = "rollsight-complete-digital-wrap form-group";
        wrap.style.marginTop = "0.75em";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "rollsight-complete-digital";
        btn.innerHTML = "<i class=\"fas fa-dice\"></i> Complete with Digital Rolls";
        btn.title = "Fill remaining dice with Foundry's digital rolls (for any RollSight hasn't already filled).";
        btn.addEventListener("click", async () => {
            btn.disabled = true;
            btn.textContent = "Filling…";
            await this._completeResolverWithDigitalRolls(resolver);
        });

        wrap.appendChild(btn);
        const rollsightPrompt = root.querySelector(".rollsight-replace-prompt");
        const form = root.querySelector("form") ?? root.querySelector("[data-part='form']") ?? root.querySelector(".window-content");
        if (rollsightPrompt) {
            rollsightPrompt.appendChild(wrap);
        } else if (form) {
            form.appendChild(wrap);
        } else {
            root.appendChild(wrap);
        }
    }

    /**
     * Fill all remaining fulfillable terms in the resolver with digital rolls, then submit.
     * Uses CONFIG.Dice.fulfillment.defaultMethod and CONFIG.Dice.randomUniform when available.
     * When the resolver was never rendered (chat flow), we mutate the roll directly and do not call submit() (avoids Foundry's form/DOM expectations).
     * Applies term modifiers (kh, kl) so keep-highest/lowest are correct.
     */
    async _completeResolverWithDigitalRolls(resolver) {
        const notRendered = this._pendingChatResolver?.resolverNotRendered === true;
        let roll = resolver?.roll;
        if (!roll?.terms?.length && this._pendingChatResolver?.roll?.terms?.length) {
            roll = this._pendingChatResolver.roll;
        }
        const CONFIG = (typeof foundry !== "undefined" && foundry.CONFIG) ? foundry.CONFIG : globalThis.CONFIG;
        const random = typeof CONFIG?.Dice?.randomUniform === "function" ? CONFIG.Dice.randomUniform : () => Math.random();
        const Die = (typeof foundry !== "undefined" && foundry.dice?.terms?.Die) ? foundry.dice.terms.Die : (typeof foundry !== "undefined" && foundry.dice?.terms?.die?.Die) ? foundry.dice.terms.die.Die : null;
        const isDiceTerm = (term) => {
            if (term?.faces == null) return false;
            if (Die && term instanceof Die) return true;
            return typeof term.denomination === "string" || typeof term.number === "number";
        };

        if (notRendered && roll?.terms?.length) {
            for (const term of roll.terms) {
                if (!isDiceTerm(term)) continue;
                const n = Math.max(1, term.number ?? 1);
                const existing = term.results ? [...term.results] : [];
                for (let i = existing.length; i < n; i++) {
                    const faces = Number(term.faces) || 6;
                    existing.push({ result: Math.floor(random() * faces) + 1, active: true, discarded: false });
                }
                if (existing.length) {
                    term.results = existing;
                    term._evaluated = existing.length >= n;
                }
            }
            // Apply modifiers (kh, kl, etc.) so total reflects keep-highest/lowest
            for (const term of roll.terms) {
                if (!isDiceTerm(term)) continue;
                const mods = term.modifiers;
                if (Array.isArray(mods) && mods.length > 0 && typeof term._evaluateModifiers === "function") {
                    try {
                        await term._evaluateModifiers();
                    } catch (_) {}
                }
            }
            let sum = 0;
            for (const term of roll.terms) {
                let t = term.total;
                if (t === undefined || t === null) {
                    const results = term.results ?? [];
                    t = results.reduce((a, r) => a + (r?.discarded !== true && r?.active !== false ? (Number(r?.result) || 0) : 0), 0);
                }
                if (typeof t === "number" && !Number.isNaN(t)) sum += t;
            }
            roll._total = sum;
            roll._evaluated = true;
            return;
        }

        const fulfillable = resolver?.fulfillable;
        if (!fulfillable || !(fulfillable instanceof Map) || fulfillable.size === 0) {
            if (typeof resolver.submit === "function") resolver.submit();
            return;
        }
        const defaultMethod = CONFIG?.Dice?.fulfillment?.defaultMethod ?? "default";
        const entries = Array.from(fulfillable.entries());
        for (const [, desc] of entries) {
            const term = desc?.term;
            if (!term || term.faces == null) continue;
            const denom = (term.denomination ?? `d${term.faces}`).toString();
            const faces = Number(term.faces) || 6;
            const count = Math.max(1, Number(term.number) ?? 1);
            for (let i = 0; i < count; i++) {
                const result = Math.floor(random() * faces) + 1;
                const consumed = resolver.registerResult(defaultMethod, denom, result);
                if (!consumed) break;
            }
        }
        if (typeof resolver.submit === "function") {
            resolver.submit();
        }
    }

    /**
     * Called when Foundry is ready
     */
    onReady() {
        console.log("RollSight Real Dice Reader | Ready");
        
        // Periodic cleanup of stale state so connection auto-recovers (e.g. after timeout or stuck resolver)
        const CLEANUP_INTERVAL_MS = 30000; // every 30s
        this._staleCleanupIntervalId = setInterval(() => this._runStaleStateCleanup(), CLEANUP_INTERVAL_MS);
        
        // Mark socket handler ready so module socket events are accepted (extension/bridge/cloud use other paths too).
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        if (game?.settings?.get("rollsight-integration", "playerActive") !== false) {
            this.connect();
        }
    }
    
    /**
     * Clear stale duplicate-suppression and pending-resolver state so rolls are accepted again.
     * Called periodically to auto-recover from timeouts or stuck dialogs.
     */
    _runStaleStateCleanup() {
        try {
            const now = Date.now();
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const debug = game?.settings?.get("rollsight-integration", "debugLogging");
            
            // Clear pending chat resolver if it's been open too long (user may have abandoned it)
            if (this._pendingChatResolver && this._pendingChatResolverCreatedAt > 0 && (now - this._pendingChatResolverCreatedAt) > this._PENDING_RESOLVER_STALE_MS) {
                if (debug) console.log("RollSight Real Dice Reader | [debug] Clearing stale pending chat resolver (older than 5 min)");
                const resolver = this._pendingChatResolver?.resolver;
                const roll = this._pendingChatResolver?.roll;
                if (roll) {
                    const RollClassRef = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
                    if (RollClassRef?.RESOLVERS instanceof Map) RollClassRef.RESOLVERS.delete(roll);
                }
                try {
                    if (typeof resolver?.close === "function") resolver.close();
                } catch (_) {}
                if (this._pendingChatResolver?.dialog?.close) this._pendingChatResolver.dialog.close();
                this._pendingChatResolver.resolveOutcome?.("cancelled");
                this._pendingChatResolver = null;
                this._pendingChatResolverCreatedAt = 0;
                this._handlingChatRollMessage = null;
            }
            
            // Clear sent-roll debounce so new rolls can go to chat again after 60s
            if (this._lastSentRollTime > 0 && (now - this._lastSentRollTime) > this._SENT_ROLL_STALE_MS) {
                if (debug) console.log("RollSight Real Dice Reader | [debug] Clearing stale last-sent-roll state (older than 60s)");
                this._lastSentRollFingerprint = null;
                this._lastSentRollTime = 0;
            }
            
            // Clear consumed-roll state so duplicate suppression doesn't block forever
            if (this._lastConsumedRollJson && this._lastPendingResolverCompletedAt > 0 && (now - this._lastPendingResolverCompletedAt) > this._JUST_COMPLETED_WINDOW_MS) {
                this._lastConsumedRollJson = null;
            }
            if (this._lastConsumedRollTime > 0 && (now - this._lastConsumedRollTime) > this._CONSUMED_STALE_MS) {
                if (debug) console.log("RollSight Real Dice Reader | [debug] Clearing stale consumed-roll state (older than 60s)");
                this._clearConsumedRollState();
            }
        } catch (err) {
            console.error("RollSight Real Dice Reader | Stale state cleanup error:", err);
        }
    }
    
    /**
     * Connect to RollSight
     */
    connect() {
        this.socketHandler.connect();
    }
    
    /**
     * Disconnect from RollSight
     */
    disconnect() {
        this.socketHandler.disconnect();
    }
    
    /**
     * Check if connected to RollSight
     */
    isConnected() {
        return this.connected;
    }

    /**
     * Base URL for RollSight desktop HTTP bridge (same /poll queue the browser extension uses).
     * RollSight binds the bridge to IPv4 127.0.0.1 only. On Windows, "localhost" often resolves to ::1 first,
     * so fetch() never reaches the server — normalize to 127.0.0.1 (same as browser_bridge.py).
     */
    _getDesktopBridgeBaseUrl() {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        let raw = (game?.settings?.get("rollsight-integration", "desktopBridgeUrl") ?? "http://127.0.0.1:8766").toString().trim();
        raw = raw.replace(/\/$/, "");
        try {
            const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
            let h = u.hostname;
            if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
            const hl = h.toLowerCase();
            if (hl === "localhost" || hl === "::1" || hl === "0:0:0:0:0:0:0:1") {
                u.hostname = "127.0.0.1";
                let out = u.toString();
                if (out.endsWith("/")) out = out.slice(0, -1);
                return out;
            }
        } catch (_) {
            /* keep raw */
        }
        return raw;
    }

    /**
     * Public API base for RollSight cloud rooms (override for development only).
     */
    _getCloudRoomApiBase() {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const raw = (game?.settings?.get("rollsight-integration", "cloudRoomApiBase") ?? "").toString().trim();
        if (raw) return raw.replace(/\/$/, "");
        return ROLLSIGHT_ROOM_API_DEFAULT;
    }

    /**
     * True if a table cloud code is set (8-char or legacy rs_…).
     */
    _hasTableCloudRoomKey() {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const ck = (game?.settings?.get("rollsight-integration", "cloudRoomKey") ?? "").toString().trim();
        return (
            this._isShortPublicCode(ck) ||
            (ck.startsWith("rs_") && ck.length >= 16 && !ck.startsWith("rs_u_"))
        );
    }

    /**
     * Ensure this Foundry user has a cloud player code when the table code exists (idempotent).
     */
    async _autoProvisionPlayerCodeOnly() {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        if (!game?.settings || !game.user) return;
        if (game.settings.get("rollsight-integration", "playerActive") === false) return;
        const pk = (game.settings.get("rollsight-integration", "cloudPlayerKey") ?? "").toString().trim();
        if (pk) return;
        if (!this._hasTableCloudRoomKey()) return;
        const roomKey = (game.settings.get("rollsight-integration", "cloudRoomKey") ?? "").toString().trim();
        try {
            const base = this._getCloudRoomApiBase();
            const body = { foundry_user_id: game.user.id };
            if (this._isShortPublicCode(roomKey)) {
                body.room_code = this._normalizeShortPublicCode(roomKey);
            } else {
                body.room_key = roomKey;
            }
            const res = await fetch(`${base}/rollsight-room/player-key`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                if (game.settings.get("rollsight-integration", "debugLogging")) {
                    console.warn("RollSight Real Dice Reader | Auto player code request failed:", res.status);
                }
                return;
            }
            const data = await res.json();
            const code = data.player_code || data.player_key;
            if (!code) return;
            await game.settings.set("rollsight-integration", "cloudPlayerKey", code);
            if (game.settings.get("rollsight-integration", "debugLogging")) {
                console.log("RollSight Real Dice Reader | Auto-assigned cloud player code for", game.user.name);
            }
        } catch (e) {
            console.warn("RollSight Real Dice Reader | Auto player code:", e);
        }
    }

    /**
     * GM: create cloud table room once if missing. All users: assign player code when table code exists.
     */
    async _autoProvisionRollSightCloudRelay() {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
        if (!game?.settings || !game.user) return;

        let createdTable = false;
        if (game.user.isGM && !this._hasTableCloudRoomKey()) {
            try {
                const base = this._getCloudRoomApiBase();
                const res = await fetch(`${base}/rollsight-room/create`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                });
                if (res.ok) {
                    const data = await res.json();
                    const room_code = data.room_code || data.room_key;
                    if (room_code) {
                        await game.settings.set("rollsight-integration", "cloudRoomKey", room_code);
                        createdTable = true;
                        if (game.settings.get("rollsight-integration", "debugLogging")) {
                            console.log("RollSight Real Dice Reader | Auto-created cloud table code");
                        }
                    }
                } else if (game.settings.get("rollsight-integration", "debugLogging")) {
                    console.warn("RollSight Real Dice Reader | Auto table room failed:", res.status);
                }
            } catch (e) {
                console.warn("RollSight Real Dice Reader | Auto table room:", e);
            }
            if (!createdTable && game.user.isGM && !this._hasTableCloudRoomKey()) {
                ui?.notifications?.warn(
                    "RollSight could not create a cloud table automatically (network or server). You can create one in module settings.",
                    { permanent: false }
                );
            }
        }

        if (createdTable) {
            ui?.notifications?.info(
                "RollSight: table code saved for this world — player codes are assigned per browser.",
                { permanent: false }
            );
        }

        if (game.settings.get("rollsight-integration", "playerActive") !== false) {
            await this._autoProvisionPlayerCodeOnly();
        }
    }

    _normalizeShortPublicCode(s) {
        return String(s).trim().toUpperCase();
    }

    _isShortPublicCode(s) {
        return ROLLSIGHT_SHORT_CODE_RE.test(this._normalizeShortPublicCode(s));
    }

    /**
     * Bearer for cloud polling: 8-char player/table code, legacy rs_u_ player token, or rs_ table key.
     */
    _getCloudPollBearerKey() {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        if (!game?.settings) return "";
        const pk = (game.settings.get("rollsight-integration", "cloudPlayerKey") ?? "").toString().trim();
        if (this._isShortPublicCode(pk)) return this._normalizeShortPublicCode(pk);
        if (pk.startsWith("rs_u_") && pk.length >= 24) return pk;
        const ck = (game.settings.get("rollsight-integration", "cloudRoomKey") ?? "").toString().trim();
        if (this._isShortPublicCode(ck)) return this._normalizeShortPublicCode(ck);
        if (ck.startsWith("rs_") && ck.length >= 16 && !ck.startsWith("rs_u_")) return ck;
        return "";
    }

    _stopCloudRoomPoll() {
        if (this._cloudPollTimeoutId != null) {
            clearTimeout(this._cloudPollTimeoutId);
            this._cloudPollTimeoutId = null;
        }
    }

    _logCloudRoomUnreachableThrottled(base) {
        const now = Date.now();
        if (now - this._cloudLastUnreachableLog < 20000) return;
        this._cloudLastUnreachableLog = now;
        console.warn(
            "RollSight Real Dice Reader | Cloud room unreachable at " + base + ". " +
            "Check your network, or confirm the room key in module settings matches RollSight."
        );
    }

    _restartCloudRoomPoll() {
        this._stopCloudRoomPoll();
        this._startCloudRoomPollIfEnabled();
    }

    _startCloudRoomPollIfEnabled() {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        this._stopCloudRoomPoll();
        if (!game?.settings) return;
        if (game.settings.get("rollsight-integration", "playerActive") === false) return;
        if (game.settings.get("rollsight-integration", "desktopBridgePoll")) return;
        const ck = this._getCloudPollBearerKey();
        if (!ck) return;
        const base = this._getCloudRoomApiBase();
        const fastMs = 500;
        const slowMs = 4000;
        const self = this;
        const schedule = (delay) => {
            if (self._cloudPollTimeoutId != null) clearTimeout(self._cloudPollTimeoutId);
            self._cloudPollTimeoutId = setTimeout(run, delay);
        };
        const run = async () => {
            self._cloudPollTimeoutId = null;
            if (!self._getCloudPollBearerKey()) return;
            if (game.settings.get("rollsight-integration", "playerActive") === false) return;
            if (game.settings.get("rollsight-integration", "desktopBridgePoll")) return;
            if (self._cloudPollInFlight) {
                schedule(fastMs);
                return;
            }
            self._cloudPollInFlight = true;
            let ok = false;
            try {
                ok = await self._pollCloudRoomOnce();
            } finally {
                self._cloudPollInFlight = false;
            }
            if (!ok && !self._cloudPollLastWasUnknownRoom) self._logCloudRoomUnreachableThrottled(base);
            schedule(ok ? fastMs : slowMs);
        };
        if (game.settings.get("rollsight-integration", "debugLogging")) {
            console.log("RollSight Real Dice Reader | Cloud room polling enabled:", `${base}/rollsight-room/events`);
        }
        run();
    }

    /**
     * Poll cloud room for queued envelopes (same shapes as the desktop HTTP bridge).
     * @returns {Promise<boolean>} true if HTTP OK
     */
    async _pollCloudRoomOnce() {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        this._cloudPollLastWasUnknownRoom = false;
        if (!game?.settings) return false;
        const ck = this._getCloudPollBearerKey();
        if (!ck) return false;
        const base = this._getCloudRoomApiBase();
        const seq = this._cloudPollSinceSeq || 0;
        const url = `${base}/rollsight-room/events?since_seq=${encodeURIComponent(String(seq))}`;
        let res;
        const debug = game.settings.get("rollsight-integration", "debugLogging");
        try {
            res = await fetch(url, {
                method: "GET",
                headers: { Authorization: `Bearer ${ck}` },
                cache: "no-store",
                credentials: "omit",
            });
        } catch (e) {
            if (debug) console.warn("RollSight Real Dice Reader | Cloud room poll fetch error:", e);
            return false;
        }
        if (!res.ok) {
            if (debug) {
                let errBody = "";
                try {
                    errBody = await res.clone().text();
                } catch (_e) {
                    errBody = "(could not read body)";
                }
                console.warn(
                    "RollSight Real Dice Reader | Cloud room poll HTTP",
                    res.status,
                    url.slice(0, 120),
                    errBody.slice(0, 400)
                );
            }
            if (res.status === 404) {
                this._cloudPollLastWasUnknownRoom = true;
                const now = Date.now();
                if (now - (this._cloudUnknownRoomLastLog || 0) > 25000) {
                    this._cloudUnknownRoomLastLog = now;
                    try {
                        const err = await res.clone().json();
                        if (err?.error === "unknown_room") {
                            console.warn(
                                "RollSight Real Dice Reader | Cloud room key is not registered on the server. " +
                                    "In module settings use “Create RollSight room”, then paste that exact key into the RollSight app (same world / same API)."
                            );
                        } else {
                            console.warn("RollSight Real Dice Reader | Cloud room poll returned 404 — check room key and Cloud room API base.");
                        }
                    } catch (_e) {
                        console.warn("RollSight Real Dice Reader | Cloud room poll returned 404 — check room key and Cloud room API base.");
                    }
                }
            }
            return false;
        }
        let data;
        try {
            data = await res.json();
        } catch (e) {
            if (debug) console.warn("RollSight Real Dice Reader | Cloud poll JSON parse failed:", e);
            return false;
        }
        const events = Array.isArray(data.events) ? data.events : [];
        if (events.length === 0) {
            if (debug) {
                const now = Date.now();
                if (now >= (this._cloudPollDebugEmptyNextLog || 0)) {
                    this._cloudPollDebugEmptyNextLog = now + 4000;
                    console.log(
                        "RollSight Real Dice Reader | Cloud poll OK (0 events)",
                        { since_seq: seq, api_since_seq: data.since_seq, url: url.slice(0, 100) }
                    );
                }
            }
            return true;
        }
        let maxSeq = seq;
        for (const ev of events) {
            const p = ev?.payload;
            const s = ev?.seq;
            if (typeof s === "number" && s > maxSeq) maxSeq = s;
            if (!p || typeof p !== "object") continue;
            try {
                if (p.type === "chat_text" && p.content) {
                    await this.postChatTextFromBridge(p.content);
                } else if (p.type === "amendment" || p.amendment) {
                    const am = p.amendment ?? p;
                    await this.handleAmendment(am);
                } else if (p.type === "roll" || p.roll) {
                    const rollInner = p.roll ?? p;
                    const ts = p.timestamp;
                    let enriched =
                        typeof ts === "number"
                            ? { ...rollInner, _rollsightBridgeTs: ts }
                            : { ...rollInner };
                    if (p._rollsightRoom && typeof p._rollsightRoom === "object") {
                        enriched = { ...enriched, _rollsightRoom: p._rollsightRoom };
                    }
                    if (debug) {
                        console.log(
                            "RollSight Real Dice Reader | Cloud room delivering roll envelope",
                            { seq: s, formula: rollInner?.formula, total: rollInner?.total }
                        );
                    }
                    await this.handleRoll(enriched);
                }
            } catch (err) {
                if (debug) console.warn("RollSight Real Dice Reader | Cloud room poll handler error:", err);
            }
        }
        if (typeof data.since_seq === "number" && data.since_seq >= this._cloudPollSinceSeq) {
            this._cloudPollSinceSeq = data.since_seq;
        } else if (maxSeq >= this._cloudPollSinceSeq) {
            this._cloudPollSinceSeq = maxSeq;
        }
        return true;
    }

    _stopDesktopBridgePoll() {
        if (this._bridgePollIntervalId != null) {
            clearInterval(this._bridgePollIntervalId);
            this._bridgePollIntervalId = null;
        }
        if (this._bridgePollTimeoutId != null) {
            clearTimeout(this._bridgePollTimeoutId);
            this._bridgePollTimeoutId = null;
        }
    }

    /**
     * When the bridge returns ERR_CONNECTION_REFUSED, nothing is listening — usually RollSight is closed
     * or the bridge failed to bind (e.g. port in use). Log at most once per 20s.
     */
    _logDesktopBridgeUnreachableThrottled(base) {
        const now = Date.now();
        if (now - this._bridgeLastUnreachableLog < 20000) return;
        this._bridgeLastUnreachableLog = now;
        console.warn(
            "RollSight Real Dice Reader | Desktop bridge unreachable at " + base + " (e.g. net::ERR_CONNECTION_REFUSED). " +
            "No process is accepting connections on that port. Start the RollSight app and keep the main window open, " +
            "or fix the port in RollSight (Foundry / VTT → Bridge port) and in this module’s Desktop bridge base URL. " +
            "If RollSight says the bridge is running but this persists, another app may be blocking the port or RollSight failed to start the server (check RollSight console / logs)."
        );
    }

    _restartDesktopBridgePoll() {
        this._stopDesktopBridgePoll();
        this._startDesktopBridgePollIfEnabled();
    }

    _startDesktopBridgePollIfEnabled() {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        this._stopDesktopBridgePoll();
        if (!game?.settings) return;
        if (game.settings.get("rollsight-integration", "playerActive") === false) return;
        if (!game.settings.get("rollsight-integration", "desktopBridgePoll")) return;
        // Desktop bridge polling is explicit: when ON, poll the local HTTP bridge even if a cloud room key
        // is still saved in world settings (e.g. switching from cloud back to local RollSight session).
        // Cloud polling is skipped when desktopBridgePoll is on — see _startCloudRoomPollIfEnabled.
        const base = this._getDesktopBridgeBaseUrl();
        if (!base) return;
        const fastMs = 500;
        const slowMs = 4000;
        const self = this;
        const schedule = (delay) => {
            if (self._bridgePollTimeoutId != null) clearTimeout(self._bridgePollTimeoutId);
            self._bridgePollTimeoutId = setTimeout(run, delay);
        };
        const run = async () => {
            self._bridgePollTimeoutId = null;
            if (!game?.settings?.get("rollsight-integration", "desktopBridgePoll")) return;
            if (game.settings.get("rollsight-integration", "playerActive") === false) return;
            if (self._bridgePollInFlight) {
                schedule(fastMs);
                return;
            }
            self._bridgePollInFlight = true;
            let ok = false;
            try {
                ok = await self._pollDesktopBridgeOnce();
            } finally {
                self._bridgePollInFlight = false;
            }
            if (!ok) self._logDesktopBridgeUnreachableThrottled(base);
            schedule(ok ? fastMs : slowMs);
        };
        if (game.settings.get("rollsight-integration", "debugLogging")) {
            console.log("RollSight Real Dice Reader | Desktop bridge polling enabled:", `${base}/poll`);
        }
        run();
    }

    /**
     * Poll bridge for queued rolls. @returns {Promise<boolean>} true if HTTP reachability OK (200 + JSON), else false.
     */
    async _pollDesktopBridgeOnce() {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        if (!game?.settings?.get("rollsight-integration", "desktopBridgePoll")) return false;
        if (game.settings.get("rollsight-integration", "playerActive") === false) return false;
        const base = this._getDesktopBridgeBaseUrl();
        if (!base) return false;
        const url = `${base}/poll?since=${this._bridgePollSince}`;
        let res;
        try {
            res = await fetch(url, { method: "GET", cache: "no-store", credentials: "omit" });
        } catch (_e) {
            return false;
        }
        if (!res.ok) return false;
        let data;
        try {
            data = await res.json();
        } catch (_e) {
            return false;
        }
        const rolls = Array.isArray(data.rolls) ? data.rolls : (data.roll ? [data.roll] : []);
        if (rolls.length === 0) return true;
        let maxTs = this._bridgePollSince;
        const debug = game.settings.get("rollsight-integration", "debugLogging");
        for (const item of rolls) {
            const ts = item?.timestamp;
            if (typeof ts === "number" && ts > maxTs) maxTs = ts;
            try {
                if (item.type === "chat_text" && item.content) {
                    await this.postChatTextFromBridge(item.content);
                } else if (item.type === "amendment" || item.amendment) {
                    const am = item.amendment ?? item;
                    await this.handleAmendment(am);
                } else if (item.type === "roll" || item.roll) {
                    const rollInner = item.roll ?? item;
                    const enriched =
                        typeof ts === "number"
                            ? { ...rollInner, _rollsightBridgeTs: ts }
                            : rollInner;
                    await this.handleRoll(enriched);
                }
            } catch (err) {
                if (debug) console.warn("RollSight Real Dice Reader | Desktop bridge poll handler error:", err);
            }
        }
        if (maxTs >= this._bridgePollSince) {
            this._bridgePollSince = maxTs;
        }
        return true;
    }
    
    /**
     * Fingerprint for duplicate detection: formula + total (and dice values if multi-die) so we can ignore a roll that was just consumed for a pending resolver.
     * @param {object} rollData - RollSight roll payload
     * @returns {string}
     */
    _rollFingerprint(rollData) {
        let formula = (rollData?.formula ?? "").toString().trim().toLowerCase().replace(/\s/g, "");
        // Normalize single-die formulas so "d6" and "1d6" match (bridge may send either)
        const singleDieMatch = formula.match(/^d(\d+)(p)?$/);
        if (singleDieMatch) formula = `1d${singleDieMatch[1]}${singleDieMatch[2] || ""}`;
        const total = rollData?.total;
        const dice = rollData?.dice;
        let base;
        if (Array.isArray(dice) && dice.length > 0) {
            const values = dice.map(d => d?.value ?? d?.results?.[0]).filter(v => v != null);
            values.sort((a, b) => Number(a) - Number(b));
            base = `${formula}|${total}|${values.join(",")}`;
        } else {
            base = `${formula}|${total}`;
        }
        const rid = rollData?.roll_id;
        if (rid != null && String(rid).length > 0) return `${base}|id:${rid}`;
        const proof = rollData?.roll_proof_url;
        if (proof != null && String(proof).length > 0) return `${base}|proof:${proof}`;
        const bts = rollData?._rollsightBridgeTs;
        if (typeof bts === "number") return `${base}|bts:${bts}`;
        return base;
    }

    /**
     * Handle incoming roll from RollSight.
     * If a RollResolver is active (e.g. attack/spell roll), fulfill it in-context;
     * otherwise fall back to chat.
     */
    async handleRoll(rollData) {
        console.log("RollSight Real Dice Reader | Received roll:", rollData);
        this._lastRollProofRollData = rollData?.roll_proof_url ? rollData : null;

        try {
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const debug = game?.settings?.get("rollsight-integration", "debugLogging");
            const ru = rollData?._rollsightRoom?.recipient_user_id;
            if (ru && game?.user?.id && ru !== game.user.id) {
                if (debug) {
                    console.log("RollSight Real Dice Reader | [debug] Skipping roll (cloud recipient does not match this user)");
                }
                return null;
            }
            const fallbackToChat = game?.settings?.get("rollsight-integration", "fallbackToChat") !== false;
            const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;

            // If pending resolver exists but its roll is already complete (e.g. completed elsewhere or stale), clear it so this roll can go to chat.
            if (this._pendingChatResolver && this._isResolverComplete(this._pendingChatResolver.resolver)) {
                if (debug) console.log("RollSight Real Dice Reader | [debug] Pending resolver already complete; clearing so roll can fall through to chat");
                const roll = this._pendingChatResolver.roll;
                this._pendingChatResolver.resolveOutcome?.("fulfilled");
                this._pendingChatResolver = null;
                this._handlingChatRollMessage = null;
                if (roll) {
                    const RollClassRef = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
                    if (RollClassRef?.RESOLVERS instanceof Map) RollClassRef.RESOLVERS.delete(roll);
                }
            }

            // When we opened RollResolver from chat /roll, feed RollSight roll into it (so it fulfills the waiting dialog).
            // Prefer direct injection first so we don't depend on Foundry's fulfillable map (which can be empty in v13 when resolver is opened from chat).
            if (this._pendingChatResolver) {
                let pairs = rollDataToFulfillmentPairs(rollData);
                // Fallback: if bridge sent total but no dice array (e.g. single die), infer one pair from resolver's first needed denomination
                if (pairs.length === 0 && rollData?.total != null && this._pendingChatResolver.roll?.terms?.length) {
                    const firstDenoms = this._getDenominationsFromRoll(this._pendingChatResolver.roll);
                    if (firstDenoms.length > 0) {
                        pairs = [{ denomination: firstDenoms[0], value: Number(rollData.total) }];
                        if (debug) console.log("RollSight Real Dice Reader | [debug] Inferred 1 pair from total for", firstDenoms[0], ":", rollData.total);
                    }
                }
                console.log("RollSight Real Dice Reader | Pending resolver for", this._pendingChatResolver.formula, "— feeding", pairs.length, "dice value(s)");
                if (debug) console.log("RollSight Real Dice Reader | [debug] Pending chat resolver present, feeding", pairs.length, "pairs for", this._pendingChatResolver.formula);
                if (pairs.length > 0) {
                    const rollFp = this._rollFingerprint(rollData);
                    if (this._pendingChatResolver.consumedFingerprints?.has(rollFp)) {
                        if (debug) console.log("RollSight Real Dice Reader | [debug] Ignoring duplicate roll for this resolver (already used):", rollFp);
                        return null;
                    }
                    const isRendered = !this._pendingChatResolver.resolverNotRendered;
                    // For rendered resolvers (skill check, attack, save), try registerResult first so Foundry updates state and form; then submit() works.
                    if (isRendered) {
                        const fulfillableBefore = this._pendingChatResolver.resolver?.fulfillable;
                        const sizeBefore = fulfillableBefore instanceof Map ? fulfillableBefore.size : 0;
                        if (debug) console.log("RollSight Real Dice Reader | [debug] Trying registerResult first (rendered resolver); fulfillable.size:", sizeBefore);
                        let anyConsumed = false;
                        const methodsToTry = ["manual"];
                        for (const { denomination, value } of pairs) {
                            let ok = false;
                            for (const method of methodsToTry) {
                                try {
                                    ok = this._pendingChatResolver.resolver.registerResult(method, denomination, value);
                                    if (ok) {
                                        if (debug) console.log("RollSight Real Dice Reader | [debug] registerResult(" + method + ",", denomination + ",", value + "):", ok);
                                        break;
                                    }
                                } catch (e) {
                                    if (debug) console.log("RollSight Real Dice Reader | [debug] registerResult(" + method + ") threw:", e);
                                }
                            }
                            if (ok) anyConsumed = true;
                        }
                        if (anyConsumed) {
                            this._pendingChatResolver.consumedFingerprints?.add(rollFp);
                            this._updatePendingDialogSlots(this._pendingChatResolver.resolver);
                            const fulfillable = this._pendingChatResolver.resolver?.fulfillable;
                            const remaining = fulfillable instanceof Map ? fulfillable.size : 0;
                            const resolverComplete = this._isResolverComplete(this._pendingChatResolver.resolver);
                            // When user has Manual dice config, registerResult can return true but fulfillable may not update (Foundry quirk).
                            // If we fed at least as many values as the formula needs, submit so the dialog closes and the roll completes.
                            const neededCount = this._getDenominationsFromRoll(this._pendingChatResolver.roll).length;
                            const fedEnough = pairs.length >= neededCount;
                            const shouldSubmit = resolverComplete || remaining === 0 || (fedEnough && anyConsumed);
                            console.log("RollSight Real Dice Reader | [debug] shouldSubmit:", shouldSubmit, "neededCount:", neededCount, "fedEnough:", fedEnough, "remaining:", remaining);
                            if (shouldSubmit) {
                                try {
                                    if (rollData.roll_proof_url) {
                                        // Must queue before resolver close/submit, because chat message creation can happen
                                        // during close and preCreateChatMessage needs payload ready ahead of time.
                                        this._queueRollProofForNextChatMessage(rollData);
                                        this._lastRollProofRollData = null;
                                    }
                                    await this._injectRollIntoResolver(this._pendingChatResolver.resolver, pairs);
                                    const roll = this._pendingChatResolver.resolver?.roll ?? this._pendingChatResolver.roll;
                                    const formula = this._pendingChatResolver.formula ?? "";
                                    if (roll?.toJSON) {
                                        const rollJson = JSON.parse(JSON.stringify(roll.toJSON()));
                                        this._registerChatRollCorrection(rollJson, formula);
                                        this._lastConsumedRollJson = rollJson;
                                    }
                                    this._lastConsumedRollFingerprint = rollFp;
                                    this._lastConsumedRollTime = Date.now();
                                    this._lastPendingResolverCompletedAt = Date.now();
                                    this._lastPendingResolverFormula = this._pendingChatResolver.formula;
                                    this._lastConsumedRollFormula = (rollData?.formula ?? "").toString().trim().toLowerCase().replace(/\s/g, "");
                                    this._lastConsumedRollTotal = rollData?.total != null ? Number(rollData.total) : null;
                                    if (typeof this._pendingChatResolver.resolver.close === "function") {
                                        await this._pendingChatResolver.resolver.close();
                                    }
                                    await this._closeDuplicateResolverIfAny();
                                    this._pendingChatResolver.resolveOutcome?.("fulfilled");
                                } catch (e) {
                                    console.warn("RollSight Real Dice Reader | close error:", e);
                                }
                            } else if (remaining > 0 && ui?.notifications) {
                                const msg = this._formatRemainingDicePrompt(fulfillable, this._pendingChatResolver.formula);
                                ui.notifications.info(msg);
                            }
                            this._lastConsumedRollFormula = (rollData?.formula ?? "").toString().trim().toLowerCase().replace(/\s/g, "");
                            this._lastConsumedRollTotal = rollData?.total != null ? Number(rollData.total) : null;
                            console.log("RollSight Real Dice Reader | Fed roll into pending RollResolver for", this._pendingChatResolver.formula);
                            return null;
                        }
                    }
                    // Injection path: when resolver is not rendered (e.g. chat) or registerResult didn't consume (fulfillable empty). Set completion state before close() so duplicate resolver guard can fire.
                    const { injected, complete } = await this._injectRollIntoResolver(this._pendingChatResolver.resolver, pairs);
                    if (injected) {
                        this._pendingChatResolver.consumedFingerprints?.add(rollFp);
                        this._updatePendingDialogSlots(this._pendingChatResolver.resolver);
                        if (complete) {
                            if (rollData.roll_proof_url) {
                                this._queueRollProofForNextChatMessage(rollData);
                                this._lastRollProofRollData = null;
                            }
                            const roll = this._pendingChatResolver.resolver?.roll ?? this._pendingChatResolver.roll;
                            const formula = this._pendingChatResolver.formula ?? "";
                            if (roll?.toJSON) {
                                const rollJson = JSON.parse(JSON.stringify(roll.toJSON()));
                                this._registerChatRollCorrection(rollJson, formula);
                                this._lastConsumedRollJson = rollJson;
                            }
                            this._lastConsumedRollFingerprint = rollFp;
                            this._lastConsumedRollTime = Date.now();
                            this._lastPendingResolverCompletedAt = Date.now();
                            this._lastPendingResolverFormula = this._pendingChatResolver.formula;
                            this._lastConsumedRollFormula = (rollData?.formula ?? "").toString().trim().toLowerCase().replace(/\s/g, "");
                            this._lastConsumedRollTotal = rollData?.total != null ? Number(rollData.total) : null;
                            if (isRendered && typeof this._pendingChatResolver.resolver.close === "function") {
                                await this._pendingChatResolver.resolver.close();
                            }
                            await this._closeDuplicateResolverIfAny();
                            console.log("RollSight Real Dice Reader | Injected roll into pending RollResolver for", this._pendingChatResolver.formula);
                            this._pendingChatResolver.resolveOutcome?.("fulfilled");
                        }
                        return null;
                    }
                    // Resolver was already complete (e.g. late roll or duplicate): clear pending so this roll can go to chat instead of being dropped
                    const resolverAlreadyComplete = this._isResolverComplete(this._pendingChatResolver.resolver);
                    if (resolverAlreadyComplete) {
                        if (debug) console.log("RollSight Real Dice Reader | [debug] Resolver already complete; clearing pending so roll can fall through to chat");
                        const roll = this._pendingChatResolver.roll;
                        this._pendingChatResolver.resolveOutcome?.("fulfilled");
                        this._pendingChatResolver = null;
                        this._handlingChatRollMessage = null;
                        if (roll) {
                            const RollClassRef = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
                            if (RollClassRef?.RESOLVERS instanceof Map) RollClassRef.RESOLVERS.delete(roll);
                        }
                        // Fall through to tryFulfillActiveResolver / initiative / fallback to chat (don't return null and drop the roll)
                    }
                }
                // Fallback: registerResult when we didn't try it first (unrendered resolver) or injection didn't inject.
                const fulfillableBefore = this._pendingChatResolver.resolver?.fulfillable;
                const sizeBefore = fulfillableBefore instanceof Map ? fulfillableBefore.size : 0;
                if (debug) console.log("RollSight Real Dice Reader | [debug] Trying registerResult fallback; fulfillable.size:", sizeBefore);
                let anyConsumed = false;
                const methodsToTry = ["manual"];
                for (const { denomination, value } of pairs) {
                    let ok = false;
                    for (const method of methodsToTry) {
                        try {
                            ok = this._pendingChatResolver.resolver.registerResult(method, denomination, value);
                            if (ok) {
                                if (debug) console.log("RollSight Real Dice Reader | [debug] registerResult(" + method + ",", denomination + ",", value + "):", ok);
                                break;
                            }
                        } catch (e) {
                            if (debug) console.log("RollSight Real Dice Reader | [debug] registerResult(" + method + ") threw:", e);
                        }
                    }
                    if (ok) anyConsumed = true;
                }
                if (anyConsumed) {
                    this._updatePendingDialogSlots(this._pendingChatResolver.resolver);
                    const fulfillable = this._pendingChatResolver.resolver?.fulfillable;
                    const remaining = fulfillable instanceof Map ? fulfillable.size : 0;
                    const resolverComplete = this._isResolverComplete(this._pendingChatResolver.resolver);
                    const neededCount = this._getDenominationsFromRoll(this._pendingChatResolver.roll).length;
                    const fedEnough = pairs.length >= neededCount;
                    const shouldSubmit = resolverComplete || remaining === 0 || (fedEnough && anyConsumed);
                    if (shouldSubmit) {
                        try {
                            if (!this._pendingChatResolver.resolverNotRendered && rollData.roll_proof_url) {
                                this._queueRollProofForNextChatMessage(rollData);
                                this._lastRollProofRollData = null;
                            }
                            await this._injectRollIntoResolver(this._pendingChatResolver.resolver, pairs);
                            const roll = this._pendingChatResolver.resolver?.roll ?? this._pendingChatResolver.roll;
                            const formula = this._pendingChatResolver.formula ?? "";
                            if (roll?.toJSON) {
                                const rollJson = JSON.parse(JSON.stringify(roll.toJSON()));
                                this._registerChatRollCorrection(rollJson, formula);
                                this._lastConsumedRollJson = rollJson;
                            }
                            this._lastPendingResolverCompletedAt = Date.now();
                            this._lastPendingResolverFormula = this._pendingChatResolver.formula;
                            if (!this._pendingChatResolver.resolverNotRendered && typeof this._pendingChatResolver.resolver.close === "function") {
                                await this._pendingChatResolver.resolver.close();
                            }
                            await this._closeDuplicateResolverIfAny();
                            this._pendingChatResolver.resolveOutcome?.("fulfilled");
                        } catch (e) {
                            if (debug) console.warn("RollSight Real Dice Reader | close error (fallback path):", e);
                        }
                    } else if (remaining > 0 && ui?.notifications) {
                        const msg = this._formatRemainingDicePrompt(fulfillable, this._pendingChatResolver.formula);
                        ui.notifications.info(msg);
                    }
                    console.log("RollSight Real Dice Reader | Fed roll into pending RollResolver for", this._pendingChatResolver.formula);
                    return null;
                }
            }

            // Try to feed the active RollResolver (Foundry v12+; e.g. attack/spell roll opened by system).
            const consumed = tryFulfillActiveResolver(rollData);
            if (consumed) {
                console.log("RollSight Real Dice Reader | Roll fulfilled in-context (RollResolver)");
                if (this._pendingChatResolver) {
                    const fulfillable = this._pendingChatResolver.resolver?.fulfillable;
                    const remaining = fulfillable instanceof Map ? fulfillable.size : 0;
                    if (remaining > 0 && ui?.notifications) {
                        const msg = this._formatRemainingDicePrompt(fulfillable, this._pendingChatResolver.formula);
                        ui.notifications.info(msg);
                    }
                    if (debug) console.log("RollSight Real Dice Reader | [debug] Fed roll into pending RollResolver for", this._pendingChatResolver.formula, "remaining:", remaining);
                }
                const foundryRoll = this.createFoundryRoll(rollData);
                if (foundryRoll) this.diceHandler.animateDice(foundryRoll);
                if (rollData.roll_proof_url) {
                    this._queueRollProofForNextChatMessage(rollData);
                    this._lastRollProofRollData = null;
                }
                return foundryRoll;
            }

            // No active resolver: try to apply to pending initiative (e.g. combat started, player prompted to roll but RollResolver didn't open)
            const appliedToInitiative = await this.tryApplyToPendingInitiative(rollData);
            if (appliedToInitiative) {
                if (rollData.roll_proof_url) {
                    this._queueRollProofForNextChatMessage(rollData);
                    this._lastRollProofRollData = null;
                }
                return null;
            }

            // No active resolver and not initiative: fall back to chat if enabled.
            // Suppress only when the bridge sends the exact same roll we just sent (e.g. duplicate after rescan); different rolls (e.g. "roll me a d20") always go through.
            if (fallbackToChat) {
                const fingerprint = this._rollFingerprint(rollData);
                const now = Date.now();
                const isDuplicateOfLastSent = this._lastSentRollFingerprint != null
                    && fingerprint === this._lastSentRollFingerprint
                    && (now - this._lastSentRollTime) < this._SENT_ROLL_DEBOUNCE_MS;
                if (isDuplicateOfLastSent) {
                    if (debug) console.log("RollSight Real Dice Reader | [debug] Ignoring duplicate of last sent roll:", fingerprint);
                    return null;
                }
                this._lastSentRollFingerprint = fingerprint;
                this._lastSentRollTime = now;

                // Prefer direct message creation so we have a ChatMessage reference for amendments.
                try {
                    const foundryRoll = this.createFoundryRoll(rollData);
                    if (rollData.roll_id) {
                        this.rollHistory.set(rollData.roll_id, {
                            roll: foundryRoll,
                            rollData: rollData,
                            chatMessage: null
                        });
                    }
                    const chatMessage = await this.chatHandler.createRollMessage(foundryRoll, rollData);
                    if (rollData.roll_proof_url) {
                        this._lastRollProofRollData = null;
                    }
                    if (rollData.roll_id && this.rollHistory.has(rollData.roll_id)) {
                        this.rollHistory.get(rollData.roll_id).chatMessage = chatMessage;
                    }
                    try {
                        this.diceHandler.animateDice(foundryRoll);
                    } catch (_) {
                        // Don't fall back to /roll if only dice animation failed (e.g. core.dice3d not registered)
                    }
                    if (debug) console.log("RollSight Real Dice Reader | [debug] Unprompted roll sent via direct message creation (amendments supported)");
                    return foundryRoll;
                } catch (directErr) {
                    if (debug) console.warn("RollSight Real Dice Reader | [debug] Direct message creation failed, falling back to /roll command:", directErr?.message || directErr);
                }

                // Fallback: send as /roll command (amendments will be stored but cannot update the chat message).
                if (rollData.roll_id) {
                    const foundryRoll = this.createFoundryRoll(rollData);
                    this.rollHistory.set(rollData.roll_id, {
                        roll: foundryRoll,
                        rollData: rollData,
                        chatMessage: null
                    });
                }
                await this.sendRollAsCommand(rollData);
            } else {
                console.log("RollSight Real Dice Reader | No pending roll and fallback disabled; roll not sent.");
            }
            return null;
            
            /* Original code - commented out for testing
            // Create Foundry Roll from roll data
            console.log("RollSight Real Dice Reader | Creating Foundry Roll...");
            const foundryRoll = this.createFoundryRoll(rollData);
            console.log("RollSight Real Dice Reader | Roll created:", foundryRoll.formula, "=", foundryRoll.total);
            
            // Store in history for potential amendments
            if (rollData.roll_id) {
                this.rollHistory.set(rollData.roll_id, {
                    roll: foundryRoll,
                    rollData: rollData,
                    chatMessage: null // Will be set when message is created
                });
            }
            
            // Create chat message (await to ensure it's created before continuing)
            console.log("RollSight Real Dice Reader | Creating chat message...");
            const chatMessage = await this.chatHandler.createRollMessage(foundryRoll, rollData);
            console.log("RollSight Real Dice Reader | Chat message created:", chatMessage.id);
            
            // Store chat message reference
            if (rollData.roll_id && this.rollHistory.has(rollData.roll_id)) {
                this.rollHistory.get(rollData.roll_id).chatMessage = chatMessage;
            }
            
            // Trigger 3D dice (after message is created)
            this.diceHandler.animateDice(foundryRoll);
            
            console.log("✅ RollSight Real Dice Reader | Roll processed successfully and should appear in chat");
            return foundryRoll;
            */
        } catch (error) {
            console.error("❌ RollSight Real Dice Reader | Error handling roll:", error);
            console.error("❌ RollSight Real Dice Reader | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Chat line with roll replay link (GIF may still be uploading when the roll is posted).
     */
    async _postRollProofSupplement(rollData) {
        if (!rollData?.roll_proof_url) return;
        try {
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const ChatMessageClass = game?.messages?.documentClass
                ?? (typeof foundry !== 'undefined' && foundry.chat?.messages?.ChatMessage)
                ?? globalThis.ChatMessage;
            const user = game?.user;
            if (!game || !user || !ChatMessageClass) return;
            let speaker;
            try {
                speaker = (typeof ChatMessageClass.getSpeaker === "function")
                    ? ChatMessageClass.getSpeaker({ user })
                    : { alias: user?.name ?? "Unknown" };
            } catch (e) {
                speaker = { alias: user?.name ?? "Unknown" };
            }
            const content = buildRollReplayStandaloneContentHtml(rollData);
            await ChatMessageClass.create({
                user: user.id,
                speaker,
                content,
            });
            this._lastRollProofRollData = null;
        } catch (e) {
            console.warn("RollSight Real Dice Reader | Roll replay chat line failed:", e);
        }
    }

    /**
     * Send roll as /roll command in Foundry chat
     */
    async sendRollAsCommand(rollData) {
        try {
            console.log("🎲 RollSight Real Dice Reader | Sending roll as /roll command...");
            
            // Get Foundry classes (using namespaced API for Foundry v13+ if available)
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            
            if (!game || !game.user) {
                throw new Error("Game or user not available");
            }
            
            const user = game.user;
            
            // Get the total value and formula
            const total = rollData.total !== undefined ? rollData.total : 0;
            const formula = rollData.formula || '1d6';
            
            // Build description using same logic as Pico display
            // - Pair d10p + d10 for percentile (d100)
            // - Handle 2 d20s as advantage/disadvantage
            let description = 'RollSight Roll';
            
            if (rollData.dice && rollData.dice.length > 0) {
                // Separate dice by type
                const d10pDice = [];
                const d10Dice = [];
                const d20Dice = [];
                const otherDice = [];
                
                rollData.dice.forEach(d => {
                    const shape = d.shape || (d.faces ? `d${d.faces}` : null);
                    const value = d.value;
                    
                    if (shape === 'd10p') {
                        d10pDice.push({ shape, value });
                    } else if (shape === 'd10') {
                        d10Dice.push({ shape, value });
                    } else if (shape === 'd20') {
                        d20Dice.push({ shape, value });
                    } else {
                        otherDice.push({ shape, value });
                    }
                });
                
                const parts = [];
                
                // Pair d10p + d10 for percentile (like Pico display)
                const pairsToMake = Math.min(d10pDice.length, d10Dice.length);
                for (let i = 0; i < pairsToMake; i++) {
                    const d10pValue = d10pDice[i].value;
                    const d10Value = d10Dice[i].value;
                    
                    // Calculate percentile value (same logic as Pico display)
                    let percentileValue;
                    const d10Adjusted = (d10Value === 10) ? 0 : d10Value; // d10 "0" is stored as 10
                    
                    if (d10pValue === 0 && d10Adjusted === 0) {
                        percentileValue = 100; // 00 + 0 = 100
                    } else if (d10pValue === 0) {
                        percentileValue = d10Adjusted; // 00 + 1-9 = that digit
                    } else {
                        percentileValue = d10pValue + d10Adjusted; // d10p + d10
                    }
                    
                    parts.push(`d100: ${percentileValue} (d10p: ${d10pValue}, d10: ${d10Value})`);
                }
                
                // Handle 2 d20s as advantage/disadvantage
                if (d20Dice.length === 2) {
                    const [d20a, d20b] = d20Dice;
                    const higher = Math.max(d20a.value, d20b.value);
                    const lower = Math.min(d20a.value, d20b.value);
                    parts.push(`d20: ${higher}/${lower} (ADV)`);
                } else if (d20Dice.length === 1) {
                    const d20Value = d20Dice[0].value;
                    parts.push(`d20: ${d20Value}`);
                }
                
                // Add remaining unpaired d10p dice
                for (let i = pairsToMake; i < d10pDice.length; i++) {
                    parts.push(`d10p: ${d10pDice[i].value}`);
                }
                
                // Add remaining unpaired d10 dice
                for (let i = pairsToMake; i < d10Dice.length; i++) {
                    parts.push(`d10: ${d10Dice[i].value}`);
                }
                
                // Add all other dice
                otherDice.forEach(d => {
                    const shape = d.shape || '?';
                    parts.push(`${shape}: ${d.value}`);
                });
                
                if (parts.length > 0) {
                    description = `RollSight Roll: ${parts.join(', ')}`;
                }
            } else if (formula) {
                description = `RollSight Roll: ${formula}`;
            }

            if (rollData.roll_proof_url) {
                const replayUrl = normalizeRollProofUrl(rollData.roll_proof_url) || rollData.roll_proof_url;
                description += ` | RollSight replay: ${replayUrl}`;
                this._lastRollProofRollData = null;
            }
            
            const rollFormula = (formula && String(formula).trim()) ? formula : String(total ?? '').trim();
            if (!rollFormula) {
                console.warn("RollSight Real Dice Reader | No roll formula available; skipping chat command.");
                return;
            }
            // Create /roll command: /roll [formula] # [description]
            const rollCommand = `/roll ${rollFormula} # ${description}`;
            
            console.log("🎲 RollSight Real Dice Reader | Sending roll command:", rollCommand);
            
            // Send the command to chat - Foundry will process it as a roll
            // Use ui.chat.processMessage to process the command
            const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
            if (ui && ui.chat && ui.chat.processMessage) {
                await ui.chat.processMessage(rollCommand);
                console.log("✅ RollSight Real Dice Reader | Roll command processed successfully");
            } else {
                // Fallback: create a ChatMessage with the command as content (v12: game.messages.documentClass)
                const ChatMessageClass = game?.messages?.documentClass ?? (typeof foundry !== 'undefined' && foundry.chat?.messages?.ChatMessage) ?? globalThis.ChatMessage;
                const speaker = (ChatMessageClass?.getSpeaker && typeof ChatMessageClass.getSpeaker === "function")
                    ? (() => { try { return ChatMessageClass.getSpeaker({ user }); } catch (_) { return { alias: user?.name ?? "Unknown" }; } })()
                    : { alias: user?.name ?? "Unknown" };
                const messageData = {
                    user: user.id,
                    speaker,
                    content: rollCommand
                };
                const message = await ChatMessageClass.create(messageData);
                console.log("✅ RollSight Real Dice Reader | Roll command sent as message, ID:", message.id);
            }
        } catch (error) {
            console.error("❌ RollSight Real Dice Reader | Error sending roll as command:", error);
            console.error("❌ RollSight Real Dice Reader | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Handle roll amendment from RollSight
     */
    async handleAmendment(amendmentData) {
        console.log("RollSight Real Dice Reader | Received amendment:", amendmentData);
        
        const rollId = amendmentData.roll_id;
        const historyEntry = this.rollHistory.get(rollId);
        
        if (!historyEntry) {
            console.warn("RollSight Real Dice Reader | Amendment for unknown roll:", rollId);
            return Promise.resolve(); // Return resolved promise instead of undefined
        }

        try {
            // Create corrected Foundry Roll
            const correctedRoll = this.createFoundryRoll(amendmentData.corrected);
            
            // Update chat message if we have a reference (direct creation path); /roll command path has chatMessage: null
            if (historyEntry.chatMessage) {
                await this.chatHandler.updateRollMessage(
                    historyEntry.chatMessage,
                    correctedRoll,
                    amendmentData.corrected
                );
            }
            
            // Update history
            historyEntry.roll = correctedRoll;
            historyEntry.rollData = amendmentData.corrected;
            
            // Re-animate dice with corrected values
            this.diceHandler.animateDice(correctedRoll);
        } catch (error) {
            console.error("❌ RollSight Real Dice Reader | Error handling amendment:", error);
            console.error("❌ RollSight Real Dice Reader | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Try to find an open "Configure Roll" (or similar) dialog and apply the RollSight d20 using its settings
     * (formula, situational bonus, advantage, roll mode). Returns true if we did; false otherwise.
     */
    async _tryApplyFromOpenRollConfigDialog(d20Value, combatant, combat) {
        const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
        if (typeof document === 'undefined') return false;

        let dialogApp = null;
        let dialogElement = null;

        const checkElement = (root) => {
            if (!root?.querySelector) return false;
            const titleEl = root.querySelector('.window-title, [class*="title"], header h2, .dialog-title, h2');
            const title = (titleEl?.textContent ?? '').trim();
            if (!/configure roll|roll config/i.test(title)) return false;
            const form = root.querySelector('form') ?? root.querySelector('[data-form]');
            return form ? root : null;
        };

        if (ui?.windows) {
            const windowsList = Array.isArray(ui.windows) ? ui.windows : Object.values(ui.windows);
            for (const w of windowsList) {
                const el = w?.element ?? w?.window?.content;
                const root = el instanceof HTMLElement ? el : w?.element;
                const found = checkElement(root);
                if (found) {
                    dialogApp = w;
                    dialogElement = found;
                    break;
                }
            }
        }
        if (!dialogElement && document.body) {
            const candidates = document.body.querySelectorAll('.window, .app, [class*="application"], [class*="dialog"]');
            for (const el of candidates) {
                const found = checkElement(el);
                if (found) {
                    dialogElement = found;
                    break;
                }
            }
        }

        if (!dialogElement?.querySelector) return false;

        let formulaStr = '';
        const formulaEl = dialogElement.querySelector('[name="formula"], .formula, [data-formula]');
        if (formulaEl) formulaStr = formulaEl.value ?? formulaEl.textContent?.trim() ?? formulaEl.dataset?.formula ?? '';
        if (!formulaStr) {
            for (const lb of dialogElement.querySelectorAll('label, .label, .form-group')) {
                if (/formula/i.test(lb.textContent || '')) {
                    const next = lb.nextElementSibling ?? lb.parentElement?.querySelector('.value, [data-value], input, .formula');
                    formulaStr = (next?.value ?? next?.textContent ?? '').toString().trim();
                    if (formulaStr) break;
                }
            }
        }
        if (!formulaStr) {
            const match = dialogElement.innerText?.match(/(\d*d\d+(?:k[hl]\d+)?(?:\s*[+*-]\s*\d+)*)/);
            if (match) formulaStr = match[1].replace(/\s/g, '');
        }
        if (!formulaStr) return false;

        const bonusInput = dialogElement.querySelector('input[placeholder*="Situational"], input[placeholder*="Bonus"], input[name*="bonus"]');
        const situationalBonus = bonusInput?.value ? parseFloat(String(bonusInput.value).replace(/\s/g, '')) : 0;
        const bonus = Number.isNaN(situationalBonus) ? 0 : situationalBonus;

        const advantageBtn = dialogElement.querySelector('[data-action="advantage"], [data-advantage="1"], .advantage, button:has([class*="advantage"])');
        const disadvantageBtn = dialogElement.querySelector('[data-action="disadvantage"], [data-advantage="-1"], .disadvantage');
        const normalBtn = dialogElement.querySelector('[data-action="normal"], .normal');
        const hasAdv = advantageBtn?.classList?.contains('active') ?? advantageBtn?.getAttribute?.('aria-pressed') === 'true';
        const hasDis = disadvantageBtn?.classList?.contains('active') ?? disadvantageBtn?.getAttribute?.('aria-pressed') === 'true';

        const RollClass = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
        const DieClass = (typeof foundry !== 'undefined' && foundry.dice?.terms?.Die) ? foundry.dice.terms.Die : globalThis.Die;
        if (!RollClass || !DieClass) return false;

        let rollFormula = formulaStr.replace(/\s/g, '');
        if (hasAdv && !/2d20kh|2d20kH/.test(rollFormula)) rollFormula = rollFormula.replace(/(\d*)d20/, '2d20kh1');
        if (hasDis && !/2d20kl|2d20kL/.test(rollFormula)) rollFormula = rollFormula.replace(/(\d*)d20/, '2d20kl1');

        let roll;
        try {
            roll = RollClass.fromFormula ? RollClass.fromFormula(rollFormula) : new RollClass(rollFormula);
        } catch (_) {
            return false;
        }

        let injected = false;
        for (const term of roll.terms) {
            if (term instanceof DieClass && term.faces === 20) {
                const n = Math.max(1, term.number ?? 1);
                term.results = Array.from({ length: n }, () => ({ result: d20Value, active: true, discarded: false }));
                term._evaluated = true;
                injected = true;
            }
        }
        if (!injected) return false;

        roll._evaluated = true;
        let sum = 0;
        for (const term of roll.terms) {
            const v = term.total ?? term.value;
            if (typeof v === 'number' && !Number.isNaN(v)) sum += v;
        }
        const total = (roll._total ?? roll.total ?? sum) + bonus;
        if (Number.isNaN(total)) return false;

        try {
            await combat.setInitiative(combatant.id, total);
            if (ui?.notifications) ui.notifications.info(`${combatant.name}: Initiative ${total} (RollSight, from dialog)`);
            if (dialogApp?.close) await dialogApp.close();
            else if (dialogElement?.closest?.('.app')?.querySelector?.('.header-button.close')) dialogElement.closest('.app').querySelector('.header-button.close').click();
            console.log("RollSight Real Dice Reader | Applied RollSight roll from Configure Roll dialog:", combatant.name, "=", total);
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Find if the click target is inside a "Configure Roll" / initiative dialog. Returns { dialogElement, dialogApp } or null.
     * Excludes known roll dialogs (Attack Roll, Damage Roll, etc.) so they are handled by the roll-dialog interceptor.
     */
    _findConfigureRollDialogFromClick(clickTarget) {
        if (!clickTarget || !clickTarget.closest) return null;
        const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
        const rollDialogPatterns = RollSightIntegration.ROLL_DIALOG_TITLE_PATTERNS;
        const checkRoot = (root) => {
            if (!root?.querySelector) return null;
            const titleEl = root.querySelector('.window-title, [class*="title"], header h2, .dialog-title, h2');
            const title = (titleEl?.textContent ?? '').trim().toLowerCase();
            const text = (root.innerText ?? '').trim().toLowerCase();
            const fullText = `${title} ${text}`;
            // Do not treat Attack/Damage/Ability Check/etc. as Configure Roll
            if (rollDialogPatterns.some(p => fullText.includes(p))) return null;
            // Match Configure Roll, Roll Config, Roll for Initiative, or initiative-style dialog with formula + adv/disadv
            if (!/configure roll|roll config|roll for initiative|initiative/i.test(fullText)) {
                const hasAdvBtn = root.querySelector('[data-action="advantage"]');
                const hasFormula = root.querySelector('[name="formula"], .formula, [data-formula]') || /\d*d\d+/.test(text);
                if (!hasAdvBtn && !hasFormula) return null;
            }
            const form = root.querySelector('form') ?? root.querySelector('[data-form]');
            return form ? root : null;
        };
        let el = clickTarget;
        while (el && el !== document.body) {
            const root = checkRoot(el);
            if (root) {
                let dialogApp = null;
                if (ui?.windows) {
                    const windowsList = Array.isArray(ui.windows) ? ui.windows : Object.values(ui.windows);
                    for (const w of windowsList) {
                        const appEl = w?.element ?? w?.window?.content;
                        const r = appEl instanceof HTMLElement ? appEl : w?.element;
                        if (r && (r === root || r.contains?.(root))) {
                            dialogApp = w;
                            break;
                        }
                    }
                }
                return { dialogElement: root, dialogApp };
            }
            el = el.parentElement;
        }
        return null;
    }

    /**
     * Parse formula and bonus from a Configure Roll dialog element (same logic as _tryApplyFromOpenRollConfigDialog).
     * When clickedButton is provided (e.g. Advantage/Normal/Disadvantage), use it to determine mode since
     * the "active" class may not be set yet (we intercept in capture phase before the default handler).
     * Returns { rollFormula, bonus } or null.
     */
    _parseConfigureRollDialog(dialogElement, clickedButton = null) {
        if (!dialogElement?.querySelector) return null;
        let formulaStr = '';
        const formulaEl = dialogElement.querySelector('[name="formula"], .formula, [data-formula]');
        if (formulaEl) formulaStr = formulaEl.value ?? formulaEl.textContent?.trim() ?? formulaEl.dataset?.formula ?? '';
        if (!formulaStr) {
            for (const lb of dialogElement.querySelectorAll('label, .label, .form-group')) {
                if (/formula/i.test(lb.textContent || '')) {
                    const next = lb.nextElementSibling ?? lb.parentElement?.querySelector('.value, [data-value], input, .formula');
                    formulaStr = (next?.value ?? next?.textContent ?? '').toString().trim();
                    if (formulaStr) break;
                }
            }
        }
        if (!formulaStr) {
            const match = dialogElement.innerText?.match(/(\d*d\d+(?:k[hl]\d+)?(?:\s*[+*-]\s*\d+)*)/);
            if (match) formulaStr = match[1].replace(/\s/g, '');
        }
        if (!formulaStr) return null;
        const bonusInput = dialogElement.querySelector('input[placeholder*="Situational"], input[placeholder*="Bonus"], input[name*="bonus"]');
        const situationalBonus = bonusInput?.value ? parseFloat(String(bonusInput.value).replace(/\s/g, '')) : 0;
        const bonus = Number.isNaN(situationalBonus) ? 0 : situationalBonus;
        // Use clicked button to determine mode (we intercept before default handler sets active)
        let hasAdv = false;
        let hasDis = false;
        const clickedText = (clickedButton?.textContent ?? '').trim().toLowerCase();
        if (/^advantage$/i.test(clickedText)) hasAdv = true;
        else if (/^disadvantage$/i.test(clickedText)) hasDis = true;
        else {
            const advantageBtn = dialogElement.querySelector('[data-action="advantage"], [data-advantage="1"], .advantage');
            const disadvantageBtn = dialogElement.querySelector('[data-action="disadvantage"], [data-advantage="-1"], .disadvantage');
            hasAdv = advantageBtn?.classList?.contains('active') ?? advantageBtn?.getAttribute?.('aria-pressed') === 'true';
            hasDis = disadvantageBtn?.classList?.contains('active') ?? disadvantageBtn?.getAttribute?.('aria-pressed') === 'true';
        }
        let rollFormula = formulaStr.replace(/\s/g, '');
        if (hasAdv && !/2d20kh|2d20kH/.test(rollFormula)) rollFormula = rollFormula.replace(/(\d*)d20/, '2d20kh1');
        if (hasDis && !/2d20kl|2d20kL/.test(rollFormula)) rollFormula = rollFormula.replace(/(\d*)d20/, '2d20kl1');
        return { rollFormula, bonus };
    }

    /**
     * Find if the click target is inside a known roll dialog (Attack Roll, Damage Roll, Ability Check, Saving Throw, etc.).
     * Excludes Configure Roll / initiative dialogs. Returns { dialogElement, dialogApp } or null.
     */
    _findRollDialogFromClick(clickTarget) {
        if (!clickTarget || !clickTarget.closest) return null;
        const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const rollPatterns = RollSightIntegration.ROLL_DIALOG_TITLE_PATTERNS;
        const configurePatterns = RollSightIntegration.CONFIGURE_ROLL_TITLE_PATTERNS;

        const checkRoot = (root) => {
            if (!root?.querySelector) return null;
            const titleEl = root.querySelector('.window-title, [class*="title"], header h2, .dialog-title, h2');
            const title = (titleEl?.textContent ?? '').trim().toLowerCase();
            const text = (root.innerText ?? '').trim().toLowerCase();
            const fullText = `${title} ${text}`;
            // Exclude Configure Roll / initiative so that handler takes precedence
            if (configurePatterns.some(p => fullText.includes(p))) return null;
            const isRollDialog = rollPatterns.some(p => fullText.includes(p));
            if (!isRollDialog) return null;
            const hasFormula = root.querySelector('[name="formula"], .formula, [data-formula]') || /\d*d\d+/.test(text);
            const hasRollButtons = !!root.querySelector('button, [role="button"], .dialog-button, [data-action]');
            if (!hasFormula || !hasRollButtons) return null;
            return root;
        };

        let el = clickTarget;
        while (el && el !== document.body) {
            const root = checkRoot(el);
            if (root) {
                let dialogApp = null;
                if (ui?.windows) {
                    const windowsList = Array.isArray(ui.windows) ? ui.windows : Object.values(ui.windows);
                    for (const w of windowsList) {
                        const appEl = w?.element ?? w?.window?.content;
                        const r = appEl instanceof HTMLElement ? appEl : w?.element;
                        if (r && (r === root || r.contains?.(root))) {
                            dialogApp = w;
                            break;
                        }
                    }
                }
                if (!dialogApp && game?.apps) {
                    const apps = Object.values(game.apps);
                    for (const app of apps) {
                        const appEl = app?.element ?? app?._element;
                        if (appEl && (appEl === root || (appEl.contains && appEl.contains(root)))) {
                            dialogApp = app;
                            break;
                        }
                    }
                }
                if (!dialogApp && root?.closest) {
                    const appWrap = root.closest('.app, [class*="application"]');
                    if (appWrap?.apps) {
                        const arr = Array.isArray(appWrap.apps) ? appWrap.apps : Object.values(appWrap.apps);
                        dialogApp = arr[0];
                    }
                }
                return { dialogElement: root, dialogApp };
            }
            el = el.parentElement;
        }
        return null;
    }

    /**
     * Normalize a dice formula: collapse spaces, fix double plus/minus at boundaries.
     */
    _normalizeFormula(s) {
        if (s == null || typeof s !== 'string') return '';
        let t = s.trim().replace(/\s+/g, '');
        t = t.replace(/\+\+/g, '+').replace(/--/g, '+').replace(/\+-/g, '-').replace(/-\+/g, '-');
        if (t.startsWith('+')) t = t.slice(1);
        return t;
    }

    /**
     * Parse formula and bonus from a roll dialog element (Attack/Damage/Ability Check/Saving Throw/etc.).
     * Returns { rollFormula, bonus } or null. Formula is normalized; situational bonus is applied separately.
     */
    _parseRollDialog(dialogElement, clickedButton = null) {
        if (!dialogElement?.querySelector) return null;
        let formulaStr = '';
        const formulaEl = dialogElement.querySelector('[name="formula"], .formula, [data-formula], input[data-formula]');
        if (formulaEl) {
            formulaStr = (formulaEl.value ?? formulaEl.textContent ?? formulaEl.dataset?.formula ?? '').toString().trim();
        }
        if (!formulaStr) {
            for (const lb of dialogElement.querySelectorAll('label, .label, .form-group, [class*="form-group"]')) {
                if (/formula/i.test(lb.textContent || '')) {
                    const next = lb.nextElementSibling ?? lb.parentElement?.querySelector('.value, [data-value], input, .formula, [name="formula"]');
                    formulaStr = (next?.value ?? next?.textContent ?? next?.dataset?.formula ?? '').toString().trim();
                    if (formulaStr) break;
                }
            }
        }
        if (!formulaStr) {
            const match = dialogElement.innerText?.match(/(\d*d\d+(?:k[hl]\d+)?(?:\s*[+*-]\s*\d+)*)/);
            if (match) formulaStr = match[1];
        }
        if (!formulaStr) return null;
        formulaStr = this._normalizeFormula(formulaStr);
        if (!formulaStr) return null;

        const bonusInput = dialogElement.querySelector('input[placeholder*="Situational"], input[placeholder*="Bonus"], input[name*="bonus"], input[name*="situational"]');
        const rawBonus = bonusInput?.value ? String(bonusInput.value).replace(/\s/g, '') : '';
        const situationalBonus = rawBonus ? parseFloat(rawBonus) : 0;
        const bonus = Number.isNaN(situationalBonus) ? 0 : situationalBonus;

        let hasAdv = false;
        let hasDis = false;
        const clickedText = (clickedButton?.textContent ?? '').trim().toLowerCase();
        if (/^advantage$/i.test(clickedText)) hasAdv = true;
        else if (/^disadvantage$/i.test(clickedText)) hasDis = true;
        else {
            const advantageBtn = dialogElement.querySelector('[data-action="advantage"], [data-advantage="1"], .advantage, [class*="advantage"]');
            const disadvantageBtn = dialogElement.querySelector('[data-action="disadvantage"], [data-advantage="-1"], .disadvantage, [class*="disadvantage"]');
            hasAdv = advantageBtn?.classList?.contains('active') ?? advantageBtn?.getAttribute?.('aria-pressed') === 'true';
            hasDis = disadvantageBtn?.classList?.contains('active') ?? disadvantageBtn?.getAttribute?.('aria-pressed') === 'true';
        }

        let rollFormula = formulaStr;
        if (hasAdv && !/2d20kh|2d20kH/.test(rollFormula)) rollFormula = rollFormula.replace(/(\d*)d20/i, '2d20kh1');
        if (hasDis && !/2d20kl|2d20kL/.test(rollFormula)) rollFormula = rollFormula.replace(/(\d*)d20/i, '2d20kl1');
        if (bonus !== 0) rollFormula += (bonus >= 0 ? `+${bonus}` : `${bonus}`);
        rollFormula = this._normalizeFormula(rollFormula);
        return { rollFormula, bonus };
    }

    /**
     * Check if we should block this click (we intercepted the mousedown and opened our flow; block the system's handler).
     */
    _shouldBlockRollDialogClick(ev) {
        const now = Date.now();
        if (now - this._rollDialogInterceptedAt > 500) return false;
        const target = ev.target;
        const button = target?.closest?.('button, [role="button"], .dialog-button, [data-action]');
        return button && this._rollDialogInterceptedTarget === button;
    }

    /**
     * Mousedown handler (capture phase). Intercept Attack/Damage Roll dialog roll buttons and open RollResolver.
     */
    _onRollDialogClick(ev) {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const debug = game?.settings?.get("rollsight-integration", "debugLogging");
        if (ev.type === 'mousedown' && Date.now() - this._rollDialogInterceptedAt < 100) return;
        if (!game?.user) return;
        const target = ev.target;
        const button = target.closest?.('button, [role="button"], .dialog-button, [data-action]');
        if (!button) return;
        const btnText = (button.textContent ?? '').trim().toLowerCase();
        const dataAction = (button.getAttribute?.('data-action') ?? '').toLowerCase();
        if (/cancel|close/i.test(btnText) || dataAction === 'cancel' || dataAction === 'close') return;
        const isRollTrigger = /^advantage$|^normal$|^disadvantage$/i.test(btnText) ||
            /^advantage$|^normal$|^disadvantage$/.test(dataAction);
        if (!isRollTrigger) return;
        const found = this._findRollDialogFromClick(target);
        if (!found) {
            if (debug) console.log("RollSight Real Dice Reader | [debug] Roll dialog skip: no matching dialog for", btnText, dataAction);
            return;
        }
        const { dialogElement, dialogApp } = found;
        const parsed = this._parseRollDialog(dialogElement, button);
        if (!parsed) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        this._rollDialogInterceptedAt = Date.now();
        this._rollDialogInterceptedTarget = button;
        if (debug) console.log("RollSight Real Dice Reader | [debug] Roll dialog intercepted:", parsed.rollFormula);
        this._openRollResolverForRollDialog(dialogElement, dialogApp, parsed, button).catch(err => {
            console.warn("RollSight Real Dice Reader | Roll dialog interception error:", err);
        });
    }

    /**
     * Open RollResolver for an Attack/Damage Roll dialog and invoke the original button after fulfillment.
     */
    async _openRollResolverForRollDialog(dialogElement, dialogApp, parsed, button) {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
        const RollClass = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
        const RollResolverClass = RollClass?.resolverImplementation ?? (typeof foundry !== 'undefined' && foundry.applications?.dice?.RollResolver) ?? null;
        if (!RollClass || !RollResolverClass) return;
        let roll;
        try {
            roll = RollClass.fromFormula ? RollClass.fromFormula(parsed.rollFormula) : new RollClass(parsed.rollFormula);
        } catch (_) {
            return;
        }
        const formula = parsed.rollFormula;
        let resolveOutcomeForPending;
        const outcomePromise = new Promise((resolve) => { resolveOutcomeForPending = resolve; });
        this._pendingChatResolver = {
            resolver: null,
            roll,
            formula,
            description: '',
            rollMode: 'publicroll',
            resolveOutcome: resolveOutcomeForPending,
            resolverNotRendered: true,
            consumedFingerprints: new Set(),
            rollDialog: { dialogElement, dialogApp, button }
        };
        this._pendingChatResolverCreatedAt = Date.now();
        this._clearConsumedRollState();
        const resolver = new RollResolverClass({ roll });
        this._pendingChatResolver.resolver = resolver;
        const RollClassRef = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
        if (RollClassRef?.RESOLVERS instanceof Map) {
            RollClassRef.RESOLVERS.set(roll, resolver);
        }
        const fallbackDialog = this._showRollSightWaitDialog(formula, resolver, resolveOutcomeForPending, game);
        if (fallbackDialog) this._pendingChatResolver.dialog = fallbackDialog;
        if (!fallbackDialog && ui?.notifications) {
            ui.notifications.info(`RollSight: Roll ${formula} — roll the dice in RollSight.`);
        }
        const winner = await outcomePromise;
        if (fallbackDialog?.close) fallbackDialog.close();
        try {
            if (typeof resolver.close === 'function') await resolver.close();
        } catch (_) {}
        if (RollClassRef?.RESOLVERS instanceof Map) {
            RollClassRef.RESOLVERS.delete(roll);
        }
        const pending = this._pendingChatResolver;
        this._pendingChatResolver = null;
        if (winner === 'cancelled') return;
        const fulfilledRoll = pending?.resolverNotRendered ? pending.roll : resolver.roll;
        const rollJson = fulfilledRoll?.toJSON ? JSON.parse(JSON.stringify(fulfilledRoll.toJSON())) : null;
        if (rollJson) {
            this._correctedRollForEvaluate = { rollJson, formula };
            // So when the button invokes Foundry's roll and a native RollResolver is rendered, we treat it as duplicate and inject + close it
            this._lastConsumedRollJson = rollJson;
            this._lastPendingResolverFormula = formula;
            this._lastPendingResolverCompletedAt = Date.now();
            // Safety: clear corrected roll after a short window so it is not applied to a later unrelated roll
            const safetyMs = 8000;
            setTimeout(() => {
                if (this._correctedRollForEvaluate?.formula === formula) {
                    this._correctedRollForEvaluate = null;
                }
            }, safetyMs);
        }
        const invoked = this._invokeRollDialogButtonCallback(dialogElement, dialogApp, button);
        if (!invoked && button?.click) {
            button.click();
        }
    }

    /**
     * Resolve the Application instance that owns dialogElement (for custom/MidiQOL dialogs not in ui.windows).
     */
    _resolveDialogApp(dialogElement) {
        if (!dialogElement) return null;
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
        if (ui?.windows) {
            const windowsList = Array.isArray(ui.windows) ? ui.windows : Object.values(ui.windows);
            for (const w of windowsList) {
                const appEl = w?.element ?? w?.window?.content;
                const r = appEl instanceof HTMLElement ? appEl : w?.element;
                if (r && (r === dialogElement || r.contains?.(dialogElement))) return w;
            }
        }
        if (game?.apps) {
            for (const app of Object.values(game.apps)) {
                const appEl = app?.element ?? app?._element;
                if (appEl && (appEl === dialogElement || appEl.contains?.(dialogElement))) return app;
            }
        }
        const appWrap = dialogElement?.closest?.('.app, [class*="application"]');
        if (appWrap?.app) return appWrap.app;
        return null;
    }

    /**
     * Try to invoke the original dialog button callback. Supports Dialog (v1), DialogV2, and MidiQOL-style dialogs.
     * DialogV2: (event, button, dialog) => Promise; Dialog v1: (html) => void.
     */
    _invokeRollDialogButtonCallback(dialogElement, dialogApp, button) {
        try {
            if (!button) return false;
            const app = dialogApp ?? this._resolveDialogApp(dialogElement);
            if (!app) return false;

            const buttonKey = button.getAttribute?.('data-button') ?? button.dataset?.button ?? button.getAttribute?.('data-action') ?? '';
            const buttonLabel = (button.textContent ?? '').trim();
            const buttons = app?.buttons ?? app?.options?.buttons ?? app?.config?.buttons ?? null;
            let buttonInfo = null;
            if (Array.isArray(buttons)) {
                buttonInfo = buttons.find(b =>
                    (b?.key ?? b?.value) === buttonKey || (b?.label ?? b?.text ?? '') === buttonLabel
                );
            } else if (buttons && typeof buttons === 'object') {
                buttonInfo = buttons[buttonKey] ?? Object.values(buttons).find(b => (b?.label ?? b?.text ?? '') === buttonLabel);
            }
            const callback = buttonInfo?.callback ?? buttonInfo?.action;
            if (typeof callback !== 'function') return false;

            const form = dialogElement?.querySelector?.('form') ?? dialogElement;
            // DialogV2: (event: PointerEvent|SubmitEvent, button: HTMLButtonElement, dialog: DialogV2) => Promise<any>
            if (callback.length >= 3) {
                callback.call(app, null, button, app);
                return true;
            }
            // Dialog v1 / legacy: (html: JQuery|HTMLElement) => void
            callback.call(app, form);
            return true;
        } catch (err) {
            console.warn("RollSight Real Dice Reader | Could not invoke dialog button callback:", err);
        }
        return false;
    }

    /**
     * Check if we should block this click (we intercepted the mousedown and opened our flow; block the system's handler).
     */
    _shouldBlockConfigureRollClick(ev) {
        const now = Date.now();
        if (now - this._configureRollInterceptedAt > 500) return false;
        const target = ev.target;
        const button = target?.closest?.('button, [role="button"], .dialog-button, [data-action]');
        return button && this._configureRollInterceptedTarget === button;
    }

    /**
     * Mousedown handler (capture phase). When user clicks the Roll button in a "Configure Roll" dialog and Dice Config
     * uses RollSight for d20, prevent the default digital roll and open RollResolver so they can roll in RollSight.
     */
    _onConfigureRollDialogClick(ev) {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const debug = game?.settings?.get("rollsight-integration", "debugLogging");
        // Dedupe: pointerdown and mousedown both fire; only handle once per interaction
        if (ev.type === 'mousedown' && Date.now() - this._configureRollInterceptedAt < 100) return;
        // Allow interception even before combat.started (initiative often rolled when setting up combat)
        if (!game?.combat || !game.user) {
            if (debug) console.log("RollSight Real Dice Reader | [debug] Configure Roll skip: no combat or user");
            return;
        }
        const target = ev.target;
        const button = target.closest?.('button, [role="button"], .dialog-button, [data-action]');
        if (!button) return;
        const btnText = (button.textContent ?? '').trim().toLowerCase();
        const dataAction = (button.getAttribute?.('data-action') ?? '').toLowerCase();
        if (/cancel|close/i.test(btnText) || dataAction === 'cancel' || dataAction === 'close') return;
        // Intercept Roll/Submit/OK and Advantage/Normal/Disadvantage (data-action or button text)
        const isRollTrigger = /roll|submit|ok/i.test(btnText) || button.type === 'submit' ||
            /^advantage$|^normal$|^disadvantage$/i.test(btnText) ||
            /^advantage$|^normal$|^disadvantage$/.test(dataAction);
        if (!isRollTrigger) return;
        const found = this._findConfigureRollDialogFromClick(target);
        if (!found) {
            if (debug) console.log("RollSight Real Dice Reader | [debug] Configure Roll skip: no matching dialog for", btnText, dataAction);
            return;
        }
        const { dialogElement, dialogApp } = found;
        const parsed = this._parseConfigureRollDialog(dialogElement, button);
        if (!parsed) return;
        const denominations = (parsed.rollFormula.match(/\d*d\d+/gi) || []).map(s => s.toLowerCase().replace(/\d+d/, 'd'));
        const combat = game.combat;
        const combatants = combat.turns ?? (Array.isArray(combat.combatants) ? combat.combatants : []);
        const isGM = game.user?.isGM;
        const pending = combatants.filter(c => {
            const noInitiative = c.initiative === null || c.initiative === undefined;
            const isPlayerOwned = c.players?.includes(game.user) ?? (c.actor?.testUserPermission?.(game.user, 'OWNER') ?? false);
            return noInitiative && (isGM || isPlayerOwned);
        });
        if (pending.length === 0) return;
        const combatant = pending[0];
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        this._configureRollInterceptedAt = Date.now();
        this._configureRollInterceptedTarget = button;
        if (debug) console.log("RollSight Real Dice Reader | [debug] Configure Roll intercepted:", parsed.rollFormula, "for", combatant?.name);
        this._openRollResolverForConfigureRollDialog(dialogElement, dialogApp, combatant, combat, parsed).catch(err => {
            console.warn("RollSight Real Dice Reader | Configure Roll interception error:", err);
        });
    }

    /**
     * Open RollResolver for the Configure Roll dialog formula; when RollSight roll is fulfilled, set initiative and close dialog.
     */
    async _openRollResolverForConfigureRollDialog(dialogElement, dialogApp, combatant, combat, parsed) {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
        const RollClass = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
        const RollResolverClass = RollClass?.resolverImplementation ?? (typeof foundry !== 'undefined' && foundry.applications?.dice?.RollResolver) ?? null;
        if (!RollClass || !RollResolverClass) return;
        let roll;
        try {
            roll = RollClass.fromFormula ? RollClass.fromFormula(parsed.rollFormula) : new RollClass(parsed.rollFormula);
        } catch (_) {
            return;
        }
        const formula = parsed.rollFormula;
        let resolveOutcomeForPending;
        const outcomePromise = new Promise((resolve) => { resolveOutcomeForPending = resolve; });
        this._pendingChatResolver = {
            resolver: null,
            roll,
            formula,
            description: '',
            rollMode: 'publicroll',
            resolveOutcome: resolveOutcomeForPending,
            resolverNotRendered: true,
            consumedFingerprints: new Set(),
            configureRoll: { dialogElement, dialogApp, combatant, combat, bonus: parsed.bonus }
        };
        this._pendingChatResolverCreatedAt = Date.now();
        this._clearConsumedRollState();
        const resolver = new RollResolverClass({ roll });
        this._pendingChatResolver.resolver = resolver;
        const RollClassRef = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
        if (RollClassRef?.RESOLVERS instanceof Map) {
            RollClassRef.RESOLVERS.set(roll, resolver);
        }
        const fallbackDialog = this._showRollSightWaitDialog(formula, resolver, resolveOutcomeForPending, game);
        if (fallbackDialog) this._pendingChatResolver.dialog = fallbackDialog;
        if (!fallbackDialog && ui?.notifications) {
            ui.notifications.info(`RollSight: Roll ${formula} — roll the dice in RollSight.`);
        }
        const winner = await outcomePromise;
        if (fallbackDialog?.close) fallbackDialog.close();
        try {
            if (typeof resolver.close === 'function') await resolver.close();
        } catch (_) {}
        if (RollClassRef?.RESOLVERS instanceof Map) {
            RollClassRef.RESOLVERS.delete(roll);
        }
        const pending = this._pendingChatResolver;
        this._pendingChatResolver = null;
        if (winner === 'cancelled') return;
        const fulfilledRoll = pending?.resolverNotRendered ? pending.roll : resolver.roll;
        const totalFromRoll = fulfilledRoll?.total ?? fulfilledRoll?._total;
        const total = (typeof totalFromRoll === 'number' && !Number.isNaN(totalFromRoll)) ? totalFromRoll + (pending?.configureRoll?.bonus ?? 0) : null;
        if (total !== null && combat && combatant) {
            try {
                await combat.setInitiative(combatant.id, total);
                if (ui?.notifications) ui.notifications.info(`${combatant.name}: Initiative ${total} (RollSight)`);
                if (dialogApp?.close) await dialogApp.close();
                else if (dialogElement?.closest?.('.app')?.querySelector?.('.header-button.close')) {
                    dialogElement.closest('.app').querySelector('.header-button.close').click();
                }
                console.log("RollSight Real Dice Reader | Initiative from Configure Roll (RollSight):", combatant.name, "=", total);
            } catch (e) {
                console.warn("RollSight Real Dice Reader | setInitiative failed:", e);
            }
        }
    }

    /**
     * Build initiative roll using combatant's formula (bonuses from sheet) with d20 result set to RollSight value.
     * Returns { roll, d20Value } or null if not supported.
     */
    _buildInitiativeRollWithInjectedD20(combatant, d20Value) {
        const RollClass = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll)
            ? foundry.dice.rolls.Roll
            : globalThis.Roll;
        const DieClass = (typeof foundry !== 'undefined' && foundry.dice?.terms?.Die)
            ? foundry.dice.terms.Die
            : globalThis.Die;
        if (!combatant?.getInitiativeRoll || !RollClass || !DieClass) return null;
        let initiativeRoll;
        try {
            initiativeRoll = combatant.getInitiativeRoll();
        } catch (_) {
            return null;
        }
        if (!initiativeRoll?.formula) return null;
        let roll;
        if (RollClass.fromFormula) {
            roll = RollClass.fromFormula(initiativeRoll.formula);
        } else {
            roll = new RollClass(initiativeRoll.formula);
        }
        let injected = false;
        for (const term of roll.terms) {
            if (term instanceof DieClass && term.faces === 20) {
                const numDice = Math.max(1, term.number ?? 1);
                term.results = Array.from({ length: numDice }, () => ({
                    result: d20Value,
                    active: true,
                    discarded: false
                }));
                term._evaluated = true;
                injected = true;
            }
        }
        if (!injected) return null;
        roll._evaluated = true;
        // Ensure total is correct (sum all terms in case Roll.total doesn't include unevaluated NumericTerms)
        let sum = 0;
        for (const term of roll.terms) {
            const v = term.total ?? term.value;
            if (typeof v === 'number' && !Number.isNaN(v)) sum += v;
        }
        if (Number.isNaN(roll.total) || roll.total === undefined) {
            roll._total = sum;
        }
        return { roll, d20Value };
    }

    /**
     * Try to apply a RollSight roll to a pending initiative: use combatant's initiative formula (so bonuses apply),
     * inject the RollSight d20 as the die result, show a dialog with the breakdown, then set initiative to the total.
     * Returns true if the roll was applied to a combatant's initiative; false otherwise.
     */
    async tryApplyToPendingInitiative(rollData) {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        if (game?.settings?.get("rollsight-integration", "applyRollsToInitiative") === false) return false;
        if (!game?.combat?.started || !game.user) return false;
        const combat = game.combat;
        const d20Value = rollData.total !== undefined ? Number(rollData.total) : NaN;
        if (Number.isNaN(d20Value) || d20Value < 1 || d20Value > 20) return false;
        const formula = (rollData.formula || '').toLowerCase().replace(/\s/g, '');
        const isSingleD20 = formula === '1d20' || formula === 'd20' || (rollData.dice?.length === 1 && (rollData.dice[0].shape === 'd20' || rollData.dice[0].faces === 20));
        if (!isSingleD20 && rollData.dice?.length !== 1) return false;
        const combatants = combat.turns ?? (Array.isArray(combat.combatants) ? combat.combatants : []);
        const isGM = game.user?.isGM;
        const pending = combatants.filter(c => {
            const noInitiative = c.initiative === null || c.initiative === undefined;
            const isPlayerOwned = c.players?.includes(game.user) ?? (c.actor?.testUserPermission?.(game.user, "OWNER") ?? false);
            return noInitiative && (isGM || isPlayerOwned);
        });
        if (pending.length === 0) return false;
        const combatant = pending[0];

        // Prefer applying from the open "Configure Roll" dialog (formula, situational bonus, advantage, roll mode)
        const appliedFromDialog = await this._tryApplyFromOpenRollConfigDialog(d20Value, combatant, combat);
        if (appliedFromDialog) return true;

        const built = this._buildInitiativeRollWithInjectedD20(combatant, d20Value);
        let total = null;
        if (built?.roll) {
            const t = built.roll._total ?? built.roll.total;
            total = (typeof t === 'number' && !Number.isNaN(t)) ? t : null;
        }
        const useFormula = total !== null;

        const applyInitiative = async (finalTotal) => {
            try {
                await combat.setInitiative(combatant.id, finalTotal);
                console.log("RollSight Real Dice Reader | Applied RollSight roll to initiative:", combatant.name, "=", finalTotal);
                const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
                if (ui?.notifications) ui.notifications.info(`${combatant.name}: Initiative ${finalTotal} (RollSight)`);
                return true;
            } catch (err) {
                console.warn("RollSight Real Dice Reader | Could not set initiative from RollSight:", err);
                return false;
            }
        };

        if (useFormula) {
            const roll = built.roll;
            const rollResult = typeof roll.result === 'string' ? roll.result : String(roll.total ?? '');
            const DialogClass = this._getFoundryDialogClass();
            if (!DialogClass) {
                await applyInitiative(total);
                return true;
            }
            return new Promise((resolve) => {
                new DialogClass({
                    title: game.i18n?.localize?.("ROLLSIGHT.InitiativeDialogTitle") ?? "Initiative (RollSight)",
                    content: `
                        <p class="rollsight-initiative-breakdown">
                            <strong>${combatant.name}</strong><br>
                            ${roll.formula} = <strong>${rollResult}</strong> (d20 from RollSight: ${built.d20Value})
                        </p>
                        <p>Apply this as ${combatant.name}'s initiative?</p>
                    `,
                    buttons: {
                        apply: {
                            icon: "<i class='fas fa-check'></i>",
                            label: game.i18n?.localize?.("ROLLSIGHT.ApplyInitiative") ?? "Apply to Initiative",
                            callback: async () => {
                                const ok = await applyInitiative(total);
                                resolve(ok);
                            }
                        },
                        cancel: {
                            icon: "<i class='fas fa-times'></i>",
                            label: game.i18n?.localize?.("ROLLSIGHT.Cancel") ?? "Cancel",
                            callback: () => resolve(false)
                        }
                    },
                    default: "apply",
                    close: () => resolve(false)
                }, { width: 400 }).render(true);
            });
        }

        try {
            return await applyInitiative(d20Value);
        } catch (err) {
            console.warn("RollSight Real Dice Reader | Could not set initiative from RollSight:", err);
            return false;
        }
    }
    
    /**
     * Send a test chat message to verify communication works
     */
    /**
     * Post a plain chat line (e.g. RollSight stats URL) from the desktop HTTP bridge or browser extension.
     * @param {string} plainText
     */
    async postChatTextFromBridge(plainText) {
        const text = (plainText ?? "").toString().trim();
        if (!text) return;
        const esc = (s) =>
            String(s)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");
        try {
            const game = (typeof foundry !== "undefined" && foundry.game) ? foundry.game : globalThis.game;
            const ChatMessageClass =
                game?.messages?.documentClass ??
                (typeof foundry !== "undefined" && foundry.chat?.messages?.ChatMessage) ??
                globalThis.ChatMessage;
            if (!game || !game.user) {
                throw new Error("Game or user not available");
            }
            const user = game.user;
            let speaker;
            try {
                speaker =
                    ChatMessageClass?.getSpeaker && typeof ChatMessageClass.getSpeaker === "function"
                        ? ChatMessageClass.getSpeaker({ user })
                        : { alias: user?.name ?? "Unknown" };
            } catch (_) {
                speaker = { alias: user?.name ?? "Unknown" };
            }
            const messageData = {
                user: user.id,
                speaker,
                content: `<p>${esc(text)}</p>`,
                sound: null,
            };
            await ChatMessageClass.create(messageData);
        } catch (err) {
            console.warn("RollSight Real Dice Reader | Could not post chat line from RollSight:", err);
            throw err;
        }
    }

    async sendTestMessage() {
        try {
            console.log("🎲 RollSight Real Dice Reader | Sending test chat message...");
            
            // Get Foundry classes (v12: game.messages.documentClass; v13+: foundry.chat.messages.ChatMessage)
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const ChatMessageClass = game?.messages?.documentClass ?? (typeof foundry !== 'undefined' && foundry.chat?.messages?.ChatMessage) ?? globalThis.ChatMessage;
            if (!game || !game.user) {
                throw new Error("Game or user not available");
            }
            const user = game.user;
            console.log("🎲 RollSight Real Dice Reader | User:", user.name, "ID:", user.id);
            let speaker;
            try {
                speaker = (ChatMessageClass?.getSpeaker && typeof ChatMessageClass.getSpeaker === "function")
                    ? ChatMessageClass.getSpeaker({ user })
                    : { alias: user?.name ?? "Unknown" };
            } catch (_) {
                speaker = { alias: user?.name ?? "Unknown" };
            }
            // Create a simple text message
            const messageData = {
                user: user.id,
                speaker,
                content: "<p><strong>🎲 RollSight Test Message</strong><br/>If you see this, communication is working!</p>",
                sound: null
            };
            
            console.log("🎲 RollSight Real Dice Reader | Creating test message with data:", messageData);
            
            const message = await ChatMessageClass.create(messageData);
            console.log("✅ RollSight Real Dice Reader | Test message created successfully, ID:", message.id);
            return message;
        } catch (error) {
            console.error("❌ RollSight Real Dice Reader | Error sending test message:", error);
            console.error("❌ RollSight Real Dice Reader | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Create a Foundry Roll from RollSight roll data
     * Uses Foundry's manual dice entry approach - create terms with results already set
     */
    createFoundryRoll(rollData) {
        // Get Foundry classes (using namespaced API for Foundry v13+ if available)
        const RollClass = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll)
            ? foundry.dice.rolls.Roll
            : globalThis.Roll;
        
        // Get formula
        const formula = rollData.formula || this.buildFormula(rollData);
        
        // Create roll from formula first
        let roll;
        if (RollClass.fromFormula) {
            roll = RollClass.fromFormula(formula);
        } else {
            roll = new RollClass(formula);
        }
        
        // If we have dice data, manually set the results (like manual dice entry)
        if (rollData.dice && rollData.dice.length > 0) {
            const DieClass = (typeof foundry !== 'undefined' && foundry.dice?.terms?.Die) 
                ? foundry.dice.terms.Die 
                : globalThis.Die;
            
            // Collect all die values (dice can be array of numbers, or array of { value }, { results }, or { values })
            const dieValues = [];
            for (const dieData of rollData.dice) {
                let value;
                if (typeof dieData === "number" && !Number.isNaN(dieData)) {
                    value = dieData;
                } else if (dieData?.value !== undefined) {
                    value = Number(dieData.value);
                } else if (dieData?.results?.length > 0) {
                    value = Number(dieData.results[0]);
                } else if (Array.isArray(dieData?.values) && dieData.values.length > 0) {
                    value = Number(dieData.values[0]);
                } else {
                    continue;
                }
                if (Number.isNaN(value)) continue;
                dieValues.push(value);
            }
            
            // Set results on each die term
            // Note: Foundry groups multiple dice of same type into one Die term
            let valueIndex = 0;
            for (const term of roll.terms) {
                if (term instanceof DieClass) {
                    // This is a Die term - set results for all dice in this term
                    const results = [];
                    const numDice = term.number || 1;
                    for (let i = 0; i < numDice && valueIndex < dieValues.length; i++) {
                        results.push({
                            result: dieValues[valueIndex],
                            active: true,
                            discarded: false
                        });
                        valueIndex++;
                    }
                    // Set results array
                    term.results = results;
                    // Mark as evaluated
                    term._evaluated = true;
                }
            }
            // Ensure roll total is set (Foundry may not recompute from terms when created this way)
            if (typeof rollData.total === "number" && !Number.isNaN(rollData.total)) {
                roll._total = rollData.total;
            }
        }
        
        // Mark roll as evaluated (results are already set, like manual entry)
        // Note: isDeterministic is read-only and calculated automatically
        roll._evaluated = true;
        // Fallback: set total from rollData if we didn't set term results (e.g. dice shape not recognized)
        if (typeof roll._total !== "number" && typeof rollData.total === "number" && !Number.isNaN(rollData.total)) {
            roll._total = rollData.total;
        }
        
        return roll;
    }
    
    /**
     * Build formula string from roll data
     */
    buildFormula(rollData) {
        const parts = [];
        for (const dieTerm of rollData.dice || []) {
            parts.push(`${dieTerm.number || dieTerm.results.length}d${dieTerm.faces}`);
        }
        return parts.join("+") || "1d6";
    }
    
    /**
     * Request a roll from RollSight
     */
    async requestRoll(_formula, _options = {}) {
        // Roll requests to the RollSight app are no longer sent; API retained for compatibility.
        return Promise.resolve(null);
    }
}

function rollHasRollSightTerms(roll) {
    const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
    const diceConfig = game?.settings?.get("core", "diceConfiguration");
    if (!diceConfig) return false;
    const Die = (typeof foundry !== 'undefined' && foundry.dice?.terms?.Die) ? foundry.dice.terms.Die : globalThis.Die;
    const PoolTerm = (typeof foundry !== 'undefined' && foundry.dice?.terms?.PoolTerm) ? foundry.dice.terms.PoolTerm : globalThis.PoolTerm;
    if (!roll?.terms || !Die) return false;
    const hasRollSight = (terms) => {
        for (const term of terms) {
            if (term instanceof Die && term.faces != null) {
                const denom = (term.denomination ?? `d${term.faces}`).toString().toLowerCase();
                const method = diceConfig[denom] ?? diceConfig[denom.toUpperCase()];
                if (method === 'rollsight') return true;
            }
            if (PoolTerm && term instanceof PoolTerm && term.rolls && Array.isArray(term.rolls)) {
                for (const inner of term.rolls) {
                    if (inner?.terms && hasRollSight(inner.terms)) return true;
                }
            }
        }
        return false;
    };
    return hasRollSight(roll.terms);
}

/** True if the roll has any die term set to "manual" in Dice Configuration (so we can force allowInteractive when replaceManualDialog is on). */
function rollHasManualTerms(roll) {
    const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
    const diceConfig = game?.settings?.get("core", "diceConfiguration");
    if (!diceConfig) return false;
    const Die = (typeof foundry !== 'undefined' && foundry.dice?.terms?.Die) ? foundry.dice.terms.Die : globalThis.Die;
    const PoolTerm = (typeof foundry !== 'undefined' && foundry.dice?.terms?.PoolTerm) ? foundry.dice.terms.PoolTerm : globalThis.PoolTerm;
    if (!roll?.terms || !Die) return false;
    const hasManual = (terms) => {
        for (const term of terms) {
            if (term instanceof Die && term.faces != null) {
                const denom = (term.denomination ?? `d${term.faces}`).toString().toLowerCase();
                const method = diceConfig[denom] ?? diceConfig[denom.toUpperCase()];
                if (method === 'manual') return true;
            }
            if (PoolTerm && term instanceof PoolTerm && term.rolls && Array.isArray(term.rolls)) {
                for (const inner of term.rolls) {
                    if (inner?.terms && hasManual(inner.terms)) return true;
                }
            }
        }
        return false;
    };
    return hasManual(roll.terms);
}

// Register fulfillment method: try setup first, then ready (CONFIG.Dice.fulfillment may be set late in v13/Forge)
const Hooks = (typeof foundry !== 'undefined' && foundry.Hooks) ? foundry.Hooks : globalThis.Hooks;
function ensureFulfillmentRegistered() {
    registerFulfillmentMethod();
}
Hooks.once('setup', ensureFulfillmentRegistered);
Hooks.once('ready', () => {
    const CONFIG = (typeof foundry !== 'undefined' && foundry.CONFIG) ? foundry.CONFIG : globalThis.CONFIG;
    // ensureFulfillmentRegistered is a no-op (we don't register RollSight as a method; only Manual is used)
});

// Register settings and create module in 'setup' so game.settings exists and our Hooks.once('ready') will fire later.
// (In 'init', game can be missing; deferring to ready then meant we registered Hooks.once('ready') after ready had already fired, so the module never ran.)
Hooks.once('setup', () => {
    try {
        registerRollSightSettings();
    } catch (err) {
        console.error("RollSight Real Dice Reader | registerRollSightSettings failed — module options will be missing:", err);
    }
});

function registerRollSightSettings() {
    const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
    if (!game?.settings) return;

    // --- This client ---
    game.settings.register("rollsight-integration", "playerActive", {
        name: "Use RollSight on this browser",
        hint: "Off: this tab will not poll the cloud or desktop bridge or apply RollSight rolls. On: normal operation. (The VTT Bridge browser extension is separate.)",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });
    game.settings.register("rollsight-integration", "desktopBridgePoll", {
        name: "Poll RollSight desktop bridge (local)",
        hint: "Use when Foundry runs in the desktop app on the same PC as RollSight. Polls the HTTP bridge (default port 8766). If enabled, this wins over cloud polling. Do not turn on together with the VTT Bridge extension on the same machine (same queue).",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });
    game.settings.register("rollsight-integration", "desktopBridgeUrl", {
        name: "Desktop bridge URL",
        hint: "Default http://127.0.0.1:8766. On Windows prefer 127.0.0.1 over localhost. Only used when “Poll RollSight desktop bridge” is on.",
        scope: "client",
        config: true,
        type: String,
        default: "http://127.0.0.1:8766"
    });

    // --- Cloud relay (Forge / no extension) ---
    game.settings.register("rollsight-integration", "cloudRoomKey", {
        name: "Cloud table (internal)",
        hint: "World relay id (short code or legacy key). Stored automatically; not shown in this form. GMs can re-link via Register cloud table if needed.",
        scope: "world",
        config: false,
        type: String,
        default: ""
    });
    game.settings.register("rollsight-integration", "cloudPlayerKey", {
        name: "RollSight app — your player code",
        hint: "Paste this into the RollSight app on this PC. It is tied to this Foundry world and your account automatically (you never need a separate table key). Copy to clipboard, or Refresh if empty.",
        scope: "client",
        config: true,
        type: String,
        default: ""
    });
    game.settings.register("rollsight-integration", "cloudRoomApiBase", {
        name: "Cloud API base URL (advanced)",
        hint: "Leave empty to use rollsight.com. Only for self-hosted or development.",
        scope: "world",
        config: true,
        type: String,
        default: ""
    });

    // --- World: dice behavior ---
    game.settings.register("rollsight-integration", "replaceManualDialog", {
        name: "Replace manual dice dialog",
        hint: "When Foundry would show manual dice entry (skills, saves, many checks), show RollSight flow instead. Set Dice Configuration to Manual for dice you want from RollSight.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });
    game.settings.register("rollsight-integration", "fallbackToChat", {
        name: "Send to chat when no roll is waiting",
        hint: "If nothing is waiting in RollResolver, post the RollSight result to chat. Off: only fulfill in-context rolls.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });
    game.settings.register("rollsight-integration", "applyRollsToInitiative", {
        name: "Apply d20 to pending initiative",
        hint: "If combat is active and you have no initiative yet, a single d20 from RollSight can apply as your initiative without rolling in Foundry.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    // --- Replay UI (client) ---
    game.settings.register("rollsight-integration", "autoExpandRollReplay", {
        name: "Auto-expand roll replay in chat",
        hint: "Open the RollSight Replay block when a message includes replay media.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });
    game.settings.register("rollsight-integration", "rollReplayRefreshEverySeconds", {
        name: "Replay retry interval (sec)",
        hint: "While a replay section is open, how often to retry loading the media if it is not ready yet.",
        scope: "client",
        config: true,
        type: Number,
        default: 3
    });
    game.settings.register("rollsight-integration", "rollReplayRefreshMaxSeconds", {
        name: "Replay retry timeout (sec)",
        hint: "Stop retrying replay loading after this many seconds.",
        scope: "client",
        config: true,
        type: Number,
        default: 20
    });

    game.settings.register("rollsight-integration", "debugLogging", {
        name: "Debug logging (console)",
        hint: "Verbose logs in the browser console (F12) for troubleshooting.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });

    const rollsight = new RollSightIntegration();
    rollsight.init();
    if (game) game.rollsight = rollsight;

    Hooks.on("renderSettingsConfig", (_app, html) => {
        try {
        const integ = game.rollsight;
        if (!integ || !game.user) return;
        const $html = $(html);

        const bindReadonlyCodeRow = ($inp) => {
            if (!$inp.length || $inp.data("rollsightReadonlyBound")) return;
            $inp.data("rollsightReadonlyBound", true);
            $inp.attr("readonly", "readonly").attr("spellcheck", "false").attr("autocomplete", "off").addClass("rollsight-readonly-code");
            $inp.on("paste", (ev) => {
                ev.preventDefault();
                return false;
            });
            const $row = $('<span class="rollsight-code-actions" style="display:inline-flex;align-items:center;gap:6px;margin-left:6px;vertical-align:middle;"></span>');
            const $copy = $(
                '<button type="button" class="rollsight-code-copy" title="Copy to clipboard"><i class="fas fa-copy"></i></button>'
            );
            $copy.on("click", async (ev) => {
                ev.preventDefault();
                const v = String($inp.val() ?? "").trim();
                if (!v) {
                    ui.notifications.warn("No player code yet — click Refresh, or wait for this world to finish loading.");
                    return;
                }
                try {
                    await navigator.clipboard.writeText(v);
                    ui.notifications.info("Copied to clipboard.");
                } catch (_e) {
                    ui.notifications.error("Could not copy — select the field and copy manually (Ctrl+C).");
                }
            });
            $row.append($copy);
            $inp.after($row);
        };

        bindReadonlyCodeRow($html.find('input[name="rollsight-integration.cloudPlayerKey"]'));

        const $playerInp = $html.find('input[name="rollsight-integration.cloudPlayerKey"]');
        const $playerRow = $playerInp.length ? $playerInp.next(".rollsight-code-actions") : $();
        if ($playerRow.length && !$playerRow.data("rollsightRefreshBound")) {
            $playerRow.data("rollsightRefreshBound", true);
            const $refresh = $(
                '<button type="button" class="rollsight-code-refresh" title="Request code from server"><i class="fas fa-sync-alt"></i></button>'
            );
            $refresh.on("click", async (ev) => {
                ev.preventDefault();
                const roomKey = (game.settings.get("rollsight-integration", "cloudRoomKey") ?? "").toString().trim();
                const hasTable =
                    integ._isShortPublicCode(roomKey) ||
                    (roomKey.startsWith("rs_") && roomKey.length >= 16 && !roomKey.startsWith("rs_u_"));
                if (!hasTable) {
                    ui.notifications.error("This world is not linked to the cloud relay yet — wait for the GM to load the game, then try Refresh.");
                    return;
                }
                try {
                    const base = integ._getCloudRoomApiBase();
                    const body = { foundry_user_id: game.user.id };
                    if (integ._isShortPublicCode(roomKey)) {
                        body.room_code = integ._normalizeShortPublicCode(roomKey);
                    } else {
                        body.room_key = roomKey;
                    }
                    const res = await fetch(`${base}/rollsight-room/player-key`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                    });
                    if (!res.ok) {
                        let err = {};
                        try {
                            err = await res.json();
                        } catch (_e) {
                            /* ignore */
                        }
                        ui.notifications.error(err?.message || err?.error || "Could not assign player code.");
                        return;
                    }
                    const data = await res.json();
                    const player_code = data.player_code || data.player_key;
                    if (!player_code) {
                        ui.notifications.error("Invalid response from server.");
                        return;
                    }
                    await game.settings.set("rollsight-integration", "cloudPlayerKey", player_code);
                    $playerInp.val(player_code);
                    ui.notifications.info("Player code updated — use Copy to paste into RollSight.");
                } catch (e) {
                    console.error(e);
                    ui.notifications.error("Could not reach RollSight server.");
                }
            });
            $playerRow.append($refresh);
        }

        if (!game.user.isGM || $html.find(".rollsight-gm-cloud-relay").length) return;
        let $anchor = $html.find('input[name="rollsight-integration.cloudRoomApiBase"]').closest(".form-group");
        if (!$anchor.length) {
            $anchor = $html.find('input[name="rollsight-integration.cloudPlayerKey"]').closest(".form-group");
        }
        if (!$anchor.length) return;
        const $wrap = $(`<div class="form-group rollsight-gm-cloud-relay"><label>Cloud table (GM)</label><p class="hint" style="margin:0.25em 0 0.5em;">The relay table is stored for this Foundry world automatically. Players never see it — they only use their personal code above. Use this if the world did not link on first load.</p><div class="form-fields"></div></div>`);
        const btn = $('<button type="button" class="rollsight-create-cloud-room"><i class="fas fa-plus"></i> Register cloud table for this world</button>');
        $wrap.find(".form-fields").append(btn);
        btn.on("click", async (ev) => {
            ev.preventDefault();
            try {
                const base = integ._getCloudRoomApiBase();
                const res = await fetch(`${base}/rollsight-room/create`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                });
                if (!res.ok) {
                    ui.notifications.error("Could not register the cloud table. Try again later.");
                    return;
                }
                const data = await res.json();
                const room_code = data.room_code || data.room_key;
                if (!room_code) {
                    ui.notifications.error("Invalid response from server.");
                    return;
                }
                await game.settings.set("rollsight-integration", "cloudRoomKey", room_code);
                ui.notifications.info("Cloud table registered for this world. Player codes can be refreshed if needed.");
            } catch (e) {
                console.error(e);
                ui.notifications.error("Could not reach RollSight server.");
            }
        });
        $anchor.after($wrap);
        } catch (err) {
            console.error("RollSight Real Dice Reader | Module settings UI hook failed:", err);
        }
    });
}

