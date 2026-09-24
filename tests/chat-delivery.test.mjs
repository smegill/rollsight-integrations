import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.Hooks = { once() {}, on() {} };
const { RollSightIntegration } = await import('../rollsight-integration/rollsight.js');

test('concurrent chat deliveries use one server document ID and preserve visibility options', async () => {
    const messages = new Map();
    const calls = [];
    messages.documentClass = {
        getSpeaker: () => ({alias: 'Test player'}),
        async create(data, options) {
            assert.equal(options.keepId, true);
            if (messages.has(data._id)) throw new Error('Duplicate document ID');
            messages.set(data._id, data); return data;
        }
    };
    globalThis.game = {world: {id:'test'}, user:{id:'player'}, release:{generation:14}, messages};
    const integration = {coreRollMode: () => 'gmroll'};
    const roll = {async toMessage(data, options) { calls.push(options); return data; }};
    const send = () => RollSightIntegration.prototype.postRoll.call(integration, roll, {roll_id:'same-physical-roll'});
    const result = await Promise.all([send(), send()]);
    assert.equal(messages.size, 1); assert.equal(result[0]._id, result[1]._id);
    assert.ok(calls.every(options => options.create === false && options.messageMode === 'gmroll'));
    await RollSightIntegration.prototype.postRoll.call(integration, roll, {roll_id:'another-physical-roll'});
    assert.equal(messages.size, 2);
});


test('percentile pair reaches direct chat as an evaluated d100, including 00 plus 10', () => {
    const oldRoll = globalThis.Roll;
    globalThis.Roll = class {
        constructor(formula) { this.formula = formula; }
        toJSON() { return {formula: this.formula, terms: [{faces: 100}]}; }
        static fromData(data) { return data; }
    };
    try {
        for (const [tens, ones, expected] of [[30,4,34],[0,10,100],[90,10,90]]) {
            const data = {dice: [{shape:'d10p',value:tens},{shape:'d10',value:ones}]};
            const roll = RollSightIntegration.prototype.createFoundryRoll.call({},data);
            assert.equal(roll.formula,'1d100');
            assert.equal(roll.total,expected);
            assert.deepEqual(roll.terms[0].results,[{result:expected,active:true}]);
            assert.equal(roll.evaluated,true);
        }
    } finally { globalThis.Roll = oldRoll; }
});
