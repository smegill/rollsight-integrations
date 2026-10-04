/** Read-only chat decoration, registered before either game or stream chat renders. */
import { buildRollReplayInjectHtml } from './roll-proof-html.js';
import { bindReplayPreview } from './replay-preview.js';
import { mergeReplayPayloads } from './replay-correlation.js';
const NS = 'rollsight-integration';
const setting = key => game.settings.get(NS, key);
const t = key => game.i18n.format(`ROLLSIGHT.${key}`);

export function registerReplayViewing(render = renderReplay) {
    Hooks.on('renderChatMessage', render);
    Hooks.on('renderChatMessageHTML', render);
    // D&D can replace message-content after the core hook; rendering deduplicates.
    Hooks.on('dnd5e.renderChatMessage', render);
}

export function renderReplay(message, html) {
    if (message.isContentVisible === false) return;
    const root = html?.nodeType ? html : html?.[0];
    if (!root?.querySelector) return;
    // Stream chat shows roll results only; standalone OBS overlays own replays.
    // Remove persisted legacy markup as well as skipping new previews, so no
    // client preference or hidden settings menu is required on the OBS machine.
    if (game.view === 'stream') {
        root.querySelectorAll('.rollsight-roll-replay-details, .rollsight-roll-replay-wrap, .rollsight-roll-proof-block')
            .forEach(element => element.remove());
        return;
    }
    const flags = message.flags?.[NS] ?? {};
    const payloads = mergeReplayPayloads(flags.rollReplayPayloads ?? [], flags.rollReplayPayload);
    const shown = new Set([...root.querySelectorAll('.rollsight-roll-replay-details')].map(el => el.dataset.rollsightProofUrl));
    for (const payload of payloads) {
        const fragment = buildRollReplayInjectHtml(payload);
        if (!fragment) continue;
        const template = root.ownerDocument.createElement('template');
        template.innerHTML = fragment;
        const details = template.content.firstElementChild;
        if (shown.has(details.dataset.rollsightProofUrl)) continue;
        shown.add(details.dataset.rollsightProofUrl);
        (root.querySelector('.message-content') ?? root).append(details);
        bindReplayPreview(details, {
            autoExpand: setting('autoExpandRollReplay'),
            intervalMs: Math.max(1, setting('rollReplayRefreshEverySeconds')) * 1000,
            maxMs: Math.min(300, Math.max(1, setting('rollReplayRefreshMaxSeconds'))) * 1000,
            unavailable: t('ReplayUnavailable'),
        });
    }
}
