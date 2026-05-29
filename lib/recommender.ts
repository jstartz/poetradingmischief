/**
 * Project recommender. Ranks recipes by a transparent, documented score.
 *
 * The previous version used opaque magic numbers. This version exposes every
 * component of the score and weights them by explicit, named factors so the
 * ranking is auditable (red-team critique #9).
 */
import { evaluateProject, type Confidence } from "./ev";
import type { Recipe, LeaguePhase } from "@/data/recipes";

export type RiskProfile = "averse" | "neutral" | "aggressive";

export type ScoreBreakdown = {
  evComponent: number;
  brickFloorComponent: number;
  phaseComponent: number;
  liquidityComponent: number;
  confidenceComponent: number;
  variancePenalty: number;
  total: number;
};

export type Recommendation = {
  recipe: Recipe;
  ev: number;
  expectedProfit: number;
  attempts: number;
  totalCost: number;
  roiPct: number;
  stdDev: number;
  pHitTarget: number;
  brickFloor: number;
  slippageDragPct: number;
  worstConfidence: Confidence;
  score: ScoreBreakdown;
  why: string[];
  caveats: string[];
};

export type Inputs = {
  budgetDiv: number;
  complexityCeiling: number;
  phase: LeaguePhase;
  risk: RiskProfile;
  recipes: Recipe[];
  horizonDays?: number;
};

export function recommend(inputs: Inputs): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const recipe of inputs.recipes) {
    if (recipe.complexity > inputs.complexityCeiling) continue;

    const baseCost = recipe.basePriceFallback ?? 0;
    const matCost = recipe.materials.reduce((s, m) => s + m.fallbackPrice * m.qty, 0);
    const perAttempt = baseCost + matCost;
    if (perAttempt <= 0) continue;

    const attempts = Math.max(1, Math.floor(inputs.budgetDiv / perAttempt));

    const result = evaluateProject({
      name: recipe.name,
      costPerAttempt: matCost,
      baseAcquisitionCost: baseCost,
      attempts,
      horizonDays: inputs.horizonDays ?? 3,
      outcomes: recipe.outcomes.map((o) => ({
        id: o.id, label: o.label, probability: o.probability,
        salePrice: o.fallbackPrice, isTarget: o.isTarget,
        dailyVolume: o.dailyVolume, provenance: o.priceProvenance, confidence: o.priceConfidence,
      })),
    });
    if (!result.ok) continue;

    // ---- transparent scoring (each component documented) ----
    // EV efficiency: profit per divine of capital, capped.
    const evComponent = Math.max(0, Math.min(40, (result.evPerAttempt / perAttempt) * 100 * 0.4));
    // brick floor: reward strategies that profit even on total miss.
    const brickFloorComponent = result.brickFloorEV > 0 ? 20 : 0;
    // phase fit.
    const phaseComponent = recipe.bestPhase.includes(inputs.phase) ? 15 : 0;
    // liquidity: penalize if slippage eats the edge.
    const liquidityComponent = Math.max(-15, -result.slippageDragPct * 0.3);
    // confidence: down-weight low-confidence data so we don't over-trust estimates.
    const confidenceComponent = result.worstConfidence === "high" ? 10 : result.worstConfidence === "medium" ? 5 : 0;
    // variance penalty scaled by risk profile.
    const riskW = inputs.risk === "averse" ? 1.5 : inputs.risk === "aggressive" ? 0.4 : 1.0;
    const variancePenalty = riskW * Math.min(25, (result.stdDevPerAttempt / Math.max(1, Math.abs(result.evPerAttempt))) * 3);

    const total = Math.max(0, Math.min(100,
      evComponent + brickFloorComponent + phaseComponent + liquidityComponent + confidenceComponent - variancePenalty));

    const why: string[] = [];
    const caveats: string[] = [];
    if (recipe.bestPhase.includes(inputs.phase)) why.push(`Optimal for ${inputs.phase} phase (+${phaseComponent})`);
    if (result.evPerAttempt > 0) why.push(`Positive EV: +${result.evPerAttempt.toFixed(1)} div/attempt`);
    if (result.brickFloorEV > 0) why.push(`Brick-floor positive — profitable even on total miss`);
    if (recipe.complexity <= 2) why.push("Simple recipe — low execution risk");

    if (result.slippageDragPct > 10) caveats.push(`Liquidity drag ${result.slippageDragPct.toFixed(0)}% — you flood the market at this volume`);
    if (result.worstConfidence === "low") caveats.push(`Low-confidence data (${result.provenanceNote}) — verify prices before committing`);
    if (result.stdDevPerAttempt > result.evPerAttempt * 3) caveats.push(`High variance — size down or expect swings`);
    if (result.pHitTarget < 0.5 && attempts < 30) caveats.push(`Only ${(result.pHitTarget * 100).toFixed(0)}% chance of a target hit at this budget`);

    recs.push({
      recipe, ev: result.evPerAttempt, expectedProfit: result.expectedProfit, attempts,
      totalCost: result.totalCost, roiPct: result.roiPct, stdDev: result.stdDevPerAttempt,
      pHitTarget: result.pHitTarget, brickFloor: result.brickFloorEV, slippageDragPct: result.slippageDragPct,
      worstConfidence: result.worstConfidence,
      score: { evComponent, brickFloorComponent, phaseComponent, liquidityComponent, confidenceComponent, variancePenalty, total },
      why, caveats,
    });
  }

  return recs.sort((a, b) => b.score.total - a.score.total);
}
