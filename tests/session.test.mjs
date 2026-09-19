import test from 'node:test';
import assert from 'node:assert/strict';
import { RollSession } from '../rollsight-integration/roll-session.js';
import { rollDataToFulfillmentPairs, getRollClass } from '../rollsight-integration/fulfillment-provider.js';
import { normalizeRollProofUrl } from '../rollsight-integration/roll-proof-html.js';

function fixture() {
    let clock = 100000;
    const notifications = [];
    const session = new RollSession({ now: () => clock, notify: key => notifications.push(key) });
    session.join('player');
    const data = (id = 'a', value = 7, extra = {}) => ({ roll_id: id, timestamp: clock, dice: [{ shape: 'd20', value }], ...extra });
    const resolver = (number = 1, method = 'manual') => {
        const values = [];
        return {
            values, roll: { formula: `${number}d20`, options: {} },
            fulfillable: new Map([['term', { method, term: { faces: 20, number } }]]),
            registerResult(m, denom, value) {
                if (m !== method || denom !== 'd20' || values.length >= number) return false;
                values.push(value); return true;
            }
        };
    };
    return { session, data, resolver, notifications, advance: ms => clock += ms };
}
test('grouped dice expand fully; malformed deliveries never partially apply', () => {
    assert.deepEqual(rollDataToFulfillmentPairs({ dice: [{ faces: 6, results: [2, 5] }] }), [{ denomination: 'd6', value: 2 }, { denomination: 'd6', value: 5 }]);
    for (const value of [0, -1, 21, 1.5, Infinity, NaN, '7', null]) assert.deepEqual(rollDataToFulfillmentPairs({ dice: [{ shape: 'd20', value }] }), []);
    assert.deepEqual(rollDataToFulfillmentPairs({ dice: [{ shape: 'd20', value: 3 }, { shape: 'd10p', value: 90 }] }), []);
    assert.deepEqual(rollDataToFulfillmentPairs({ formula: '1d20', total: 7 }), []);
});
test('identical physical values with distinct IDs both fulfill; redelivery does not', () => {
    const { session, resolver, data } = fixture(); const r = resolver(2); session.track(r);
    assert.equal(session.accept(data()), true); assert.equal(session.fulfill(data()).consumed, true);
    assert.equal(session.accept(data()), false);
    assert.equal(session.accept(data('b')), true); session.fulfill(data('b'));
    assert.deepEqual(r.values, [7, 7]);
});
test('rerender is idempotent; concurrent identical formulas need explicit selection', () => {
    const { session, resolver, data } = fixture(); const a = resolver(), b = resolver();
    const first = session.track(a); assert.equal(session.track(a), first);
    session.track(b); assert.equal(session.selected, null);
    assert.equal(session.fulfill(data()).consumed, false);
    session.select(b); session.fulfill(data());
    assert.deepEqual(a.values, []); assert.deepEqual(b.values, [7]);
    session.remove(b); assert.equal(session.selected, null);
});
test('closing a request never sends its correlated result to another resolver or chat', () => {
    const { session, resolver, data } = fixture(); const a = resolver(), b = resolver();
    const request = session.track(a); session.remove(a); session.track(b);
    assert.deepEqual(session.fulfill(data('a', 7, { request_id: request.id })), { blocked: true, consumed: false });
    assert.deepEqual(b.values, []);
});
test('timeouts pause reception without closing or digitally completing the Foundry roll', () => {
    const { session, resolver, data, advance, notifications } = fixture(); const r = resolver(); session.track(r);
    advance(300001); session.expire(); assert.deepEqual(notifications, ['TimedOut']);
    session.fulfill(data()); assert.deepEqual(r.values, []);
    session.select(r); session.fulfill(data('b')); assert.deepEqual(r.values, [7]);
});
test('leave, rejoin and recipient boundaries reject old or foreign results', () => {
    const { session, data, advance } = fixture();
    assert.equal(session.accept(data('a', 7, { recipient_user_id: 'gm' })), false);
    const old = data(); session.leave(); assert.equal(session.accept(old), false);
    advance(10); session.join('player'); assert.equal(session.accept(old), false);
    assert.equal(session.accept(data()), true);
});
test('freshness gates reject expired, future and pre-request results', () => {
    const { session, data, resolver, advance } = fixture(); const old = data();
    advance(100); session.track(resolver()); assert.equal(session.fulfill(old).consumed, false);
    assert.equal(session.accept(data('future', 7, { timestamp: 1000000 })), false);
    assert.equal(session.accept(data('stale', 7, { timestamp: 1 })), false);
});
test('unmatched and extra dice never spill into a different request', () => {
    const { session, data, resolver } = fixture(); const a = resolver(), b = resolver(); session.track(a); session.track(b); session.select(a);
    session.fulfill(data('a', 7, { dice: [{ faces: 20, results: [7, 9] }] }));
    assert.deepEqual(a.values, [7]); assert.deepEqual(b.values, []);
    assert.equal(session.fulfill(data('b', 7, { dice: [{ shape: 'd6', value: 3 }] })).blocked, true);
});
test('Manual opt out leaves RollSight denomination handling available', () => {
    const { session, resolver } = fixture(); session.acceptManual = () => false;
    assert.equal(session.track(resolver()), undefined); assert.ok(session.track(resolver(1, 'rollsight')));
});
test('v14 namespaced Roll is preferred; v12 global remains supported', () => {
    const old = globalThis.foundry; const oldRoll = globalThis.Roll;
    globalThis.Roll = class V12 {}; globalThis.foundry = { dice: { Roll: class V14 {} } };
    assert.equal(getRollClass().name, 'V14'); delete globalThis.foundry;
    assert.equal(getRollClass().name, 'V12'); globalThis.foundry = old; globalThis.Roll = oldRoll;
});
test('replay links reject executable schemes and embedded credentials', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'http://example.com/a', 'https://user:secret@example.com/a']) assert.equal(normalizeRollProofUrl(url), '');
    assert.equal(normalizeRollProofUrl('https://www.rollsight.com/rp/test.gif'), 'https://www.rollsight.com/rp/test.gif');
});
