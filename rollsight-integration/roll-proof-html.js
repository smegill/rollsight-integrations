/**
 * Roll replay block for Foundry chat: formula/total line + inline GIF + branded link.
 * Merged into message content (v12 roll cards often omit flavor).
 */

const _BRANDED_RP_BASE = "https://www.rollsight.com/rp";

/**
 * If the app sent a direct Supabase public Storage URL, rewrite to branded /rp/… so
 * "Open in new tab" and <img> hit rollsight.com first (307 to Storage) instead of a raw 404 host.
 * @param {string} [url]
 * @returns {string}
 */
export function normalizeRollProofUrl(url) {
    if (!url || typeof url !== "string") return "";
    const s = url.trim();
    const m = s.match(/\/roll-proofs\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.gif)/i);
    if (m && /supabase\.co/i.test(s)) {
        return `${_BRANDED_RP_BASE}/${m[1]}`;
    }
    return s;
}

/**
 * @param {object|null} roll - Foundry Roll (optional)
 * @param {object} rollData - RollSight payload
 * @returns {string}
 */
export function buildRollSummaryHtml(roll, rollData) {
    const formula = (roll?.formula ?? rollData?.formula ?? "").toString().trim();
    const total = roll?.total ?? rollData?.total;
    if (!formula && total == null) return "";
    const escapeHtml = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const totalStr = total != null && !Number.isNaN(Number(total)) ? String(total) : "—";
    const f = formula || "—";
    return `<div class="rollsight-roll-summary" aria-label="Roll result"><strong>${escapeHtml(f)}</strong> <span class="rollsight-roll-summary-sep">→</span> <span class="rollsight-roll-summary-total">${escapeHtml(totalStr)}</span></div>`;
}

/**
 * @param {object} rollData
 * @param {string} [rollData.roll_proof_url]
 * @param {string} [rollData.roll_proof_note]
 * @param {boolean} [rollData.roll_proof_pending]
 * @returns {string}
 */
export function buildRollReplayBlockHtml(rollData) {
    if (!rollData?.roll_proof_url) return "";
    const url = normalizeRollProofUrl(rollData.roll_proof_url);
    const escapeAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const href = escapeAttr(url);
    const defaultPendingNote =
        "Replay is still processing — the animation may appear in a few seconds. If the image is broken, use the link below.";
    const pendingNote = rollData.roll_proof_note || defaultPendingNote;
    const pending = rollData.roll_proof_pending === true;
    const pendingClass = pending ? " rollsight-roll-replay-wrap--pending" : "";
    const doneExtraNote =
        !pending && rollData.roll_proof_note
            ? `<p class="rollsight-roll-proof-note"><em>${escapeHtml(rollData.roll_proof_note)}</em></p>`
            : "";
    return `
<div class="rollsight-roll-replay-wrap${pendingClass}" data-rollsight-roll-replay="1">
  <p class="rollsight-roll-replay-heading"><span class="rollsight-roll-replay-icon" aria-hidden="true">&#127922;</span> Roll replay</p>
  ${pending ? `<p class="rollsight-roll-proof-pending-msg"><em>${escapeHtml(pendingNote)}</em></p>` : ""}
  <figure class="rollsight-roll-proof-figure">
    <img src="${href}" alt="Roll replay" class="rollsight-roll-proof-gif rollsight-roll-replay-gif" width="480" loading="lazy" decoding="async" />
  </figure>
  ${doneExtraNote}
  <p class="rollsight-roll-proof-open"><a href="${href}" target="_blank" rel="noopener noreferrer">Open roll replay</a></p>
</div>`.trim();
}

/**
 * Summary line + replay block (use when merging into chat message content so the numeric result stays visible if the dice card is hidden).
 * @param {object} rollData
 * @param {object|null} [roll]
 * @returns {string}
 */
export function buildRollReplayCardHtml(rollData, roll = null) {
    const summary = buildRollSummaryHtml(roll, rollData);
    const block = buildRollReplayBlockHtml(rollData);
    if (!block) return summary;
    const sep = summary ? "\n" : "";
    return `${summary}${sep}${block}`;
}

/** @deprecated Use buildRollReplayCardHtml for messages; buildRollReplayBlockHtml for replay-only. */
export function buildRollProofFlavorHtml(rollData) {
    return buildRollReplayCardHtml(rollData, null);
}
