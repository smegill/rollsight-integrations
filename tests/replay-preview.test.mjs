import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRollReplayInjectHtml } from '../rollsight-integration/roll-proof-html.js';
import { bindReplayPreview } from '../rollsight-integration/replay-preview.js';

function fixture() {
    let clock = 0, nextId = 0;
    const timers = new Map(), probes = [];
    const image = { hidden: true, get complete() { return !this.src; } };
    const loading = { hidden: false, textContent: 'Loading replay…' };
    const details = {
        isConnected: true, dataset: { rollsightProofUrl: 'https://example.com/replay.gif' },
        querySelector: selector => selector === 'img' ? image : loading,
    };
    const stop = bindReplayPreview(details, {
        autoExpand: true, maxMs: 10000, intervalMs: 1000, unavailable: 'Unavailable',
        ImageClass: class { constructor() { probes.push(this); } }, now: () => clock,
        schedule: (fn, ms) => { timers.set(++nextId, {fn, at: clock + ms}); return nextId; },
        cancel: id => timers.delete(id),
    });
    function advance(ms) {
        clock += ms;
        for (const [id, timer] of [...timers]) if (timer.at <= clock) {
            timers.delete(id); timer.fn();
        }
    }
    advance(0);
    return { image, loading, details, probes, timers, stop, advance };
}

test('pending replay leaves no loading DOM image to block Foundry chat scrolling', () => {
    const html = buildRollReplayInjectHtml({roll_proof_url: 'https://example.com/replay.gif'});
    assert.match(html, /rollsight-replay-loading/);
    assert.doesNotMatch(html.match(/<img[^>]*>/)[0], /\bsrc=/);
    const f = fixture();
    // Foundry waitForImages filters for !img.complete. A pending off-DOM probe is excluded.
    assert.deepEqual([f.image].filter(img => !img.complete), []);
    assert.equal(f.loading.hidden, false);
    f.advance(5000);
    assert.equal(f.probes.length, 1, 'large downloads must not restart on every polling interval');
    assert.equal(f.image.src, undefined);
    f.probes[0].onload();
    assert.equal(f.image.src, f.probes[0].src);
    assert.equal(f.image.hidden, false);
    assert.equal(f.loading.hidden, true);
    assert.equal(f.timers.size, 0);
});

test('not-yet-uploaded replay retries off-DOM and eventually becomes ready', () => {
    const f = fixture();
    f.probes[0].onerror();
    f.advance(1000);
    assert.equal(f.probes.length, 2);
    assert.notEqual(f.probes[0].src, f.probes[1].src);
    assert.equal(f.image.src, undefined);
    f.probes[1].onload();
    assert.equal(f.loading.hidden, true);
});

test('a hanging replay times out without delaying the roll or accepting a late load', () => {
    const f = fixture();
    f.advance(10000);
    assert.equal(f.loading.textContent, 'Unavailable');
    assert.equal(f.image.src, undefined);
    assert.equal(f.probes[0].onload, null);
    assert.equal(f.timers.size, 0);
});

test('removed chat cards stop polling', () => {
    const f = fixture();
    f.probes[0].onerror();
    f.details.isConnected = false;
    f.advance(1000);
    assert.equal(f.timers.size, 0);
    assert.equal(f.probes.length, 1);
});
