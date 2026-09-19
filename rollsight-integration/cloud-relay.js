/** One cancellable long-poll loop per session. A stopped generation cannot deliver or reschedule. */
export class CloudRelay {
    constructor({ fetcher = (...args) => fetch(...args), deliver, status = () => {}, storage = globalThis.sessionStorage, checkpoint = () => {} } = {}) {
        Object.assign(this, { fetcher, deliver, status, storage, checkpoint });
    }
    stop() {
        this.controller?.abort();
        this.controller = null;
    }
    async start({ base, bearer, scope, sinceTime, sinceSeq = 0, deliveryState = () => {} }) {
        this.stop();
        const controller = this.controller = new AbortController();
        const signal = controller.signal;
        const storageKey = `rollsight.cursor.v2.${scope}`;
        let cursor = sinceSeq;
        try { cursor = Math.max(cursor, Number(this.storage?.getItem(storageKey)) || 0); } catch (_) {}
        const current = () => this.controller === controller && !signal.aborted;
        const loop = async () => {
            while (current()) {
                let ok = false;
                const timeout = setTimeout(() => request.abort(), 28000);
                const request = new AbortController();
                const abort = () => request.abort();
                signal.addEventListener('abort', abort, { once: true });
                try {
                    const response = await this.fetcher(`${base}/rollsight-room/events?since_seq=${cursor}&wait_ms=20000`, {
                        headers: { Authorization: `Bearer ${bearer}` }, cache: 'no-store', credentials: 'omit', signal: request.signal
                    });
                    if (!current()) return;
                    if (!response.ok) {
                        this.status(response.status === 401 || response.status === 404 ? 'CodeError' : 'Reconnecting');
                        // A stale credential requires explicit refresh, not endless retries.
                        if (response.status === 401 || response.status === 404) return;
                        throw new Error(`Relay HTTP ${response.status}`);
                    }
                    const data = await response.json();
                    if (!current()) return;
                    if (!Array.isArray(data.events)) throw new Error('Invalid relay response');
                    const events = [...data.events].sort((a, b) => a.seq - b.seq);
                    for (const event of events) {
                        if (!current()) return;
                        if (!Number.isSafeInteger(event?.seq) || event.seq <= cursor) continue;
                        const p = event.payload;
                        // Resolver completion can lower this window's priority. Keep ownership
                        // until its consumed cursor has reached the other windows.
                        deliveryState(true);
                        try {
                            // Historical events are acknowledged but never replayed into a newly joined session.
                            if (p && Number.isFinite(p.timestamp) && p.timestamp >= sinceTime) {
                                await this.deliver(p, `${scope}:${event.seq}`, current);
                            }
                            if (!current()) return;
                            cursor = event.seq;
                            this.checkpoint(cursor);
                            try { this.storage?.setItem(storageKey, String(cursor)); } catch (_) {}
                        } finally { deliveryState(false); }
                    }
                    this.status('Connected');
                    ok = true;
                } catch (error) {
                    if (!current()) return;
                    this.status('Reconnecting');
                } finally {
                    clearTimeout(timeout);
                    signal.removeEventListener('abort', abort);
                }
                if (current()) await abortableDelay(ok ? 100 : 4000, signal);
            }
        };
        // Avoid two tabs consuming the same physical dice as the same Foundry user.
        if (globalThis.navigator?.locks?.request) {
            await navigator.locks.request(`rollsight.consumer.${scope}`, { ifAvailable: true }, async lock => {
                if (!current()) return;
                if (!lock) { this.status('AnotherTab'); return; }
                await loop();
            });
        } else {
            await loop();
        }
    }
}

function abortableDelay(ms, signal) {
    return new Promise(resolve => {
        if (signal.aborted) return resolve();
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
    });
}
