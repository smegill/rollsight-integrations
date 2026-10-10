import { rollDataToFulfillmentPairs, resolverMethods } from './fulfillment-provider.js';

function newRequestId() {
    // Roll options and chat messages can cross client boundaries. A local
    // epoch/serial is not unique when two players open simultaneous prompts.
    const random = globalThis.crypto?.randomUUID?.() ?? globalThis.foundry?.utils?.randomID?.(32);
    if (!random) throw new Error('Secure Foundry request IDs are unavailable');
    return `rs:${random}`;
}

/** Client-local ownership; no formula matching, private Roll mutation, or dice RNG. */
export class RollSession {
    constructor({ now = Date.now, notify = () => {}, changed = () => {}, acceptManual = () => true } = {}) {
        Object.assign(this, { now, notify, changed, acceptManual });
        this.requests = new Map();
        this.seen = new Map();
        this.active = false;
        this.selected = null;
        this.epoch = 0;
        this.cancelled = new Set();
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
        this.cancelled.clear();
        this.cancelledAt = null;
        this.destination = 'automatic';
        this.destinationSince = null;
        this.selected = null;
        this.changed();
    }
    track(resolver) {
        if (!this.active || typeof resolver?.registerResult !== 'function' || !resolverMethods(resolver, this.acceptManual()).size) return;
        let request = this.requests.get(resolver);
        if (!request) {
            request = { id: newRequestId(), resolver, createdAt: this.now() };
            this.requests.set(resolver, request);
            // New Foundry requests take priority, including attack-to-damage transitions.
            this.selected = resolver;
            this.changed();
        }
        return request;
    }
    remove(resolver) {
        this.requests.delete(resolver);
        if (this.selected === resolver) {
            this.selected = [...this.requests.keys()].at(-1) ?? null;
            // Reject throws made before this older request became active again.
            const next = this.requests.get(this.selected);
            if (next) next.createdAt = this.now();
        }
        this.changed();
    }
    cancel(resolver) {
        const request = this.requests.get(resolver);
        if (!request) return;
        this.cancelled.add(request.id);
        this.cancelledAt = this.now();
        this.remove(resolver);
    }
    select(resolver) {
        const r = this.requests.get(resolver);
        if (!this.active || !r) return;
        r.createdAt = this.now();
        this.selected = resolver;
        this.changed();
    }
    setDestination(destination) {
        if (!['automatic', 'chat'].includes(destination) || destination === this.destination) return;
        this.destination = destination;
        this.destinationSince = this.now();
        this.changed();
    }
    forget(data) {
        if (data.roll_id) this.seen.delete(`roll:${data.roll_id}`);
        if (data._deliveryId) this.seen.delete(`event:${data._deliveryId}`);
    }
    /** Delivery IDs distinguish identical legitimate rolls; fingerprints never do. */
    accept(data) {
        this.lastOutcome = 'DeliveryIgnored';
        if (!this.active || !data || typeof data !== 'object') return false;
        const recipient = data._rollsightRoom?.recipient_user_id ?? data.recipient_user_id;
        if (recipient && recipient !== this.userId) return false;
        const ts = data._rollsightBridgeTs ?? data.timestamp;
        // The session start and future bound exclude foreign/old rolls. A live
        // session can catch up after a long relay outage without dropping rolls.
        if (ts != null && (!Number.isFinite(ts) || ts < this.startedAt || ts > this.now() + 5000)) return false;
        const ids = [data.roll_id && `roll:${data.roll_id}`, data._deliveryId && `event:${data._deliveryId}`].filter(Boolean);
        if (!ids.length || ids.some(id => this.seen.has(id))) return false;
        for (const id of ids) this.seen.set(id, this.now());
        while (this.seen.size > 4096) this.seen.delete(this.seen.keys().next().value);
        return true;
    }
    fulfill(data) {
        this.lastOutcome = 'DeliveryIgnored';
        const ts = data._rollsightBridgeTs ?? data.timestamp;
        // Reject old in-flight dice, not every future throw after a cancellation.
        if (this.cancelledAt != null && !data.request_id && (!Number.isFinite(ts) || ts <= this.cancelledAt))
            return { blocked: true, consumed: false };
        if (this.destinationSince != null && (!Number.isFinite(ts) || ts <= this.destinationSince))
            return { blocked: true, consumed: false };
        if (data.request_id && this.cancelled.has(data.request_id)) return { blocked: true, consumed: false };
        const request = this.destination === 'chat' ? null : this.requests.get(this.selected);
        if (data.request_id && data.request_id !== request?.id) return { blocked: true, consumed: false };
        const expected = request?.resolver?.fulfillable instanceof Map
            && [...request.resolver.fulfillable.values()].some(entry => {
                const term = entry?.term ?? entry;
                return String(term?.denomination ?? `d${term?.faces ?? ''}`).toLowerCase() === 'd100';
            });
        const pairs = rollDataToFulfillmentPairs(data, { composePercentile: expected || this.destination === 'chat' || (!request && !this.requests.size) });
        if (!pairs.length) { this.lastOutcome = 'InvalidDice'; this.notify('InvalidDice'); return { blocked: true, consumed: false }; }
        if (!request) {
            const blocked = this.destination !== 'chat' && this.requests.size > 0;
            if (blocked) { this.lastOutcome = 'ChooseRoll'; this.notify('ChooseRoll'); }
            return { blocked, consumed: false };
        }
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
        this.lastOutcome = consumed ? 'DeliveryApplied' : 'NoMatch';
        if (!consumed) this.notify('NoMatch');
        return { blocked: true, consumed, request };
    }
}
