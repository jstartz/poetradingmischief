/**
 * Item search — substring match across the REAL unique categories
 * (accessory, armour, weapon, jewel, flask, ...). Returns current price (base
 * unit + Divine-equiv) and, when the name matches a catalog recipe, the value
 * drivers for that item so the EV page asks about the RIGHT dimensions.
 */
import { NextRequest } from "next/server";
import { getCurrentLeague, getItems, getCategories, divineRate, type Realm } from "@/lib/poe2scout";
import { RECIPES } from "@/data/recipes";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
  const realm = (u.searchParams.get("realm") ?? "poe2") as Realm;
  if (!q) return Response.json({ ok: true, results: [] });

  try {
    const league = await getCurrentLeague(realm);
    const name = u.searchParams.get("league") || league.Value;
    const divRate = divineRate(league);
    const cats = await getCategories(name, realm);
    const categoryIds: string[] = cats.unique.map((c: { apiId: string }) => c.apiId); // REAL ids, fetched live

    const all: any[] = [];
    await Promise.all(categoryIds.map(async (cat: string) => {
      try {
        const items = await getItems(name, cat, 1, 250, realm);
        for (const it of items) {
          const nm = (it.Name || it.Text || "").toString();
          if (nm.toLowerCase().includes(q)) {
            const recipe = RECIPES.find((r) => r.name.toLowerCase().includes(nm.toLowerCase().split(" ")[0]));
            all.push({
              name: nm,
              base: it.Type ?? "",
              category: cat,
              iconUrl: it.IconUrl,
              currentBase: it.CurrentPrice ?? 0,
              currentDiv: (it.CurrentPrice ?? 0) / divRate,
              itemId: it.ItemId,
              valueDrivers: recipe?.valueDrivers ?? null,
              recipeId: recipe?.id ?? null,
            });
          }
        }
      } catch { /* category may be empty */ }
    }));

    all.sort((a, b) => (b.currentBase ?? 0) - (a.currentBase ?? 0));
    return Response.json({
      ok: true, league: name, baseUnit: league.BaseCurrencyText ?? "Exalted Orb",
      divineRate: divRate, count: all.length, results: all.slice(0, 30),
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? "Search failed" }, { status: 502 });
  }
}
