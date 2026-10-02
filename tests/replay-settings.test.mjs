import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('automatic replay expansion defaults off as a client setting', () => {
    let initialize;
    const registered = new Map();
    const context = {
        Hooks: { once: (_hook, callback) => { initialize = callback; }, on() {} },
        game: { settings: { register: (namespace, key, definition) => registered.set(`${namespace}.${key}`, definition) } },
    };
    const source = readFileSync(new URL('../rollsight-integration/rollsight-settings.js', import.meta.url), 'utf8');
    vm.runInNewContext(source, context);
    initialize();

    const replaySetting = registered.get('rollsight-integration.autoExpandRollReplay');
    assert.equal(replaySetting.type.name, 'Boolean');
    assert.equal(replaySetting.scope, 'client');
    assert.equal(replaySetting.default, false);
});
