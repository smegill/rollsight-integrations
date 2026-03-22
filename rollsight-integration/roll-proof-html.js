/**
 * Collapsible roll-proof block for Foundry chat (GIF in <img> for native playback).
 * Appended to message flavor so it sits on the same card as system rolls (Forge / dnd5e).
 */

/**
 * @param {object} rollData
 * @param {string} [rollData.roll_proof_url]
 * @param {string} [rollData.roll_proof_note]
 * @param {boolean} [rollData.roll_proof_pending]
 * @returns {string}
 */
export function buildRollProofFlavorHtml(rollData) {
    if (!rollData?.roll_proof_url) return "";
    const escapeAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const url = escapeAttr(rollData.roll_proof_url);
    const note =
        rollData.roll_proof_note ||
        "Roll video is building — expand to preview; try again in a few seconds if the image does not load yet.";
    const pending = rollData.roll_proof_pending === true;
    const mediaBlock = pending
        ? `<p class="rollsight-roll-proof-pending-msg"><em>${escapeHtml(note)}</em></p>`
        : `<figure class="rollsight-roll-proof-figure">
  <img src="${url}" alt="Roll proof GIF" class="rollsight-roll-proof-gif" width="480" loading="lazy" decoding="async" />
</figure>
    <p class="rollsight-roll-proof-note"><em>${escapeHtml(note)}</em></p>`;
    return `
<details class="rollsight-roll-proof-block">
  <summary class="rollsight-roll-proof-summary" title="Show or hide roll proof">
    <span class="rollsight-roll-proof-summary-row">
      <span class="rollsight-roll-proof-icon" aria-hidden="true">&#127922;</span>
      <span class="rollsight-roll-proof-label">Roll proof</span>
      <span class="rollsight-roll-proof-chevron" aria-hidden="true"></span>
    </span>
  </summary>
  <div class="rollsight-roll-proof-panel">
    ${mediaBlock}
    <p class="rollsight-roll-proof-open"><a href="${url}" target="_blank" rel="noopener noreferrer">Open in new tab</a></p>
  </div>
</details>`.trim();
}
