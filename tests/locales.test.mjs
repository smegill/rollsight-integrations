import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const modulePath = new URL('../rollsight-integration/', import.meta.url);
const json = name => JSON.parse(readFileSync(new URL(name, modulePath), 'utf8'));
test('all ten catalogs have translated complete templates and identical placeholders', () => {
    const manifest = json('module.json'); assert.equal(manifest.languages.length, 10);
    const english = json('lang/en.json');
    const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    for (const lang of manifest.languages) {
        const catalog = json(lang.path); assert.deepEqual(Object.keys(catalog).sort(), Object.keys(english).sort());
        for (const [key, value] of Object.entries(catalog)) {
            assert.ok(value.trim(), `${lang.lang}: ${key}`);
            assert.deepEqual(placeholders(value), placeholders(english[key]), `${lang.lang}: ${key}`);
            if (lang.lang !== 'en') assert.notEqual(value, english[key], `${lang.lang}: English fallback ${key}`);
        }
    }
    for (const file of ['rollsight.js', 'rollsight-settings.js', 'fulfillment-provider.js']) {
        const source = readFileSync(new URL(file, modulePath), 'utf8');
        for (const match of source.matchAll(/['"]ROLLSIGHT\.([A-Za-z]+)['"]/g)) assert.ok(english[match[0].slice(1,-1)]);
    }
});
