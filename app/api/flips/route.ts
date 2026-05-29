/**
 * Flip scanner — items AND currencies, with REAL fair-value from price history.
 *
 * Pipeline:
 *   1. Pull a category's items (verified shape: bare array, CurrentPrice only).
 *   2. For the cheapest-within-budget candidates, fetch /History and compute a
 *      robust fair value (median of MAD-filtered inliers) + volume + confidence.
 *   3. Flag items trading below fair by >= minDiscount, with enough volume.
 *   4. Currencies: same, via the currency list + their history.
 *
 * Prices are in the league BASE currency (Exalted) with a Divine-equivalent.
 * Gold cost applies to currency-exchange buys only (uniques trade P2P).
 */
import { NextRequest } from "next/server";
import { getCurrentLeague, getItems, getItemHistory, getCurrencies, divineRate, type Realm } from "@/lib/poe2scout";
import { fairValueFromHistory, holdTime } from "@/lib/fairvalue";
import { goldFor } from "@/lib/gold";

export const runtime = "nodejs"; // history fan-out benefits from node runtime

const CONCURRENCY = 6;
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let i = 0;
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return out;
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const realm = (u.searchParams.get("realm") ?? "poe2") as Realm;
  const category = u.searchParams.get("category") ?? "accessory";
  const minDiscount = Number(u.searchParams.get("minDiscount") ?? "15");
  const maxDiscount = Number(u.searchParams.get("maxDiscount") ?? "75"); // reject stale/noise artifacts
  const minVolumePerDay = Number(u.searchParams.get("minVolume") ?? "2");
  const minMarginDiv = Number(u.searchParams.get("minMargin") ?? "0.5"); // ignore sub-divine penny noise
  const tradeSize = Number(u.searchParams.get("size") ?? "10");
  const includeCurrency = u.searchParams.get("currency") !== "0";
  const includeItems = u.searchParams.get("items") !== "0";
  const maxProbe = Number(u.searchParams.get("probe") ?? "40"); // history calls budget

  try {
    const league = u.searchParams.get("league") || (await getCurrentLeague(realm)).Value;
    const leagues = await getCurrentLeague(realm);
    const baseUnit = leagues.BaseCurrencyText ?? "Exalted Orb";
    const divRate = divineRate(leagues);
    const budgetBase = Number(u.searchParams.get("budget") ?? "0") * divRate || Infinity; // budget given in Divine

    const rows: any[] = [];

    if (includeItems) {
      const items = (await getItems(league, category, 1, 250, realm))
        .filter((it) => (it.CurrentPrice ?? 0) > 0 && (it.CurrentPrice ?? 0) <= budgetBase)
        .sort((a, b) => (a.CurrentPrice ?? 0) - (b.CurrentPrice ?? 0))
        .slice(0, maxProbe);

      const probed = await mapLimit(items, CONCURRENCY, async (it) => {
        try {
          const hist = await getItemHistory(league, it.ItemId, 28, realm);
          const fv = fairValueFromHistory(hist, it.CurrentPrice ?? undefined);
          return { it, fv };
        } catch { return null; }
      });

      for (const p of probed) {
        if (!p) continue;
        const { it, fv } = p;
        if (fv.confidence === "none") continue;
        if (fv.discountPct < minDiscount || fv.discountPct > maxDiscount) continue;
        if (fv.volumePerDay < minVolumePerDay) continue;
        // absolute-margin floor: skip sub-divine penny "flips" that are pure noise
        const marginDiv = (fv.fair - (it.CurrentPrice ?? 0)) / divRate;
        if (marginDiv < minMarginDiv) continue;
        rows.push({
          kind: "item",
          name: it.Name || it.Text || it.Type,
          base: it.Type ?? "",
          iconUrl: it.IconUrl,
          currentBase: it.CurrentPrice,
          fairBase: fv.fair,
          currentDiv: (it.CurrentPrice ?? 0) / divRate,
          fairDiv: fv.fair / divRate,
          discountPct: fv.discountPct,
          confidence: fv.confidence,
          confidenceReason: fv.reason,
          sampleSize: fv.sampleSize,
          dispersionPct: fv.dispersionPct,
          volumePerDay: fv.volumePerDay,
          lookbackDays: fv.lookbackDays,
          expectedHold: holdTime(fv.volumePerDay),
          goldCost: 0, // uniques trade player-to-player — no gold
          tradeUrl: `https://www.pathofexile.com/trade2/search/poe2/${encodeURIComponent(league)}?q=${encodeURIComponent(it.Name || it.Text || "")}`,
        });
      }
    }

    if (includeCurrency) {
      const curs = await getCurrencies(league, "currency", 1, 250, realm);
      const candidates = curs.filter((c) => (c.CurrentPrice ?? 0) > 0).slice(0, maxProbe);
      const probed = await mapLimit(candidates, CONCURRENCY, async (c) => {
        try {
          const hist = await getItemHistory(league, c.ItemId ?? 0, 28, realm);
          const fv = fairValueFromHistory(hist, c.CurrentPrice ?? undefined);
          return { c, fv };
        } catch { return { c, fv: fairValueFromHistory([], c.CurrentPrice ?? undefined) }; }
      });
      for (const { c, fv } of probed) {
        if (fv.confidence === "none" || fv.discountPct < minDiscount || fv.discountPct > maxDiscount) continue;
        const gold = goldFor(c.ApiId) * tradeSize;
        rows.push({
          kind: "currency",
          name: c.Text || c.ApiId,
          apiId: c.ApiId,
          iconUrl: c.IconUrl,
          currentBase: c.CurrentPrice,
          fairBase: fv.fair,
          currentDiv: (c.CurrentPrice ?? 0) / divRate,
          fairDiv: fv.fair / divRate,
          discountPct: fv.discountPct,
          confidence: fv.confidence,
          confidenceReason: fv.reason,
          sampleSize: fv.sampleSize,
          dispersionPct: fv.dispersionPct,
          volumePerDay: fv.volumePerDay,
          lookbackDays: fv.lookbackDays,
          expectedHold: holdTime(fv.volumePerDay),
          goldCostPerUnit: goldFor(c.ApiId),
          goldCost: gold,
        });
      }
    }

    rows.sort((a, b) => b.discountPct - a.discountPct);

    return Response.json({
      ok: true,
      league,
      baseUnit,
      divineRate: divRate,
      tradeSize,
      count: rows.length,
      methodology:
        `Fair value = median of MAD-outlier-filtered price history (LogCount=28). Discount % = (fair − current)/fair. ` +
        `Rows require confidence != none, discount ≥ ${minDiscount}%, and ≥ ${minVolumePerDay} units/day volume (kills troll listings & dead items). ` +
        `Prices shown in ${baseUnit} and Divine-equivalent (1 Div = ${divRate.toFixed(1)} ${baseUnit}). ` +
        `Gold cost applies to currency-exchange buys only; uniques trade player-to-player (no gold).`,
      rows: rows.slice(0, 100),
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? "Upstream error" }, { status: 502 });
  }
}
