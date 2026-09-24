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
export function rollDataToFulfillmentPairs(data, { composePercentile = false } = {}) {
    if (!Array.isArray(data?.dice) || !data.dice.length || data.dice.length > 1000) return [];
    const pairs = [], percentileTens = [], tens = [];
    let valueCount = 0;
    for (const die of data.dice) {
        if (!die || typeof die !== 'object') return [];
        const shape = String(die.shape ?? `d${die.faces}`).toLowerCase();
        const denomination = shapeToDenomination(shape);
        if (!denomination && shape !== 'd10p') return [];
        const values = die.value !== undefined ? [die.value] : die.results;
        if (!Array.isArray(values) || !values.length) return [];
        for (const raw of values) {
            if (++valueCount > 1000) return [];
            const value = typeof raw === 'object' ? raw?.result : raw;
            if (shape === 'd10p') {
                if (!Number.isInteger(value) || value < 0 || value > 90 || value % 10) return [];
                percentileTens.push(value);
            } else {
                if (!Number.isInteger(value) || value < 1 || value > Number(denomination.slice(1))) return [];
                if (denomination === 'd10') tens.push(value);
                else pairs.push({ denomination, value });
            }
        }
    }
    if (composePercentile && percentileTens.length) {
        if (percentileTens.length > tens.length) return [];
        for (const value of percentileTens) {
            const ones = tens.shift();
            const digit = ones === 10 ? 0 : ones;
            pairs.push({ denomination: 'd100', value: value === 0 && digit === 0 ? 100 : value + digit });
        }
    }
    if (percentileTens.length && !composePercentile && !tens.length) return [];
    // A d10p is meaningful only with a d100 request. Do not let it invalidate
    // ordinary d10s that arrived in the same physical delivery.
    pairs.push(...tens.map(value => ({ denomination: 'd10', value })));
    if (pairs.length > 1000) return [];
    return pairs;
}

export function resolverMethods(resolver, acceptManual = true) {
    if (!(resolver?.fulfillable instanceof Map)) return new Set();
    return new Set([...resolver.fulfillable.values()].map(d => d.method)
        .filter(m => m === 'rollsight' || (acceptManual && m === 'manual')));
}

/** Describe only unfilled physical dice; Foundry owns modifiers and arithmetic. */
export function requestedPhysicalDice(resolver, acceptManual = true) {
    const counts = new Map();
    const add = (denomination, count) => {
        if (count > 0 && /^d\d+$/i.test(denomination)) counts.set(denomination, (counts.get(denomination) ?? 0) + count);
    };
    const allowed = method => method === 'rollsight' || (acceptManual && method === 'manual');
    const root = resolver.element?.nodeType ? resolver.element : resolver.element?.[0];
    const inputs = root?.querySelectorAll?.('label[data-method][data-denomination] > input');
    if (inputs?.length) {
        for (const input of inputs) {
            const label = input.closest('label');
            if (!input.disabled && input.value === '' && allowed(label.dataset.method)) add(label.dataset.denomination, 1);
        }
    } else {
        for (const { term, method } of resolver.fulfillable?.values?.() ?? []) {
            if (!term || !allowed(method)) continue;
            const results = term.results ?? [];
            const remaining = Math.max(term.number ?? 1, results.length) - results.filter(Boolean).length;
            add(String(term.denomination ?? `d${term.faces}`), remaining);
        }
    }
    return [...counts].map(([denomination, count]) => `${count}${denomination}`).join(' + ');
}
