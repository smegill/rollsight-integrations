/** RollSight client integration. Foundry owns roll evaluation, permissions and visibility. */
import { getRollClass, registerFulfillmentMethod, rollDataToFulfillmentPairs } from './fulfillment-provider.js';
import { RollSession } from './roll-session.js';
import { CloudRelay } from './cloud-relay.js';
import { ConsumerCoordinator, deliveryMessageId } from './consumer-coordinator.js';
import { buildRollReplayInjectHtml, rollReplaySerializablePayload } from './roll-proof-html.js';
import { bindReplayPreview } from './replay-preview.js';
import { correlatedReplayPayloads, mergeReplayPayloads } from './replay-correlation.js';

export const NS = 'rollsight-integration';
export const t = (key, args = {}) => game.i18n.format(`ROLLSIGHT.${key}`, args);
const notify = key => globalThis.ui?.notifications?.warn(t(key));
const shortCode = value => /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/i.test(value);
const playerCode = value => shortCode(value) || /^rs_u_.{19,}$/.test(value);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class RollSightIntegration {
    constructor() {
        this.session = new RollSession({ notify, changed: () => this.refreshPrompts(), acceptManual: () => this.setting('replaceManualDialog') });
        this.relay = new CloudRelay({ deliver: (...args) => this.deliver(...args), status: key => this.setStatus(key), checkpoint: seq => this.coordinator?.checkpoint(seq) });
        this.history = new Map();
        this.deliveryQueue = Promise.resolve();
        this.status = 'Disconnected';
        this.generation = 0;
        this.proofs = new Map();
    }
    setting(key) { return game.settings.get(NS, key); }
    get apiBase() { return String(this.setting('cloudRoomApiBase') || 'https://www.rollsight.com/api').replace(/\/$/, ''); }
    setStatus(key) {
        if (key !== this.status && ['CodeError', 'AnotherTab', 'NoTabLock'].includes(key)) notify(key);
        this.status = key;
    }
    isConnected() { return this.session.active && this.status === 'Connected'; }
    init() {
        Hooks.on('renderRollResolver', (resolver, element) => {
            if (this.session.track(resolver)) this.renderPrompt(resolver, element);
            this.refreshPrompts();
        });
        Hooks.on('closeRollResolver', resolver => this.session.remove(resolver));
        Hooks.on('closeGame', () => this.disconnect());
        window.addEventListener('pagehide', () => this.disconnect());
        window.addEventListener('message', event => {
            if (event.source !== window || event.origin !== window.location.origin || !this.setting('desktopBridgePoll')) return;
            const data = event.data;
            if (data?.type === 'rollsight-roll') void this.handleRoll(data.rollData);
            else if (data?.type === 'rollsight-amendment') void this.handleAmendment(data.amendmentData);
            else if (data?.type === 'rollsight-chat-text') void this.postChatTextFromBridge(data.text);
            else if (data?.type === 'rollsight-test') void this.sendTestMessage();
        });
        Hooks.on('preCreateChatMessage', (document, data) => {
            const payloads = this.replayPayloads(document, data);
            if (payloads.length) document.updateSource({ [`flags.${NS}.rollReplayPayloads`]: payloads });
        });
        // Midi-QOL adds attack and damage rolls to an existing item card.
        Hooks.on('preUpdateChatMessage', (document, changes) => {
            if (!Object.hasOwn(changes, 'rolls')) return;
            const payloads = this.replayPayloads(document, changes);
            if (payloads.length) changes[`flags.${NS}.rollReplayPayloads`] = payloads;
        });
        const renderReplay = (message, html) => this.renderReplay(message, html);
        Hooks.on('renderChatMessage', renderReplay);
        Hooks.on('renderChatMessageHTML', renderReplay);
        void this.connect();
    }
    disconnect() {
        this.generation++;
        this.provisionAbort?.abort();
        this.coordinator?.stop();
        this.coordinator = null;
        this.relay.stop();
        clearInterval(this.expiryTimer);
        this.session.leave();
        this.proofs.clear();
        this.history.clear();
        this.setStatus('Disconnected');
    }
    scheduleReconnect() {
        if (this.reconnectQueued) return;
        this.reconnectQueued = true;
        queueMicrotask(() => { this.reconnectQueued = false; void this.connect(); });
    }
    async connect() {
        this.disconnect();
        if (!this.setting('playerActive') || !game.user) return;
        const generation = this.generation;
        this.session.join(game.user.id);
        this.expiryTimer = setInterval(() => this.session.expire(), 1000);
        if (this.setting('desktopBridgePoll')) { this.setStatus('ExtensionReady'); return; }
        try {
            const bearer = await this._autoProvisionPlayerCodeOnly();
            if (generation !== this.generation || !bearer) return;
            const scope = await this.scopeHash([game.world?.id, game.user.id, this.apiBase, bearer]);
            if (generation !== this.generation) return;
            this.setStatus('Connecting');
            const coordinator = this.coordinator = new ConsumerCoordinator({
                socket: game.socket, scope, changed: leader => {
                    if (generation !== this.generation) return;
                    this.relay.stop();
                    if (leader) {
                        this.setStatus('Connecting');
                        void this.relay.start({ base: this.apiBase, bearer, scope,
                            sinceTime: this.session.startedAt, sinceSeq: coordinator.cursor,
                            deliveryState: busy => coordinator.setBusy(busy) });
                    } else this.setStatus('AnotherTab');
                }
            });
            coordinator.setPriority(this.session.selected ? 2 : this.session.requests.size ? 1 : 0);
            coordinator.start();
        } catch (error) {
            if (generation === this.generation) this.setStatus('CodeError');
        }
    }
    async scopeHash(parts) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
        return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    async _autoProvisionPlayerCodeOnly() {
        const room = String(this.setting('cloudRoomKey') || '').trim();
        if (!room) { this.setStatus('NotLinked'); return ''; }
        const userId = game.user.id;
        const generation = this.generation;
        this.provisionAbort?.abort();
        const controller = this.provisionAbort = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            // Always resolve by current world + user. Client settings can survive switching users.
            const body = { foundry_user_id: userId, [shortCode(room) ? 'room_code' : 'room_key']: room };
            const res = await fetch(`${this.apiBase}/rollsight-room/player-key`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
                credentials: 'omit', cache: 'no-store'
            });
            if (!res.ok) throw new Error(`Player code HTTP ${res.status}`);
            const data = await res.json();
            if (generation !== this.generation || controller.signal.aborted || userId !== game.user.id || room !== this.setting('cloudRoomKey')) return '';
            const code = String(data.player_code || data.player_key || '').trim();
            if (!playerCode(code)) throw new Error('Invalid player code response');
            await game.settings.set(NS, 'cloudPlayerKey', code);
            return code;
        } finally { clearTimeout(timeout); }
    }
    async _autoProvisionRollSightCloudRelay() {
        // Explicit GM action; settings rendering never creates cloud rooms.
        if (!game.user.isGM) return;
        if (this.setting('cloudRoomKey')) return this.connect();
        if (this.linkPromise) return this.linkPromise;
        this.linkPromise = (async () => {
            const res = await fetch(`${this.apiBase}/rollsight-room/create`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), credentials: 'omit'
            });
            if (!res.ok) throw new Error(`Link HTTP ${res.status}`);
            const data = await res.json();
            const room = data.room_code || data.room_key;
            if (!shortCode(room) && !/^rs_.{13,}$/.test(room ?? '')) throw new Error('Invalid table code response');
            if (game.user.isGM && !this.setting('cloudRoomKey')) await game.settings.set(NS, 'cloudRoomKey', room);
        })().finally(() => { this.linkPromise = null; });
        return this.linkPromise;
    }
    renderPrompt(resolver, element) {
        const root = (element?.nodeType ? element : element?.[0]) ?? resolver.element;
        if (!root?.querySelector || root.querySelector('.rollsight-native-prompt')) return;
        // Keep Foundry's native submission handler: it preserves supplied values and
        // generates only missing dice. Do not relabel the separate pause action.
        const submit = root.querySelector('button[type="submit"]');
        if (submit) {
            const icon = submit.querySelector('i');
            submit.replaceChildren(...(icon ? [icon] : []), root.ownerDocument.createTextNode(t('RollRemaining')));
            submit.setAttribute('aria-label', t('RollRemaining'));
        }
        const box = root.ownerDocument.createElement('section');
        box.className = 'rollsight-native-prompt';
        box.dir = ['ar', 'ur'].includes(game.i18n.lang) ? 'rtl' : 'ltr';
        const logo = root.ownerDocument.createElement('img');
        logo.className = 'rollsight-prompt-logo';
        logo.src = 'modules/rollsight-integration/assets/rollsight-logo.png';
        logo.alt = 'RollSight';
        box.append(logo);
        const info = root.ownerDocument.createElement('p');
        info.className = 'rollsight-request-status';
        info.setAttribute('aria-live', 'polite');
        box.append(info);
        for (const [label, action] of [['UseThisRoll', () => this.session.select(resolver)], ['StopReceiving', () => this.session.pause(resolver)]]) {
            const button = root.ownerDocument.createElement('button');
            button.type = 'button'; button.textContent = t(label); button.addEventListener('click', action); box.append(button);
        }
        (root.querySelector('.window-content') ?? root).prepend(box);
        this.refreshPrompts();
    }
    refreshPrompts() {
        this.coordinator?.setPriority(this.session.selected ? 2 : this.session.requests.size ? 1 : 0);
        if (!this.session?.active && typeof document !== 'undefined') {
            for (const el of document.querySelectorAll('.rollsight-request-status')) el.textContent = t('Disconnected');
        }
        for (const [resolver, request] of this.session?.requests ?? []) {
            const root = resolver.element?.nodeType ? resolver.element : resolver.element?.[0];
            const text = root?.querySelector?.('.rollsight-request-status');
            if (text) text.textContent = t(this.session.selected === resolver && !request.paused ? 'Waiting' : 'Paused', { formula: resolver.roll?.formula ?? '' });
        }
    }
    handleRoll(data, current = () => true) {
        const epoch = this.session.epoch;
        const work = this.deliveryQueue.then(async () => {
            if (!current() || epoch !== this.session.epoch || !this.session.accept(data)) return null;
            const pending = this.session.requests.get(this.session.selected);
            const proof = rollReplaySerializablePayload(data);
            const previousProof = pending && this.proofs.get(pending.id);
            const previousRequestId = pending?.resolver.roll?.options?.rollsightRequestId;
            const previousPayloads = pending?.resolver.roll?.options?.rollsightReplayPayloads;
            if (pending?.resolver.roll?.options && proof) {
                pending.resolver.roll.options.rollsightRequestId = pending.id;
                const payloads = mergeReplayPayloads(previousPayloads, previousProof, proof);
                pending.resolver.roll.options.rollsightReplayPayloads = payloads;
                this.proofs.set(pending.id, payloads);
            }
            const result = this.session.fulfill(data);
            if (!result.consumed && pending && proof) {
                if (previousProof) this.proofs.set(pending.id, previousProof);
                else this.proofs.delete(pending.id);
                if (pending.resolver.roll?.options) {
                    if (previousRequestId === undefined) delete pending.resolver.roll.options.rollsightRequestId;
                    else pending.resolver.roll.options.rollsightRequestId = previousRequestId;
                    if (previousPayloads === undefined) delete pending.resolver.roll.options.rollsightReplayPayloads;
                    else pending.resolver.roll.options.rollsightReplayPayloads = previousPayloads;
                }
            }
            if (result.consumed) {
                const roll = result.request.resolver.roll;
                if (roll?.options) {
                    roll.options.rollsightRequestId = result.request.id;
                    const proof = rollReplaySerializablePayload(data);
                    if (proof) this.proofs.set(result.request.id, mergeReplayPayloads(this.proofs.get(result.request.id), proof));
                    while (this.proofs.size > 100) this.proofs.delete(this.proofs.keys().next().value);
                }
                // Foundry intentionally does not auto-submit Manual inputs. Submit only
                // when every enabled die has a value, so no digital dice are generated.
                const element = result.request.resolver.element;
                const inputs = element?.querySelectorAll?.('label[data-method] > input:not(:disabled)');
                if (inputs?.length && [...inputs].some(input => input.closest('label').dataset.method === 'manual')
                    && [...inputs].every(input => input.value !== '' && input.validity.valid)) {
                    const submitter = element.querySelector('button[type="submit"]');
                    if (submitter && !submitter.disabled) element.requestSubmit(submitter);
                }
                return roll;
            }
            if (result.blocked || !this.setting('fallbackToChat')) return null;
            const roll = this.createFoundryRoll(data);
            if (!roll || epoch !== this.session.epoch) return null;
            const message = await this.postRoll(roll, data);
            if (data.roll_id && epoch === this.session.epoch) {
                this.history.set(data.roll_id, message);
                while (this.history.size > 500) this.history.delete(this.history.keys().next().value);
            }
            return roll;
        });
        this.deliveryQueue = work.catch(error => { console.error('RollSight | Delivery failed', error); notify('DeliveryError'); });
        return this.deliveryQueue;
    }
    async deliver(envelope, deliveryId, current = () => true) {
        if (!current() || !this.session.active) return;
        const meta = { _deliveryId: deliveryId, _rollsightBridgeTs: envelope.timestamp, _rollsightRoom: envelope._rollsightRoom };
        if (envelope.type === 'roll') await this.handleRoll({ ...envelope.roll, ...meta }, current);
        else if (envelope.type === 'amendment' && this.session.accept(meta)) await this.handleAmendment(envelope.amendment);
        else if (envelope.type === 'chat_text' && this.session.accept(meta)) await this.postChatTextFromBridge(envelope.content);
    }
    createFoundryRoll(data) {
        const pairs = rollDataToFulfillmentPairs(data);
        if (!pairs.length) return null;
        // Only plain physical dice in unsolicited chat. System formulas/modifiers belong to native resolvers.
        const Roll = getRollClass();
        const counts = new Map();
        for (const pair of pairs) {
            if (!counts.has(pair.denomination)) counts.set(pair.denomination, []);
            counts.get(pair.denomination).push(pair.value);
        }
        const formula = [...counts].map(([denom, values]) => `${values.length}${denom}`).join(' + ');
        const parsed = new Roll(formula).toJSON();
        // fromData is public; construct fully evaluated standard dice data without evaluating random dice.
        for (const term of parsed.terms) {
            const values = counts.get(`d${term.faces}`);
            if (!values) continue;
            term.results = values.map(result => ({ result, active: true }));
            term.evaluated = true;
        }
        parsed.evaluated = true;
        parsed.total = pairs.reduce((sum, pair) => sum + pair.value, 0);
        return Roll.fromData(parsed);
    }
    async postRoll(roll, data) {
        const ChatMessage = game.messages.documentClass;
        const mode = this.coreRollMode();
        const id = await deliveryMessageId(game.world?.id, game.user.id, data.roll_id || data._deliveryId);
        const existing = game.messages.get(id);
        if (existing) return existing;
        const messageData = await roll.toMessage({
            speaker: ChatMessage.getSpeaker(),
            flags: { [NS]: { rollId: data.roll_id, source: 'rollsight', rollReplayPayload: rollReplaySerializablePayload(data) } }
        }, Number(game.release?.generation ?? String(game.version).split('.')[0]) >= 14
            ? { messageMode: mode, create: false } : { rollMode: mode, create: false });
        messageData._id = id;
        try {
            return await ChatMessage.create(messageData, { keepId: true });
        } catch (error) {
            // Another client can win between the collection check and server create.
            // Foundry broadcasts successful creates before rejecting the duplicate ID.
            const winner = game.messages.get(id);
            if (winner) return winner;
            throw error;
        }
    }

    coreRollMode() {
        // v14 renamed rollMode to messageMode; feature detection keeps earlier generations usable.
        for (const key of ['messageMode', 'rollMode']) {
            try { const mode = game.settings.get('core', key); if (mode) return mode; } catch (_) {}
        }
        return Number(game.release?.generation ?? String(game.version).split('.')[0]) >= 14 ? 'public' : 'publicroll';
    }
    async handleAmendment(data) {
        if (!this.session.active || !data?.roll_id) return;
        const message = this.history.get(data.roll_id);
        // Amend only our own unsolicited card, never a system roll or another player's message.
        if (!message || (message.author?.id ?? message.user?.id ?? message.user) !== game.user.id || !message.isOwner) return;
        const roll = this.createFoundryRoll(data.corrected);
        if (roll) await message.update({ rolls: [roll.toJSON()] });
    }
    async postChatTextFromBridge(text) {
        if (!this.session.active || typeof text !== 'string' || !text.trim()) return;
        const ChatMessage = game.messages.documentClass;
        const data = { content: escapeHTML(text.slice(0, 10000)), speaker: ChatMessage.getSpeaker() };
        const applyMode = ChatMessage.applyMode ?? ChatMessage.applyRollMode;
        if (typeof applyMode === 'function') applyMode.call(ChatMessage, data, this.coreRollMode());
        return ChatMessage.create(data);
    }
    async sendTestMessage() { return this.postChatTextFromBridge(t('TestMessage')); }
    async requestRoll() { notify('RequestLocal'); return null; }
    replayPayloads(document, data) {
        const flags = document.flags?.[NS] ?? {};
        const existing = mergeReplayPayloads(flags.rollReplayPayloads ?? [], flags.rollReplayPayload);
        return correlatedReplayPayloads(data.rolls ?? document.rolls ?? document._source?.rolls, this.proofs, existing);
    }
    renderReplay(message, html) {
        if (message.isContentVisible === false) return;
        const root = html?.nodeType ? html : html?.[0];
        if (!root?.querySelector) return;
        const flags = message.flags?.[NS] ?? {};
        const payloads = mergeReplayPayloads(flags.rollReplayPayloads ?? [], flags.rollReplayPayload);
        const shown = new Set([...root.querySelectorAll('.rollsight-roll-replay-details')].map(el => el.dataset.rollsightProofUrl));
        for (const payload of payloads) {
            const fragment = buildRollReplayInjectHtml(payload);
            if (!fragment) continue;
            const template = root.ownerDocument.createElement('template');
            template.innerHTML = fragment;
            const details = template.content.firstElementChild;
            if (shown.has(details.dataset.rollsightProofUrl)) continue;
            shown.add(details.dataset.rollsightProofUrl);
            (root.querySelector('.message-content') ?? root).append(details);
            bindReplayPreview(details, {
                autoExpand: this.setting('autoExpandRollReplay'),
                intervalMs: Math.max(1, this.setting('rollReplayRefreshEverySeconds')) * 1000,
                maxMs: Math.min(300, Math.max(1, this.setting('rollReplayRefreshMaxSeconds'))) * 1000,
                unavailable: t('ReplayUnavailable'),
            });
        }
    }
}

Hooks.once('init', registerFulfillmentMethod);
Hooks.once('ready', () => {
    registerFulfillmentMethod();
    game.rollsight = new RollSightIntegration();
    game.rollsight.init();
});
