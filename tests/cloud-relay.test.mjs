import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudRelay } from '../rollsight-integration/cloud-relay.js';
const response = events => ({ ok: true, json: async () => ({ events }) });
const options = { base: 'https://example.test/api', bearer: 'TESTCODE', scope: 'test-player', sinceTime: 100 };
const storage = () => { const map = new Map(); return { getItem: k => map.get(k), setItem: (k,v) => map.set(k,v) }; };

test('late response after leave cannot deliver or advance cursor', async () => {
    let resolve; const delivered = []; const store = storage();
    const relay = new CloudRelay({ storage: store, fetcher: () => new Promise(r => resolve = r), deliver: e => delivered.push(e) });
    const running = relay.start(options); relay.stop(); resolve(response([{ seq: 1, payload: { timestamp: 101 } }])); await running;
    assert.deepEqual(delivered, []); assert.equal(store.getItem('rollsight.cursor.v2.test-player'), undefined);
});
test('old generation cannot replace a new session cursor', async () => {
    const pending = []; const delivered = [];
    const relay = new CloudRelay({ storage: storage(), fetcher: () => new Promise(r => pending.push(r)), deliver: e => { delivered.push(e); relay.stop(); } });
    const first = relay.start(options); const second = relay.start({ ...options, scope: 'other-player' });
    pending[0](response([{ seq: 100, payload: { timestamp: 101, id: 'old' } }])); await first;
    pending[1](response([{ seq: 1, payload: { timestamp: 101, id: 'new' } }])); await second;
    assert.deepEqual(delivered.map(e => e.id), ['new']);
});
test('expired history and duplicate sequence numbers are acknowledged without redelivery', async () => {
    const delivered = []; const store = storage();
    const relay = new CloudRelay({ storage: store, fetcher: async () => response([
        { seq: 1, payload: { timestamp: 50 } }, { seq: 2, payload: { timestamp: 101 } }, { seq: 2, payload: { timestamp: 101 } }
    ]), deliver: (e,id) => delivered.push(id), status: key => { if (key === 'Connected') relay.stop(); } });
    await relay.start(options);
    assert.deepEqual(delivered, ['test-player:2']); assert.equal(store.getItem('rollsight.cursor.v2.test-player'), '2');
});
test('invalid player key stops polling and asks for refresh', async () => {
    const states = []; let calls = 0;
    const relay = new CloudRelay({ storage: storage(), fetcher: async () => { calls++; return { ok: false, status: 401 }; }, status: s => states.push(s) });
    await relay.start(options); assert.equal(calls, 1); assert.ok(states.includes('CodeError')); relay.stop();
});
test('delivery ownership is released only after its consumed cursor is checkpointed', async () => {
    const order = [];
    const relay = new CloudRelay({storage: storage(), fetcher: async () => response([{seq: 1, payload: {timestamp:101}}]),
        deliver: async () => order.push('delivered'), checkpoint: () => order.push('checkpoint'),
        status: key => {if (key === 'Connected') relay.stop();}});
    await relay.start({...options, deliveryState: busy => order.push(busy ? 'hold' : 'release')});
    assert.deepEqual(order, ['hold', 'delivered', 'checkpoint', 'release']);
});
