/** Public dice fulfillment contract shared by Foundry 12–14. */
export const getRollClass = () => globalThis.foundry?.dice?.Roll
    ?? globalThis.foundry?.dice?.rolls?.Roll ?? globalThis.Roll;

export function registerFulfillmentMethod() {
    const methods = globalThis.CONFIG?.Dice?.fulfillment?.methods;
    if (methods) methods.rollsight = { label: 'ROLLSIGHT.Method', icon: '<i class="fas fa-dice"></i>', interactive: true };
}

export function shapeToDenomination(shape) {
    const s = String(shape ?? '').toLowerCase();
    return /^d(?:4|6|8|10|12|20|100)$/.test(s) ? s : null;
}

/** Reject the entire delivery if any die is invalid. Never infer a die from a total. */
export function rollDataToFulfillmentPairs(data) {
    if (!Array.isArray(data?.dice) || !data.dice.length || data.dice.length > 1000) return [];
    const pairs = [];
    for (const die of data.dice) {
        if (!die || typeof die !== 'object') return [];
        const denomination = shapeToDenomination(die.shape ?? `d${die.faces}`);
        if (!denomination) return []; // d10p needs explicit percentile composition in the desktop.
        const values = die.value !== undefined ? [die.value] : die.results;
        if (!Array.isArray(values) || !values.length) return [];
        for (const raw of values) {
            const value = typeof raw === 'object' ? raw?.result : raw;
            if (!Number.isInteger(value) || value < 1 || value > Number(denomination.slice(1))) return [];
            pairs.push({ denomination, value });
            if (pairs.length > 1000) return [];
        }
    }
    return pairs;
}

export function resolverMethods(resolver, acceptManual = true) {
    if (!(resolver?.fulfillable instanceof Map)) return new Set();
    return new Set([...resolver.fulfillable.values()].map(d => d.method)
        .filter(m => m === 'rollsight' || (acceptManual && m === 'manual')));
}
