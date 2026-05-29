/**
 * Currency valuation scanner (formerly "arbitrage").
 *
 * HONEST SCOPE CORRECTION (red-team finding): poe2scout's exchange data is a
 * STAR graph — every SnapshotPair shares the same Exalted base and the API
 * exposes a single mid RelativePrice per currency, not two-sided order-book
 * depth. Triangular arbitrage requires either cross-pairs (A↔B, B↔C, C↔A) or
 * bid/ask spreads; neither exists here. So we DO NOT fabricate arbitrage loops.
 *
 * What the data CAN support, and what we return instead:
 *   - Each currency's current exchange rate vs the league base (Exalted).
 *   - Mispricing vs a robust mean of its recent history (under/over-valued).
 *   - Traded volume, so you can see what's actually liquid.
 * This is a valuation/mean-reversion signal, not riskless arbitrage.
 */
import { NextRequest } from "next/server";
import { getCurrentLeague, getSnapshotPairs, getCurrencies, getItemHistory, divineRate, type Realm } from "@/lib/poe2scout";
import { fairValueFromHistory } from "@/lib/fairvalue";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const realm = (u.searchParams.get("realm") ?? "poe2") as Realm;
  const minMispricing = Number(u.searchParams.get("minMispricing") ?? "8");

  try {
    const league = await getCurrentLeague(realm);
    const leagueName = u.searchParams.get("league") || league.Value;
    const baseUnit = league.BaseCurrencyText ?? "Exalted Orb";
    const divRate = divineRate(league);

    // Live traded pairs (gives volume + relative price vs base)
    const pairs = await getSnapshotPairs(leagueName, realm).catch(() => []);
    const liveRates = pairs.map((p) => ({
      currency: p.CurrencyOne.Text ?? p.CurrencyOne.ApiId,
      apiId: p.CurrencyOne.ApiId,
      ratePerBase: p.CurrencyOneData.RelativePrice, // units of base per 1 of this currency
      volumeTraded: p.CurrencyOneData.VolumeTraded ?? 0,
      stock: p.CurrencyOneData.HighestStock ?? 0,
    }));

    // Mispricing vs robust historical mean, for the most-liquid currencies
    const curs = (await getCurrencies(leagueName, "currency", 1, 250, realm)).filter((c) => (c.CurrentPrice ?? 0) > 0);
    const valued: any[] = [];
    for (const c of curs.slice(0, 30)) {
      let fv;
      try { fv = fairValueFromHistory(await getItemHistory(leagueName, c.ItemId ?? 0, 28, realm), c.CurrentPrice ?? undefined); }
      catch { continue; }
      if (fv.confidence === "none") continue;
      const mispricing = fv.discountPct; // + = currently cheap vs its own mean
      // require a real signal AND reject implausible (>75%) gaps that are just
      // stale/noisy history rather than tradeable mispricing; require volume.
      if (Math.abs(mispricing) < minMispricing || Math.abs(mispricing) > 75) continue;
      if (fv.volumePerDay < 2) continue;
      valued.push({
        currency: c.Text || c.ApiId,
        apiId: c.ApiId,
        iconUrl: c.IconUrl,
        currentBase: c.CurrentPrice,
        meanBase: fv.fair,
        currentDiv: (c.CurrentPrice ?? 0) / divRate,
        signal: mispricing > 0 ? "undervalued (mean-revert up)" : "overvalued (mean-revert down)",
        mispricingPct: mispricing,
        volumePerDay: fv.volumePerDay,
        confidence: fv.confidence,
        confidenceReason: fv.reason,
      });
    }
    valued.sort((a, b) => Math.abs(b.mispricingPct) - Math.abs(a.mispricingPct));

    return Response.json({
      ok: true,
      league: leagueName,
      baseUnit,
      trueArbitrageSupported: false,
      arbitrageNote:
        "True triangular arbitrage is NOT computable from this data: poe2scout exposes a single mid-price per currency against one Exalted base (a star graph), with no cross-pairs and no bid/ask depth. Riskless loops require order-book spreads this API does not provide. Shown instead: mean-reversion mispricing — a directional signal, not a guaranteed profit.",
      methodology:
        "Mispricing % = (robust historical mean − current) / mean, from MAD-filtered price history. Positive = trading below its own recent mean (candidate to buy); negative = above. Volume/day indicates whether the signal is tradeable.",
      liveRates,
      valued: valued.slice(0, 50),
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? "Upstream error" }, { status: 502 });
  }
}
