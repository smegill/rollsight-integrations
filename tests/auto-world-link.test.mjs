import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
const { RollSightIntegration } = await import('../rollsight-integration/rollsight.js');

const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t, { user = 'gm-a', gm = true, linked = '', extension = false, active = true } = {}) {
    const values = { cloudRoomKey: linked, cloudRoomApiBase: 'https://example.test/api',
        desktopBridgePoll: extension, playerActive: active };
    const writes = [];
    globalThis.game = {
        world: { id: 'world-a' }, user: { id: user, isGM: gm },
        users: [{ id: 'gm-a', active: true, isGM: true }, { id: 'gm-b', active: true, isGM: true }],
        settings: { get: (_ns, key) => values[key], set: async (_ns, key, value) => {
            writes.push([key, value]); values[key] = value;
        } },
        socket: { connected: true, on() {}, off() {}, emit() {} }
    };
    const integration = new RollSightIntegration();
    t.after(() => { integration._stopAutoWorldLink(); integration.disconnect(); delete globalThis.game; });
    return { integration, values, writes };
}

test('first active GM links once, even when not receiving dice; an existing link is reused', async t => {
    const { integration, values, writes } = setup(t, { active: false });
    let creates = 0;
    t.mock.method(globalThis, 'fetch', async url => {
        assert.match(url, /rollsight-room\/create$/);
        creates++;
        return { ok: true, json: async () => ({ room_code: 'ABCDEFGH' }) };
    });
    integration._startAutoWorldLink();
    integration.worldLinkCoordinator.setLeader(true);
    integration.worldLinkCoordinator.setLeader(true);
    await flush();
    assert.equal(values.cloudRoomKey, 'ABCDEFGH');
    assert.deepEqual(writes, [['cloudRoomKey', 'ABCDEFGH']]);
    assert.equal(creates, 1);
    assert.equal(integration.worldLinkCoordinator, null, 'successful link releases socket and timer');
    integration._startAutoWorldLink();
    assert.equal(integration.worldLinkCoordinator, null);
});

test('world setting update stops a waiting GM tab coordinator', t => {
    const { integration, values } = setup(t);
    let removed = 0;
    game.socket.off = () => { removed++; };
    integration._startAutoWorldLink();
    assert.ok(integration.worldLinkCoordinator?.timer);
    values.cloudRoomKey = 'ABCDEFGH';
    integration.scheduleReconnect();
    assert.equal(integration.worldLinkCoordinator, null);
    assert.equal(removed, 1);
});

test('non-GM, other active GM and extension clients never create a room', t => {
    for (const options of [{ user: 'player', gm: false }, { user: 'gm-b' }, { extension: true }, { linked: 'ABCDEFGH' }]) {
        const { integration } = setup(t, options);
        integration._startAutoWorldLink();
        assert.equal(integration.worldLinkCoordinator, undefined);
        integration.disconnect();
    }
});

test('two tabs for the elected GM coordinate before creating a room', async t => {
    const { integration: first, values } = setup(t);
    const second = new RollSightIntegration();
    t.after(() => { second._stopAutoWorldLink(); second.disconnect(); });
    const listeners = new Set();
    game.socket.on = (_channel, listener) => listeners.add(listener);
    game.socket.off = (_channel, listener) => listeners.delete(listener);
    game.socket.emit = (_channel, message) => { for (const listener of [...listeners]) listener(message); };
    let creates = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        creates++;
        return { ok: true, json: async () => ({ room_code: 'ABCDEFGH' }) };
    });
    first._startAutoWorldLink();
    second._startAutoWorldLink();
    for (const coordinator of [first.worldLinkCoordinator, second.worldLinkCoordinator]) {
        coordinator.started -= 1000;
        coordinator.candidateSince -= 1000;
        coordinator.tick();
    }
    await flush();
    assert.equal(creates, 1);
    assert.equal(values.cloudRoomKey, 'ABCDEFGH');
});

test('failed automatic link is recoverable through the manual action', async t => {
    const { integration, values } = setup(t);
    let attempts = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        attempts++;
        if (attempts === 1) throw new Error('offline');
        return { ok: true, json: async () => ({ room_code: 'ABCDEFGH' }) };
    });
    integration._startAutoWorldLink();
    integration.worldLinkCoordinator.setLeader(true);
    await flush();
    assert.equal(integration.status, 'CodeError');
    assert.equal(values.cloudRoomKey, '');
    await integration._autoProvisionRollSightCloudRelay();
    assert.equal(values.cloudRoomKey, 'ABCDEFGH');
    assert.equal(attempts, 2);
});

test('settings reconnect during player-key fetch cannot install an old session', async t => {
    const { integration, values } = setup(t, { user: 'player', gm: false, linked: 'ABCDEFGH' });
    const pending = [];
    t.mock.method(globalThis, 'fetch', (_url, options) => new Promise(resolve => {
        pending.push({ room: JSON.parse(options.body).room_code, resolve });
    }));
    const oldConnect = integration.connect();
    values.cloudRoomKey = 'HJKLMNPQ';
    integration.scheduleReconnect();
    await flush();
    assert.deepEqual(pending.map(request => request.room), ['ABCDEFGH', 'HJKLMNPQ']);
    pending[0].resolve({ ok: true, json: async () => ({ player_code: 'ABCDEFGH' }) });
    await oldConnect;
    assert.equal(integration.currentPlayerCode, '');
    assert.equal(integration.coordinator, null);
    pending[1].resolve({ ok: true, json: async () => ({ player_code: 'JKLMNPQR' }) });
    for (let attempt = 0; attempt < 20 && !integration.coordinator; attempt++) await flush();
    assert.equal(integration.currentPlayerCode, 'JKLMNPQR');
    assert.ok(integration.coordinator);
});
