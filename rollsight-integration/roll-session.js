import { rollDataToFulfillmentPairs, resolverMethods } from './fulfillment-provider.js';

/** Client-local ownership; no formula matching, private Roll mutation, or RNG. */
export class RollSession {
    constructor({ now = Date.now, notify = () => {}, changed = () => {}, acceptManual = () => true } = {}) {
        Object.assign(this, { now, notify, changed, acceptManual });
        this.requests = new Map();
        this.seen = new Map();
        this.active = false;
        this.selected = null;
        this.epoch = 0;
        this.serial = 0;
    }
    join(userId) {
        this.leave();
        this.active = true;
        this.userId = userId;
        this.startedAt = this.now();
        this.changed();
    }
    leave() {
        this.epoch++;
        this.active = false;
        this.requests.clear();
        this.selected = null;
        this.changed();
    }
    track(resolver) {
        if (!this.active || typeof resolver?.registerResult !== 'function' || !resolverMethods(resolver, this.acceptManual()).size) return;
        let request = this.requests.get(resolver);
        if (!request) {
            request = { id: `${this.epoch}:${++this.serial}`, resolver, createdAt: this.now(), paused: false };
            this.requests.set(resolver, request);
            // A second open resolver requires an explicit choice, even for identical formulas.
            this.selected = this.requests.size === 1 ? resolver : null;
        }
        return request;
    }
    remove(resolver) {
        this.requests.delete(resolver);
        // Never move a late result automatically into the next waiting roll.
        if (this.selected === resolver) this.selected = null;
        this.changed();
    }
    select(resolver) {
        const r = this.requests.get(resolver);
        if (!this.active || !r) return;
        r.paused = false;
        r.createdAt = this.now();
        this.selected = resolver;
        this.changed();
    }
    pause(resolver) {
        const r = this.requests.get(resolver);
        if (r) r.paused = true;
        if (this.selected === resolver) this.selected = null;
        this.changed();
    }
    expire() {
        for (const r of this.requests.values()) {
            if (!r.paused && this.now() - r.createdAt >= 300000) {
                this.pause(r.resolver);
                this.notify('TimedOut');
            }
        }
    }
    /** Delivery IDs distinguish identical legitimate rolls; fingerprints never do. */
    accept(data) {
        if (!this.active || !data || typeof data !== 'object') return false;
        const recipient = data._rollsightRoom?.recipient_user_id ?? data.recipient_user_id;
        if (recipient && recipient !== this.userId) return false;
        const ts = data._rollsightBridgeTs ?? data.timestamp;
        if (ts != null && (!Number.isFinite(ts) || ts < this.startedAt || ts > this.now() + 5000 || this.now() - ts > 60000)) return false;
        const ids = [data.roll_id && `roll:${data.roll_id}`, data._deliveryId && `event:${data._deliveryId}`].filter(Boolean);
        if (!ids.length || ids.some(id => this.seen.has(id))) return false;
        for (const id of ids) this.seen.set(id, this.now());
        while (this.seen.size > 4096) this.seen.delete(this.seen.keys().next().value);
        return true;
    }
    fulfill(data) {
        this.expire();
        const request = this.requests.get(this.selected);
        if (data.request_id && data.request_id !== request?.id) return { blocked: true, consumed: false };
        const expected = request?.resolver?.fulfillable instanceof Map
            && [...request.resolver.fulfillable.values()].some(entry => {
                const term = entry?.term ?? entry;
                return String(term?.denomination ?? `d${term?.faces ?? ''}`).toLowerCase() === 'd100';
            });
        const pairs = rollDataToFulfillmentPairs(data, { composePercentile: expected || (!request && !this.requests.size) });
        if (!pairs.length) { this.notify('InvalidDice'); return { blocked: true, consumed: false }; }
        if (!request || request.paused) {
            if (this.requests.size) this.notify('ChooseRoll');
            return { blocked: this.requests.size > 0, consumed: false };
        }
        const ts = data._rollsightBridgeTs ?? data.timestamp;
        if (ts != null && ts < request.createdAt) return { blocked: true, consumed: false };
        const methods = resolverMethods(request.resolver, this.acceptManual());
        let consumed = false;
        // A delivery is confined to this resolver. Extra values never spill into another roll or chat.
        for (const pair of pairs) {
            for (const method of methods) {
                if (request.resolver.registerResult(method, pair.denomination, pair.value) === true) {
                    consumed = true;
                    break;
                }
            }
        }
        if (!consumed) this.notify('NoMatch');
        return { blocked: true, consumed, request };
    }
}
