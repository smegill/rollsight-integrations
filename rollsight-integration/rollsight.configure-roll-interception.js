/**
 * Rollsight Real Dice Reader for Foundry VTT
 *
 * Receives physical dice rolls from Rollsight and integrates them into Foundry.
 * Uses Foundry v12+ Dice Fulfillment so rolls apply in-context (spells, attacks, saves).
 */

import { SocketHandler } from './socket-handler.js';
import { ChatHandler } from './chat-handler.js';
import { DiceHandler } from './dice-handler.js';
import {
    registerFulfillmentMethod,
    tryFulfillActiveResolver,
    rollHasRollsightTerms,
    getMethodForDenomination,
    rollDataToFulfillmentPairs
} from './fulfillment-provider.js';

class RollsightIntegration {
    constructor() {
        this.socketHandler = new SocketHandler(this);
        this.chatHandler = new ChatHandler(this);
        this.diceHandler = new DiceHandler(this);
        
        this.connected = false;
        this.rollHistory = new Map(); // Track rolls by ID for amendments
        /** When we opened RollResolver from chat /roll, so we can feed Rollsight rolls into it. */
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
        this._SENT_ROLL_STALE_MS = 60000;                   // 60s
        this._CONSUMED_STALE_MS = 60000;                    // 60s
        this._staleCleanupIntervalId = null;
    }

    /** Clear duplicate-suppression state so subsequent rolls are not suppressed (e.g. after opening a new dialog or after we've suppressed one duplicate). */
    _clearConsumedRollState() {
        this._lastConsumedRollFingerprint = null;
        this._lastConsumedRollTime = 0;
        this._lastPendingResolverCompletedAt = 0;
        this._lastPendingResolverFormula = null;
        this._lastConsumedRollFormula = null;
        this._lastConsumedRollTotal = null;
    }
    
    /**
     * Initialize the module
     */
    init() {
        console.log("Rollsight Real Dice Reader | Initializing...");
        
        // Register socket handlers
        this.socketHandler.register();
        
        // Register Hooks (using namespaced API for Foundry v13+ if available)
        const Hooks = (typeof foundry !== 'undefined' && foundry.Hooks) ? foundry.Hooks : globalThis.Hooks;
        Hooks.once('ready', () => {
            this.onReady();
            // Make API available globally (using namespaced API for Foundry v13+ if available)
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            game.rollsight = this;
            
            // Listen for messages from browser extension (via window.postMessage)
            // When RollResolver opens for a roll: optionally notify Rollsight (if URL set) and inject "Complete with Digital Rolls" button
            Hooks.on('renderRollResolver', (resolver, element, _data) => {
                this._injectCompleteWithDigitalButton(resolver, element);
            });

            window.addEventListener('message', (event) => {
                // Only accept messages from our extension or same origin
                if (event.data && event.data.type === 'rollsight-roll') {
                    console.log("Rollsight Real Dice Reader | Received roll via postMessage:", event.data.rollData);
                    this.handleRoll(event.data.rollData).catch(error => {
                        console.error("Rollsight Real Dice Reader | Error handling roll from postMessage:", error);
                    });
                } else if (event.data && event.data.type === 'rollsight-test') {
                    console.log("🎲 Rollsight Real Dice Reader | Received test message request");
                    this.sendTestMessage().catch(error => {
                        console.error("Rollsight Real Dice Reader | Error sending test message:", error);
                    });
                } else if (event.data && event.data.type === 'rollsight-amendment') {
                    console.log("Rollsight Real Dice Reader | Received amendment via postMessage:", event.data.amendmentData);
                    this.handleAmendment(event.data.amendmentData).catch(error => {
                        console.error("Rollsight Real Dice Reader | Error handling amendment from postMessage:", error);
                    });
                }
            });

            // 1) Patch Roll.evaluate so Rollsight dice always use interactive (RollResolver) path.
            this._patchRollEvaluateForRollsight();
            // 2) Intercept chat /roll so we open RollResolver when evaluate() isn't used (e.g. chat/initiative).
            this._wrapChatProcessMessage();
            // 3) Intercept "Configure Roll" (e.g. initiative) dialog Roll button so we open RollResolver instead of digital roll.
            // Use mousedown + pointerdown to intercept and open our flow; use click to block the system's handler.
            const self = this;
            if (typeof document !== 'undefined' && document.body) {
                const intercept = (ev) => self._onConfigureRollDialogClick(ev);
                document.body.addEventListener('pointerdown', intercept, true);
                document.body.addEventListener('mousedown', intercept, true);
                document.body.addEventListener('click', (ev) => {
                    if (self._shouldBlockConfigureRollClick(ev)) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation();
                    }
                }, true);
            }
        });
    }

    /**
     * Patch Roll.evaluate so that any roll with dice set to Rollsight in Dice Configuration
     * always uses allowInteractive: true, so Foundry opens RollResolver (same as manual entry).
     * Patch both base Roll and any game-system classes in CONFIG.Dice.rolls.
     */
    _patchRollEvaluateForRollsight() {
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
                const hasRollsight = rollHasRollsightTerms(this);
                if (game?.settings?.get("rollsight-integration", "debugLogging")) {
                    console.log("Rollsight Real Dice Reader | [debug] Roll.evaluate", this.formula, "hasRollsight:", hasRollsight, "allowInteractive:", options?.allowInteractive);
                }
                if (hasRollsight) {
                    options = { ...options, allowInteractive: true };
                    if (game?.settings?.get("rollsight-integration", "debugLogging")) {
                        console.log("Rollsight Real Dice Reader | [debug] Forcing allowInteractive: true for", this.formula);
                    }
                }
                return originalEvaluate.call(this, options);
            };
            RollClass.prototype._rollsightEvaluatePatched = true;
        }
        if (game?.settings?.get("rollsight-integration", "debugLogging")) {
            const CONFIG = (typeof foundry !== 'undefined' && foundry.CONFIG) ? foundry.CONFIG : globalThis.CONFIG;
            const coreDice = game?.settings?.get("core", "diceConfiguration");
            console.log("Rollsight Real Dice Reader | [debug] CONFIG.Dice.fulfillment.dice at ready:", JSON.stringify(CONFIG?.Dice?.fulfillment?.dice ?? {}));
            console.log("Rollsight Real Dice Reader | [debug] game.settings.get('core','diceConfiguration'):", coreDice);
        }
        console.log("Rollsight Real Dice Reader | Roll.evaluate patched for", rollClasses.length, "Roll class(es) (RollResolver for Rollsight dice)");
    }

    /**
     * Wrap ui.chat.processMessage so /roll <formula> opens RollResolver when Dice Config uses Rollsight.
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
                    console.log("Rollsight Real Dice Reader | [debug] Chat roll command not handled by Rollsight, passing to default:", message.slice(0, 60));
                }
                return original(message);
            } catch (err) {
                console.error("Rollsight Real Dice Reader | Chat interceptor error (falling back to default):", err);
                return original(message);
            }
        };
        console.log("Rollsight Real Dice Reader | Chat /roll and /r interceptor active");
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
     * If message is a roll command (<cmd> <formula> [# description]) and any die uses Rollsight in Dice Config,
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
        // Normalize formula: trim and collapse internal spaces (e.g. "2d20kh  +  5" -> "2d20kh + 5")
        let formula = match[2].trim().replace(/\s+/g, ' ');
        const description = match[3]?.trim() || '';

        if (description && /Rollsight/i.test(description)) {
            if (debug) console.log("Rollsight Real Dice Reader | [debug] Chat /roll skipped (Rollsight-originated)");
            return false;
        }

        const CONFIG = (typeof foundry !== 'undefined' && foundry.CONFIG) ? foundry.CONFIG : globalThis.CONFIG;
        const RollClass = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
        const RollResolverClass = RollClass?.resolverImplementation ?? (typeof foundry !== 'undefined' && foundry.applications?.dice?.RollResolver ? foundry.applications.dice.RollResolver : null);
        const rollMode = this._chatRollCommandToRollMode(rollCommand);
        if (debug) {
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const rawSetting = game?.settings?.get("core", "diceConfiguration");
            console.log("Rollsight Real Dice Reader | [debug] Chat roll check:", { command: rollCommand, rollMode, formula, hasFulfillmentDice: !!CONFIG?.Dice?.fulfillment?.dice, hasRollClass: !!RollClass, hasRollResolverClass: !!RollResolverClass, coreDiceConfig: rawSetting });
        }
        if (!RollClass || !RollResolverClass) return false;

        let roll;
        try {
            roll = RollClass.fromFormula ? RollClass.fromFormula(formula) : new RollClass(formula);
        } catch (_) {
            if (debug) console.log("Rollsight Real Dice Reader | [debug] Chat /roll parse failed for formula:", formula);
            return false;
        }

        const denominations = this._getDenominationsFromRoll(roll);
        const usesRollsight = denominations.some(denom => getMethodForDenomination(denom) === 'rollsight');
        if (debug) {
            console.log("Rollsight Real Dice Reader | [debug] Chat roll denominations:", denominations, "usesRollsight:", usesRollsight, "methods:", denominations.map(d => getMethodForDenomination(d)));
        }
        if (!usesRollsight) return false;

        if (this._handlingChatRollMessage === msg) {
            if (debug) console.log("Rollsight Real Dice Reader | [debug] Chat /roll duplicate call, skipping (already handling this message)");
            return true;
        }
        this._handlingChatRollMessage = msg;

        try {
            if (debug) console.log("Rollsight Real Dice Reader | [debug] Chat /roll opening RollResolver for", formula);
            this._pendingChatResolver = null;
            this._clearConsumedRollState();
            const resolver = new RollResolverClass({ roll });
            let resolveOutcomeForPending;
            const outcomePromise = new Promise((resolve) => { resolveOutcomeForPending = resolve; });
            this._pendingChatResolver = { resolver, roll, formula, description, rollMode, resolveOutcome: resolveOutcomeForPending, resolverNotRendered: true, consumedFingerprints: new Set() };
            this._pendingChatResolverCreatedAt = Date.now();
            // Register with Roll.RESOLVERS so Roll.registerResult() routes to this resolver (e.g. from tryFulfillActiveResolver).
            const RollClassRef = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
            if (RollClassRef?.RESOLVERS instanceof Map) {
                RollClassRef.RESOLVERS.set(roll, resolver);
                if (debug) console.log("Rollsight Real Dice Reader | [debug] Chat /roll registered resolver in Roll.RESOLVERS");
            }
            // Don't render the RollResolver window — show only our Rollsight dialog so the user sees one dialog, not two.
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;

            const fallbackDialog = this._showRollsightWaitDialog(formula, resolver, resolveOutcomeForPending, game);
            if (fallbackDialog) this._pendingChatResolver.dialog = fallbackDialog;
            if (!fallbackDialog && ui?.notifications) {
                ui.notifications.info(`Rollsight: Roll ${formula} — roll the dice in Rollsight to fill in the result.`);
            }

            // Wait only on our dialog outcome (Complete / Cancel / or handleRoll will resolve when Rollsight roll is injected).
            // Do NOT race with resolver.awaitFulfillment() — in v13 the resolver can have empty fulfillable when opened from chat, so awaitFulfillment() resolves immediately and the dialog would flash and disappear.
            const winner = await outcomePromise;

            if (fallbackDialog?.close) fallbackDialog.close();

            if (winner === "cancelled") {
                try {
                    if (typeof resolver.close === "function") await resolver.close();
                } catch (_) {}
                return true;
            }

            const fulfilledRoll = this._pendingChatResolver?.resolverNotRendered
                ? this._pendingChatResolver.roll
                : resolver.roll;
            if (fulfilledRoll?.total !== undefined) {
                const messageData = description ? { flavor: description } : {};
                const options = { rollMode: this._pendingChatResolver?.rollMode ?? 'publicroll' };
                await fulfilledRoll.toMessage(messageData, options);
            }
            try {
                if (typeof resolver.close === "function") await resolver.close();
            } catch (_) {
                // Resolver was never rendered (chat flow); close() may expect element
            }
            return true;
        } catch (err) {
            console.error("Rollsight Real Dice Reader | Chat /roll fulfillment error:", err);
            return false;
        } finally {
            if (this._pendingChatResolver?.roll) {
                const RollClassRef = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
                if (RollClassRef?.RESOLVERS instanceof Map) {
                    RollClassRef.RESOLVERS.delete(this._pendingChatResolver.roll);
                }
            }
            this._pendingChatResolver = null;
            this._handlingChatRollMessage = null;
        }
    }

    /**
     * Build a user-facing message for remaining dice (e.g. "Roll 5 more d6 in Rollsight for 8d6").
     * @param {Map<string, object>} fulfillable - resolver.fulfillable (term key -> descriptor; descriptor may have denomination)
     * @param {string} formula - e.g. "8d6"
     */
    _formatRemainingDicePrompt(fulfillable, formula) {
        if (!fulfillable || !(fulfillable instanceof Map) || fulfillable.size === 0) {
            return `Rollsight: result received. Still need more for ${formula}.`;
        }
        const n = fulfillable.size;
        const byDenom = new Map();
        for (const [, desc] of fulfillable) {
            const denom = (desc?.denomination ?? desc?.denom ?? "").toString();
            const d = denom.toLowerCase().startsWith("d") ? denom : (denom ? `d${denom}` : "d?");
            byDenom.set(d, (byDenom.get(d) || 0) + 1);
        }
        if (byDenom.size === 0) {
            return `Rollsight: Roll ${n} more dice in Rollsight for ${formula}.`;
        }
        const parts = [];
        for (const [denom, count] of byDenom) {
            parts.push(count === 1 ? `1 ${denom}` : `${count} ${denom}`);
        }
        return `Rollsight: Roll ${parts.join(", ")} more in Rollsight for ${formula}.`;
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
     * Show Foundry native "wait for Rollsight" dialog. Prefer DialogV2 (v13) to avoid V1 deprecation warning.
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
     * Update slot elements in the pending dialog from resolver.roll.terms (Pending vs value).
     * @param {object} resolver - RollResolver instance
     */
    _updatePendingDialogSlots(resolver) {
        const dialog = this._pendingChatResolver?.dialog;
        if (!dialog?.element) return;
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
                const el = dialog.element.querySelector(`[data-slot-index="${slotIndex}"]`);
                if (el) el.textContent = results[i]?.result != null ? String(results[i].result) : "Pending";
                slotIndex++;
            }
        }
    }

    _showRollsightWaitDialog(formula, resolver, resolveOutcome, game) {
        const _t = (key, fallback) => {
            const s = game.i18n?.localize?.(key);
            return (s && s !== key) ? s : fallback;
        };
        const title = _t("ROLLSIGHT.RollDialogTitle", `Rollsight: Roll ${formula}`);
        const prompt = _t("ROLLSIGHT.RollDialogPrompt", `Roll <strong>${formula}</strong> in Rollsight to fill in the result, or click below to complete with digital rolls.`);
        const labelDigital = _t("ROLLSIGHT.CompleteWithDigital", "Complete with Digital Rolls");
        const labelCancel = _t("Cancel", "Cancel");

        const slotsHtml = this._buildRollSlotHtml(resolver);
        const content = `<p class="rollsight-dialog-prompt">${prompt}</p>${slotsHtml}`;

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
     * Inject Rollsight results into the resolver's roll (merge into existing results). Does not submit.
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
            if (debug) console.log("Rollsight Real Dice Reader | [debug] inject failed: no roll.terms or no pairs");
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
            if (!placed && debug) console.log("Rollsight Real Dice Reader | [debug] inject: no matching term for", wantD, "pair value", pair.value);
        }
        for (const term of roll.terms) {
            if (!isDiceTerm(term)) continue;
            const n = Math.max(1, term.number ?? 1);
            const filled = (term.results ?? []).filter(r => r?.result != null && r?.result !== undefined).length;
            if (filled < n) allComplete = false;
        }
        if (!injected) {
            const termInfo = roll.terms?.map(t => ({ denom: this._termDenom(t), faces: t?.faces, number: t?.number })) ?? [];
            console.log("Rollsight Real Dice Reader | Injection failed: no term matched pairs. Roll terms:", termInfo, "pairs:", pairs.map(p => p.denomination + "=" + p.value));
            if (debug) console.log("Rollsight Real Dice Reader | [debug] inject: no new pairs to merge (roll.terms:", roll.terms?.length, "pairs:", pairs.length, ")");
            return { injected: false, complete: false };
        }
        // Apply term modifiers (kh, kl, etc.) so keep-highest/lowest are applied; otherwise we'd sum all results.
        for (const term of roll.terms) {
            if (!isDiceTerm(term)) continue;
            const mods = term.modifiers;
            if (Array.isArray(mods) && mods.length > 0 && typeof term._evaluateModifiers === "function") {
                try {
                    await term._evaluateModifiers();
                } catch (e) {
                    if (debug) console.log("Rollsight Real Dice Reader | [debug] _evaluateModifiers threw:", e);
                }
            }
        }
        roll._evaluated = allComplete;
        let sum = 0;
        for (const term of roll.terms) {
            // Use term.total after modifiers (only counts active/kept results); fallback to sum of active results
            let t = term.total;
            if (t === undefined || t === null) {
                const results = term.results ?? [];
                // Only count results that are not discarded (kh/kl set discarded: true on dropped dice)
                t = results.reduce((a, r) => a + (r?.discarded !== true && r?.active !== false ? (Number(r?.result) || 0) : 0), 0);
            }
            if (typeof t === "number" && !Number.isNaN(t)) sum += t;
        }
        roll._total = sum;
        return { injected: true, complete: allComplete };
    }

    /**
     * Inject Rollsight results and submit when complete (one-shot; use _injectRollIntoResolver for partial + _updatePendingDialogSlots for UI).
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
     * Inject a "Complete with Digital Rolls" button into the RollResolver dialog when there are unfulfilled terms.
     * Lets the user fill any remaining dice with Foundry's digital RNG instead of rolling more in Rollsight.
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
        btn.title = "Fill remaining dice with Foundry's digital rolls (for any Rollsight hasn't already filled).";
        btn.addEventListener("click", async () => {
            btn.disabled = true;
            btn.textContent = "Filling…";
            await this._completeResolverWithDigitalRolls(resolver);
        });

        wrap.appendChild(btn);
        const form = root.querySelector("form") ?? root.querySelector("[data-part='form']") ?? root.querySelector(".window-content");
        if (form) {
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
        console.log("Rollsight Real Dice Reader | Ready");
        
        // Periodic cleanup of stale state so connection auto-recovers (e.g. after timeout or stuck resolver)
        const CLEANUP_INTERVAL_MS = 30000; // every 30s
        this._staleCleanupIntervalId = setInterval(() => this._runStaleStateCleanup(), CLEANUP_INTERVAL_MS);
        
        // Check if we should auto-connect (using namespaced API for Foundry v13+ if available)
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const autoConnect = game.settings.get("rollsight-integration", "autoConnect");
        if (autoConnect) {
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
                if (debug) console.log("Rollsight Real Dice Reader | [debug] Clearing stale pending chat resolver (older than 5 min)");
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
                if (debug) console.log("Rollsight Real Dice Reader | [debug] Clearing stale last-sent-roll state (older than 60s)");
                this._lastSentRollFingerprint = null;
                this._lastSentRollTime = 0;
            }
            
            // Clear consumed-roll state so duplicate suppression doesn't block forever
            if (this._lastConsumedRollTime > 0 && (now - this._lastConsumedRollTime) > this._CONSUMED_STALE_MS) {
                if (debug) console.log("Rollsight Real Dice Reader | [debug] Clearing stale consumed-roll state (older than 60s)");
                this._clearConsumedRollState();
            }
        } catch (err) {
            console.error("Rollsight Real Dice Reader | Stale state cleanup error:", err);
        }
    }
    
    /**
     * Connect to Rollsight
     */
    connect() {
        this.socketHandler.connect();
    }
    
    /**
     * Disconnect from Rollsight
     */
    disconnect() {
        this.socketHandler.disconnect();
    }
    
    /**
     * Check if connected to Rollsight
     */
    isConnected() {
        return this.connected;
    }
    
    /**
     * Fingerprint for duplicate detection: formula + total (and dice values if multi-die) so we can ignore a roll that was just consumed for a pending resolver.
     * @param {object} rollData - Rollsight roll payload
     * @returns {string}
     */
    _rollFingerprint(rollData) {
        let formula = (rollData?.formula ?? "").toString().trim().toLowerCase().replace(/\s/g, "");
        // Normalize single-die formulas so "d6" and "1d6" match (bridge may send either)
        const singleDieMatch = formula.match(/^d(\d+)(p)?$/);
        if (singleDieMatch) formula = `1d${singleDieMatch[1]}${singleDieMatch[2] || ""}`;
        const total = rollData?.total;
        const dice = rollData?.dice;
        if (Array.isArray(dice) && dice.length > 0) {
            const values = dice.map(d => d?.value ?? d?.results?.[0]).filter(v => v != null);
            values.sort((a, b) => Number(a) - Number(b));
            return `${formula}|${total}|${values.join(",")}`;
        }
        return `${formula}|${total}`;
    }

    /**
     * Handle incoming roll from Rollsight.
     * If a RollResolver is active (e.g. attack/spell roll), fulfill it in-context;
     * otherwise fall back to chat.
     */
    async handleRoll(rollData) {
        console.log("Rollsight Real Dice Reader | Received roll:", rollData);

        try {
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const fallbackToChat = game?.settings?.get("rollsight-integration", "fallbackToChat") !== false;
            const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;

            const debug = game?.settings?.get("rollsight-integration", "debugLogging");

            // If pending resolver exists but its roll is already complete (e.g. completed elsewhere or stale), clear it so this roll can go to chat.
            if (this._pendingChatResolver && this._isResolverComplete(this._pendingChatResolver.resolver)) {
                if (debug) console.log("Rollsight Real Dice Reader | [debug] Pending resolver already complete; clearing so roll can fall through to chat");
                const roll = this._pendingChatResolver.roll;
                this._pendingChatResolver.resolveOutcome?.("fulfilled");
                this._pendingChatResolver = null;
                this._handlingChatRollMessage = null;
                if (roll) {
                    const RollClassRef = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll) ? foundry.dice.rolls.Roll : globalThis.Roll;
                    if (RollClassRef?.RESOLVERS instanceof Map) RollClassRef.RESOLVERS.delete(roll);
                }
            }

            // When we opened RollResolver from chat /roll, feed Rollsight roll into it (so it fulfills the waiting dialog).
            // Prefer direct injection first so we don't depend on Foundry's fulfillable map (which can be empty in v13 when resolver is opened from chat).
            if (this._pendingChatResolver) {
                let pairs = rollDataToFulfillmentPairs(rollData);
                // Fallback: if bridge sent total but no dice array (e.g. single die), infer one pair from resolver's first needed denomination
                if (pairs.length === 0 && rollData?.total != null && this._pendingChatResolver.roll?.terms?.length) {
                    const firstDenoms = this._getDenominationsFromRoll(this._pendingChatResolver.roll);
                    if (firstDenoms.length > 0) {
                        pairs = [{ denomination: firstDenoms[0], value: Number(rollData.total) }];
                        if (debug) console.log("Rollsight Real Dice Reader | [debug] Inferred 1 pair from total for", firstDenoms[0], ":", rollData.total);
                    }
                }
                console.log("Rollsight Real Dice Reader | Pending resolver for", this._pendingChatResolver.formula, "— feeding", pairs.length, "dice value(s)");
                if (debug) console.log("Rollsight Real Dice Reader | [debug] Pending chat resolver present, feeding", pairs.length, "pairs for", this._pendingChatResolver.formula);
                if (pairs.length > 0) {
                    const rollFp = this._rollFingerprint(rollData);
                    if (this._pendingChatResolver.consumedFingerprints?.has(rollFp)) {
                        if (debug) console.log("Rollsight Real Dice Reader | [debug] Ignoring duplicate roll for this resolver (already used):", rollFp);
                        return null;
                    }
                    const { injected, complete } = await this._injectRollIntoResolver(this._pendingChatResolver.resolver, pairs);
                    if (injected) {
                        this._pendingChatResolver.consumedFingerprints?.add(rollFp);
                        this._updatePendingDialogSlots(this._pendingChatResolver.resolver);
                        if (complete) {
                            if (!this._pendingChatResolver.resolverNotRendered && typeof this._pendingChatResolver.resolver.submit === "function") {
                                this._pendingChatResolver.resolver.submit();
                            }
                            this._lastConsumedRollFingerprint = this._rollFingerprint(rollData);
                            this._lastConsumedRollTime = Date.now();
                            this._lastPendingResolverCompletedAt = Date.now();
                            this._lastPendingResolverFormula = this._pendingChatResolver.formula;
                            this._lastConsumedRollFormula = (rollData?.formula ?? "").toString().trim().toLowerCase().replace(/\s/g, "");
                            this._lastConsumedRollTotal = rollData?.total != null ? Number(rollData.total) : null;
                            console.log("Rollsight Real Dice Reader | Injected roll into pending RollResolver for", this._pendingChatResolver.formula);
                            this._pendingChatResolver.resolveOutcome?.("fulfilled");
                        }
                        return null;
                    }
                    // Resolver was already complete (e.g. late roll or duplicate): clear pending so this roll can go to chat instead of being dropped
                    const resolverAlreadyComplete = this._isResolverComplete(this._pendingChatResolver.resolver);
                    if (resolverAlreadyComplete) {
                        if (debug) console.log("Rollsight Real Dice Reader | [debug] Resolver already complete; clearing pending so roll can fall through to chat");
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
                // Try resolver.registerResult as fallback when injection didn't complete (works even when resolver not rendered if API accepts it)
                const fulfillableBefore = this._pendingChatResolver.resolver?.fulfillable;
                const sizeBefore = fulfillableBefore instanceof Map ? fulfillableBefore.size : 0;
                if (debug) console.log("Rollsight Real Dice Reader | [debug] Trying registerResult fallback; fulfillable.size:", sizeBefore);
                let anyConsumed = false;
                for (const { denomination, value } of pairs) {
                    let ok = false;
                    try {
                        ok = this._pendingChatResolver.resolver.registerResult("rollsight", denomination, value);
                    } catch (e) {
                        if (debug) console.log("Rollsight Real Dice Reader | [debug] registerResult threw:", e);
                    }
                    if (debug) console.log("Rollsight Real Dice Reader | [debug] registerResult(rollsight,", denomination + ",", value + "):", ok);
                    if (ok) anyConsumed = true;
                }
                if (anyConsumed) {
                    this._updatePendingDialogSlots(this._pendingChatResolver.resolver);
                    const fulfillable = this._pendingChatResolver.resolver?.fulfillable;
                    const remaining = fulfillable instanceof Map ? fulfillable.size : 0;
                    if (remaining > 0 && ui?.notifications) {
                        const msg = this._formatRemainingDicePrompt(fulfillable, this._pendingChatResolver.formula);
                        ui.notifications.info(msg);
                    } else if (remaining === 0) {
                        this._pendingChatResolver.resolveOutcome?.("fulfilled");
                    }
                    console.log("Rollsight Real Dice Reader | Fed roll into pending RollResolver for", this._pendingChatResolver.formula);
                    return null;
                }
            }

            // Try to feed the active RollResolver (Foundry v12+; e.g. attack/spell roll opened by system).
            const consumed = tryFulfillActiveResolver(rollData);
            if (consumed) {
                console.log("Rollsight Real Dice Reader | Roll fulfilled in-context (RollResolver)");
                if (this._pendingChatResolver) {
                    const fulfillable = this._pendingChatResolver.resolver?.fulfillable;
                    const remaining = fulfillable instanceof Map ? fulfillable.size : 0;
                    if (remaining > 0 && ui?.notifications) {
                        const msg = this._formatRemainingDicePrompt(fulfillable, this._pendingChatResolver.formula);
                        ui.notifications.info(msg);
                    }
                    if (debug) console.log("Rollsight Real Dice Reader | [debug] Fed roll into pending RollResolver for", this._pendingChatResolver.formula, "remaining:", remaining);
                }
                const foundryRoll = this.createFoundryRoll(rollData);
                if (foundryRoll) this.diceHandler.animateDice(foundryRoll);
                return foundryRoll;
            }

            // No active resolver: try to apply to pending initiative (e.g. combat started, player prompted to roll but RollResolver didn't open)
            const appliedToInitiative = await this.tryApplyToPendingInitiative(rollData);
            if (appliedToInitiative) {
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
                    if (debug) console.log("Rollsight Real Dice Reader | [debug] Ignoring duplicate of last sent roll:", fingerprint);
                    return null;
                }
                this._lastSentRollFingerprint = fingerprint;
                this._lastSentRollTime = now;
                await this.sendRollAsCommand(rollData);
            } else {
                console.log("Rollsight Real Dice Reader | No pending roll and fallback disabled; roll not sent.");
            }
            return null;
            
            /* Original code - commented out for testing
            // Create Foundry Roll from roll data
            console.log("Rollsight Real Dice Reader | Creating Foundry Roll...");
            const foundryRoll = this.createFoundryRoll(rollData);
            console.log("Rollsight Real Dice Reader | Roll created:", foundryRoll.formula, "=", foundryRoll.total);
            
            // Store in history for potential amendments
            if (rollData.roll_id) {
                this.rollHistory.set(rollData.roll_id, {
                    roll: foundryRoll,
                    rollData: rollData,
                    chatMessage: null // Will be set when message is created
                });
            }
            
            // Create chat message (await to ensure it's created before continuing)
            console.log("Rollsight Real Dice Reader | Creating chat message...");
            const chatMessage = await this.chatHandler.createRollMessage(foundryRoll, rollData);
            console.log("Rollsight Real Dice Reader | Chat message created:", chatMessage.id);
            
            // Store chat message reference
            if (rollData.roll_id && this.rollHistory.has(rollData.roll_id)) {
                this.rollHistory.get(rollData.roll_id).chatMessage = chatMessage;
            }
            
            // Trigger 3D dice (after message is created)
            this.diceHandler.animateDice(foundryRoll);
            
            console.log("✅ Rollsight Real Dice Reader | Roll processed successfully and should appear in chat");
            return foundryRoll;
            */
        } catch (error) {
            console.error("❌ Rollsight Real Dice Reader | Error handling roll:", error);
            console.error("❌ Rollsight Real Dice Reader | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Send roll as /roll command in Foundry chat
     */
    async sendRollAsCommand(rollData) {
        try {
            console.log("🎲 Rollsight Real Dice Reader | Sending roll as /roll command...");
            
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
            let description = 'Rollsight Roll';
            
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
                    description = `Rollsight Roll: ${parts.join(', ')}`;
                }
            } else if (formula) {
                description = `Rollsight Roll: ${formula}`;
            }
            
            // Create /roll command: /roll [total] # [description]
            const rollCommand = `/roll ${total} # ${description}`;
            
            console.log("🎲 Rollsight Real Dice Reader | Sending roll command:", rollCommand);
            
            // Send the command to chat - Foundry will process it as a roll
            // Use ui.chat.processMessage to process the command
            const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
            if (ui && ui.chat && ui.chat.processMessage) {
                await ui.chat.processMessage(rollCommand);
                console.log("✅ Rollsight Real Dice Reader | Roll command processed successfully");
            } else {
                // Fallback: create a ChatMessage with the command as content
                const ChatMessageClass = (typeof foundry !== 'undefined' && foundry.chat?.messages?.ChatMessage)
                    ? foundry.chat.messages.ChatMessage
                    : globalThis.ChatMessage;
                
                const messageData = {
                    user: user.id,
                    speaker: ChatMessageClass.getSpeaker({ user: user }),
                    content: rollCommand
                };
                
                const message = await ChatMessageClass.create(messageData);
                console.log("✅ Rollsight Real Dice Reader | Roll command sent as message, ID:", message.id);
            }
        } catch (error) {
            console.error("❌ Rollsight Real Dice Reader | Error sending roll as command:", error);
            console.error("❌ Rollsight Real Dice Reader | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Handle roll amendment from Rollsight
     */
    async handleAmendment(amendmentData) {
        console.log("Rollsight Real Dice Reader | Received amendment:", amendmentData);
        
        const rollId = amendmentData.roll_id;
        const historyEntry = this.rollHistory.get(rollId);
        
        if (!historyEntry) {
            console.warn("Rollsight Real Dice Reader | Amendment for unknown roll:", rollId);
            return Promise.resolve(); // Return resolved promise instead of undefined
        }
        
        try {
            // Create corrected Foundry Roll
            const correctedRoll = this.createFoundryRoll(amendmentData.corrected);
            
            // Update chat message
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
            console.error("❌ Rollsight Real Dice Reader | Error handling amendment:", error);
            console.error("❌ Rollsight Real Dice Reader | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Try to find an open "Configure Roll" (or similar) dialog and apply the Rollsight d20 using its settings
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
            if (ui?.notifications) ui.notifications.info(`${combatant.name}: Initiative ${total} (Rollsight, from dialog)`);
            if (dialogApp?.close) await dialogApp.close();
            else if (dialogElement?.closest?.('.app')?.querySelector?.('.header-button.close')) dialogElement.closest('.app').querySelector('.header-button.close').click();
            console.log("Rollsight Real Dice Reader | Applied Rollsight roll from Configure Roll dialog:", combatant.name, "=", total);
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Find if the click target is inside a "Configure Roll" dialog. Returns { dialogElement, dialogApp } or null.
     */
    _findConfigureRollDialogFromClick(clickTarget) {
        if (!clickTarget || !clickTarget.closest) return null;
        const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
        const checkRoot = (root) => {
            if (!root?.querySelector) return null;
            const titleEl = root.querySelector('.window-title, [class*="title"], header h2, .dialog-title, h2');
            const title = (titleEl?.textContent ?? '').trim();
            // Match Configure Roll, Roll Config, Roll for Initiative, or any dialog with formula + adv/disadv buttons
            if (!/configure roll|roll config|roll for|initiative/i.test(title)) {
                const hasAdvBtn = root.querySelector('[data-action="advantage"]');
                const hasFormula = root.querySelector('[name="formula"], .formula, [data-formula]') || /\d*d\d+/.test(root.innerText || '');
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
     * uses Rollsight for d20, prevent the default digital roll and open RollResolver so they can roll in Rollsight.
     */
    _onConfigureRollDialogClick(ev) {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const debug = game?.settings?.get("rollsight-integration", "debugLogging");
        // Dedupe: pointerdown and mousedown both fire; only handle once per interaction
        if (ev.type === 'mousedown' && Date.now() - this._configureRollInterceptedAt < 100) return;
        // Allow interception even before combat.started (initiative often rolled when setting up combat)
        if (!game?.combat || !game.user) {
            if (debug) console.log("Rollsight Real Dice Reader | [debug] Configure Roll skip: no combat or user");
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
            if (debug) console.log("Rollsight Real Dice Reader | [debug] Configure Roll skip: no matching dialog for", btnText, dataAction);
            return;
        }
        const { dialogElement, dialogApp } = found;
        const parsed = this._parseConfigureRollDialog(dialogElement, button);
        if (!parsed) return;
        const denominations = (parsed.rollFormula.match(/\d*d\d+/gi) || []).map(s => s.toLowerCase().replace(/\d+d/, 'd'));
        const usesRollsight = denominations.some(d => getMethodForDenomination(d) === 'rollsight');
        if (!usesRollsight) return;
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
        if (debug) console.log("Rollsight Real Dice Reader | [debug] Configure Roll intercepted:", parsed.rollFormula, "for", combatant?.name);
        this._openRollResolverForConfigureRollDialog(dialogElement, dialogApp, combatant, combat, parsed).catch(err => {
            console.warn("Rollsight Real Dice Reader | Configure Roll interception error:", err);
        });
    }

    /**
     * Open RollResolver for the Configure Roll dialog formula; when Rollsight roll is fulfilled, set initiative and close dialog.
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
        const fallbackDialog = this._showRollsightWaitDialog(formula, resolver, resolveOutcomeForPending, game);
        if (fallbackDialog) this._pendingChatResolver.dialog = fallbackDialog;
        if (!fallbackDialog && ui?.notifications) {
            ui.notifications.info(`Rollsight: Roll ${formula} — roll the dice in Rollsight.`);
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
                if (ui?.notifications) ui.notifications.info(`${combatant.name}: Initiative ${total} (Rollsight)`);
                if (dialogApp?.close) await dialogApp.close();
                else if (dialogElement?.closest?.('.app')?.querySelector?.('.header-button.close')) {
                    dialogElement.closest('.app').querySelector('.header-button.close').click();
                }
                console.log("Rollsight Real Dice Reader | Initiative from Configure Roll (Rollsight):", combatant.name, "=", total);
            } catch (e) {
                console.warn("Rollsight Real Dice Reader | setInitiative failed:", e);
            }
        }
    }

    /**
     * Build initiative roll using combatant's formula (bonuses from sheet) with d20 result set to Rollsight value.
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
     * Try to apply a Rollsight roll to a pending initiative: use combatant's initiative formula (so bonuses apply),
     * inject the Rollsight d20 as the die result, show a dialog with the breakdown, then set initiative to the total.
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
                console.log("Rollsight Real Dice Reader | Applied Rollsight roll to initiative:", combatant.name, "=", finalTotal);
                const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
                if (ui?.notifications) ui.notifications.info(`${combatant.name}: Initiative ${finalTotal} (Rollsight)`);
                return true;
            } catch (err) {
                console.warn("Rollsight Real Dice Reader | Could not set initiative from Rollsight:", err);
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
                    title: game.i18n?.localize?.("ROLLSIGHT.InitiativeDialogTitle") ?? "Initiative (Rollsight)",
                    content: `
                        <p class="rollsight-initiative-breakdown">
                            <strong>${combatant.name}</strong><br>
                            ${roll.formula} = <strong>${rollResult}</strong> (d20 from Rollsight: ${built.d20Value})
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
                            label: game.i18n?.localize?.("Cancel") ?? "Cancel",
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
            console.warn("Rollsight Real Dice Reader | Could not set initiative from Rollsight:", err);
            return false;
        }
    }
    
    /**
     * Send a test chat message to verify communication works
     */
    async sendTestMessage() {
        try {
            console.log("🎲 Rollsight Real Dice Reader | Sending test chat message...");
            
            // Get Foundry classes (using namespaced API for Foundry v13+ if available)
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const ChatMessageClass = (typeof foundry !== 'undefined' && foundry.chat?.messages?.ChatMessage)
                ? foundry.chat.messages.ChatMessage
                : globalThis.ChatMessage;
            
            if (!game || !game.user) {
                throw new Error("Game or user not available");
            }
            
            const user = game.user;
            console.log("🎲 Rollsight Real Dice Reader | User:", user.name, "ID:", user.id);
            
            // Create a simple text message
            const messageData = {
                user: user.id,
                speaker: ChatMessageClass.getSpeaker({ user: user }),
                content: "<p><strong>🎲 Rollsight Test Message</strong><br/>If you see this, communication is working!</p>",
                sound: null
            };
            
            console.log("🎲 Rollsight Real Dice Reader | Creating test message with data:", messageData);
            
            const message = await ChatMessageClass.create(messageData);
            console.log("✅ Rollsight Real Dice Reader | Test message created successfully, ID:", message.id);
            return message;
        } catch (error) {
            console.error("❌ Rollsight Real Dice Reader | Error sending test message:", error);
            console.error("❌ Rollsight Real Dice Reader | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Create a Foundry Roll from Rollsight roll data
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
            
            // Collect all die values
            const dieValues = [];
            for (const dieData of rollData.dice) {
                let value;
                if (dieData.value !== undefined) {
                    value = dieData.value;
                } else if (dieData.results && dieData.results.length > 0) {
                    value = dieData.results[0];
                } else {
                    continue;
                }
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
        }
        
        // Mark roll as evaluated (results are already set, like manual entry)
        // Note: isDeterministic is read-only and calculated automatically
        roll._evaluated = true;
        
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
     * Request a roll from Rollsight (no-op; roll requests no longer sent to app)
     */
    async requestRoll(_formula, _options = {}) {
        return Promise.resolve(null);
    }
}

// Register fulfillment method: try setup first, then ready (CONFIG.Dice.fulfillment may be set late in v13/Forge)
const Hooks = (typeof foundry !== 'undefined' && foundry.Hooks) ? foundry.Hooks : globalThis.Hooks;
function ensureFulfillmentRegistered() {
    registerFulfillmentMethod();
}
Hooks.once('setup', ensureFulfillmentRegistered);
Hooks.once('ready', () => {
    const CONFIG = (typeof foundry !== 'undefined' && foundry.CONFIG) ? foundry.CONFIG : globalThis.CONFIG;
    if (CONFIG?.Dice?.fulfillment?.methods && !CONFIG.Dice.fulfillment.methods.rollsight) {
        ensureFulfillmentRegistered();
    }
});

// Register settings and create module in 'setup' so game.settings exists and our Hooks.once('ready') will fire later.
// (In 'init', game can be missing; deferring to ready then meant we registered Hooks.once('ready') after ready had already fired, so the module never ran.)
Hooks.once('setup', () => {
    registerRollsightSettings();
});

function registerRollsightSettings() {
    const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
    if (!game?.settings) return;
    game.settings.register("rollsight-integration", "debugLogging", {
        name: "Debug logging (console)",
        hint: "Log extra diagnostics to the browser console (F12) to troubleshoot Rollsight not pausing for physical dice.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });
    game.settings.register("rollsight-integration", "autoConnect", {
        name: "Auto-connect to Rollsight",
        hint: "Automatically connect to Rollsight when the game loads",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });
    game.settings.register("rollsight-integration", "fallbackToChat", {
        name: "Fallback to chat when no pending roll",
        hint: "If no RollResolver is open (e.g. no attack/spell roll waiting), send Rollsight rolls to chat. Disable to only fulfill in-context rolls.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });
    game.settings.register("rollsight-integration", "applyRollsToInitiative", {
        name: "Apply Rollsight rolls to pending initiative",
        hint: "When combat has started and a player has no initiative yet, a single d20 roll from Rollsight is applied to their initiative (so they are not forced to roll inside Foundry).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });
    // Client-scoped so players see the module in Configure Settings and know it's active for them
    game.settings.register("rollsight-integration", "playerActive", {
        name: "Rollsight Real Dice Reader (this client)",
        hint: "This module runs for all users (GM and players) when the GM enables it in Manage Modules. Use the Rollsight browser extension and Rollsight app to send physical dice rolls from this client.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });

    const rollsight = new RollsightIntegration();
    rollsight.init();
    if (game) game.rollsight = rollsight;
}

