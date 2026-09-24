import { sha256, randomConsumerId } from './browser-crypto.js';

/** Coordinate a player's receivers through Foundry, across browsers and the desktop client. */
export class ConsumerCoordinator {
    constructor({ socket, scope, changed, id = randomConsumerId(), now = Date.now, autoTick = true }) {
        Object.assign(this, { socket, scope, changed, id, now, autoTick });
        this.peers = new Map();
        this.priority = 0;
        this.cursor = 0;
        this.leader = false;
        this.channel = 'module.rollsight-integration';
        this.receive = data => this.onMessage(data);
    }
    start() {
        this.active = true;
        this.started = this.now();
        this.socket.on(this.channel, this.receive);
        this.announce('hello');
        this.tick();
        if (this.autoTick) this.timer = setInterval(() => this.tick(), 250);
    }
    stop() {
        if (!this.active) return;
        this.announce('bye');
        this.active = false;
        clearInterval(this.timer);
        this.socket.off(this.channel, this.receive);
        this.setLeader(false);
    }
    announce(kind = 'presence') {
        this.lastAnnounced = this.now();
        this.socket.emit(this.channel, { type: 'rollsight-consumer-v1', scope: this.scope,
            id: this.id, kind, priority: this.effectivePriority(), cursor: this.cursor });
    }
    onMessage(data) {
        if (!this.active || data?.type !== 'rollsight-consumer-v1' || data.scope !== this.scope
            || typeof data.id !== 'string' || data.id === this.id) return;
        if (data.kind === 'bye') this.peers.delete(data.id);
        else {
            if (!['hello', 'presence', 'cursor'].includes(data.kind)
                || ![0, 1, 2, 3].includes(data.priority) || !Number.isSafeInteger(data.cursor) || data.cursor < 0) return;
            this.peers.set(data.id, { id: data.id, priority: data.priority, seen: this.now() });
            this.cursor = Math.max(this.cursor, data.cursor);
            if (data.kind === 'hello') this.announce();
        }
        this.tick();
    }
    setPriority(priority) {
        if (priority === this.priority) return;
        this.priority = priority;
        if (this.active) { this.announce(); this.tick(); }
    }
    effectivePriority() { return this.busy ? 3 : this.priority; }
    setBusy(busy) {
        this.busy = busy;
        if (this.active) { this.announce(); this.tick(); }
    }
    checkpoint(cursor) {
        if (!this.active || cursor <= this.cursor) return;
        this.cursor = cursor;
        this.announce('cursor');
    }
    setLeader(value) {
        if (value === this.leader && this.leadershipReported) return;
        this.leadershipReported = true;
        this.leader = value;
        this.changed(value);
    }
    tick() {
        if (!this.active) return;
        const now = this.now();
        if (this.socket.connected === false) {
            this.candidate = null;
            this.setLeader(false);
            return;
        }
        if (now - this.lastAnnounced >= 2000) this.announce();
        for (const [id, peer] of this.peers) if (now - peer.seen > 6500) this.peers.delete(id);
        // A window with a waiting resolver takes precedence over unsolicited chat.
        const peers = [{ id: this.id, priority: this.effectivePriority() }, ...this.peers.values()];
        peers.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
        const winner = peers[0].id;
        if (winner !== this.candidate) { this.candidate = winner; this.candidateSince = now; }
        if (winner !== this.id) this.setLeader(false);
        else if (now - this.candidateSince >= 500 && now - this.started >= 500) this.setLeader(true);
    }
}

/** Server-enforced identity is the final safeguard against concurrent chat creation. */
export async function deliveryMessageId(worldId, userId, deliveryId) {
    if (!deliveryId) throw new Error('Missing physical delivery identity');
    const hash = await sha256(JSON.stringify([worldId, userId, deliveryId]));
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    return [...new Uint8Array(hash).slice(0, 16)].map(byte => alphabet[byte % alphabet.length]).join('');
}
