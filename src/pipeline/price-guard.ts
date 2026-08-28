import { selectAll } from '../lib/supabase.js'

/**
 * Refuses to record a run whose prices have changed scale.
 *
 * crbnpickleball.com returned a $223.99 paddle as 21800.00 because Node's fetch
 * sends `Accept-Language: *` and Shopify answered from a different market — in
 * that market's currency, with no currency field in the JSON to reveal it. The
 * numbers were plausible on their own; only comparing them against the rest of
 * the catalogue showed anything was wrong.
 *
 * The header is fixed at source in `src/lib/http.ts`. This is the backstop,
 * because a price series that quietly changes units is worse than one with a
 * missing day: the gap is visible, the unit change is not, and it corrupts
 * every trend drawn through it.
 *
 * Deliberately a wide band. Real markdowns of 60% and launches at three times
 * the range average both have to pass; only a scale change should not.
 */

/** A median moving by more than this between runs is not a price change. */
const MAX_MEDIAN_RATIO = 5

export interface PriceGuardVerdict {
  ok: boolean
  reason: string
  median: number | null
  previousMedian: number | null
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

/**
 * Compares this run's median against the previous successful run for the site.
 * The first run for a site has no baseline and is always allowed — there is
 * nothing to compare it with, which is exactly why the fix belongs in the
 * client and this only catches a later drift.
 */
export function comparePrices(current: number[], previous: number[]): PriceGuardVerdict {
  const now = median(current)
  const before = median(previous)

  if (now === null) {
    return { ok: true, reason: 'no priced SKUs in this run', median: now, previousMedian: before }
  }
  if (before === null) {
    return { ok: true, reason: 'no baseline yet', median: now, previousMedian: before }
  }

  const ratio = now > before ? now / before : before / now
  if (ratio > MAX_MEDIAN_RATIO) {
    return {
      ok: false,
      reason:
        `median price moved ${ratio.toFixed(1)}x (${before} -> ${now}). ` +
        `That is a change of scale, not of price — check the storefront's currency ` +
        `and market before trusting this run.`,
      median: now,
      previousMedian: before,
    }
  }
  return { ok: true, reason: `median ${now} within ${MAX_MEDIAN_RATIO}x of ${before}`, median: now, previousMedian: before }
}

/** The prices recorded by the most recent successful run for a site. */
export async function previousPrices(siteId: string): Promise<number[]> {
  const runs = await selectAll<{ id: string }>('crawl_runs', 'id,started_at', (q) =>
    q.eq('site_id', siteId).eq('status', 'done').order('started_at', { ascending: false }).limit(1),
  )
  const runId = runs[0]?.id
  if (!runId) return []

  const snaps = await selectAll<{ price: string | number | null }>(
    'variant_snapshots',
    'price',
    (q) => q.eq('run_id', runId),
  )
  return snaps.map((s) => Number(s.price)).filter((n) => Number.isFinite(n))
}
