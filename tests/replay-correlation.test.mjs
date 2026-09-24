import test from 'node:test';
import assert from 'node:assert/strict';
import { correlatedReplayPayloads, mergeReplayPayloads } from '../rollsight-integration/replay-correlation.js';
const proof = id => ({roll_proof_url:`https://example.com/${id}.gif`,roll_proof_pending:true});
test('remote player serialized rolls preserve replay without the GM request cache', () => {
    const roll = JSON.stringify({options:{rollsightRequestId:'remote',rollsightReplayPayloads:[proof('remote')]}});
    assert.deepEqual(correlatedReplayPayloads([roll],new Map()),[proof('remote')]);
});
test('serialized initiative rolls retain exact request replay correlation', () => {
    const proofs = new Map([['request-a', [proof('a')]]]);
    const rolls = [JSON.stringify({options:{rollsightRequestId:'request-a'}})];
    assert.deepEqual(correlatedReplayPayloads(rolls, proofs), [proof('a')]);
    assert.deepEqual(correlatedReplayPayloads(['bad JSON', {options:{rollsightRequestId:'other'}}], proofs), []);
});
test('Midi card updates preserve attack replay and append damage without duplicate previews', () => {
    const proofs = new Map([['attack',[proof('a')]],['damage',[proof('b'),proof('c')]]]);
    const rolls = [{options:{rollsightRequestId:'attack'}}, {options:{rollsightRequestId:'damage'}}];
    assert.deepEqual(correlatedReplayPayloads(rolls, proofs, [proof('a')]), [proof('a'),proof('b'),proof('c')]);
    assert.deepEqual(mergeReplayPayloads(undefined, [proof('a')], proof('a')), [proof('a')]);
    assert.equal(proofs.size,2); // Multiple cards may legitimately contain the same Roll.
});
