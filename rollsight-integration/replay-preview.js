/** Load outside the chat DOM: Foundry waits for DOM images before scrolling to a roll. */
export function bindReplayPreview(details, {
    autoExpand = false, intervalMs = 3000, maxMs = 120000,
    unavailable = '', ImageClass = globalThis.Image,
    schedule = setTimeout, cancel = clearTimeout, now = Date.now,
} = {}) {
    const image = details.querySelector('img');
    const loading = details.querySelector('.rollsight-replay-loading');
    if (!image || !loading) return;
    let timer, deadline, probe, stopped = false;
    const started = now();
    const stop = () => {
        stopped = true;
        cancel(timer);
        cancel(deadline);
        if (probe) probe.onload = probe.onerror = null;
    };
    const attempt = () => {
        if (stopped || !details.isConnected) return stop();
        if (now() - started >= maxMs) {
            loading.textContent = unavailable;
            return stop();
        }
        probe = new ImageClass();
        probe.referrerPolicy = 'no-referrer';
        probe.onload = () => {
            if (!details.isConnected) return stop();
            // The image is cached now. Until this point the chat image has no src,
            // so an unfinished upload cannot hold Foundry's waitForImages open.
            image.src = probe.src;
            image.hidden = false;
            loading.hidden = true;
            stop();
        };
        probe.onerror = () => {
            probe.onload = probe.onerror = null;
            probe = null;
            timer = schedule(attempt, Math.max(1000, intervalMs));
        };
        const url = new URL(details.dataset.rollsightProofUrl);
        url.searchParams.set('rs', String(now()));
        probe.src = url.href;
    };
    details.open = autoExpand;
    deadline = schedule(() => {
        loading.textContent = unavailable;
        stop();
    }, maxMs);
    // renderChatMessage runs before Foundry appends this card to the chat log.
    timer = schedule(attempt, 0);
    return stop;
}
