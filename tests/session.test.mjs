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
test('percentile components compose only for a pending d100 and retain ordinary d10s otherwise', () => {
    const percentile = { dice: [{ shape: 'd10p', value: 50 }, { shape: 'd10', value: 7 }] };
    assert.deepEqual(rollDataToFulfillmentPairs(percentile), [{ denomination: 'd10', value: 7 }]);
    assert.deepEqual(rollDataToFulfillmentPairs(percentile, { composePercentile: true }), [{ denomination: 'd100', value: 57 }]);
    assert.deepEqual(rollDataToFulfillmentPairs({ dice: [{ shape: 'd10p', value: 0 }, { shape: 'd10', value: 10 }] }, { composePercentile: true }), [{ denomination: 'd100', value: 100 }]);
});
test('a selected d100 resolver receives a percentile pair, while d10 receives its ordinary die', () => {
    const pending = (faces, denomination = `d${faces}`) => {
        const values = [];
        return { values, roll: { options: {} }, fulfillable: new Map([['term', { method: 'manual', term: { faces, denomination } }]]),
            registerResult(method, denom, value) { if (method !== 'manual' || denom !== denomination || values.length) return false; values.push(value); return true; } };
    };
    const data = { roll_id: 'percentile', timestamp: 100000, dice: [{ shape: 'd10p', value: 30 }, { shape: 'd10', value: 4 }] };
    const percentile = new RollSession({ now: () => 100000 }); percentile.join('player'); const d100 = pending(100); percentile.track(d100);
    assert.equal(percentile.fulfill(data).consumed, true); assert.deepEqual(d100.values, [34]);
    const ordinary = new RollSession({ now: () => 100000 }); ordinary.join('player'); const d10 = pending(10); ordinary.track(d10);
    assert.equal(ordinary.fulfill({ ...data, roll_id: 'ordinary' }).consumed, true); assert.deepEqual(d10.values, [4]);
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


test('a percentile pair without a resolver is allowed through to direct chat', () => {
    const {session,data} = fixture();
    assert.deepEqual(session.fulfill(data('percentile',0,{dice:[{shape:'d10p',value:0},{shape:'d10',value:10}]})),
        {blocked:false,consumed:false});
});

test('percentile composition covers every possible value and preserves leftover dice', () => {
    for (let tens=0; tens<=90; tens+=10) for (let ones=1; ones<=10; ones++) {
        const result = rollDataToFulfillmentPairs({dice:[{shape:'d10p',value:tens},{shape:'d10',value:ones}]}, {composePercentile:true});
        assert.deepEqual(result,[{denomination:'d100',value:(tens + ones % 10) || 100}]);
    }
    const result = rollDataToFulfillmentPairs({dice:[{shape:'d10p',results:[20,80]},{shape:'d10',results:[3,10,7]},{shape:'d6',value:5}]}, {composePercentile:true});
    assert.deepEqual(result,[{denomination:'d6',value:5},{denomination:'d100',value:23},{denomination:'d100',value:80},{denomination:'d10',value:7}]);
});

test('invalid or oversized percentile deliveries never partially apply', () => {
    for (const value of [-10,100,15,1.5,'30',NaN]) {
        assert.deepEqual(rollDataToFulfillmentPairs({dice:[{shape:'d6',value:2},{shape:'d10p',value},{shape:'d10',value:4}]},{composePercentile:true}),[]);
    }
    assert.deepEqual(rollDataToFulfillmentPairs({dice:[{shape:'d10p',results:[20,30]},{shape:'d10',value:1}]},{composePercentile:true}),[]);
    assert.deepEqual(rollDataToFulfillmentPairs({dice:[{shape:'d10p',results:Array(1001).fill(10)},{shape:'d10',results:Array(1001).fill(1)}]},{composePercentile:true}),[]);
});

test('excess percentile results cannot spill into another request or chat', () => {
    const {session} = fixture();
    const values=[];
    const resolver={roll:{options:{}},fulfillable:new Map([['term',{method:'manual',term:{faces:100}}]]),
        registerResult(method,denomination,value) { if(method!=='manual'||denomination!=='d100'||values.length) return false; values.push(value); return true; }};
    session.track(resolver);
    const data={dice:[{shape:'d10p',results:[30,70]},{shape:'d10',results:[4,2]}]};
    assert.equal(session.fulfill(data).consumed,true);
    assert.deepEqual(values,[34]);
    const exhausted=session.fulfill(data);
    assert.equal(exhausted.blocked,true); assert.equal(exhausted.consumed,false);
    assert.deepEqual(values,[34]);
});
