/**
 * Fulfillment Provider for Rollsight Integration
 *
 * Registers Rollsight as a CONFIG.Dice.fulfillment method (Foundry v12+)
 * so players can choose "Rollsight" per die type in Dice Configuration.
 * When they roll (e.g. attack), RollResolver opens and we feed results
 * via Roll.registerResult when we receive physical dice.
 */

const METHOD_ID = "rollsight";

/**
 * Register Rollsight as a dice fulfillment method.
 * Called from init so it runs before Dice Configuration is shown.
 */
export function registerFulfillmentMethod() {
  const CONFIG =
    typeof foundry !== "undefined" && foundry.CONFIG
      ? foundry.CONFIG
      : globalThis.CONFIG;
  if (!CONFIG?.Dice?.fulfillment?.methods) {
    console.warn(
      "Rollsight Integration | CONFIG.Dice.fulfillment.methods not available (Foundry v12+ required for fulfillment)"
    );
    return;
  }
  CONFIG.Dice.fulfillment.methods[METHOD_ID] = {
    label: "Rollsight (Physical Dice)",
    icon: "fas fa-dice-d20",
  };
  console.log("Rollsight Integration | Registered fulfillment method:", METHOD_ID);
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
 * Returns true if at least one result was consumed (resolver was active).
 */
export function tryFulfillActiveResolver(rollData) {
  const Roll =
    typeof foundry !== "undefined" && foundry.dice?.rolls?.Roll
      ? foundry.dice.rolls.Roll
      : globalThis.Roll;
  if (!Roll?.registerResult) return false;
  const pairs = rollDataToFulfillmentPairs(rollData);
  let consumed = false;
  for (const { denomination, value } of pairs) {
    const result = Roll.registerResult(METHOD_ID, denomination, value);
    if (result === true) consumed = true;
  }
  return consumed;
}
