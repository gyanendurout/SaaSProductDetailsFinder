import 'server-only'
import { db, selectAll } from './supabase.js'
import { withRetry } from './retry.js'
import { createLogger } from './logger.js'
import {
  buildObservations,
  latestChange,
  type BrandChange,
  type BrandObservation,
  type PriceSnapshot,
  type ReviewRecord,
} from './brand-timeline.js'

/**
 * Reads for the brand timeline.
 *
 * Deliberately whole-table reads, against the house rule that reviews must
 * never be loaded whole. The two snapshot tables are a different size of thing:
 * 1,433 price rows and 520 review rows today, and a full crawl of all six
 * brands writes about a thousand more. At the cadence these crawls actually run
 * — on demand, a handful of times a year — a decade of history is on the order
 * of 120k rows across both tables, and only four narrow columns of each are
 * read. Aggregating in Postgres would need a view, and a view needs a migration
 * that cannot currently be applied.
 *
 * The threshold to revisit this is roughly 100k rows in either table, at which
 * point the grouping belongs in SQL.
 */

const log = createLogger('brand-timeline')

/**
 * Ten minutes, shared between concurrent requests.
 *
 * The corpus only changes when a crawl runs, and crawls are manual and on
 * demand, so there is nothing to go stale between them. Without this, two
 * people opening the page at once each pay for the same 21-request read.
 */
const TTL_MS = 600_000
let cache: { at: number; value: BrandTimeline[] } | null = null
let inFlight: Promise<BrandTimeline[]> | null = null

export interface BrandTimeline {
  brand: string
  brandSlug: string
  observations: BrandObservation[]
  change: BrandChange | null
  /** Variant ids resolved to something a reader recognises. */
  labels: Map<string, string>
}

interface SiteRow {
  id: string
  brand_id: string
}
interface BrandRow {
  id: string
  name: string
  slug: string
}
interface VariantSnapshotRow {
  id: number
  variant_id: string
  site_id: string
  observed_at: string
  price: string | number | null
  is_on_sale: boolean | null
  discount_pct: string | number | null
  is_available: boolean | null
}
/** Only enough to know a review crawl happened; the figures come from `reviews`. */
interface ReviewRunRow {
  id: number
  site_id: string
  observed_at: string
}
interface ReviewRow {
  id: string
  site_id: string
  first_seen_at: string
  submitted_at: string | null
  rating: number | null
}
interface VariantRow {
  id: string
  sku: string | null
  title: string | null
  product_id: string
}
interface ProductRow {
  id: string
  title: string
}

export async function getBrandTimelines(): Promise<BrandTimeline[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  if (inFlight) return inFlight
  inFlight = load().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function load(): Promise<BrandTimeline[]> {
  const started = Date.now()
  const [brands, sites, priceRows, reviewRuns, reviewRows, variants, products] = await Promise.all([
    selectAll<BrandRow>('brands', 'id,name,slug'),
    selectAll<SiteRow>('sites', 'id,brand_id'),
    selectAll<VariantSnapshotRow>(
      'variant_snapshots',
      'id,variant_id,site_id,observed_at,price,is_on_sale,discount_pct,is_available',
    ),
    selectAll<ReviewRunRow>('product_review_snapshots', 'id,site_id,observed_at'),
    // 20,771 rows of four narrow columns. Heavier than the snapshot tables, and
    // taken deliberately: the snapshot counts are per listing and cannot be
    // summed (see ReviewRecord).
    fetchAllParallel<ReviewRow>('reviews', 'id,site_id,first_seen_at,submitted_at,rating'),
    selectAll<VariantRow>('variants', 'id,sku,title,product_id'),
    selectAll<ProductRow>('products', 'id,title'),
  ])

  const brandOfSite = new Map<string, string>()
  const byId = new Map(brands.map((b) => [b.id, b]))
  for (const site of sites) {
    const brand = byId.get(site.brand_id)
    if (brand) brandOfSite.set(site.id, brand.slug)
  }

  const productTitle = new Map(products.map((p) => [p.id, p.title]))
  const labels = new Map<string, string>()
  for (const v of variants) {
    // A colourway's own title is often just "Default Title", so the product
    // name is what makes a churn entry readable.
    const parent = productTitle.get(v.product_id)
    const detail = [v.title, v.sku].find((x) => x && x !== 'Default Title')
    labels.set(v.id, parent ? (detail ? `${parent} · ${detail}` : parent) : (detail ?? v.id))
  }

  const pricesBy = groupBySlug(priceRows, (r) => brandOfSite.get(r.site_id))
  const runsBy = groupBySlug(reviewRuns, (r) => brandOfSite.get(r.site_id))
  const reviewsBy = groupBySlug(reviewRows, (r) => brandOfSite.get(r.site_id))

  const timelines = brands.map((brand) => {
    const observations = buildObservations({
      prices: (pricesBy.get(brand.slug) ?? []).map(toPriceSnapshot),
      reviewRuns: (runsBy.get(brand.slug) ?? []).map((r) => r.observed_at),
      reviews: (reviewsBy.get(brand.slug) ?? []).map(toReviewRecord),
    })
    return {
      brand: brand.name,
      brandSlug: brand.slug,
      observations,
      change: latestChange(observations),
      labels,
    }
  })

  log.info('brand timelines built', {
    brands: timelines.length,
    reviews: reviewRows.length,
    ms: Date.now() - started,
  })

  // A brand with nothing stored has nothing to say; sorted so the brands with
  // the most history — the only ones that can show a trend — come first.
  const value = timelines
    .filter((t) => t.observations.length > 0)
    .sort(
      (a, b) =>
        b.observations.length - a.observations.length || a.brand.localeCompare(b.brand),
    )

  cache = { at: Date.now(), value }
  return value
}

/**
 * Every row of a table, eight range requests at a time.
 *
 * selectAll pages sequentially, which is right when a caller stops at the first
 * short page. Here the whole table is needed to count anything, so sequential
 * paging spends its time waiting: 20,771 reviews took 11.2s, almost all of it
 * round-trip latency. The same requests eight at a time take about three.
 *
 * Ordered by a unique key for the same reason selectAll is: LIMIT/OFFSET with no
 * ORDER BY is free to repeat one row and skip another, which once cost this
 * codebase 419 duplicated and 419 missing reviews on every full read.
 */
const PAGE = 1000
const CONCURRENCY = 8

async function fetchAllParallel<T>(table: string, columns: string): Promise<T[]> {
  const total = await withRetry(async () => {
    const { count, error } = await db().from(table).select('id', { count: 'exact', head: true })
    if (error) throw new Error(`count ${table}: ${error.message}`)
    return count ?? 0
  }, `count ${table}`)

  const pages = Math.ceil(total / PAGE)
  if (pages === 0) return []

  const chunks: T[][] = Array.from({ length: pages })
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pages) }, async () => {
      for (;;) {
        const index = next++
        if (index >= pages) return
        chunks[index] = await withRetry(async () => {
          const { data, error } = await db()
            .from(table)
            .select(columns)
            .order('id', { ascending: true })
            .range(index * PAGE, index * PAGE + PAGE - 1)
          if (error) throw new Error(`${table} page ${index}: ${error.message}`)
          return (data ?? []) as unknown as T[]
        }, `${table} page`)
      }
    }),
  )
  return chunks.flat()
}

function groupBySlug<T>(rows: T[], slugOf: (row: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const slug = slugOf(row)
    if (!slug) continue
    const list = out.get(slug)
    if (list) list.push(row)
    else out.set(slug, [row])
  }
  return out
}

/** numeric(12,2) arrives as a string over PostgREST; Number(null) is 0, so guard. */
function num(value: string | number | null): number | null {
  if (value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toPriceSnapshot(row: VariantSnapshotRow): PriceSnapshot {
  return {
    variantId: row.variant_id,
    observedAt: row.observed_at,
    price: num(row.price),
    isOnSale: row.is_on_sale === true,
    discountPct: num(row.discount_pct),
    isAvailable: row.is_available,
  }
}

function toReviewRecord(row: ReviewRow): ReviewRecord {
  return {
    firstSeenAt: row.first_seen_at,
    submittedAt: row.submitted_at,
    rating: row.rating === null ? null : Number(row.rating),
  }
}
