"use client";
import { useEffect, useMemo, useState } from "react";
import { RECIPES } from "@/data/recipes";
import { evaluateProject, simulate } from "@/lib/ev";
import { goldFor } from "@/lib/gold";
import { Flame, TrendingUp, Calculator, Search, RefreshCw, Compass, ArrowRightLeft, Wand2, Lightbulb, Target } from "lucide-react";

type LeagueOpt = { Value: string; IsCurrent?: boolean; DivinePrice?: number; BaseCurrencyText?: string };

// ---- shared confidence badge ----
function Conf({ level, reason }: { level?: string; reason?: string }) {
  if (!level) return null;
  const map: Record<string, string> = {
    high: "bg-emerald-100 text-emerald-900 border-emerald-200",
    medium: "bg-amber-100 text-amber-900 border-amber-200",
    low: "bg-rose-100 text-rose-900 border-rose-200",
    none: "bg-neutral-100 text-neutral-600 border-neutral-200",
  };
  return (
    <span title={reason} className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${map[level] ?? map.none}`}>
      {level} conf
    </span>
  );
}

export default function Page() {
  const [leagues, setLeagues] = useState<LeagueOpt[]>([]);
  const [league, setLeague] = useState<string>("");
  const [baseUnit, setBaseUnit] = useState<string>("Exalted Orb");
  const [divRate, setDivRate] = useState<number>(1);
  const [leagueLoading, setLeagueLoading] = useState(false);

  async function refreshLeagues() {
    setLeagueLoading(true);
    try {
      const r = await fetch("/api/poe2scout/poe2/Leagues", { cache: "no-store" });
      const j = await r.json();
      const list: LeagueOpt[] = (Array.isArray(j) ? j : j?.data ?? [])
        .map((l: any) => ({ Value: l.Value ?? l.value, IsCurrent: l.IsCurrent, DivinePrice: l.DivinePrice, BaseCurrencyText: l.BaseCurrencyText }))
        .filter((l: LeagueOpt) => !!l.Value);
      setLeagues(list);
      // NOTE: between patches NO league is IsCurrent=true (verified live), so fall back.
      const current =
        list.find((l) => l.IsCurrent) ??
        list.find((l) => !/^(HC |Standard|Hardcore)/i.test(l.Value) && !/SSF/i.test(l.Value)) ??
        list[0];
      if (current) { setLeague(current.Value); setDivRate(current.DivinePrice || 1); setBaseUnit(current.BaseCurrencyText || "Exalted Orb"); }
    } finally { setLeagueLoading(false); }
  }
  useEffect(() => { refreshLeagues(); }, []);

  const [tab, setTab] = useState<"opps" | "recommend" | "calc" | "items" | "flips" | "valuation">("opps");
  const ctx = { league, baseUnit, divRate };

  return (
    <main className="min-h-screen bg-[#faf7f0] text-neutral-900">
      <header className="border-b border-neutral-900/10 bg-[#faf7f0]/85 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3">
          <Flame className="text-orange-700" />
          <div className="flex-1">
            <h1 className="font-display text-2xl font-semibold leading-none">PoE 2 EV Lab</h1>
            <div className="text-[10px] uppercase tracking-[0.22em] text-neutral-500 mt-1">Opportunities · Recommend · Craft · Lookup · Flip · Valuation</div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-500">League</span>
            <select value={league} onChange={(e) => {
              setLeague(e.target.value);
              const l = leagues.find((x) => x.Value === e.target.value);
              if (l) { setDivRate(l.DivinePrice || 1); setBaseUnit(l.BaseCurrencyText || "Exalted Orb"); }
            }} className="border border-neutral-900/20 rounded px-2 py-1 bg-white">
              {leagues.map((l) => <option key={l.Value} value={l.Value}>{l.Value}{l.IsCurrent ? " · current" : ""}</option>)}
            </select>
            <button onClick={refreshLeagues} disabled={leagueLoading} className="border border-neutral-900/20 rounded p-1.5 hover:bg-white" title="Refresh">
              <RefreshCw size={12} className={leagueLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-6 flex gap-1 text-xs overflow-x-auto">
          {[
            ["opps", Target, "Opportunities"],
            ["recommend", Lightbulb, "Recommend"],
            ["calc", Calculator, "EV Calculator"],
            ["items", Wand2, "Item Lookup"],
            ["flips", Search, "Flip Scanner"],
            ["valuation", ArrowRightLeft, "Currency Valuation"],
          ].map(([id, Icon, label]: any) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 whitespace-nowrap transition ${tab === id ? "border-orange-700 text-orange-900 font-semibold" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {tab === "opps" && <OpportunitiesTab ctx={ctx} />}
        {tab === "recommend" && <RecommendTab ctx={ctx} />}
        {tab === "calc" && <CalcTab ctx={ctx} />}
        {tab === "items" && <ItemsTab ctx={ctx} />}
        {tab === "flips" && <FlipsTab ctx={ctx} />}
        {tab === "valuation" && <ValuationTab ctx={ctx} />}
      </div>

      <footer className="max-w-7xl mx-auto px-6 py-8 text-[11px] text-neutral-500 border-t border-neutral-900/5">
        Data: <a className="underline" href="https://poe2scout.com">poe2scout</a> (verified shapes, zod-parsed). Prices in {baseUnit} + Divine-equivalent.
        Every figure carries a confidence badge — verify low-confidence rows on the live trade site. Not affiliated with GGG.
      </footer>
    </main>
  );
}

type Ctx = { league: string; baseUnit: string; divRate: number };

// =====================================================================
// OPPORTUNITIES — the composite flip→craft→relist ranked list
// =====================================================================
function OpportunitiesTab({ ctx }: { ctx: Ctx }) {
  const [budget, setBudget] = useState(500);
  const [category, setCategory] = useState("accessory");
  const [complexity, setComplexity] = useState(5);
  const [minConf, setMinConf] = useState("low");
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function scan() {
    if (!ctx.league) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/opportunities?league=${encodeURIComponent(ctx.league)}&budget=${budget}&category=${category}&complexity=${complexity}`);
      const j = await r.json();
      setRows(j?.opportunities ?? []);
      setMeta(j);
    } finally { setLoading(false); }
  }

  const order = ["high", "medium", "low"];
  const filtered = rows.filter((r) => order.indexOf(r.confidence ?? "low") <= order.indexOf(minConf));

  return (
    <div>
      <div className="bg-white border border-neutral-900/10 rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm items-end">
        <label className="block"><span className="text-neutral-600">Budget (Divine)</span>
          <input type="number" value={budget} onChange={(e) => setBudget(+e.target.value)} className="w-full mt-1 border border-neutral-900/20 rounded px-2 py-1.5" /></label>
        <label className="block"><span className="text-neutral-600">Flip category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full mt-1 border border-neutral-900/20 rounded px-2 py-1.5">
            {["accessory", "armour", "weapon", "jewel", "flask"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label className="block"><span className="text-neutral-600">Max craft complexity</span>
          <input type="range" min={1} max={5} value={complexity} onChange={(e) => setComplexity(+e.target.value)} className="w-full" />
          <div className="text-xs text-orange-900">{["Trivial", "Easy", "Moderate", "Advanced", "Expert"][complexity - 1]}</div></label>
        <label className="block"><span className="text-neutral-600">Min confidence</span>
          <select value={minConf} onChange={(e) => setMinConf(e.target.value)} className="w-full mt-1 border border-neutral-900/20 rounded px-2 py-1.5">
            <option value="low">Low+ (all)</option><option value="medium">Medium+</option><option value="high">High only</option>
          </select></label>
        <button onClick={scan} disabled={loading || !ctx.league} className="bg-orange-700 hover:bg-orange-800 text-white rounded px-4 py-2 flex items-center justify-center gap-2">
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <Target size={14} />} Find opportunities
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900 mb-4">
        <b>The composite:</b> unifies two money-makers the brief asked for on one net-margin ranking — <b>FLIP</b> (buy underpriced unique vs MAD-filtered history median → relist at fair minus friction) and <b>CRAFT</b> (buy base → enhance → relist outcomes, liquidity-adjusted). {meta?.methodology ? "" : "Click Find opportunities."}
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && !loading && <Empty>No opportunities yet — run a scan (try raising budget or lowering min confidence).</Empty>}
        {filtered.map((o, i) => (
          <div key={i} className="bg-white border border-neutral-900/10 rounded-lg p-5">
            <div className="flex items-start gap-3">
              <div className="text-2xl font-bold text-orange-900 font-mono w-8 text-center">{i + 1}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${o.type === "flip" ? "bg-blue-100 text-blue-900" : "bg-purple-100 text-purple-900"}`}>{o.type}</span>
                  <h3 className="font-display text-lg font-semibold">{o.name}</h3>
                  <Conf level={o.confidence} reason={o.confidenceReason} />
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-neutral-600 flex-wrap">
                  {o.chain?.map((step: string, j: number) => (
                    <span key={j} className="flex items-center gap-1.5">
                      <span className="bg-neutral-100 px-2 py-0.5 rounded">{step}</span>
                      {j < o.chain.length - 1 && <span className="text-neutral-400">→</span>}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">Net margin {o.type === "craft" ? "(batch)" : ""}</div>
                <div className="font-mono text-2xl font-bold text-emerald-700">+{(o.netMarginBatchDiv ?? o.netMarginDiv).toFixed(1)} div</div>
                <div className="text-[10px] text-neutral-500">ROI {o.roiPct?.toFixed(0)}% {o.attempts ? `· ${o.attempts} attempts` : ""}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3 border-t border-neutral-900/5 text-xs">
              <Field label="Acquire cost" value={`${o.acquireCostDiv?.toFixed(1)} div`} />
              <Field label="Expected proceeds" value={`${o.expectedProceedsDiv?.toFixed(1)} div`} />
              {o.expectedHold && <Field label="Expected hold" value={o.expectedHold} />}
              {o.volumePerDay != null && <Field label="Volume" value={`${o.volumePerDay.toFixed(0)}/day`} />}
              {o.brickFloorDiv != null && <Field label="Brick-floor EV" value={`${o.brickFloorDiv.toFixed(1)} div`} />}
              {o.slippageDragPct != null && <Field label="Liquidity drag" value={`${o.slippageDragPct.toFixed(0)}%`} />}
            </div>
            {o.tradeUrl && <a href={o.tradeUrl} target="_blank" rel="noopener" className="text-orange-700 underline text-xs mt-2 inline-block">Open on trade site →</a>}
          </div>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// RECOMMEND
// =====================================================================
function RecommendTab({ ctx }: { ctx: Ctx }) {
  const [budget, setBudget] = useState(500);
  const [complexity, setComplexity] = useState(3);
  const [phase, setPhase] = useState("week1");
  const [risk, setRisk] = useState("neutral");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const r = await fetch(`/api/recommend?budget=${budget}&complexity=${complexity}&phase=${phase}&risk=${risk}`);
      const j = await r.json();
      setResults(j?.results ?? []);
    } finally { setLoading(false); }
  }
  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="grid lg:grid-cols-12 gap-6">
      <aside className="lg:col-span-3 bg-white border border-neutral-900/10 rounded-lg p-5 h-fit sticky top-32">
        <h2 className="font-display text-lg font-semibold mb-4">Inputs</h2>
        <div className="space-y-4 text-sm">
          <label className="block"><span className="text-neutral-600">Budget (Divine)</span>
            <input type="number" value={budget} onChange={(e) => setBudget(+e.target.value)} className="w-full mt-1 border border-neutral-900/20 rounded px-2 py-1.5" /></label>
          <label className="block"><span className="text-neutral-600">Max complexity (1→5)</span>
            <input type="range" min={1} max={5} value={complexity} onChange={(e) => setComplexity(+e.target.value)} className="w-full" />
            <div className="text-xs text-orange-900 font-semibold">{["Trivial", "Easy", "Moderate", "Advanced", "Expert"][complexity - 1]}</div></label>
          <label className="block"><span className="text-neutral-600">League phase</span>
            <select value={phase} onChange={(e) => setPhase(e.target.value)} className="w-full mt-1 border border-neutral-900/20 rounded px-2 py-1.5">
              <option value="launch">Day 0–3 (launch)</option><option value="week1">Week 1</option>
              <option value="midleague">Mid-league</option><option value="lateleague">Late league</option>
            </select></label>
          <label className="block"><span className="text-neutral-600">Risk profile</span>
            <select value={risk} onChange={(e) => setRisk(e.target.value)} className="w-full mt-1 border border-neutral-900/20 rounded px-2 py-1.5">
              <option value="averse">Averse</option><option value="neutral">Neutral</option><option value="aggressive">Aggressive</option>
            </select></label>
          <button onClick={run} disabled={loading} className="w-full bg-orange-700 hover:bg-orange-800 text-white rounded px-3 py-2 flex items-center justify-center gap-2">
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Compass size={14} />} Rank projects
          </button>
        </div>
      </aside>
      <section className="lg:col-span-9 space-y-4">
        {results.map((r: any) => (
          <article key={r.recipe.id} className="bg-white border border-neutral-900/10 rounded-lg p-5">
            <header className="flex items-start gap-3 mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display text-lg font-semibold">{r.recipe.name}</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-900">{r.recipe.category}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100">Cx {r.recipe.complexity}/5</span>
                  <Conf level={r.worstConfidence} reason={r.recipe.notes} />
                </div>
                {r.recipe.notes && <p className="text-xs text-neutral-600 italic mt-1">{r.recipe.notes}</p>}
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">Score</div>
                <div className="font-mono text-2xl font-bold text-orange-700">{r.score.total.toFixed(0)}</div>
              </div>
            </header>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Field label="EV / attempt" value={`${r.ev.toFixed(1)} div`} good={r.ev > 0} />
              <Field label="Expected profit" value={`${r.expectedProfit.toFixed(0)} div`} good={r.expectedProfit > 0} />
              <Field label="ROI" value={`${r.roiPct.toFixed(0)}%`} good={r.roiPct > 0} />
              <Field label="Attempts" value={`${r.attempts}`} />
              <Field label="P(target hit)" value={`${(r.pHitTarget * 100).toFixed(0)}%`} />
              <Field label="Brick-floor EV" value={`${r.brickFloor.toFixed(0)} div`} good={r.brickFloor > 0} />
              <Field label="Liquidity drag" value={`${r.slippageDragPct.toFixed(0)}%`} />
              <Field label="Std dev" value={`${r.stdDev.toFixed(0)} div`} />
            </div>
            <div className="grid md:grid-cols-2 gap-3 mt-3 pt-3 border-t border-neutral-900/5">
              {r.why?.length > 0 && <div><div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-1">Why this fits</div>
                <ul className="text-xs space-y-0.5">{r.why.map((w: string, i: number) => <li key={i}>• {w}</li>)}</ul></div>}
              {r.caveats?.length > 0 && <div><div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold mb-1">Caveats</div>
                <ul className="text-xs space-y-0.5">{r.caveats.map((c: string, i: number) => <li key={i}>• {c}</li>)}</ul></div>}
            </div>
            <details className="mt-2 text-[11px] text-neutral-500">
              <summary className="cursor-pointer">Score breakdown</summary>
              <div className="font-mono mt-1">EV {r.score.evComponent.toFixed(1)} + brick {r.score.brickFloorComponent} + phase {r.score.phaseComponent} + liq {r.score.liquidityComponent.toFixed(1)} + conf {r.score.confidenceComponent} − var {r.score.variancePenalty.toFixed(1)} = {r.score.total.toFixed(1)}</div>
            </details>
          </article>
        ))}
      </section>
    </div>
  );
}

// =====================================================================
// EV CALCULATOR
// =====================================================================
function CalcTab({ ctx }: { ctx: Ctx }) {
  const [recipeId, setRecipeId] = useState(RECIPES[0].id);
  const recipe = RECIPES.find((r) => r.id === recipeId)!;
  const [baseCost, setBaseCost] = useState(recipe.basePriceFallback ?? 0);
  const [matCost, setMatCost] = useState(recipe.materials.reduce((s, m) => s + m.fallbackPrice * m.qty, 0));
  const [attempts, setAttempts] = useState(50);
  const [horizon, setHorizon] = useState(3);
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  useEffect(() => {
    setBaseCost(recipe.basePriceFallback ?? 0);
    setMatCost(recipe.materials.reduce((s, m) => s + m.fallbackPrice * m.qty, 0));
    setOverrides({});
  }, [recipeId]); // eslint-disable-line

  const project = useMemo(() => ({
    name: recipe.name, costPerAttempt: matCost, baseAcquisitionCost: baseCost, attempts, horizonDays: horizon,
    outcomes: recipe.outcomes.map((o) => ({
      id: o.id, label: o.label, probability: o.probability, salePrice: overrides[o.id] ?? o.fallbackPrice,
      isTarget: o.isTarget, dailyVolume: o.dailyVolume, confidence: o.priceConfidence, provenance: o.priceProvenance,
    })),
  }), [recipe, baseCost, matCost, attempts, horizon, overrides]);
  const res = evaluateProject(project);
  const sim = simulate(project, 2000);

  return (
    <div className="grid lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 space-y-5">
        <div className="bg-white border border-neutral-900/10 rounded-lg p-5">
          <h2 className="font-display text-xl font-semibold mb-3 flex items-center gap-2"><Calculator size={18} className="text-orange-900" />Project</h2>
          <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} className="w-full mb-3 border border-neutral-900/20 rounded px-2 py-1.5 text-sm">
            {RECIPES.map((r) => <option key={r.id} value={r.id}>{r.category}: {r.name}</option>)}
          </select>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Num label="Base cost (div)" value={baseCost} onChange={setBaseCost} />
            <Num label="Material / attempt (div)" value={matCost} onChange={setMatCost} />
            <Num label="Attempts" value={attempts} onChange={setAttempts} />
            <Num label="Sell horizon (days)" value={horizon} onChange={setHorizon} />
          </div>
          {recipe.sampleSize != null && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
              Probabilities: {recipe.outcomes[0]?.probProvenance} (n={recipe.sampleSize ?? "?"}, verified {recipe.verified}). {recipe.notes}
            </p>
          )}
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Value drivers for THIS item</div>
            {recipe.valueDrivers.map((d, i) => (
              <div key={i} className="text-xs border-l-2 border-amber-600 pl-3 mb-1">
                <span className="font-semibold text-orange-900">{d.axis}:</span> <span className="text-neutral-700">{d.values.join(" · ")}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-neutral-900/10 rounded-lg p-5">
          <h3 className="font-display text-lg font-semibold mb-3">Outcome prices (Div)</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-96 overflow-y-auto pr-1">
            {recipe.outcomes.map((o) => (
              <div key={o.id} className={`text-xs border rounded p-2 ${o.isTarget ? "border-orange-700/50 bg-orange-50" : "border-neutral-900/10"}`}>
                <div className="flex justify-between mb-1 items-center">
                  <span className="font-medium truncate">{o.label}</span>
                  <span className="text-neutral-500 font-mono">{(o.probability * 100).toFixed(2)}%</span>
                </div>
                <input type="number" value={overrides[o.id] ?? o.fallbackPrice} onChange={(e) => setOverrides((s) => ({ ...s, [o.id]: +e.target.value }))}
                  className="w-full border border-neutral-900/20 rounded px-1.5 py-1 font-mono" />
                <div className="flex justify-between mt-1"><Conf level={o.priceConfidence} /><span className="text-[9px] text-neutral-400">{o.dailyVolume ?? 0}/day</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="lg:col-span-5">
        <div className="bg-neutral-900 text-neutral-50 rounded-lg p-6 shadow-xl sticky top-32">
          <h3 className="font-display text-xl text-amber-50 mb-4 flex items-center gap-2"><TrendingUp size={18} className="text-amber-500" />Expected Value</h3>
          {!res.ok ? <p className="text-rose-300 text-sm">{res.error}</p> : (
            <div className="space-y-2.5">
              <Row label="EV / attempt (liquidity-adj.)" value={`${res.evPerAttempt.toFixed(1)} div`} good={res.evPerAttempt > 0} />
              <Row label="EV / attempt (naive)" value={`${res.evPerAttemptNaive.toFixed(1)} div`} />
              <Row label="Liquidity drag" value={`${res.slippageDragPct.toFixed(0)}%`} good={res.slippageDragPct < 10} />
              <Row label="Expected profit (batch)" value={`${res.expectedProfit.toFixed(0)} div`} good={res.expectedProfit > 0} />
              <Row label="ROI" value={`${res.roiPct.toFixed(1)}%`} good={res.roiPct > 0} />
              <Row label="P(≥1 target hit)" value={`${(res.pHitTarget * 100).toFixed(1)}%`} />
              <Row label="Brick-floor EV / attempt" value={`${res.brickFloorEV.toFixed(1)} div`} good={res.brickFloorEV > 0} />
              <div className="border-t border-neutral-700 pt-3 mt-3 text-xs">
                <div className="text-neutral-400 uppercase tracking-wider mb-1">Monte Carlo (2,000 runs, slippage-aware)</div>
                <div className="font-mono text-sm">p5 {sim.p5.toFixed(0)} · p50 {sim.p50.toFixed(0)} · p95 {sim.p95.toFixed(0)} div</div>
                <div className="text-neutral-400 mt-1">P(profit) ≈ <span className="text-emerald-400 font-semibold">{(sim.pProfit * 100).toFixed(0)}%</span></div>
                <div className="text-neutral-500 mt-2 text-[10px]">Data confidence: {res.worstConfidence} ({res.provenanceNote})</div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// =====================================================================
// ITEM LOOKUP
// =====================================================================
function ItemsTab({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function go() {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/items/search?q=${encodeURIComponent(q)}&league=${encodeURIComponent(ctx.league)}`);
      const j = await r.json();
      setHits(j?.results ?? []);
    } finally { setLoading(false); }
  }

  return (
    <div className="grid lg:grid-cols-12 gap-6">
      <section className="lg:col-span-5">
        <div className="bg-white border border-neutral-900/10 rounded-lg p-5">
          <h2 className="font-display text-xl font-semibold mb-3 flex items-center gap-2"><Wand2 size={18} className="text-orange-900" />Item lookup</h2>
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()}
              placeholder="e.g. Mageblood, Choir, Atziri…" className="flex-1 border border-neutral-900/20 rounded px-2 py-1.5 text-sm" />
            <button onClick={go} disabled={loading} className="bg-orange-700 hover:bg-orange-800 text-white rounded px-3">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
            </button>
          </div>
          <div className="mt-3 max-h-[60vh] overflow-y-auto divide-y divide-neutral-900/5">
            {hits.map((h, i) => (
              <button key={i} onClick={() => setSelected(h)} className={`w-full text-left py-2 px-2 hover:bg-neutral-50 text-sm flex justify-between gap-2 ${selected?.name === h.name ? "bg-orange-50" : ""}`}>
                <div><div className="font-medium">{h.name}</div><div className="text-xs text-neutral-500">{h.base} · {h.category}</div></div>
                <div className="font-mono text-xs text-right"><div>{h.currentDiv.toFixed(1)} div</div><div className="text-neutral-400">{h.currentBase.toFixed(0)} {ctx.baseUnit.split(" ")[0]}</div></div>
              </button>
            ))}
            {hits.length === 0 && q && !loading && <p className="text-xs text-neutral-500 text-center py-4">No matches in this league&apos;s feed.</p>}
          </div>
        </div>
      </section>
      <section className="lg:col-span-7">
        {!selected ? <Empty>Search and select an item to see its value drivers + live price.</Empty> : (
          <div className="bg-white border border-neutral-900/10 rounded-lg p-6 space-y-4">
            <div className="flex justify-between items-start">
              <div><h3 className="font-display text-2xl font-semibold">{selected.name}</h3><div className="text-xs text-neutral-500">{selected.base} · {selected.category}</div></div>
              <div className="text-right"><div className="text-[10px] uppercase tracking-wider text-neutral-500">Current</div>
                <div className="font-mono text-2xl">{selected.currentDiv.toFixed(1)} div</div>
                <div className="text-xs text-neutral-500">{selected.currentBase.toFixed(0)} {ctx.baseUnit}</div></div>
            </div>
            {selected.valueDrivers ? (
              <div>
                <h4 className="text-sm font-semibold mb-2 text-orange-900">Value drivers for this item</h4>
                {selected.valueDrivers.map((d: any, i: number) => (
                  <div key={i} className="border-l-2 border-amber-600 pl-3 mb-2"><div className="font-semibold text-sm">{d.axis}</div><div className="text-xs text-neutral-700">{d.values.join(" · ")}</div></div>
                ))}
                <p className="text-xs text-neutral-600 italic mt-2">The EV calculator uses <em>these</em> dimensions for this item — not generic stats.</p>
              </div>
            ) : (
              <p className="text-xs text-neutral-600">Not in the recipe catalog yet. Add it in <code className="bg-neutral-100 px-1 rounded">data/recipes.ts</code> with its price-driving axes.</p>
            )}
            <a href={`https://www.pathofexile.com/trade2/search/poe2/${encodeURIComponent(ctx.league)}?q=${encodeURIComponent(selected.name)}`} target="_blank" rel="noopener" className="inline-block text-sm underline text-orange-800">Open in official trade site →</a>
          </div>
        )}
      </section>
    </div>
  );
}

// =====================================================================
// FLIP SCANNER
// =====================================================================
function FlipsTab({ ctx }: { ctx: Ctx }) {
  const [category, setCategory] = useState("accessory");
  const [budget, setBudget] = useState(500);
  const [minDiscount, setMinDiscount] = useState(15);
  const [tradeSize, setTradeSize] = useState(10);
  const [kind, setKind] = useState<"all" | "items" | "currency">("all");
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function scan() {
    if (!ctx.league) return;
    setLoading(true);
    try {
      const items = kind === "currency" ? 0 : 1;
      const currency = kind === "items" ? 0 : 1;
      const r = await fetch(`/api/flips?league=${encodeURIComponent(ctx.league)}&category=${category}&budget=${budget}&minDiscount=${minDiscount}&size=${tradeSize}&items=${items}&currency=${currency}`);
      const j = await r.json();
      setRows(j?.rows ?? []);
      setMeta(j);
    } finally { setLoading(false); }
  }

  return (
    <div>
      <div className="bg-white border border-neutral-900/10 rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-6 gap-3 text-sm items-end">
        <label className="block"><span className="text-neutral-600">Source</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as any)} className="w-full mt-1 border border-neutral-900/20 rounded px-2 py-1.5">
            <option value="all">Items + currency</option><option value="items">Items only</option><option value="currency">Currency only</option>
          </select></label>
        <label className="block"><span className="text-neutral-600">Item category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={kind === "currency"} className="w-full mt-1 border border-neutral-900/20 rounded px-2 py-1.5">
            {["accessory", "armour", "weapon", "jewel", "flask"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label className="block"><span className="text-neutral-600">Budget (Div)</span>
          <input type="number" value={budget} onChange={(e) => setBudget(+e.target.value)} className="w-full mt-1 border border-neutral-900/20 rounded px-2 py-1.5" /></label>
        <label className="block"><span className="text-neutral-600">Min discount %</span>
          <input type="number" value={minDiscount} onChange={(e) => setMinDiscount(+e.target.value)} className="w-full mt-1 border border-neutral-900/20 rounded px-2 py-1.5" /></label>
        <label className="block"><span className="text-neutral-600">Trade size (units)</span>
          <input type="number" value={tradeSize} onChange={(e) => setTradeSize(+e.target.value)} className="w-full mt-1 border border-neutral-900/20 rounded px-2 py-1.5" /></label>
        <button onClick={scan} disabled={loading || !ctx.league} className="bg-orange-700 hover:bg-orange-800 text-white rounded px-4 py-2 flex items-center justify-center gap-2">
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Scan
        </button>
      </div>
      {meta?.methodology && <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900 mb-4"><b>Methodology:</b> {meta.methodology}</div>}
      <div className="bg-white border border-neutral-900/10 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-[10px] uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-3 py-2">Kind</th><th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Current (div)</th><th className="px-3 py-2 text-right">Fair (div)</th>
              <th className="px-3 py-2 text-right">Discount</th><th className="px-3 py-2">Conf</th>
              <th className="px-3 py-2 text-right">Gold</th><th className="px-3 py-2">Hold</th>
              <th className="px-3 py-2 text-right">Vol/day</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900/5">
            {rows.length === 0 && !loading && <tr><td colSpan={10} className="text-center py-10 text-neutral-400 text-sm">Click Scan to load live opportunities.</td></tr>}
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-orange-50/30">
                <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${r.kind === "currency" ? "bg-blue-100 text-blue-900" : "bg-orange-100 text-orange-900"}`}>{r.kind}</span></td>
                <td className="px-3 py-2 font-medium">{r.name}{r.base && <span className="block text-[10px] text-neutral-500">{r.base}</span>}</td>
                <td className="px-3 py-2 text-right font-mono">{r.currentDiv.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono text-neutral-500">{r.fairDiv.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700">−{r.discountPct.toFixed(0)}%</td>
                <td className="px-3 py-2"><Conf level={r.confidence} reason={r.confidenceReason} /></td>
                <td className="px-3 py-2 text-right font-mono text-xs">{r.kind === "currency" ? <span className="text-amber-700">{r.goldCost >= 1000 ? `${(r.goldCost / 1000).toFixed(1)}k` : Math.round(r.goldCost)}g</span> : <span className="text-neutral-400">none</span>}</td>
                <td className="px-3 py-2 text-xs">{r.expectedHold}</td>
                <td className="px-3 py-2 text-right text-xs font-mono">{r.volumePerDay?.toFixed(0)}</td>
                <td className="px-3 py-2">{r.tradeUrl && <a href={r.tradeUrl} target="_blank" rel="noopener" className="text-orange-700 underline text-xs">Trade →</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =====================================================================
// CURRENCY VALUATION (honest replacement for "arbitrage")
// =====================================================================
function ValuationTab({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function scan() {
    if (!ctx.league) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/arbitrage?league=${encodeURIComponent(ctx.league)}`);
      const j = await r.json();
      setRows(j?.valued ?? []);
      setMeta(j);
    } finally { setLoading(false); }
  }

  return (
    <div>
      <div className="bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-900 mb-4">
        <b>Honest scope:</b> {meta?.arbitrageNote ?? "True triangular arbitrage is NOT computable from poe2scout's data — it exposes a single mid-price per currency against one Exalted base (a star graph), with no cross-pairs and no bid/ask depth. This tab shows mean-reversion mispricing instead: a directional signal, not riskless profit."}
      </div>
      <button onClick={scan} disabled={loading || !ctx.league} className="bg-orange-700 hover:bg-orange-800 text-white rounded px-4 py-2 mb-4 flex items-center gap-2">
        {loading ? <RefreshCw size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />} Scan currency valuations
      </button>
      {meta?.methodology && <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900 mb-4"><b>Methodology:</b> {meta.methodology}</div>}
      <div className="space-y-2">
        {rows.length === 0 && !loading && <Empty>Run a scan to find under/overvalued currencies vs their recent mean.</Empty>}
        {rows.map((r, i) => (
          <div key={i} className="bg-white border border-neutral-900/10 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${r.mispricingPct > 0 ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"}`}>{r.signal}</span>
              <div><div className="font-medium">{r.currency}</div><div className="text-xs text-neutral-500">{r.volumePerDay?.toFixed(0)}/day · <Conf level={r.confidence} reason={r.confidenceReason} /></div></div>
            </div>
            <div className="text-right text-sm">
              <div className="font-mono text-lg font-bold text-orange-700">{r.mispricingPct > 0 ? "+" : ""}{r.mispricingPct.toFixed(1)}%</div>
              <div className="text-xs text-neutral-500 font-mono">{r.currentBase.toFixed(2)} vs mean {r.meanBase.toFixed(2)} {ctx.baseUnit.split(" ")[0]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// shared bits
// =====================================================================
function Field({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return <div><div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
    <div className={`font-mono ${good === true ? "text-emerald-700" : good === false ? "text-rose-700" : "text-neutral-900"}`}>{value}</div></div>;
}
function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return <div className="flex items-baseline justify-between"><span className="text-neutral-400 text-sm">{label}</span>
    <span className={`font-mono text-lg ${good === true ? "text-emerald-400" : good === false ? "text-rose-400" : "text-neutral-100"}`}>{value}</span></div>;
}
function Num({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return <label className="block"><span className="text-neutral-600 text-xs">{label}</span>
    <input type="number" value={value} onChange={(e) => onChange(+e.target.value)} className="w-full mt-1 border border-neutral-900/20 rounded px-2 py-1.5 font-mono" /></label>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="bg-white border border-dashed border-neutral-900/15 rounded-lg p-12 text-center text-neutral-500 text-sm">{children}</div>;
}
