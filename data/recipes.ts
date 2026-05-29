/**
 * Crafting recipe catalog — with HONEST provenance on every number.
 *
 * Each outcome carries:
 *   - provenance: "observed" (measured sample), "modweight" (game data), or
 *     "estimate" (community-reported / unverified)
 *   - confidence: high | medium | low
 * and each recipe carries a sampleSize + verified date + sourceUrl so the UI
 * can show how much to trust the EV instead of rendering false precision.
 *
 * NOTE on probabilities: PoE 2 ID/corruption weights are NOT published by GGG
 * and poe2db does not expose per-combination ID weights. Where we lack a real
 * weight source we mark the probability as an ESTIMATE and assume an
 * approximately uniform distribution — flagged in the UI as low/medium
 * confidence. Do not treat these as ground truth.
 */

export type Provenance = "observed" | "modweight" | "estimate";
export type Confidence = "high" | "medium" | "low";
export type LeaguePhase = "launch" | "week1" | "midleague" | "lateleague";

export type ValueDriver = { axis: string; values: string[]; note?: string };

export type RecipeOutcome = {
  id: string;
  label: string;
  probability: number;
  probProvenance: Provenance;
  probConfidence: Confidence;
  fallbackPrice: number;       // Divine; overridable / live-resolvable
  priceProvenance: Provenance;
  priceConfidence: Confidence;
  dailyVolume?: number;        // est. market depth (units/day) for slippage model
  isTarget?: boolean;
};

export type Recipe = {
  id: string;
  name: string;
  category: "Identify" | "Corrupt" | "Vaal" | "Currency Craft" | "Essence" | "Omen";
  basePriceKey?: string;
  basePriceFallback: number;
  materials: { priceKey: string; qty: number; fallbackPrice: number }[];
  valueDrivers: ValueDriver[];
  outcomes: RecipeOutcome[];
  complexity: 1 | 2 | 3 | 4 | 5;
  bestPhase: LeaguePhase[];
  requiresPostProcessing?: boolean;
  resetYield?: number;
  // provenance metadata
  sampleSize?: number;
  verified: string;            // ISO date the data was last sanity-checked
  sourceUrl?: string;
  notes: string;
};

// Belton's published 155-ID sample (observed per-cell SALE prices + counts).
// counts: helm/shield/boots/gloves observed in his run (noisy, n=155).
const ATZIRI = [
  // [id, defense, slot, price(div), observedCount]
  ["es-helm", "ES + Helm", 4999, 9, true], ["es-shield", "ES + Shield", 3000, 3], ["es-boots", "ES + Boots", 2000, 6], ["es-gloves", "ES + Gloves", 1700, 7],
  ["ar-helm", "Armour + Helm", 300, 7], ["ar-shield", "Armour + Shield", 600, 0], ["ar-boots", "Armour + Boots", 245, 5], ["ar-gloves", "Armour + Gloves", 250, 7],
  ["ev-helm", "Evasion + Helm", 230, 5], ["ev-shield", "Evasion + Shield", 255, 4], ["ev-boots", "Evasion + Boots", 279, 9], ["ev-gloves", "Evasion + Gloves", 235, 8],
  ["esar-helm", "ES/AR + Helm", 666, 3], ["esar-shield", "ES/AR + Shield", 266, 7], ["esar-boots", "ES/AR + Boots", 250, 5], ["esar-gloves", "ES/AR + Gloves", 249, 9],
  ["esev-helm", "ES/EV + Helm", 666, 4], ["esev-shield", "ES/EV + Shield", 300, 1], ["esev-boots", "ES/EV + Boots", 289, 7], ["esev-gloves", "ES/EV + Gloves", 276, 11],
  ["arev-helm", "AR/EV + Helm", 255, 1], ["arev-shield", "AR/EV + Shield", 290, 1], ["arev-boots", "AR/EV + Boots", 235, 4], ["arev-gloves", "AR/EV + Gloves", 255, 10],
  ["esarev-helm", "ES/AR/EV + Helm", 335, 8], ["esarev-shield", "ES/AR/EV + Shield", 245, 7], ["esarev-boots", "ES/AR/EV + Boots", 250, 6], ["esarev-gloves", "ES/AR/EV + Gloves", 249, 1],
] as const;

const ATZIRI_N = 155;

export const RECIPES: Recipe[] = [
  {
    id: "atziri-splendour-id",
    name: "Atziri's Splendour — Unidentified",
    category: "Identify",
    basePriceFallback: 600,
    materials: [{ priceKey: "wisdom", qty: 1, fallbackPrice: 0.002 }],
    resetYield: 1 / 3,
    complexity: 1,
    bestPhase: ["week1", "midleague"],
    sampleSize: ATZIRI_N,
    verified: "2026-05-09",
    sourceUrl: "https://www.youtube.com/watch?v=StJ0JYzi4aY",
    valueDrivers: [
      { axis: "Defense type", values: ["ES", "Armour", "Evasion", "ES/AR", "ES/EV", "AR/EV", "ES/AR/EV"] },
      { axis: "Soul Core slot", values: ["Helm", "Shield", "Boots", "Gloves"] },
    ],
    notes:
      "Probabilities use Belton's OBSERVED counts (n=155) — a noisy single-sample estimate, NOT a verified drop table. True per-cell weights are unpublished; treat as approximately uniform. Prices are his observed sale data. The edge survives because every brick still resells > the 3-to-1 reset value.",
    outcomes: ATZIRI.map(([id, label, price, count, target]: any) => ({
      id,
      label,
      // observed frequency, smoothed toward uniform to avoid zero-prob cells
      probability: (count + 1) / (ATZIRI_N + ATZIRI.length),
      probProvenance: "observed" as Provenance,
      probConfidence: "low" as Confidence,
      fallbackPrice: price,
      priceProvenance: "observed" as Provenance,
      priceConfidence: "medium" as Confidence,
      dailyVolume: 4,
      isTarget: !!target,
    })),
  },
  {
    id: "choir-storms-corrupt",
    name: "Choir of the Storms — Double Corrupt",
    category: "Corrupt",
    basePriceFallback: 250,
    materials: [{ priceKey: "vaal", qty: 2, fallbackPrice: 0.3 }],
    complexity: 2,
    bestPhase: ["midleague", "lateleague"],
    verified: "2026-05-09",
    sourceUrl: "https://www.youtube.com/watch?v=StJ0JYzi4aY",
    valueDrivers: [{ axis: "Implicit corruption", values: ["+1 all skills", "+1 spell", "+1 minion", "Generic"] }],
    notes: "1-in-54 to hit +1 all skills is a COMMUNITY ESTIMATE, not a confirmed weight. Bricks ~300 div form the floor.",
    outcomes: [
      { id: "plus1", label: "+1 all skills (target)", probability: 1 / 54, probProvenance: "estimate", probConfidence: "low", fallbackPrice: 18000, priceProvenance: "estimate", priceConfidence: "low", dailyVolume: 0.3, isTarget: true },
      { id: "brick", label: "Generic double-corrupt brick", probability: 53 / 54, probProvenance: "estimate", probConfidence: "low", fallbackPrice: 300, priceProvenance: "observed", priceConfidence: "medium", dailyVolume: 2 },
    ],
  },
  {
    id: "essence-life-armour",
    name: "Essence of the Body — Body Armour slam",
    category: "Essence",
    basePriceFallback: 8,
    materials: [{ priceKey: "essence", qty: 1, fallbackPrice: 0.4 }],
    complexity: 1,
    bestPhase: ["launch", "week1"],
    verified: "2026-05-28",
    valueDrivers: [
      { axis: "Life roll tier", values: ["t1", "t2", "t3"] },
      { axis: "Secondary mod", values: ["meta resist", "filler", "junk"] },
    ],
    notes: "League-start volume play. Probabilities are ESTIMATES of essence-slam mod distribution; high throughput compensates for thin per-attempt EV. Slippage matters a lot here — you list a LOT of these.",
    outcomes: [
      { id: "t1-meta", label: "t1 life + meta resist", probability: 0.04, probProvenance: "estimate", probConfidence: "low", fallbackPrice: 40, priceProvenance: "estimate", priceConfidence: "low", dailyVolume: 6, isTarget: true },
      { id: "t1-filler", label: "t1 life + filler", probability: 0.16, probProvenance: "estimate", probConfidence: "low", fallbackPrice: 12, priceProvenance: "estimate", priceConfidence: "low", dailyVolume: 20 },
      { id: "t2", label: "t2 life", probability: 0.30, probProvenance: "estimate", probConfidence: "low", fallbackPrice: 4, priceProvenance: "estimate", priceConfidence: "low", dailyVolume: 60 },
      { id: "t3", label: "t3 life / junk", probability: 0.50, probProvenance: "estimate", probConfidence: "low", fallbackPrice: 1, priceProvenance: "estimate", priceConfidence: "low", dailyVolume: 200 },
    ],
  },
  {
    id: "stellar-vaal",
    name: "Stellar Amulet — Single Vaal jackpot",
    category: "Vaal",
    basePriceFallback: 4,
    materials: [{ priceKey: "vaal", qty: 1, fallbackPrice: 0.3 }],
    complexity: 1,
    bestPhase: ["launch", "week1"],
    verified: "2026-05-28",
    valueDrivers: [{ axis: "Vaal implicit", values: ["+1 all skills", "+1 spell", "+1 socket", "Generic"] }],
    notes: "Cheapest single-corrupt EV. All probabilities are ESTIMATES (Vaal implicit pool weights unconfirmed). Floor is the brick value of the rare base.",
    outcomes: [
      { id: "jackpot", label: "+1 all skills implicit", probability: 1 / 220, probProvenance: "estimate", probConfidence: "low", fallbackPrice: 600, priceProvenance: "estimate", priceConfidence: "low", dailyVolume: 0.5, isTarget: true },
      { id: "spell1", label: "+1 spell skills", probability: 1 / 110, probProvenance: "estimate", probConfidence: "low", fallbackPrice: 80, priceProvenance: "estimate", priceConfidence: "low", dailyVolume: 1 },
      { id: "socket", label: "+1 socket", probability: 0.02, probProvenance: "estimate", probConfidence: "low", fallbackPrice: 25, priceProvenance: "estimate", priceConfidence: "low", dailyVolume: 3 },
      { id: "rares", label: "Rare/Magic (still resellable)", probability: 0.9646, probProvenance: "estimate", probConfidence: "low", fallbackPrice: 3, priceProvenance: "estimate", priceConfidence: "low", dailyVolume: 30 },
      { id: "white", label: "Bricked to white", probability: 0.0036, probProvenance: "estimate", probConfidence: "low", fallbackPrice: 0.5, priceProvenance: "estimate", priceConfidence: "low", dailyVolume: 50 },
    ],
  },
];
