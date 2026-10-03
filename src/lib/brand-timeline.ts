/**
 * How each brand has moved between one crawl and the next.
 *
 * Pure: no database, no 'server-only'. Every rule about what an observation is,
 * what may be compared with what, and what must be withheld lives here so it can
 * be tested without a network.
 *
 * The premise this module is built on, and the reason it does not look like an
 * ordinary time series:
 *
 *   Crawls are ad-hoc. Nothing schedules them.
 *
 * So there is no "last 30 days vs the 30 before". The gap between two
 * observations has been 16 days once and could be 90 next time. Every figure
 * below is therefore stated per OBSERVATION, carries the real elapsed days, and
 * normalises any rate by that elapsed time rather than assuming a period.
 */

/**
 * How far apart two runs can be and still describe the same visit.
 *
 * Three days, not "the same calendar date", because of what the stored runs
 * actually look like: prices for JOOLA, Selkirk and CRBN were crawled on
 * 2026-08-27 and their reviews on 2026-08-28. Grouping by date would make
 * August two half-empty observations — one where price moved and reviews are
 * blank, then one where reviews moved and price is blank — and a reader would
 * see a brand doing something it had not done.
 *
 * Anchored to the first run in a cluster rather than the previous one, so a
 * steady drip of crawls two days apart cannot chain into one cluster months
 * wide.
 */
export const OBSERVATION_TOLERANCE_DAYS = 3

const DAY_MS = 86_400_000

export interface PriceSnapshot {
  variantId: string
  observedAt: string
  price: number | null
  isOnSale: boolean
  discountPct: number | null
  isAvailable: boolean | null
}

/**
 * One stored review, as the source of every review figure here.
 *
 * NOT product_review_snapshots. That table's review_count is per LISTING, and a
 * review syndicated across a paddle's twelve colourways is counted once per
 * colourway. Summing it across products overstates the corpus by more than
 * double: on 2026-09-12 the sum is 45,929 against 20,771 reviews actually
 * stored. The same mistake once had the brand chips advertising 13,520 Selkirk
 * reviews and returning 6,161.
 *
 * The reviews table is unique on (site, platform, source review id), so one row
 * is one review, and first_seen_at makes the count historical.
 */
export interface ReviewRecord {
  /** When WE first collected it — a crawl instant, so counts are as-of-crawl. */
  firstSeenAt: string
  /** When the customer wrote it, where the platform says. */
  submittedAt: string | null
  rating: number | null
}

export interface BrandMetrics {
  /** Variants carrying a price in this observation. */
  skus: number
  priceLow: number | null
  priceMedian: number | null
  priceHigh: number | null
  /** Share of priced SKUs on sale, 0-1. */
  onSaleShare: number | null
  deepestDiscount: number | null
  /** Share of SKUs the storefront reported unavailable, 0-1. */
  outOfStockShare: number | null

  /** Distinct reviews collected by the end of this observation. Cumulative. */
  reviewsHeld: number
  averageRating: number | null
  /**
   * Reviews collected since the previous observation — null on the first.
   *
   * "Collected", not "received". first_seen_at is when the crawler saw it, so a
   * crawl that reaches deeper than the last one reports a surge of new reviews
   * that were written years ago. Read it as collection progress; read
   * `writtenInWindow` for what buyers actually wrote.
   */
  newCollected: number | null
  /**
   * Reviews whose submitted_at falls in the gap — null on the first observation.
   *
   * This is the honest velocity signal, and it is the one that answers "is this
   * brand getting more attention". Undercounts only where a review existed but
   * had not been crawled yet.
   */
  writtenInWindow: number | null
  /** Share of rated reviews at one or two stars, 0-1. */
  lowStarShare: number | null
}

export interface BrandObservation {
  /** First and last run instant folded into this observation. */
  start: string
  end: string
  hasPrices: boolean
  hasReviews: boolean
  metrics: BrandMetrics
  /** Variant ids priced in this observation — the input to assortment churn. */
  skuKeys: readonly string[]
}

/**
 * Cluster run instants into observations.
 *
 * Exported because the clustering is the part most likely to be wrong on data
 * nobody has seen yet, and a reader should be able to check it in isolation.
 */
export function clusterInstants(
  instants: readonly string[],
  toleranceDays: number = OBSERVATION_TOLERANCE_DAYS,
): Array<{ start: string; end: string }> {
  const sorted = [...new Set(instants)].sort()
  const out: Array<{ start: string; end: string }> = []

  for (const instant of sorted) {
    const open = out[out.length - 1]
    const within =
      open !== undefined &&
      Date.parse(instant) - Date.parse(open.start) <= toleranceDays * DAY_MS
    if (within) open.end = instant
    else out.push({ start: instant, end: instant })
  }

  return out
}

/** Does this instant fall inside the cluster, inclusive at both ends? */
function inCluster(instant: string, cluster: { start: string; end: string }): boolean {
  return instant >= cluster.start && instant <= cluster.end
}

export interface TimelineInput {
  prices: readonly PriceSnapshot[]
  /**
   * observed_at of each product_review_snapshots row for this brand.
   *
   * Used ONLY to mark that a review crawl happened, so an observation knows
   * whether its review figures are fresh or inherited. The figures themselves
   * come from `reviews`.
   */
  reviewRuns: readonly string[]
  reviews: readonly ReviewRecord[]
}

/** One brand's observations, oldest first. */
export function buildObservations(
  input: TimelineInput,
  toleranceDays: number = OBSERVATION_TOLERANCE_DAYS,
): BrandObservation[] {
  const clusters = clusterInstants(
    [...input.prices.map((p) => p.observedAt), ...input.reviewRuns],
    toleranceDays,
  )

  return clusters.map((cluster, index) => {
    const priceRows = latestPerKey(
      input.prices.filter((p) => inCluster(p.observedAt, cluster)),
      (p) => p.variantId,
    )

    // Review figures are cumulative as of the end of this observation, not
    // "rows seen during it". A review collected in August is still held in
    // September, and the stock is what a reader means by "how many reviews
    // does this brand have".
    const previousEnd = index === 0 ? null : clusters[index - 1]!.end
    const held = input.reviews.filter((r) => r.firstSeenAt <= cluster.end)

    return {
      start: cluster.start,
      end: cluster.end,
      hasPrices: priceRows.length > 0,
      hasReviews: input.reviewRuns.some((r) => inCluster(r, cluster)),
      metrics: metricsFor(priceRows, held, input.reviews, previousEnd, cluster.end),
      skuKeys: priceRows.map((p) => p.variantId),
    }
  })
}

/**
 * The newest row per entity inside one observation.
 *
 * A brand can be crawled more than once in a cluster — on 2026-09-12 several
 * sites were crawled twice, once for the catalogue and once for reviews. Taking
 * every row would count those variants twice and halve the apparent median.
 */
function latestPerKey<T extends { observedAt: string }>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): T[] {
  const newest = new Map<string, T>()
  for (const row of rows) {
    const seen = newest.get(keyOf(row))
    if (!seen || row.observedAt > seen.observedAt) newest.set(keyOf(row), row)
  }
  return [...newest.values()]
}

function metricsFor(
  prices: readonly PriceSnapshot[],
  held: readonly ReviewRecord[],
  allReviews: readonly ReviewRecord[],
  previousEnd: string | null,
  end: string,
): BrandMetrics {
  const priced = prices.filter((p) => p.price !== null && Number.isFinite(p.price))
  const values = priced.map((p) => Number(p.price)).sort((a, b) => a - b)

  // Availability is nullable: a storefront that does not report stock is not a
  // storefront reporting everything in stock, so those rows are excluded from
  // the denominator rather than counted as available.
  const known = prices.filter((p) => p.isAvailable !== null)
  const out = known.filter((p) => p.isAvailable === false).length

  const rated = held.filter((r) => r.rating !== null)
  const lowStars = rated.filter((r) => (r.rating as number) <= 2).length

  return {
    skus: priced.length,
    priceLow: values[0] ?? null,
    priceMedian: median(values),
    priceHigh: values[values.length - 1] ?? null,
    onSaleShare: priced.length ? priced.filter((p) => p.isOnSale).length / priced.length : null,
    deepestDiscount: priced.length
      ? Math.max(0, ...priced.map((p) => Number(p.discountPct ?? 0)))
      : null,
    outOfStockShare: known.length ? out / known.length : null,

    reviewsHeld: held.length,
    averageRating: rated.length
      ? rated.reduce((n, r) => n + (r.rating as number), 0) / rated.length
      : null,
    // Both flows need a previous observation to be a flow at all. On the first,
    // every review ever written looks like it arrived at once.
    newCollected:
      previousEnd === null
        ? null
        : allReviews.filter((r) => r.firstSeenAt > previousEnd && r.firstSeenAt <= end).length,
    writtenInWindow:
      previousEnd === null
        ? null
        : allReviews.filter(
            (r) => r.submittedAt !== null && r.submittedAt > previousEnd && r.submittedAt <= end,
          ).length,
    lowStarShare: rated.length ? lowStars / rated.length : null,
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((n, v) => n + v, 0)
}

/** Lower of the two middle values on an even count, so the result is a real price. */
export function median(sortedAscending: readonly number[]): number | null {
  if (sortedAscending.length === 0) return null
  return sortedAscending[Math.floor((sortedAscending.length - 1) / 2)] ?? null
}

export interface BrandChange {
  previous: BrandObservation
  current: BrandObservation
  /** Real days between the two, which is the whole point of this module. */
  elapsedDays: number
  /** Variant ids priced now and not before. */
  added: string[]
  /** Variant ids priced before and not now. */
  removed: string[]
}

/**
 * The move between a brand's two most recent observations, or null.
 *
 * Null is a real answer and the page must render it. Six Zero, Paddletek and
 * GAMMA were added to the crawl after the only earlier run, so they hold one
 * observation each: there is no before, and a 0% delta would be a claim that
 * nothing changed rather than that nothing is known.
 */
export function latestChange(observations: readonly BrandObservation[]): BrandChange | null {
  if (observations.length < 2) return null
  const current = observations[observations.length - 1]!
  const previous = observations[observations.length - 2]!

  const before = new Set(previous.skuKeys)
  const now = new Set(current.skuKeys)

  return {
    previous,
    current,
    elapsedDays: elapsedDays(previous.end, current.start),
    added: [...now].filter((k) => !before.has(k)),
    removed: [...before].filter((k) => !now.has(k)),
  }
}

/** Whole days between two instants, never negative. */
export function elapsedDays(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS))
}

/**
 * A count expressed per week, given the gap it actually accumulated over.
 *
 * Without this a scorecard reads "+412 reviews" beside "+37 reviews" as if the
 * first brand were ten times busier, when the first gap was 90 days and the
 * second nine. Returns null below a day, where the arithmetic would amplify a
 * rounding error into a headline.
 */
export function perWeek(count: number | null, days: number): number | null {
  if (count === null || days < 1) return null
  return (count / days) * 7
}

/** Signed difference, or null when either side is unknown. */
export function diff(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null
  return after - before
}
