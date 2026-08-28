/**
 * Price tier arithmetic, deliberately free of any database import.
 *
 * This lives apart from price-bands.ts because that module reaches the server-
 * only Supabase client, and importing it from a test throws before a single
 * assertion runs. The boundary rules are the part worth testing, so they live
 * where a test can reach them.
 */

/**
 * Tiers as fixed boundaries rather than quantiles of the current data.
 *
 * Quantile tiers would move every crawl: a brand could drift from "mid" to
 * "premium" because a rival discounted, which is the opposite of what a tier is
 * for. Fixed bands mean "premium" says the same thing in March as in November,
 * and a brand crossing a boundary has genuinely repriced.
 */
export const PRICE_TIERS = [
  { key: 'value', label: 'value', upperBound: 100 },
  { key: 'mid', label: 'mid', upperBound: 200 },
  { key: 'premium', label: 'premium', upperBound: Number.POSITIVE_INFINITY },
] as const

export type PriceTierKey = (typeof PRICE_TIERS)[number]['key']

/** Bounds are exclusive upper bounds: $100 is the first "mid" price. */
export function tierOf(price: number): PriceTierKey {
  const tier = PRICE_TIERS.find((t) => price < t.upperBound)
  return (tier ?? PRICE_TIERS[PRICE_TIERS.length - 1]!).key
}

/** Median of a non-empty list. Even counts average the middle pair. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
