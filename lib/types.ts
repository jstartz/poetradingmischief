/**
 * Verified poe2scout API types + zod parsers.
 *
 * Every shape here was confirmed against a REAL payload captured on
 * 2025/2026 from poe2scout.com/api (see fixtures/real_payloads.json).
 * The API uses PascalCase everywhere — keys AND query params. Do not guess.
 */
import { z } from "zod";

export const LeagueSchema = z.object({
  Value: z.string(),
  ShortName: z.string().optional(),
  IsCurrent: z.boolean().optional(),
  DivinePrice: z.number().optional(),          // price of 1 Divine in the base currency (Exalted)
  ChaosDivinePrice: z.number().optional(),
  BaseCurrencyApiId: z.string().optional(),    // e.g. "exalted" — the unit CurrentPrice is denominated in
  BaseCurrencyText: z.string().optional(),
});
export type League = z.infer<typeof LeagueSchema>;

export const ItemSchema = z.object({
  ItemId: z.number(),
  CategoryApiId: z.string().optional(),
  Text: z.string().optional(),
  Name: z.string().nullable().optional(),
  Type: z.string().nullable().optional(),
  ApiId: z.string().nullable().optional(),
  CurrentPrice: z.number().nullable().optional(),   // in league base currency (Exalted)
  IconUrl: z.string().nullable().optional(),
});
export type Item = z.infer<typeof ItemSchema>;
export const ItemArraySchema = z.array(ItemSchema);

export const CurrencyItemSchema = z.object({
  CurrencyItemId: z.number(),
  ItemId: z.number().optional(),
  ApiId: z.string(),
  Text: z.string().optional(),
  CategoryApiId: z.string().optional(),
  IconUrl: z.string().nullable().optional(),
  CurrentPrice: z.number().nullable().optional(),   // in base currency (Exalted)
  CurrentQuantity: z.number().nullable().optional(),
  PriceLogs: z.array(z.any()).nullable().optional(),
});
export type CurrencyItem = z.infer<typeof CurrencyItemSchema>;

export const CurrencyPageSchema = z.object({
  CurrentPage: z.number(),
  Pages: z.number(),
  Total: z.number(),
  Items: z.array(CurrencyItemSchema),
});

export const PricePointSchema = z.object({
  Price: z.number(),
  Time: z.string(),
  Quantity: z.number().nullable().optional(),
});
export type PricePoint = z.infer<typeof PricePointSchema>;
export const HistorySchema = z.object({ PriceHistory: z.array(PricePointSchema) });

export const SnapshotPairSchema = z.object({
  Volume: z.coerce.number().optional(),
  BaseCurrencyApiId: z.string().optional(),
  CurrencyOne: z.object({ ApiId: z.string(), Text: z.string().optional() }),
  CurrencyTwo: z.object({ ApiId: z.string(), Text: z.string().optional() }),
  CurrencyOneData: z.object({
    RelativePrice: z.coerce.number(),
    VolumeTraded: z.coerce.number().optional(),
    StockValue: z.coerce.number().optional(),
    HighestStock: z.coerce.number().optional(),
  }),
  CurrencyTwoData: z.object({
    RelativePrice: z.coerce.number(),
    VolumeTraded: z.coerce.number().optional(),
    StockValue: z.coerce.number().optional(),
    HighestStock: z.coerce.number().optional(),
  }),
});
export type SnapshotPair = z.infer<typeof SnapshotPairSchema>;
