/**
 * Verified server-side client for poe2scout.com/api.
 *
 * All endpoints, query params (PascalCase!), and response shapes were
 * confirmed against real payloads. Responses are zod-parsed so a schema drift
 * surfaces as a loud error instead of silently returning empty.
 */
import {
  LeagueSchema, ItemArraySchema, CurrencyPageSchema, HistorySchema,
  SnapshotPairSchema, type League, type Item, type CurrencyItem,
  type PricePoint, type SnapshotPair,
} from "./types";
import { z } from "zod";

const BASE = "https://poe2scout.com/api";
const UA = "poe2-ev/0.3 (github.com/yourname/poe2-ev; contact: gracku@hotmail.com)";

const cache = new Map<string, { t: number; v: unknown }>();

async function raw(path: string, ttlMs = 120_000): Promise<unknown> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const res = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: Math.floor(ttlMs / 1000) },
  });
  if (!res.ok) throw new Error(`poe2scout ${path} -> HTTP ${res.status}`);
  const v = await res.json();
  cache.set(path, { t: Date.now(), v });
  return v;
}

export type Realm = "poe2" | "poe2hc";

// ---- Leagues -------------------------------------------------------------
export async function getLeagues(realm: Realm = "poe2"): Promise<League[]> {
  const v = await raw(`/${realm}/Leagues`);
  return z.array(LeagueSchema).parse(v);
}

/**
 * Robust current-league selector.
 * IMPORTANT: between patches NO league has IsCurrent=true. Verified live.
 * Fallback chain: IsCurrent -> first non-HC/Standard challenge league -> first.
 */
export async function getCurrentLeague(realm: Realm = "poe2"): Promise<League> {
  const list = await getLeagues(realm);
  return (
    list.find((l) => l.IsCurrent) ??
    list.find((l) => !/^(HC |Standard|Hardcore)/i.test(l.Value) && !/SSF|Solo/i.test(l.Value)) ??
    list[0]
  );
}

/** Divine price (in base currency) for converting CurrentPrice -> Divine equivalents. */
export function divineRate(league: League): number {
  return league.DivinePrice && league.DivinePrice > 0 ? league.DivinePrice : 1;
}

// ---- Items ---------------------------------------------------------------
export async function getItems(
  league: string, category: string, page = 1, perPage = 250, realm: Realm = "poe2"
): Promise<Item[]> {
  const v = await raw(
    `/${realm}/Leagues/${encodeURIComponent(league)}/Items?Category=${encodeURIComponent(category)}&Page=${page}&PerPage=${perPage}`
  );
  return ItemArraySchema.parse(v);
}

export async function getItemHistory(
  league: string, itemId: number, logCount = 28, realm: Realm = "poe2"
): Promise<PricePoint[]> {
  const lc = Math.max(4, Math.round(logCount / 4) * 4); // API requires a multiple of 4
  const v = await raw(
    `/${realm}/Leagues/${encodeURIComponent(league)}/Items/${itemId}/History?LogCount=${lc}`
  );
  return HistorySchema.parse(v).PriceHistory;
}

// ---- Item categories -----------------------------------------------------
export async function getCategories(league: string, realm: Realm = "poe2") {
  const v: any = await raw(`/${realm}/Leagues/${encodeURIComponent(league)}/Items/Categories`);
  return {
    unique: (v?.UniqueCategories ?? []).map((c: any) => ({ apiId: c.ApiId, label: c.Label })),
    currency: (v?.CurrencyCategories ?? []).map((c: any) => ({ apiId: c.ApiId, label: c.Label })),
  };
}

// ---- Currencies ----------------------------------------------------------
export async function getCurrencies(
  league: string, category = "currency", page = 1, perPage = 250, realm: Realm = "poe2"
): Promise<CurrencyItem[]> {
  const v = await raw(
    `/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/ByCategory?Category=${encodeURIComponent(category)}&Page=${page}&PerPage=${perPage}`
  );
  return CurrencyPageSchema.parse(v).Items;
}

// ---- Exchange pairs (for the currency valuation tab) ---------------------
export async function getSnapshotPairs(league: string, realm: Realm = "poe2"): Promise<SnapshotPair[]> {
  const v = await raw(`/${realm}/Leagues/${encodeURIComponent(league)}/SnapshotPairs`);
  return z.array(SnapshotPairSchema).parse(v);
}
