import test from 'node:test';
import assert from 'node:assert/strict';
import { ObsTurnController, sceneForCombat } from '../rollsight-integration/obs-turns.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const actor = (id, hasPlayerOwner) => ({ id, hasPlayerOwner });
const combat = (id, who, started = true) => ({ id, started, active: started, combatant: who ? { actor: who } : null });
function fixture() {
    const config = { operatorUserId: 'operator', actors: { pc: 'PC Camera' }, npcScene: 'GM Camera', endScene: 'Table' };
    const settings = { obsTurnsEnabled: true, obsTurnsPaused: false, obsTurnsConfig: config };
    const calls = [], warnings = [], timers = [];
    let fail = false;
    const listeners = new Map();
    const client = {
        on: (event, listener) => listeners.set(event, listener),
        call: async (request, args) => { assert.equal(request, 'SetCurrentProgramScene'); calls.push(args.sceneName); if (fail) throw new Error('offline'); },
    };
    let api = { isOBS: () => true, getOBSWebsocketClient: async () => client };
    const game = { user: { id: 'operator' }, view: 'stream', world: { id: 'world' }, combats: { contents: [] } };
    const controller = new ObsTurnController({
        getGame: () => game, getSetting: key => settings[key], getApi: () => api,
        notify: key => warnings.push(key), setTimer: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
        clearTimer: () => {}, locks: () => ({ request: async (_key, callback) => callback() }),
    });
    return { controller, game, config, settings, client, calls, warnings, timers, listeners,
        setApi: value => api = value, setFailure: value => fail = value };
}

test('actor IDs map to scenes; unmapped players hold and NPCs use explicit fallback', () => {
    const pc = actor('pc', true), unknown = actor('other', true), npc = actor('goblin', false);
    const config = { actors: { pc: 'PC Camera' }, npcScene: 'GM Camera' };
    assert.equal(sceneForCombat(combat('a', pc), config), 'PC Camera');
    assert.equal(sceneForCombat(combat('a', unknown), config), '');
    assert.equal(sceneForCombat(combat('a', npc), config), 'GM Camera');
    assert.equal(sceneForCombat(combat('a', npc), { ...config, actors: { goblin: 'Goblin Camera' } }), 'Goblin Camera');
    assert.equal(sceneForCombat(combat('a', npc, false), config), '');
});

test('operator stream switches through start, turn, NPC, pause, resume, and encounter end once per target', async () => {
    const f = fixture(), pc = actor('pc', true), npc = actor('goblin', false);
    const encounter = combat('encounter', pc); f.game.combats.contents = [encounter]; f.game.combats.active = encounter;
    f.controller.start(); await tick(); await tick();
    assert.deepEqual(f.calls, ['PC Camera']);
    f.controller.onCombatUpdated(encounter); await tick();
    assert.deepEqual(f.calls, ['PC Camera']);
    encounter.combatant.actor = npc;
    f.controller.onCombatUpdated(encounter); await tick();
    assert.deepEqual(f.calls, ['PC Camera', 'GM Camera']);
    f.settings.obsTurnsPaused = true; f.controller.syncOwnership(); await tick();
    encounter.combatant.actor = pc; f.controller.onCombatUpdated(encounter); await tick();
    assert.deepEqual(f.calls, ['PC Camera', 'GM Camera']);
    f.settings.obsTurnsPaused = false; f.controller.syncOwnership(); await tick(); await tick();
    assert.equal(f.calls.at(-1), 'PC Camera');
    encounter.started = false; encounter.active = false; f.game.combats.active = null;
    f.controller.onCombatUpdated(encounter); await tick();
    assert.equal(f.calls.at(-1), 'Table');
    const count = f.calls.length; f.controller.onCombatDeleted(encounter); await tick();
    assert.equal(f.calls.length, count);
    f.controller.stop();
});

test('only selected OBS-mode stream may act and missing OBS Utils or locks fail closed', async () => {
    const f = fixture(); const encounter = combat('encounter', actor('pc', true)); f.game.combats.active = encounter;
    f.game.user.id = 'other'; f.controller.start(); await tick(); assert.deepEqual(f.calls, []);
    f.game.user.id = 'operator'; f.game.view = 'game'; f.controller.syncOwnership(); await tick(); assert.deepEqual(f.calls, []);
    f.game.view = 'stream'; f.setApi(null); f.controller.syncOwnership(); await tick();
    assert.deepEqual(f.calls, []); assert.deepEqual(f.warnings, ['ObsTurnsUnavailable']);
    f.controller.stop();
    const noLock = new ObsTurnController({ getGame: () => f.game, getSetting: key => f.settings[key],
        getApi: () => ({ isOBS: () => true }), locks: () => undefined, notify: key => f.warnings.push(key) });
    noLock.start(); assert.deepEqual(f.calls, []); assert.equal(f.warnings.at(-1), 'ObsTurnsNoLock'); noLock.stop();
});

test('failed scene request retries; reconnect reconciles current turn and duplicate updates deduplicate', async () => {
    const f = fixture(); const encounter = combat('encounter', actor('pc', true)); f.game.combats.active = encounter;
    f.setFailure(true); f.controller.start(); await tick(); await tick();
    assert.deepEqual(f.calls, ['PC Camera']); assert.deepEqual(f.warnings, ['ObsTurnsSwitchFailed']);
    const retry = f.timers.find(timer => timer.ms === 2000);
    assert.ok(retry);
    f.setFailure(false); retry.fn(); await tick();
    assert.deepEqual(f.calls, ['PC Camera', 'PC Camera']);
    f.controller.onCombatUpdated(encounter); f.controller.onCombatUpdated(encounter); await tick();
    assert.equal(f.calls.length, 2);
    f.listeners.get('ConnectionOpened')(); await tick();
    assert.equal(f.calls.length, 3);
    f.controller.stop();
});

test('an unrelated combat update does not replace the active encounter', async () => {
    const f = fixture();
    const selected = combat('selected', actor('pc', true));
    const unrelated = combat('unrelated', actor('goblin', false));
    f.game.combats.active = selected; f.game.combats.contents = [selected, unrelated];
    f.controller.start(); await tick(); await tick();
    f.controller.onCombatUpdated(unrelated); await tick();
    assert.equal(f.controller.lastCombatId, 'selected');
    assert.deepEqual(f.calls, ['PC Camera']);
    f.controller.stop();
});

test('pause or newer turn while the OBS client is loading prevents a stale command', async () => {
    const f = fixture();
    const encounter = combat('encounter', actor('pc', true)); f.game.combats.active = encounter;
    let resolveClient;
    f.setApi({ isOBS: () => true, getOBSWebsocketClient: () => new Promise(resolve => { resolveClient = resolve; }) });
    f.controller.start(); await tick();
    f.settings.obsTurnsPaused = true; f.controller.syncOwnership();
    resolveClient(f.client); await tick();
    assert.deepEqual(f.calls, []);
    f.controller.stop();

    const g = fixture();
    const turn = combat('encounter', actor('pc', true)); g.game.combats.active = turn;
    let resolveNext;
    g.setApi({ isOBS: () => true, getOBSWebsocketClient: () => new Promise(resolve => { resolveNext = resolve; }) });
    g.controller.start(); await tick();
    turn.combatant.actor = actor('goblin', false); g.controller.onCombatUpdated(turn);
    resolveNext(g.client); await tick();
    assert.deepEqual(g.calls, []);
    assert.equal(g.controller.lastTarget, '');
    g.controller.stop();
});

test('two OBS sources with the same operator hold one browser lock at a time', async () => {
    const first = fixture(), second = fixture();
    const encounter = combat('encounter', actor('pc', true));
    first.game.combats.active = encounter; second.game.combats.active = encounter;
    let queue = Promise.resolve();
    const locks = { request: (_name, callback) => {
        const run = queue.then(callback);
        queue = run.catch(() => {});
        return run;
    } };
    first.controller.locks = second.controller.locks = () => locks;
    first.controller.start(); second.controller.start(); await tick(); await tick();
    assert.deepEqual(first.calls, ['PC Camera']);
    assert.deepEqual(second.calls, []);
    first.controller.stop(); await tick(); await tick();
    assert.deepEqual(second.calls, ['PC Camera']);
    second.controller.stop();
});

test('a hanging OBS response times out so current state can retry', async () => {
    const f = fixture();
    f.game.combats.active = combat('encounter', actor('pc', true));
    f.client.call = () => new Promise(() => {});
    f.controller.start(); await tick();
    const timeout = f.timers.find(timer => timer.ms === 8000);
    assert.ok(timeout);
    timeout.fn(); await tick();
    assert.equal(f.controller.running, false);
    assert.equal(f.warnings.at(-1), 'ObsTurnsSwitchFailed');
    assert.ok(f.timers.some(timer => timer.ms === 2000));
    f.controller.stop();
});

test('Foundry socket disconnect suppresses turns and reconnect uses the current turn', async () => {
    const f = fixture();
    const encounter = combat('encounter', actor('pc', true)); f.game.combats.active = encounter;
    const events = new Map();
    f.game.socket = { connected: true, on: (name, handler) => events.set(name, handler), off: name => events.delete(name) };
    f.controller.start(); await tick(); await tick();
    assert.deepEqual(f.calls, ['PC Camera']);
    f.game.socket.connected = false; events.get('disconnect')();
    encounter.combatant.actor = actor('goblin', false); f.controller.onCombatUpdated(encounter); await tick();
    assert.deepEqual(f.calls, ['PC Camera']);
    f.game.socket.connected = true; events.get('connect')(); await tick(); await tick();
    assert.deepEqual(f.calls, ['PC Camera', 'GM Camera']);
    f.controller.stop(); assert.equal(events.size, 0);
});
