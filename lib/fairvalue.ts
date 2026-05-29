/**
 * Fair-value + liquidity estimation from a poe2scout PriceHistory series.
 *
 * The Items endpoint only gives a single CurrentPrice (no median/volume), so
 * "is this underpriced?" is computed HERE from the {Price,Time,Quantity}
 * history series, with outlier rejection and an honest confidence score.
 */
import type { PricePoint } from "./types";

export type Confidence = "high" | "medium" | "low" | "none";

export type FairValue = {
  fair: number;            // robust central price (median of inliers)
  mean: number;
  current: number;         // most-recent observed price
  discountPct: number;     // (fair - current) / fair * 100  (positive = cheap)
  sampleSize: number;      // # history points used
  inliers: number;         // # after MAD outlier rejection
  dispersionPct: number;   // robust CoV — how noisy the price is
  volumePerDay: number;    // avg Quantity per ~24h
  lookbackDays: number;
  confidence: Confidence;
  reason: string;          // why this confidence (provenance)
};

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median Absolute Deviation — robust outlier rejection (drops troll listings). */
function rejectOutliers(xs: number[], k = 3.5): number[] {
  if (xs.length < 4) return xs;
  const med = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - med))) || 1e-9;
  // 0.6745 scales MAD to ~stddev for a normal distribution
  return xs.filter((x) => Math.abs((0.6745 * (x - med)) / mad) <= k);
}

export function fairValueFromHistory(history: PricePoint[], currentPrice?: number): FairValue {
  const prices = history.map((h) => h.Price).filter((p) => p > 0);
  const current = currentPrice ?? prices[0] ?? 0;

  if (prices.length === 0) {
    return {
      fair: current, mean: current, current, discountPct: 0,
      sampleSize: 0, inliers: 0, dispersionPct: 0, volumePerDay: 0,
      lookbackDays: 0, confidence: "none", reason: "No price history available",
    };
  }

  const inliers = rejectOutliers(prices);
  const fair = median(inliers);
  const mean = inliers.reduce((s, x) => s + x, 0) / inliers.length;
  const mad = median(inliers.map((x) => Math.abs(x - fair))) || 0;
  const dispersionPct = fair > 0 ? (1.4826 * mad / fair) * 100 : 0;

  // lookback span + volume
  const times = history.map((h) => new Date(h.Time).getTime()).filter((t) => !isNaN(t));
  const spanMs = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
  const lookbackDays = spanMs / 86_400_000;
  const totalQty = history.reduce((s, h) => s + (h.Quantity ?? 0), 0);
  const volumePerDay = lookbackDays > 0 ? totalQty / lookbackDays : totalQty;

  // Confidence: needs enough samples, low dispersion, real volume
  let confidence: Confidence = "low";
  const reasons: string[] = [];
  if (prices.length >= 12 && dispersionPct < 25 && volumePerDay >= 5) {
    confidence = "high"; reasons.push(`${prices.length} points, ${dispersionPct.toFixed(0)}% dispersion, ${volumePerDay.toFixed(0)}/day`);
  } else if (prices.length >= 6 && dispersionPct < 60) {
    confidence = "medium"; reasons.push(`${prices.length} points, ${dispersionPct.toFixed(0)}% dispersion`);
  } else {
    reasons.push(`only ${prices.length} points / ${dispersionPct.toFixed(0)}% dispersion`);
  }
  if (prices.length - inliers.length > 0) reasons.push(`${prices.length - inliers.length} outlier(s) rejected`);

  const discountPct = fair > 0 ? ((fair - current) / fair) * 100 : 0;

  // Artifact guard: a discount/premium beyond ~75% almost always means stale or
  // noisy history rather than a real edge (penny items, dead listings, a single
  // spiked print). Force confidence down so these can't masquerade as signal.
  if (Math.abs(discountPct) > 75) {
    confidence = "low";
    reasons.push(`implausible ${discountPct.toFixed(0)}% gap — likely stale/noisy history, not a real edge`);
  }

  return {
    fair, mean, current, discountPct,
    sampleSize: prices.length, inliers: inliers.length, dispersionPct,
    volumePerDay, lookbackDays, confidence, reason: reasons.join("; "),
  };
}

/** Map volume/day to an expected time-to-liquidate bucket. */
export function holdTime(volumePerDay: number): string {
  if (!volumePerDay) return "unknown — no volume data";
  const perHour = volumePerDay / 24;
  if (perHour >= 10) return "minutes (deep liquidity)";
  if (perHour >= 2) return "under 1 hour";
  if (perHour >= 0.5) return "1–6 hours";
  if (perHour >= 0.1) return "6–24 hours";
  return "days (thin — patient hold)";
}
