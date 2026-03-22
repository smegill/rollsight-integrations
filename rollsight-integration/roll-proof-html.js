/**
 * Roll replay: serializable payload on ChatMessage flags + HTML injected in renderChatMessage
 * (keeps stock Foundry / system roll cards; appends replay below).
 */

const _BRANDED_RP_BASE = "https://www.rollsight.com/rp";

/**
 * If the app sent a direct Supabase public Storage URL, rewrite to branded /rp/…
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
 * Storable on ChatMessage flags (plain JSON).
 * @param {object} rollData
 * @returns {object|null}
 */
export function rollReplaySerializablePayload(rollData) {
    if (!rollData?.roll_proof_url) return null;
    return {
        roll_proof_url: rollData.roll_proof_url,
        roll_proof_note: rollData.roll_proof_note ?? "",
        roll_proof_pending: rollData.roll_proof_pending === true,
    };
}

/**
 * Collapsed-by-default <details> with GIF + link (injected under the stock roll card).
 * @param {object} rollData - payload (may be from flags)
 * @returns {string}
 */
export function buildRollReplayInjectHtml(rollData) {
    if (!rollData?.roll_proof_url) return "";
    const url = normalizeRollProofUrl(rollData.roll_proof_url);
    const escapeAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const href = escapeAttr(url);
    const defaultPendingNote =
        "Replay is still processing — open below in a few seconds once upload finishes. If the image stays broken, use the link (you may still see a short redirect to storage).";
    const pendingNote = rollData.roll_proof_note || defaultPendingNote;
    const pending = rollData.roll_proof_pending === true;
    const pendingClass = pending ? " rollsight-roll-replay-details--pending" : "";
    const doneExtraNote =
        !pending && rollData.roll_proof_note
            ? `<p class="rollsight-roll-proof-note"><em>${escapeHtml(rollData.roll_proof_note)}</em></p>`
            : "";
    return `
<details class="rollsight-roll-replay-details${pendingClass}">
  <summary class="rollsight-roll-replay-summary" title="Expand for in-chat preview; use the link below for full size in your browser">
    <span class="rollsight-roll-replay-summary-row">
      <span class="rollsight-roll-proof-icon" aria-hidden="true">&#127922;</span>
      <span class="rollsight-roll-proof-label">Roll replay</span>
      <span class="rollsight-roll-proof-chevron" aria-hidden="true"></span>
    </span>
  </summary>
  <div class="rollsight-roll-replay-panel">
    ${pending ? `<p class="rollsight-roll-proof-pending-msg"><em>${escapeHtml(pendingNote)}</em></p>` : ""}
    <p class="rollsight-roll-replay-preview-hint">Preview below (sized for chat). Click the image or the link to open the full-resolution GIF in your browser.</p>
    <figure class="rollsight-roll-proof-figure">
      <a class="rollsight-roll-replay-preview-link" href="${href}" target="_blank" rel="noopener noreferrer" title="Open full-size replay in browser">
        <img src="${href}" alt="Roll replay (preview in chat — click for full size)" class="rollsight-roll-proof-gif rollsight-roll-replay-gif" width="480" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
      </a>
    </figure>
    ${doneExtraNote}
    <p class="rollsight-roll-proof-open"><a href="${href}" target="_blank" rel="noopener noreferrer">Open full-size replay in browser</a></p>
  </div>
</details>`.trim();
}

/**
 * Standalone chat line (no dice card) — full HTML in message content.
 * @param {object} rollData
 * @returns {string}
 */
export function buildRollReplayStandaloneContentHtml(rollData) {
    return buildRollReplayInjectHtml(rollData);
}

/** @deprecated */
export function buildRollSummaryHtml(roll, rollData) {
    const formula = (roll?.formula ?? rollData?.formula ?? "").toString().trim();
    const total = roll?.total ?? rollData?.total;
    if (!formula && total == null) return "";
    const escapeHtml = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const totalStr = total != null && !Number.isNaN(Number(total)) ? String(total) : "—";
    const f = formula || "—";
    return `<div class="rollsight-roll-summary" aria-label="Roll result"><strong>${escapeHtml(f)}</strong> <span class="rollsight-roll-summary-sep">→</span> <span class="rollsight-roll-summary-total">${escapeHtml(totalStr)}</span></div>`;
}

/** @deprecated */
export function buildRollReplayBlockHtml(rollData) {
    return buildRollReplayInjectHtml(rollData);
}

/** @deprecated */
export function buildRollReplayCardHtml(rollData, roll = null) {
    const summary = buildRollSummaryHtml(roll, rollData);
    const block = buildRollReplayInjectHtml(rollData);
    if (!block) return summary;
    return summary ? `${summary}\n${block}` : block;
}

/** @deprecated */
export function buildRollProofFlavorHtml(rollData) {
    return buildRollReplayCardHtml(rollData, null);
}
