/**
 * Gold-cost model for the in-game Currency Exchange.
 *
 * Per the PoE wiki, the Currency Exchange charges GOLD per item on the BUY
 * side of an order. The fee is fixed per item and scales with rarity. It does
 * NOT apply to player-to-player item trades (uniques, rares) — those are
 * whispered and paid in currency only.
 *
 * Values below are the published per-item gold costs (PoE wiki, Currency
 * Exchange Market). Unlisted currencies fall back to DEFAULT_GOLD.
 */
export const REF_CURRENCY = "div"; // every price in this app is in Divine Orbs

export const GOLD_COST: Record<string, number> = {
  divine: 250, exalted: 250, annulment: 250, ancient: 250,
  chaos: 15, alchemy: 15, scour: 15,
  vaal: 20, "vaal-orb": 20, regret: 20, unmaking: 20, binding: 20, instilling: 20,
  regal: 50, gemcutter: 50, glassblower: 50,
  jewellers: 10, chance: 10, chromatic: 10, alteration: 10,
  transmute: 3, augmentation: 5, wisdom: 1, portal: 1,
  armourer: 25, whetstone: 30, blessed: 35, enkindling: 35,
  "perfect-chaos": 250, "perfect-exalted": 250, "perfect-ex": 250,
  "perfect-jewellers": 50, "perfect-regal": 50,
  fracturing: 500, mist: 500, "veiled-exalt": 500,
  "vaal-infuser": 75, "vaal-cultivation": 75,
  "hinekoras-lock": 6250, "mirror-shard": 1250, mirror: 25000,
  essence: 50, omen: 75, sacred: 250, tempering: 250, tailoring: 250,
};

export const DEFAULT_GOLD = 25;

/** Resolve a currency name / apiId to its per-item gold cost. */
export function goldFor(name: string): number {
  if (!name) return DEFAULT_GOLD;
  const key = name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-orb$|-shard$/g, "")
    .replace(/^perfect-orb-of-/, "perfect-")
    .replace(/^orb-of-/, "");
  if (GOLD_COST[key] != null) return GOLD_COST[key];
  for (const k of Object.keys(GOLD_COST)) if (key.includes(k)) return GOLD_COST[k];
  return DEFAULT_GOLD;
}

/**
 * Walk an arbitrage cycle, compounding a starting amount of the first currency
 * through each rate, and charge gold per leg = (units received) * goldFor(to).
 */
export function goldForLoop(
  legs: Array<{ from: string; to: string; rate: number; volume?: number }>,
  startAmount: number
) {
  let amt = startAmount;
  const detailed = legs.map((l) => {
    const received = amt * l.rate;
    const gold = received * goldFor(l.to);
    amt = received;
    return { ...l, received, gold };
  });
  const totalGold = detailed.reduce((s, l) => s + l.gold, 0);
  return { legs: detailed, totalGold, startAmount, endAmount: amt, profitUnits: amt - startAmount };
}

export function fmtGold(g: number): string {
  if (g >= 1e6) return `${(g / 1e6).toFixed(2)}M`;
  if (g >= 1e3) return `${(g / 1e3).toFixed(1)}k`;
  return `${Math.round(g)}`;
}
