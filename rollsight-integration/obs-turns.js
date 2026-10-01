/** Optional OBS scene automation. OBS Utils owns the OBS connection. */
const NS = 'rollsight-integration';
const t = (key, args = {}) => game.i18n.format(`ROLLSIGHT.${key}`, args);
const currentConfig = () => game.settings.get(NS, 'obsTurnsConfig') || {};
const currentSetting = key => game.settings.get(NS, key);
const obsApi = () => game.modules.get('obs-utils')?.active && game.modules.get('obs-utils')?.api;
const norm = value => typeof value === 'string' ? value.trim() : '';

/** A named target is returned only when the explicit world policy maps this turn. */
export function sceneForCombat(combat, config) {
    if (!combat?.started || !combat.combatant) return '';
    const actor = combat.combatant.actor;
    if (!actor) return '';
    const mapped = norm(config?.actors?.[actor.id]);
    if (mapped) return mapped;
    const isNpc = !actor.hasPlayerOwner;
    return isNpc ? norm(config?.npcScene) : '';
}

export class ObsTurnController {
    constructor({ getGame = () => game, getApi = obsApi, getSetting = currentSetting,
        notify = (key, args) => globalThis.ui?.notifications?.warn(t(key, args)),
        setTimer = setTimeout, clearTimer = clearTimeout,
        locks = () => globalThis.navigator?.locks } = {}) {
        Object.assign(this, { getGame, getApi, getSetting, notify, setTimer, clearTimer, locks });
        this.lastTarget = '';
        this.pending = false;
        this.running = false;
        this.retryDelay = 2000;
        this.warned = new Set();
    }
    warnOnce(key, args) {
        if (this.warned.has(key)) return;
        this.warned.add(key);
        this.notify(key, args);
    }
    eligible() {
        const game = this.getGame();
        const config = this.getSetting('obsTurnsConfig') || {};
        const api = this.getApi();
        if (!this.getSetting('obsTurnsEnabled') || this.getSetting('obsTurnsPaused')) return false;
        if (!config.operatorUserId || config.operatorUserId !== game.user?.id) return false;
        if (game.view !== 'stream') return false;
        if (game.socket?.connected === false) return false;
        if (!api?.isOBS?.()) { this.warnOnce('ObsTurnsUnavailable'); return false; }
        return true;
    }
    start() {
        this.active = true;
        const socket = this.getGame().socket;
        if (!this.socketEventsBound && socket?.on) {
            this.socket = socket;
            this.onSocketDisconnect = () => this.syncOwnership();
            this.onSocketConnect = () => { this.lastTarget = ''; this.syncOwnership(); };
            socket.on('disconnect', this.onSocketDisconnect);
            socket.on('connect', this.onSocketConnect);
            this.socketEventsBound = true;
        }
        this.syncOwnership();
    }
    stop() {
        this.active = false;
        if (this.socketEventsBound) {
            this.socket.off?.('disconnect', this.onSocketDisconnect);
            this.socket.off?.('connect', this.onSocketConnect);
            this.socketEventsBound = false;
        }
        this.generation = (this.generation || 0) + 1;
        this.clearTimer(this.retryTimer);
        this.retryTimer = null;
        this.releaseLock?.();
        this.releaseLock = null;
        this.owner = false;
    }
    syncOwnership() {
        if (!this.active) return;
        if (!this.eligible()) {
            this.releaseLock?.();
            this.releaseLock = null;
            this.owner = false;
            this.generation = (this.generation || 0) + 1;
            this.clearTimer(this.retryTimer);
            this.retryTimer = null;
            return;
        }
        if (this.owner || this.waitingForLock) { this.reconcile(); return; }
        const locks = this.locks();
        if (typeof locks?.request !== 'function') {
            this.warnOnce('ObsTurnsNoLock');
            return;
        }
        this.waitingForLock = true;
        const game = this.getGame();
        const key = `rollsight-obs-turns:${game.world?.id}:${game.user.id}`;
        void locks.request(key, async () => {
            if (!this.active || !this.eligible()) return;
            this.owner = true;
            this.waitingForLock = false;
            this.lastTarget = '';
            this.reconcile();
            await new Promise(resolve => { this.releaseLock = resolve; });
            this.releaseLock = null;
            this.owner = false;
        }).catch(() => this.warnOnce('ObsTurnsNoLock')).finally(() => {
            this.waitingForLock = false;
            if (this.active && this.eligible() && !this.owner) this.scheduleRetry();
        });
    }
    findCombat() {
        const combats = this.getGame().combats;
        return combats?.active?.started ? combats.active :
            [...(combats?.contents ?? combats ?? [])].find(combat => combat.started && combat.active) ?? null;
    }
    desiredScene() {
        const config = this.getSetting('obsTurnsConfig') || {};
        const combat = this.findCombat();
        if (combat) {
            this.lastCombatId = combat.id;
            return sceneForCombat(combat, config);
        }
        return this.lastCombatId ? norm(config.endScene) : '';
    }
    onCombatDeleted(combat) {
        if (combat?.id !== this.lastCombatId) return;
        this.reconcile();
    }
    onCombatUpdated(combat) {
        // v12/v13 updateCombat and v14 combatTurnChange can both fire; reconciliation deduplicates.
        if (combat?.started && this.findCombat()?.id === combat.id) this.lastCombatId = combat.id;
        this.reconcile();
    }
    canDispatch(generation, target) {
        return generation === (this.generation || 0) && this.active && this.owner && this.eligible()
            && this.desiredScene() === target;
    }
    reconcile() {
        if (!this.active || !this.owner || !this.eligible()) return;
        this.pending = true;
        if (!this.running) void this.flush();
    }
    async flush() {
        this.running = true;
        while (this.pending && this.active && this.owner && this.eligible()) {
            this.pending = false;
            const target = this.desiredScene();
            if (!target || target === this.lastTarget) continue;
            const generation = this.generation || 0;
            try {
                const dispatched = await this.switchScene(target, generation);
                if (generation !== (this.generation || 0) || !this.active || !this.owner) break;
                if (!dispatched) continue;
                this.lastTarget = target;
                this.retryDelay = 2000;
                this.warned.delete('ObsTurnsSwitchFailed');
            } catch (error) {
                this.warnOnce('ObsTurnsSwitchFailed', { scene: target });
                console.warn('RollSight OBS turn scene switch failed', error);
                this.scheduleRetry();
            }
        }
        this.running = false;
        if (this.pending && this.active && this.owner) this.reconcile();
    }
    async switchScene(scene, generation = this.generation || 0) {
        const api = this.getApi();
        if (!api?.isOBS?.()) throw new Error('OBS Utils is unavailable in this client');
        let websocketError;
        try {
            const client = await api.getOBSWebsocketClient?.();
            if (client?.call) {
                if (client !== this.client) {
                    this.client = client;
                    client.on?.('ConnectionOpened', () => { this.lastTarget = ''; this.reconcile(); });
                    client.on?.('Identified', () => { this.lastTarget = ''; this.reconcile(); });
                    client.on?.('ConnectionClosed', () => { this.lastTarget = ''; this.scheduleRetry(); });
                }
                if (!this.canDispatch(generation, scene)) return false;
                await this.withTimeout(client.call('SetCurrentProgramScene', { sceneName: scene }), 8000);
                return true;
            }
        } catch (error) {
            websocketError = error;
        }
        const studio = globalThis.window?.obsstudio;
        if (!studio?.getControlLevel || !studio?.setCurrentScene) throw websocketError || new Error('OBS Utils has no scene control API available');
        const level = await new Promise((resolve, reject) => {
            const timer = this.setTimer(() => reject(new Error('OBS browser source control check timed out')), 1500);
            try { studio.getControlLevel(value => { this.clearTimer(timer); resolve(value); }); }
            catch (error) { this.clearTimer(timer); reject(error); }
        });
        if (level !== 4) throw new Error('OBS browser source control level is too low');
        if (!this.canDispatch(generation, scene)) return false;
        studio.setCurrentScene(scene);
        return true;
    }
    async withTimeout(promise, milliseconds) {
        let timer;
        try {
            await Promise.race([
                promise,
                new Promise((_, reject) => { timer = this.setTimer(() => reject(new Error('OBS scene request timed out')), milliseconds); }),
            ]);
        } finally { this.clearTimer(timer); }
    }
    scheduleRetry() {
        if (this.retryTimer || !this.active || !this.eligible()) return;
        const delay = this.retryDelay;
        this.retryDelay = Math.min(delay * 2, 30000);
        this.retryTimer = this.setTimer(() => {
            this.retryTimer = null;
            if (!this.owner) this.syncOwnership();
            else this.reconcile();
        }, delay);
    }
}

let panel;
const add = (parent, tag, key) => {
    const element = parent.ownerDocument.createElement(tag);
    if (key) element.textContent = t(key);
    parent.append(element);
    return element;
};
const field = (parent, key, value = '') => {
    const label = add(parent, 'label', key);
    const input = add(label, 'input');
    input.type = 'text'; input.value = value; input.dir = 'auto';
    return input;
};

export function openObsTurnPanel() {
    if (!game.user?.isGM) return;
    if (panel?.isConnected) { panel.focus(); return; }
    const doc = document;
    const dialog = panel = doc.createElement('dialog');
    dialog.className = 'rollsight-connection-panel rollsight-obs-turn-panel';
    dialog.dir = ['ar', 'ur'].includes(game.i18n.lang) ? 'rtl' : 'ltr';
    dialog.setAttribute('aria-labelledby', 'rollsight-obs-turn-title');
    const header = add(dialog, 'header');
    add(header, 'h2', 'ObsTurnsTitle').id = 'rollsight-obs-turn-title';
    const close = add(header, 'button', 'Close'); close.type = 'button'; close.onclick = () => dialog.close();
    add(dialog, 'p', 'ObsTurnsIntro');
    if (!obsApi()?.isOBS) add(dialog, 'p', 'ObsTurnsUnavailable');
    const config = currentConfig();
    const users = [...(game.users?.contents ?? game.users ?? [])];
    const actors = [...(game.actors?.contents ?? game.actors ?? [])].sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    const operatorLabel = add(dialog, 'label', 'ObsTurnsOperator');
    const operator = add(operatorLabel, 'select');
    const empty = add(operator, 'option', 'ObsTurnsChooseOperator'); empty.value = '';
    for (const user of users) { const option = add(operator, 'option'); option.value = user.id; option.textContent = user.name; }
    operator.value = config.operatorUserId ?? '';
    add(dialog, 'p', 'ObsTurnsOperatorHint');
    const pauseLabel = add(dialog, 'label', 'ObsTurnsPaused');
    const paused = add(pauseLabel, 'input'); paused.type = 'checkbox'; paused.checked = currentSetting('obsTurnsPaused');
    const npc = field(dialog, 'ObsTurnsNpcScene', config.npcScene ?? '');
    const end = field(dialog, 'ObsTurnsEndScene', config.endScene ?? '');
    add(dialog, 'h3', 'ObsTurnsMappings');
    const rows = add(dialog, 'div');
    const addRow = (id = '', scene = '') => {
        const row = add(rows, 'div'); row.className = 'rollsight-obs-turn-row';
        const actor = add(row, 'select'); actor.setAttribute('aria-label', t('ObsTurnsActor'));
        const blank = add(actor, 'option', 'ObsTurnsChooseActor'); blank.value = '';
        for (const item of actors) { const option = add(actor, 'option'); option.value = item.id; option.textContent = item.name; }
        actor.value = id;
        const name = add(row, 'input'); name.type = 'text'; name.value = scene; name.dir = 'auto';
        name.setAttribute('aria-label', t('ObsTurnsScene'));
        const remove = add(row, 'button', 'ObsTurnsRemove'); remove.type = 'button'; remove.onclick = () => row.remove();
    };
    for (const [id, scene] of Object.entries(config.actors ?? {})) if (actors.some(actor => actor.id === id)) addRow(id, scene);
    const addButton = add(dialog, 'button', 'ObsTurnsAdd'); addButton.type = 'button'; addButton.onclick = () => addRow();
    const status = add(dialog, 'p'); status.setAttribute('role', 'status');
    const save = add(dialog, 'button', 'ObsTurnsSave'); save.type = 'button';
    save.onclick = async () => {
        if (!operator.value) { status.textContent = t('ObsTurnsChooseOperator'); return; }
        const mappings = {};
        for (const row of rows.children) {
            const id = row.querySelector('select')?.value;
            const scene = norm(row.querySelector('input')?.value);
            if (id && scene) mappings[id] = scene;
        }
        save.disabled = true;
        try {
            await game.settings.set(NS, 'obsTurnsPaused', true);
            await game.settings.set(NS, 'obsTurnsConfig', { operatorUserId: operator.value, actors: mappings, npcScene: norm(npc.value), endScene: norm(end.value) });
            await game.settings.set(NS, 'obsTurnsPaused', paused.checked);
            status.textContent = t('ObsTurnsSaved');
        } catch (error) {
            status.textContent = t('ObsTurnsSaveFailed');
            console.warn('RollSight OBS turn settings save failed', error);
        } finally { save.disabled = false; }
    };
    dialog.addEventListener('close', () => { dialog.remove(); if (panel === dialog) panel = null; }, { once: true });
    doc.body.append(dialog); dialog.showModal();
}

export function mountObsTurnShortcut(app, html) {
    if (!game.user?.isGM) return;
    const root = (html?.nodeType ? html : html?.[0]) ?? (app.element?.nodeType ? app.element : app.element?.[0]);
    const settingField = root?.querySelector?.('input[name="rollsight-integration.obsTurnsEnabled"]');
    if (!settingField || root.querySelector('.rollsight-obs-turn-shortcut')) return;
    const button = root.ownerDocument.createElement('button');
    button.type = 'button'; button.className = 'rollsight-obs-turn-shortcut';
    button.textContent = t('ObsTurnsConfigure'); button.onclick = openObsTurnPanel;
    (settingField.closest('.form-group, .setting, li') ?? settingField).after(button);
}

export function registerObsTurnAutomation() {
    const controller = new ObsTurnController();
    Hooks.on('renderSettingsConfig', mountObsTurnShortcut);
    Hooks.on('combatTurnChange', combat => controller.onCombatUpdated(combat));
    Hooks.on('updateCombat', combat => controller.onCombatUpdated(combat));
    Hooks.on('deleteCombat', combat => controller.onCombatDeleted(combat));
    Hooks.on('rollsightObsTurnsSettingsChanged', () => controller.syncOwnership());
    Hooks.once('ready', () => controller.start());
    Hooks.once('streamReady', () => controller.start());
    globalThis.window?.addEventListener('pagehide', () => controller.stop());
    return controller;
}
