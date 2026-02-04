/**
 * Fulfillment Provider for Rollsight Integration
 *
 * We do not register Rollsight as a CONFIG.Dice.fulfillment method.
 * Users set Dice Configuration to Manual for dice they use with Rollsight;
 * we replace the manual dialog with a Rollsight prompt and feed physical dice
 * via Roll.registerResult("manual", ...) when we receive them.
 */

const METHOD_ID = "rollsight";

/**
 * No-op: we no longer register Rollsight as a dice fulfillment method.
 * Only Manual is used; the module feeds rolls into the Manual resolver.
 */
export function registerFulfillmentMethod() {
  // Intentionally do not add CONFIG.Dice.fulfillment.methods.rollsight.
  // Users configure dice as Manual; we inject Rollsight results into that resolver.
}

/**
 * Map Rollsight die shape to Foundry denomination string.
 * Handles d10p (percentile tens) as "d10" for fulfillment;
 * d100 is typically built from d10p + d10 in RollResolver.
 */
export function shapeToDenomination(shape) {
  if (!shape || typeof shape !== "string") return null;
  const s = shape.toLowerCase();
  if (["d4", "d6", "d8", "d10", "d12", "d20", "d100"].includes(s)) return s;
  if (s === "d10p") return "d10"; // percentile tens
  const match = s.match(/^d(\d+)(p)?$/);
  return match ? `d${match[1]}` : null;
}

/**
 * Build ordered list of { denomination, value } from Rollsight roll payload.
 * Preserves order so we can feed RollResolver one result per fulfillable term.
 */
export function rollDataToFulfillmentPairs(rollData) {
  const pairs = [];
  const dice = rollData?.dice;
  if (!Array.isArray(dice)) {
    if (
      rollData?.total !== undefined &&
      (rollData?.formula === "1d20" || rollData?.formula === "d20")
    ) {
      pairs.push({ denomination: "d20", value: Number(rollData.total) });
    }
    return pairs;
  }
  for (const d of dice) {
    const shape = d.shape || (d.faces ? `d${d.faces}` : null);
    const denom = shapeToDenomination(shape);
    const value =
      d.value !== undefined
        ? Number(d.value)
        : d.results?.[0] != null
          ? Number(d.results[0])
          : NaN;
    if (denom && !Number.isNaN(value)) pairs.push({ denomination: denom, value });
  }
  return pairs;
}

/**
 * Try to consume roll data with the active RollResolver via Roll.registerResult.
 * Uses "manual" only (Rollsight is not a config option; users set Manual and we feed into it).
 */
export function tryFulfillActiveResolver(rollData) {
  const Roll =
    typeof foundry !== "undefined" && foundry.dice?.rolls?.Roll
      ? foundry.dice.rolls.Roll
      : globalThis.Roll;
  if (!Roll?.registerResult) return false;
  const pairs = rollDataToFulfillmentPairs(rollData);
  let consumed = false;
  const methodsToTry = ["manual"];
  for (const { denomination, value } of pairs) {
    for (const method of methodsToTry) {
      try {
        const result = Roll.registerResult(method, denomination, value);
        if (result === true) {
          consumed = true;
          break;
        }
      } catch (_) {}
    }
  }
  return consumed;
}
