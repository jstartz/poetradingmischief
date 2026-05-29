import { describe, it, expect } from "vitest";
import { evaluateProject, simulate } from "../lib/ev";
import { fairValueFromHistory } from "../lib/fairvalue";
import type { PricePoint } from "../lib/types";

describe("EV engine", () => {
  const base = {
    name: "t", costPerAttempt: 1, baseAcquisitionCost: 600, attempts: 50,
    outcomes: [
      { id: "a", label: "hit", probability: 0.1, salePrice: 5000, isTarget: true, dailyVolume: 5 },
      { id: "b", label: "brick", probability: 0.9, salePrice: 400, dailyVolume: 8 },
    ],
  };

  it("rejects probabilities that do not sum to 1.0", () => {
    const r = evaluateProject({ ...base, outcomes: [{ id: "x", label: "x", probability: 0.5, salePrice: 1 }] });
    expect(r.ok).toBe(false);
  });

  it("computes a positive EV when expected revenue exceeds cost", () => {
    const r = evaluateProject(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // naive expected revenue = 0.1*5000 + 0.9*400 = 860; cost = 601 -> +259
      expect(r.evPerAttemptNaive).toBeCloseTo(259, 0);
      expect(r.evPerAttempt).toBeLessThanOrEqual(r.evPerAttemptNaive); // slippage can only reduce
    }
  });

  it("applies slippage drag when batch volume exceeds market depth", () => {
    // tiny daily volume -> flooding the market -> big drag
    const thin = { ...base, attempts: 500, outcomes: base.outcomes.map((o) => ({ ...o, dailyVolume: 1 })) };
    const r = evaluateProject(thin);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slippageDragPct).toBeGreaterThan(0);
  });

  it("propagates worst-case confidence", () => {
    const r = evaluateProject({
      ...base,
      outcomes: [
        { id: "a", label: "hit", probability: 0.1, salePrice: 5000, isTarget: true, confidence: "high" },
        { id: "b", label: "brick", probability: 0.9, salePrice: 400, confidence: "low" },
      ],
    });
    if (r.ok) expect(r.worstConfidence).toBe("low");
  });

  it("Monte Carlo p5 <= p50 <= p95", () => {
    const s = simulate(base, 1000);
    expect(s.p5).toBeLessThanOrEqual(s.p50);
    expect(s.p50).toBeLessThanOrEqual(s.p95);
    expect(s.pProfit).toBeGreaterThanOrEqual(0);
    expect(s.pProfit).toBeLessThanOrEqual(1);
  });
});

describe("Fair-value estimator", () => {
  const mk = (prices: number[]): PricePoint[] =>
    prices.map((p, i) => ({ Price: p, Time: new Date(Date.now() - i * 6 * 3600_000).toISOString(), Quantity: 10 }));

  it("returns confidence=none for empty history", () => {
    const fv = fairValueFromHistory([], 5);
    expect(fv.confidence).toBe("none");
  });

  it("rejects a single troll/spiked outlier via MAD", () => {
    const fv = fairValueFromHistory(mk([100, 102, 98, 101, 99, 100, 100, 103, 97, 100, 100, 999999]));
    // median should be ~100, not dragged by the 999999 print
    expect(fv.fair).toBeGreaterThan(90);
    expect(fv.fair).toBeLessThan(110);
    expect(fv.inliers).toBeLessThan(fv.sampleSize);
  });

  it("flags implausible discounts as low confidence (artifact guard)", () => {
    // current is 1, history median ~100 -> 99% discount -> must be forced low
    const fv = fairValueFromHistory(mk([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]), 1);
    expect(Math.abs(fv.discountPct)).toBeGreaterThan(75);
    expect(fv.confidence).toBe("low");
  });

  it("earns high confidence with many tight, liquid samples", () => {
    const fv = fairValueFromHistory(mk(Array(16).fill(0).map((_, i) => 100 + (i % 3))), 100);
    expect(fv.confidence).toBe("high");
  });
});
