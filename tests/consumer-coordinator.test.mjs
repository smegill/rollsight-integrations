import test from 'node:test';
import assert from 'node:assert/strict';
import { ConsumerCoordinator, deliveryMessageId } from '../rollsight-integration/consumer-coordinator.js';

function fixture() {
    let now = 1000;
    const listeners = new Set();
    const clients = [];
    function client(id, scope = 'world/player') {
        const states = [];
        const socket = { connected: true, on: (_name, fn) => listeners.add(fn),
            off: (_name, fn) => listeners.delete(fn),
            emit: (_name, data) => { for (const fn of [...listeners]) fn(data); } };
        const c = new ConsumerCoordinator({ socket, id, scope, changed: v => states.push(v), now: () => now, autoTick: false });
        clients.push(c); c.start(); return { c, states, socket };
    }
    const advance = ms => { now += ms; clients.forEach(c => c.tick()); };
    return { client, advance };
}
test('separate browser contexts elect only one cloud consumer', () => {
    const f = fixture(), a = f.client('a'), b = f.client('b');
    assert.equal(a.c.leader, false); assert.equal(b.c.leader, false);
    f.advance(500);
    assert.equal(a.c.leader, true); assert.equal(b.c.leader, false);
});
test('waiting native resolver takes ownership from unsolicited chat window', () => {
    const f = fixture(), a = f.client('a'), b = f.client('b'); f.advance(500);
    b.c.setPriority(2);
    assert.equal(a.c.leader, false); assert.equal(b.c.leader, false);
    f.advance(500);
    assert.equal(a.c.leader, false); assert.equal(b.c.leader, true);
});
test('handoff carries the processed cursor; closing a client releases ownership', () => {
    const f = fixture(), a = f.client('a'), b = f.client('b'); f.advance(500);
    a.c.checkpoint(19); assert.equal(b.c.cursor, 19);
    a.c.stop(); f.advance(500); assert.equal(b.c.leader, true);
});
test('a disconnected socket cannot keep receiving dice and peers recover', () => {
    const f = fixture(), a = f.client('a'), b = f.client('b'); f.advance(500);
    a.socket.connected = false; f.advance(1); assert.equal(a.c.leader, false);
    f.advance(7000); f.advance(500); assert.equal(b.c.leader, true);
});
test('different players do not block one another', () => {
    const f = fixture(), a = f.client('a', 'one'), b = f.client('b', 'two'); f.advance(500);
    assert.equal(a.c.leader, true); assert.equal(b.c.leader, true);
});
test('stable chat IDs deduplicate physical delivery, not equal dice values', async () => {
    const id = await deliveryMessageId('world', 'player', 'roll-1');
    assert.match(id, /^[A-Za-z0-9]{16}$/);
    assert.equal(await deliveryMessageId('world', 'player', 'roll-1'), id);
    assert.notEqual(await deliveryMessageId('world', 'player', 'roll-2'), id);
    assert.notEqual(await deliveryMessageId('world', 'other', 'roll-1'), id);
});
test('finishing a native roll retains ownership until its cursor is shared', () => {
    const f = fixture(), a = f.client('a'), b = f.client('b');
    b.c.setPriority(2); f.advance(500);
    assert.equal(b.c.leader, true);
    b.c.setBusy(true);
    b.c.setPriority(0); // Native resolver closed while the delivery is finishing.
    f.advance(500);
    assert.equal(b.c.leader, true); assert.equal(a.c.leader, false);
    b.c.checkpoint(27);
    b.c.setBusy(false); f.advance(500);
    assert.equal(a.c.leader, true); assert.equal(a.c.cursor, 27);
});
