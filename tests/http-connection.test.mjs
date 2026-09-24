import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { sha256, randomConsumerId } from '../rollsight-integration/browser-crypto.js';
import { deliveryMessageId } from '../rollsight-integration/consumer-coordinator.js';
globalThis.Hooks = { once() {}, on() {} };
const { RollSightIntegration } = await import('../rollsight-integration/rollsight.js');

function httpCrypto(t) {
    // This is the Crypto API exposed by a remote, non-secure HTTP origin.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {configurable: true, value: { getRandomValues: bytes => webcrypto.getRandomValues(bytes) }});
    t.after(() => Object.defineProperty(globalThis, 'crypto', descriptor));
}

test('HTTP SHA-256 matches native hashing across padding boundaries and UTF-8', async t => {
    httpCrypto(t);
    for (const text of ['', 'abc', '骰子 🎲 العربية', ...[55,56,63,64,65,119,120,128,1000].map(n => 'a'.repeat(n))]) {
        assert.equal(Buffer.from(await sha256(text)).toString('hex'), createHash('sha256').update(text).digest('hex'));
    }
    const ids = new Set(Array.from({length: 100}, () => randomConsumerId()));
    assert.equal(ids.size, 100);
    for (const id of ids) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('HTTP and HTTPS clients keep identical scopes and delivery IDs', async t => {
    const parts = ['world', 'player', 'https://www.rollsight.com/api', 'test-code'];
    const scope = await RollSightIntegration.prototype.scopeHash(parts);
    const delivery = await deliveryMessageId('world', 'player', 'physical-roll');
    httpCrypto(t);
    assert.equal(await RollSightIntegration.prototype.scopeHash(parts), scope);
    assert.equal(await deliveryMessageId('world', 'player', 'physical-roll'), delivery);
    assert.notEqual(await deliveryMessageId('world', 'other-player', 'physical-roll'), delivery);
});

test('remote HTTP player connects after provisioning and starts isolated reception', async t => {
    httpCrypto(t);
    const values = {playerActive: true, cloudRoomKey: 'ABCDEFGH', cloudRoomApiBase: 'https://www.rollsight.com/api'};
    const writes = [];
    globalThis.game = {user: {id: 'normal-player', isGM: false}, world: {id: 'world'},
        settings: {get: (_ns, key) => values[key], set: async (_ns, key, value) => { writes.push([key,value]); values[key]=value; }},
        socket: {connected: true, on() {}, off() {}, emit() {}}};
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
        assert.deepEqual(JSON.parse(options.body), {foundry_user_id: 'normal-player', room_code: 'ABCDEFGH'});
        return {ok: true, json: async () => ({player_code: 'JKLMNPQR'})};
    });
    const integration = new RollSightIntegration();
    const receptions = [];
    integration.relay.start = async options => { receptions.push(options); };
    try {
        await integration.connect();
        assert.ok(integration.coordinator, 'must not fall into CodeError after successful provisioning');
        assert.notEqual(integration.status, 'CodeError');
        integration.coordinator.setLeader(true);
        assert.equal(receptions.length, 1);
        assert.equal(receptions[0].bearer, 'JKLMNPQR');
        assert.equal(writes.length, 1);
        assert.equal(integration.session.userId, 'normal-player');
    } finally { integration.disconnect(); delete globalThis.game; }
});
