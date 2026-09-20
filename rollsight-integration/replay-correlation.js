/** Correlate by exact request ID, including Foundry's serialized ChatMessage rolls. */
export function mergeReplayPayloads(...groups) {
    const unique = new Map();
    for (const payload of groups.flat().filter(Boolean)) {
        if (payload.roll_proof_url) unique.set(payload.roll_proof_url, payload);
    }
    return [...unique.values()];
}

export function correlatedReplayPayloads(rolls, proofs, existing = []) {
    const payloads = [...existing];
    for (let roll of rolls ?? []) {
        if (typeof roll === 'string') {
            try { roll = JSON.parse(roll); } catch (_) { continue; }
        }
        // Midi may evaluate on a player's client and create/update the card on the GM.
        // Carry public replay metadata with the Roll across that socket boundary.
        const proof = roll?.options?.rollsightReplayPayloads ?? proofs.get(roll?.options?.rollsightRequestId);
        if (proof) payloads.push(...(Array.isArray(proof) ? proof : [proof]));
    }
    return mergeReplayPayloads(payloads);
}
