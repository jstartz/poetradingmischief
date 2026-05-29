/**
 * Liquidity-aware Expected-Value engine.
 *
 * Two improvements over a naive EV = Σ(p·price) − cost model:
 *
 * 1. SLIPPAGE. Dumping N copies of an outcome onto the market depresses price.
 *    We discount each outcome's realized price by a depth-aware decay so that
 *    "brick-floor profit" reflects what you'd ACTUALLY receive selling volume,
 *    not the top listing. This directly answers the red-team critique that the
 *    strategy "eats itself" at scale.
 *
 * 2. PROVENANCE. Every outcome carries a confidence + source so the UI can
 *    show how much to trust each number instead of rendering false precision.
 */

export type Provenance = "observed" | "modweight" | "estimate";
export type Confidence = "high" | "medium" | "low";

export type Outcome = {
  id: string;
  label: string;
  probability: number;
  salePrice: number;          // top-of-book price (Divine), before slippage
  isTarget?: boolean;
  dailyVolume?: number;       // market depth for this outcome (units/day)
  provenance?: Provenance;
  confidence?: Confidence;
};

export type CraftProject = {
  name: string;
  costPerAttempt: number;
  baseAcquisitionCost?: number;
  attempts: number;
  outcomes: Outcome[];
  /** Liquidation horizon in days — how long you're willing to sell over. */
  horizonDays?: number;
  /** Slippage aggressiveness: price decays by `slippageK` per (qty/dailyVolume). */
  slippageK?: number;
};

/**
 * Effective price when selling `qty` units of an outcome over `horizonDays`,
 * given the outcome's daily market volume. If you flood more than the market
 * absorbs, the marginal units sell for less. Modeled as a smooth decay:
 *   effPrice = price / (1 + k * max(0, qty/absorbable - 1))
 */
function effectivePrice(price: number, qty: number, dailyVolume = 0, horizonDays = 3, k = 0.5): number {
  if (!dailyVolume || qty <= 0) return price;
  const absorbable = dailyVolume * horizonDays;
  const overhang = Math.max(0, qty / absorbable - 1);
  return price / (1 + k * overhang);
}

export type EVResult =
  | { ok: false; error: string }
  | {
      ok: true;
      evPerAttempt: number;
      evPerAttemptNaive: number;     // without slippage, for comparison
      slippageDragPct: number;       // how much liquidity costs you
      expectedProfit: number;
      totalCost: number;
      totalRevenue: number;
      roiPct: number;
      pHitTarget: number;
      stdDevPerAttempt: number;
      brickFloorEV: number;
      worstConfidence: Confidence;
      provenanceNote: string;
    };

export function evaluateProject(p: CraftProject): EVResult {
  if (!p.outcomes?.length) return { ok: false, error: "No outcomes defined" };
  const sumP = p.outcomes.reduce((s, o) => s + o.probability, 0);
  if (Math.abs(sumP - 1) > 0.001)
    return { ok: false, error: `Outcome probabilities sum to ${sumP.toFixed(4)} (must be 1.0)` };

  const horizon = p.horizonDays ?? 3;
  const k = p.slippageK ?? 0.5;
  const fixed = p.costPerAttempt + (p.baseAcquisitionCost ?? 0);

  // Naive expected revenue (top-of-book)
  const naiveRev = p.outcomes.reduce((s, o) => s + o.probability * o.salePrice, 0);

  // Liquidity-aware: expected qty of each outcome across the batch, priced with slippage
  const liqRev = p.outcomes.reduce((s, o) => {
    const expectedQty = o.probability * p.attempts;
    const eff = effectivePrice(o.salePrice, expectedQty, o.dailyVolume, horizon, k);
    return s + o.probability * eff;
  }, 0);

  const evPerAttempt = liqRev - fixed;
  const evPerAttemptNaive = naiveRev - fixed;

  const variance = p.outcomes.reduce((s, o) => s + o.probability * (o.salePrice - naiveRev) ** 2, 0);
  const stdDev = Math.sqrt(variance);

  const pTarget = p.outcomes.filter((o) => o.isTarget).reduce((s, o) => s + o.probability, 0);
  const pHitTarget = 1 - (1 - pTarget) ** p.attempts;

  const bricks = p.outcomes.filter((o) => !o.isTarget);
  const brickProb = bricks.reduce((s, o) => s + o.probability, 0) || 1;
  const avgBrick = bricks.reduce((s, o) => {
    const expectedQty = o.probability * p.attempts;
    const eff = effectivePrice(o.salePrice, expectedQty, o.dailyVolume, horizon, k);
    return s + (o.probability / brickProb) * eff;
  }, 0);

  const order: Confidence[] = ["high", "medium", "low"];
  const worst = p.outcomes.reduce<Confidence>((w, o) => {
    const c = o.confidence ?? "low";
    return order.indexOf(c) > order.indexOf(w) ? c : w;
  }, "high");
  const provCounts = p.outcomes.reduce<Record<string, number>>((m, o) => {
    const k2 = o.provenance ?? "estimate"; m[k2] = (m[k2] ?? 0) + 1; return m;
  }, {});
  const provenanceNote = Object.entries(provCounts).map(([k2, n]) => `${n} ${k2}`).join(", ");

  return {
    ok: true,
    evPerAttempt,
    evPerAttemptNaive,
    slippageDragPct: evPerAttemptNaive !== 0 ? ((evPerAttemptNaive - evPerAttempt) / Math.abs(evPerAttemptNaive)) * 100 : 0,
    expectedProfit: evPerAttempt * p.attempts,
    totalCost: fixed * p.attempts,
    totalRevenue: liqRev * p.attempts,
    roiPct: fixed > 0 ? (evPerAttempt / fixed) * 100 : 0,
    pHitTarget,
    stdDevPerAttempt: stdDev,
    brickFloorEV: avgBrick - fixed,
    worstConfidence: worst,
    provenanceNote,
  };
}

/** Monte Carlo with the same slippage model applied to realized batch composition. */
export function simulate(p: CraftProject, runs = 4000) {
  const cum: number[] = []; let acc = 0;
  for (const o of p.outcomes) { acc += o.probability; cum.push(acc); }
  const fixed = p.costPerAttempt + (p.baseAcquisitionCost ?? 0);
  const horizon = p.horizonDays ?? 3, k = p.slippageK ?? 0.5;
  const profits: number[] = [];
  for (let r = 0; r < runs; r++) {
    const counts = new Array(p.outcomes.length).fill(0);
    for (let i = 0; i < p.attempts; i++) {
      const x = Math.random();
      let idx = cum.findIndex((c) => x <= c); if (idx === -1) idx = p.outcomes.length - 1;
      counts[idx]++;
    }
    let rev = 0;
    for (let j = 0; j < p.outcomes.length; j++) {
      const o = p.outcomes[j];
      rev += counts[j] * effectivePrice(o.salePrice, counts[j], o.dailyVolume, horizon, k);
    }
    profits.push(rev - fixed * p.attempts);
  }
  profits.sort((a, b) => a - b);
  const q = (f: number) => profits[Math.floor(f * (profits.length - 1))];
  return { p5: q(0.05), p50: q(0.5), p95: q(0.95), pProfit: profits.filter((x) => x > 0).length / profits.length };
}
