# PoE 2 EV Lab

Expected-value crafting analysis + market-opportunity finder for **Path of Exile 2**, built on **verified** poe2scout data with honest confidence labelling throughout.

This is the v3 rebuild that addresses a full red-team review. Every API shape is confirmed against real payloads (see `fixtures/real_payloads.json`), zod-parsed at runtime, and the project **compiles, type-checks, unit-tests, and runs** (CI enforced).

## Six tools

1. **Opportunities** — *the composite*. One ranked list joining the two money-makers the original brief asked for: **flips** (buy underpriced unique vs its MAD-filtered history median → relist at fair, minus relist friction) and **crafts** (buy base → enhance → relist outcomes, liquidity-adjusted). Ranked by net Divine margin, each row with a confidence badge.
2. **Recommend** — ranks recipes for your budget / complexity ceiling / league phase / risk profile, with a fully **transparent score breakdown** (no magic numbers — expand the details on any card).
3. **EV Calculator** — liquidity-aware EV for any project: brick-floor analysis, **slippage drag** (naive vs liquidity-adjusted EV), Monte Carlo p5/50/95, P(target hit), and a data-confidence readout.
4. **Item Lookup** — search any unique across the **real** categories; shows live price (base unit + Divine-equivalent) and the value drivers that actually move that item's price.
5. **Flip Scanner** — items + currencies, fair value from price **history** (not a guessed field), with discount %, confidence, expected hold time (from real volume), and gold cost on currency-exchange buys.
6. **Currency Valuation** — honest replacement for the old "arbitrage" tab (see below).

## What changed in the rebuild (red-team fixes)

| Critique | Fix |
|---|---|
| API shapes were **guessed** | Captured real payloads, generated zod schemas in `lib/types.ts`, parse at runtime. Wrong category ids (`unique-amulet` → `accessory`), wrong param casing (`category` → `Category`), and `LogCount` multiple-of-4 rule all corrected. |
| Probabilities **fabricated** | Atziri uses Belton's *observed* (non-uniform) counts; every outcome carries `provenance` (observed/modweight/estimate) + `confidence` + a `verified` date. Estimates are labelled, not hidden. |
| No **slippage** model | EV engine discounts each outcome's realized price by market depth over a sell horizon. Reports naive vs liquidity-adjusted EV and the drag %. |
| Flip→craft→relist loop **missing** | Built as `/api/opportunities` — the headline composite. |
| Never **compiled/tested** | `npm run typecheck`, `npm test` (9 vitest unit tests), and `npm run build` all pass; GitHub Actions runs them on every push. |
| "Live prices" not wired | Fair value derived from real `/History`; flips/opps/valuation all hit live data (verified end-to-end). |
| **Arbitrage** was theoretical | poe2scout exposes one mid-price per currency vs a single Exalted base (a star graph) — **triangular arbitrage is not computable** from it. The tab now honestly does **mean-reversion valuation** and says so. |
| Divine hardcoded as unit | Reference unit comes from the league's `BaseCurrencyText`/`DivinePrice`; prices shown in base unit **and** Divine-equivalent. |
| Magic-number recommender | Score components are explicit and shown per card. |
| Troll-listing / outlier traps | MAD outlier rejection, an implausible-gap guard (>75% ⇒ forced low confidence), a min-volume gate, and an absolute-Divine margin floor. |

## Verified API reference (poe2scout)

| Endpoint | Real shape |
|---|---|
| `GET /{realm}/Leagues` | Array; `Value, IsCurrent, DivinePrice, BaseCurrencyText`. **No league is `IsCurrent` between patches** — selector falls back. |
| `GET /{realm}/Leagues/{L}/Items?Category=&Page=&PerPage=` | **Bare array**; `ItemId, Name, Type, CurrentPrice, IconUrl` (no median/volume). |
| `GET /{realm}/Leagues/{L}/Items/{id}/History?LogCount=` | `LogCount` must be a **multiple of 4**; `{ PriceHistory: [{ Price, Time, Quantity }] }`. The real fair-value + volume source. |
| `GET /{realm}/Leagues/{L}/Currencies/ByCategory?Category=&Page=&PerPage=` | `{ CurrentPage, Pages, Total, Items[] }`; `ApiId, CurrentPrice, PriceLogs[]`. |
| `GET /{realm}/Leagues/{L}/SnapshotPairs` | Pair data vs one Exalted base; `CurrencyOneData.RelativePrice/VolumeTraded`. |
| `GET /{realm}/Leagues/{L}/ExchangeSnapshot` | Only `{ Epoch, Volume, MarketCap, BaseCurrencyApiId }` — **no pairs**. |

Categories are `accessory, armour, weapon, jewel, flask, map, sanctum` (uniques) and `currency, fragments, runes, essences, ...`.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind · zod. API routes run on the Node runtime (history fan-out); the poe2scout proxy is edge-cached.

## Develop / verify

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest — 9 unit tests (EV engine + fair-value)
npm run build       # next production build
npm run dev         # http://localhost:3000
```

## Deploy to Vercel

Push to GitHub → Vercel → Import → Deploy. No env vars. Set a contact email in the `UA` constant in `lib/poe2scout.ts` for polite API use.

## Adding a recipe

Append a `Recipe` to `data/recipes.ts`. Provide `valueDrivers` (the axes that move that item's price), `complexity`, `bestPhase`, and per-outcome `probProvenance`/`probConfidence`/`priceConfidence` + `dailyVolume` (for slippage). Probabilities must sum to 1.0 — the engine refuses otherwise.

## Honesty notes

- Probabilities for corruptions / Vaal / essence slams are **community estimates** (GGG does not publish weights; poe2db has no per-combination ID weights). They are flagged low-confidence. Verify before committing capital.
- Confidence badges reflect *price-data* quality (sample size, dispersion, volume). A high EV with a low badge means "promising, but go confirm on the live trade site."

## License

MIT. Not affiliated with or endorsed by Grinding Gear Games.
