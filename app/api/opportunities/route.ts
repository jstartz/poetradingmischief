/**
 * THE COMPOSITE — flip -> (optional craft) -> relist, ranked by net margin.
 *
 * This is the feature the brief actually asked for: "buying certain bases,
 * doing a minor enhancement via crafting, and relisting." The flip scanner and
 * EV calculator were disconnected; this joins them.
 *
 * It produces two opportunity types on ONE ranked list of net margin per
 * execution (Divine), each with the full chain shown:
 *   - "flip"  : buy an underpriced item, relist at fair value (no craft).
 *               net = fairProceeds*(1−sellHaircut) − buyPrice
 *   - "craft" : run an EV-positive recipe within budget (buy base → enhance →
 *               sell outcomes), already liquidity-adjusted by the EV engine.
 *
 * Every row carries confidence + provenance so low-trust rows can be filtered.
 */
import { NextRequest } from "next/server";
import { getCurrentLeague, getItems, getItemHistory, divineRate, type Realm } from "@/lib/poe2scout";
import { fairValueFromHistory, holdTime } from "@/lib/fairvalue";
import { evaluateProject } from "@/lib/ev";
import { RECIPES } from "@/data/recipes";

export const runtime = "nodejs";

const CONCURRENCY = 6;
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let i = 0;
  await Promise.all(Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const realm = (u.searchParams.get("realm") ?? "poe2") as Realm;
  const budgetDiv = Number(u.searchParams.get("budget") ?? "500");
  const category = u.searchParams.get("category") ?? "accessory";
  const minDiscount = Number(u.searchParams.get("minDiscount") ?? "15");
  const maxDiscount = Number(u.searchParams.get("maxDiscount") ?? "75"); // reject stale/noise artifacts
  const minVolume = Number(u.searchParams.get("minVolume") ?? "2");
  const minMarginDiv = Number(u.searchParams.get("minMargin") ?? "1"); // ignore sub-divine penny noise
  const sellHaircut = Number(u.searchParams.get("haircut") ?? "0.10"); // P2P relist friction (undercut + time)
  const complexityMax = Number(u.searchParams.get("complexity") ?? "5");

  try {
    const league = await getCurrentLeague(realm);
    const name = u.searchParams.get("league") || league.Value;
    const divRate = divineRate(league);
    const baseUnit = league.BaseCurrencyText ?? "Exalted Orb";
    const opportunities: any[] = [];

    // ---- (A) PURE FLIPS: underpriced uniques in budget, relist at fair ----
    const items = (await getItems(name, category, 1, 250, realm))
      .filter((it) => (it.CurrentPrice ?? 0) > 0 && (it.CurrentPrice ?? 0) / divRate <= budgetDiv)
      .sort((a, b) => (a.CurrentPrice ?? 0) - (b.CurrentPrice ?? 0))
      .slice(0, 40);

    const probed = await mapLimit(items, CONCURRENCY, async (it) => {
      try { return { it, fv: fairValueFromHistory(await getItemHistory(name, it.ItemId, 28, realm), it.CurrentPrice ?? undefined) }; }
      catch { return null; }
    });

    for (const p of probed) {
      if (!p) continue;
      const { it, fv } = p;
      if (fv.confidence === "none" || fv.discountPct < minDiscount || fv.discountPct > maxDiscount || fv.volumePerDay < minVolume) continue;
      const buyDiv = (it.CurrentPrice ?? 0) / divRate;
      const fairDiv = fv.fair / divRate;
      const proceeds = fairDiv * (1 - sellHaircut);
      const net = proceeds - buyDiv;
      if (net < minMarginDiv) continue; // absolute-divine floor — kills penny-item noise
      opportunities.push({
        type: "flip",
        name: it.Name || it.Text,
        chain: [
          `Buy @ ${buyDiv.toFixed(1)} div`,
          `Relist @ fair ${fairDiv.toFixed(1)} div (−${(sellHaircut * 100).toFixed(0)}% relist friction)`,
        ],
        acquireCostDiv: buyDiv,
        expectedProceedsDiv: proceeds,
        netMarginDiv: net,
        roiPct: (net / buyDiv) * 100,
        confidence: fv.confidence,
        confidenceReason: fv.reason,
        expectedHold: holdTime(fv.volumePerDay),
        volumePerDay: fv.volumePerDay,
        tradeUrl: `https://www.pathofexile.com/trade2/search/poe2/${encodeURIComponent(name)}?q=${encodeURIComponent(it.Name || it.Text || "")}`,
      });
    }

    // ---- (B) CRAFT PLAYS: EV-positive recipes within budget ----
    for (const recipe of RECIPES) {
      if (recipe.complexity > complexityMax) continue;
      const baseCost = recipe.basePriceFallback ?? 0;
      const matCost = recipe.materials.reduce((s, m) => s + m.fallbackPrice * m.qty, 0);
      const perAttempt = baseCost + matCost;
      if (perAttempt <= 0 || perAttempt > budgetDiv) continue;
      const attempts = Math.max(1, Math.floor(budgetDiv / perAttempt));
      const ev = evaluateProject({
        name: recipe.name, costPerAttempt: matCost, baseAcquisitionCost: baseCost, attempts,
        outcomes: recipe.outcomes.map((o) => ({
          id: o.id, label: o.label, probability: o.probability, salePrice: o.fallbackPrice,
          isTarget: o.isTarget, dailyVolume: o.dailyVolume, confidence: o.priceConfidence, provenance: o.priceProvenance,
        })),
      });
      if (!ev.ok || ev.evPerAttempt <= 0) continue;
      opportunities.push({
        type: "craft",
        name: recipe.name,
        chain: [
          `Buy base @ ${baseCost} div`,
          `Apply: ${recipe.materials.map((m) => `${m.qty}× ${m.priceKey}`).join(" + ")}`,
          `Relist outcomes (liquidity-adjusted)`,
        ],
        acquireCostDiv: perAttempt,
        expectedProceedsDiv: ev.evPerAttempt + perAttempt,
        netMarginDiv: ev.evPerAttempt,           // per single execution
        netMarginBatchDiv: ev.expectedProfit,    // across max affordable attempts
        attempts,
        roiPct: ev.roiPct,
        slippageDragPct: ev.slippageDragPct,
        confidence: ev.worstConfidence,
        confidenceReason: ev.provenanceNote,
        brickFloorDiv: ev.brickFloorEV,
      });
    }

    opportunities.sort((a, b) => (b.netMarginBatchDiv ?? b.netMarginDiv) - (a.netMarginBatchDiv ?? a.netMarginDiv));

    return Response.json({
      ok: true,
      league: name,
      baseUnit,
      divineRate: divRate,
      count: opportunities.length,
      methodology:
        "Unified net-margin ranking. FLIP rows: buy underpriced unique (vs MAD-filtered history median) and relist at fair, minus a relist-friction haircut. CRAFT rows: EV-positive recipes within budget, liquidity-adjusted (slippage) by the EV engine, ranked by expected batch profit. All values in Divine. Confidence reflects price-data quality — low-confidence rows should be verified on the live trade site first.",
      opportunities: opportunities.slice(0, 60),
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? "Upstream error" }, { status: 502 });
  }
}
