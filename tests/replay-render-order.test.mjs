import test from 'node:test';
import assert from 'node:assert/strict';
const hooks = new Map();
globalThis.Hooks = {once() {}, on(name, fn) { hooks.set(name, fn); }};
globalThis.window = {addEventListener() {}};
const { registerReplayViewing } = await import('../rollsight-integration/replay-viewer.js');

test('replay rendering runs again after D&D replaces a skill or damage card', () => {
    registerReplayViewing((_message, card) => { card.replay = true; });
    for (const type of ['skill', 'damage']) {
        const card = {type, replay:false};
        hooks.get('renderChatMessageHTML')({}, card);
        assert.equal(card.replay, true);
        // D&D's system.getHTML replaces .message-content after super.renderHTML.
        card.replay = false;
        hooks.get('dnd5e.renderChatMessage')?.({}, card);
        assert.equal(card.replay, true, `${type} replay survives the final system render`);
    }
});
