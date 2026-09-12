import 'server-only'
import { db } from './supabase.js'
import { withRetry } from './retry.js'
import { createLogger } from './logger.js'
import {
  agreedValue,
  resolveShape,
  resolveThickness,
  type Shape,
} from './review-dimensions.js'
import { brandsNamedIn, defectsIn, readsAsSwitch, reviewText } from './review-text.js'
import { ownershipBucket, perceptionOf, wasReturningBuyer } from './review-context.js'
import { materialGaps, type ModelCoverage } from './review-coverage.js'
import type { EnrichedFact, ReviewFact } from './review-stats.js'

const log = createLogger('review-analysis')

export { materialGaps, type ModelCoverage } from './review-coverage.js'

const PAGE = 1000
/**
 * Six concurrent range requests, not twenty-one.
 *
 * Every other read in this codebase pages sequentially, which is correct when
 * the caller stops as soon as a short page arrives. Here the whole corpus is
 * needed to count anything, so sequential paging spends its entire time waiting:
 * measured at 20,771 reviews it took 15.9s of almost pure round-trip latency.
 * The same 21 requests at six at a time took 3.1s.
 *
 * Eight rather than twenty-one because this is someone's shared Supabase instance
 * and a page load should not open a connection per thousand rows.
 */
const CONCURRENCY = 8

/**
 * Two tiers: the counts everything needs, and the prose only three panels read.
 *
 * Measured in isolation, each tier takes about 4.5-5s. So this is not a
 * dramatic saving — it roughly halves the read for the leaderboard and momentum
 * panels, which never look at prose, rather than the order of magnitude an
 * earlier measurement suggested. (That measurement was taken while browser
 * checks and other scripts were hitting the same Supabase project, and what it
 * actually recorded was contention, not column cost.)
 *
 * It is kept because halving a five-second read on the default panel is still
 * worth a type split, and because EnrichedFact makes it impossible to hand a
 * prose panel rows that never had prose.
 */
const REVIEW_COLUMNS =
  'review_id,product_id,product_title,model_id,model_name,brand,brand_slug,rating,' +
  'variant_label,submitted_at,play_style'
const PROSE_COLUMNS = 'review_id,product_id,title,body,pros,cons,context_data,brand_slug'
const VARIANT_COLUMNS = 'product_id,variant_shape,core_thickness_mm'
const SNAPSHOT_COLUMNS = 'product_id,reported_total,observed_at'

interface ReviewRow {
  review_id: string
  product_id: string
  product_title: string | null
  model_id: string | null
  model_name: string | null
  brand: string
  brand_slug: string
  rating: number | null
  variant_label: string | null
  submitted_at: string | null
  play_style: string | null
}

interface ProseRow {
  review_id: string
  product_id: string
  brand_slug: string
  title: string | null
  body: string | null
  pros: string | null
  cons: string | null
  context_data: Record<string, unknown> | null
}

interface VariantRow {
  product_id: string
  variant_shape: string | null
  core_thickness_mm: number | null
}

interface SnapshotRow {
  product_id: string
  reported_total: number | null
  observed_at: string
}

/**
 * The whole corpus, resolved, held for a short while.
 *
 * The rest of the dashboard deliberately caches nothing — supabase.ts even
 * bypasses Next's fetch wrapper so a live figure can never be served stale.
 * This page is the one place that trade is wrong: it reads all 20,771 reviews
 * to count them, every filter the reader clicks would otherwise re-read all
 * 20,771, and the corpus only changes when a crawl runs — which is now manual
 * and on demand. A short TTL keeps the page interactive without letting it
 * drift past the next crawl unnoticed.
 */
interface CacheEntry {
  facts: ReviewFact[]
  coverage: ModelCoverage[]
  loadedAt: number
}
/**
 * Ten minutes, not two.
 *
 * The corpus read is 21 range requests per tier, so a short TTL means paying
 * for it again while someone is still clicking between panels. Nothing here
 * changes until a crawl runs, and crawls are manual.
 */
const TTL_MS = 600_000
let cache: CacheEntry | null = null

/**
 * The load currently in flight, if any.
 *
 * Without this, two requests arriving before the first finishes each start
 * their own full read — measured at 109s apiece when they collided, because
 * they were competing for the same connection pool to do identical work. The
 * second caller now waits on the first instead.
 */
let inFlight: Promise<CacheEntry> | null = null

export function reviewFactsCachedAt(): number | null {
  return cache && Date.now() - cache.loadedAt < TTL_MS ? cache.loadedAt : null
}

async function load(): Promise<CacheEntry> {
  const fresh = cache && Date.now() - cache.loadedAt < TTL_MS
  if (cache && fresh) return cache
  if (inFlight) return inFlight

  inFlight = readCorpus().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function readCorpus(): Promise<CacheEntry> {
  const started = Date.now()
  const [reviews, variants, snapshots] = await Promise.all([
    fetchAllParallel<ReviewRow>('v_review_search', REVIEW_COLUMNS, 'review_id'),
    fetchAllParallel<VariantRow>('v_variant_current', VARIANT_COLUMNS, 'variant_id'),
    fetchAllParallel<SnapshotRow>('product_review_snapshots', SNAPSHOT_COLUMNS, 'id'),
  ])

  const listings = listingDimensions(variants)
  const facts = reviews.map((r) => toFact(r, listings.get(r.product_id)))
  const coverage = collectionCoverage(facts, snapshots)

  const entry: CacheEntry = { facts, coverage, loadedAt: Date.now() }
  cache = entry
  log.info('review facts loaded', {
    reviews: facts.length,
    variants: variants.length,
    shortfalls: materialGaps(coverage).length,
    ms: Date.now() - started,
  })
  return entry
}

export async function loadReviewFacts(): Promise<ReviewFact[]> {
  return (await load()).facts
}

/**
 * Stored against platform-reported, per listing.
 *
 * Exists because a shortfall is invisible in the data itself and fatal to a
 * time series. Judge.me's widget stops serving new rows after 100 pages and
 * then repeats the last one forever, so a listing with more than a few hundred
 * reviews is silently truncated to the most RECENT slice — which is exactly the
 * wrong slice to lose when plotting a launch curve, because what survives is
 * the tail and what goes missing is the history.
 */
export async function loadCoverage(): Promise<ModelCoverage[]> {
  return (await load()).coverage
}

function collectionCoverage(facts: ReviewFact[], snapshots: SnapshotRow[]): ModelCoverage[] {
  const latest = new Map<string, SnapshotRow>()
  for (const s of snapshots) {
    const seen = latest.get(s.product_id)
    if (!seen || s.observed_at > seen.observed_at) latest.set(s.product_id, s)
  }

  // Group by model, remembering which listings contributed, so `reported` can
  // be a max over them rather than a sum that would count one review per
  // listing it is displayed under.
  const models = new Map<
    string,
    { modelName: string; brand: string; stored: number; listings: Set<string> }
  >()
  for (const f of facts) {
    // A listing that never resolved to a model is its own group; it still has a
    // reported figure worth checking.
    const key = f.modelId ?? `listing:${f.productId}`
    const m =
      models.get(key) ??
      { modelName: f.modelName ?? f.productTitle, brand: f.brand, stored: 0, listings: new Set() }
    m.stored++
    m.listings.add(f.productId)
    models.set(key, m)
  }

  return [...models].map(([modelId, m]) => ({
    modelId,
    modelName: m.modelName,
    brand: m.brand,
    stored: m.stored,
    reported: Math.max(
      0,
      ...[...m.listings].map((id) => latest.get(id)?.reported_total ?? 0),
    ),
    listings: m.listings.size,
  }))
}


interface ListingDimensions {
  shape: Shape | null
  thicknessMm: number | null
}

/** The value every SKU under a listing agrees on, or null where they differ. */
function listingDimensions(variants: VariantRow[]): Map<string, ListingDimensions> {
  const byProduct = new Map<string, VariantRow[]>()
  for (const v of variants) {
    const list = byProduct.get(v.product_id) ?? []
    list.push(v)
    byProduct.set(v.product_id, list)
  }

  const out = new Map<string, ListingDimensions>()
  for (const [productId, rows] of byProduct) {
    out.set(productId, {
      shape: agreedValue(rows.map((r) => r.variant_shape)) as Shape | null,
      thicknessMm: agreedValue(rows.map((r) => r.core_thickness_mm)),
    })
  }
  return out
}

function toFact(row: ReviewRow, listing: ListingDimensions | undefined): ReviewFact {
  return {
    reviewId: row.review_id,
    productId: row.product_id,
    productTitle: row.product_title ?? 'Untitled listing',
    modelId: row.model_id,
    modelName: row.model_name,
    brand: row.brand,
    brandSlug: row.brand_slug,
    rating: row.rating,
    shape: resolveShape(row.variant_label, listing?.shape ?? null),
    thicknessMm: resolveThickness(row.variant_label, listing?.thicknessMm ?? null),
    submittedAt: row.submitted_at,
    playStyle: row.play_style && row.play_style !== 'unknown' ? row.play_style : null,
  }
}

/**
 * Every row of a view, fetched as a fixed set of ranges in parallel.
 *
 * The exact count is asked for first so the ranges are known up front — that is
 * what makes the requests independent. A row inserted between the count and the
 * reads would be missed, which for a crawl that runs on demand is not a
 * meaningful race, and costs a count that is one review stale rather than a
 * page that takes four times as long.
 */
async function fetchAllParallel<T>(view: string, columns: string, orderBy: string): Promise<T[]> {
  const total = await withRetry(async () => {
    const { count, error } = await db().from(view).select('*', { count: 'exact', head: true })
    if (error) throw new Error(`count ${view}: ${error.message}`)
    return count ?? 0
  }, `count ${view}`)

  const pages = Math.ceil(total / PAGE)
  if (pages === 0) return []

  const out: T[][] = Array.from({ length: pages })
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pages) }, async () => {
      for (;;) {
        const index = next++
        if (index >= pages) return
        out[index] = await withRetry(async () => {
          const { data, error } = await db()
            .from(view)
            .select(columns)
            // Unique, ascending: without it the independent range requests
            // below overlap and drop rows. See selectAll for the measurement.
            .order(orderBy, { ascending: true })
            .range(index * PAGE, index * PAGE + PAGE - 1)
          if (error) throw new Error(`select ${view}: ${error.message}`)
          return (data ?? []) as T[]
        }, `select ${view} page ${index}`)
      }
    }),
  )
  return out.flat()
}


/* ---------------------------------------------------------------------------
 * Prose tier
 * ------------------------------------------------------------------------ */

interface ProseCache {
  facts: EnrichedFact[]
  loadedAt: number
}
let proseCache: ProseCache | null = null
let proseInFlight: Promise<EnrichedFact[]> | null = null

/**
 * Every review with its prose and questionnaire answers mined into flags.
 *
 * Pairs the prose rows back onto the counting facts positionally-by-key rather
 * than re-deriving anything: both reads are of the same view with the same
 * default ordering, but relying on that would be a silent correctness bug the
 * first time a row is inserted mid-read, so they are matched on the natural key
 * instead.
 */
export async function loadEnrichedFacts(): Promise<EnrichedFact[]> {
  if (proseCache && Date.now() - proseCache.loadedAt < TTL_MS) return proseCache.facts
  if (proseInFlight) return proseInFlight

  proseInFlight = readProse().finally(() => {
    proseInFlight = null
  })
  return proseInFlight
}

async function readProse(): Promise<EnrichedFact[]> {
  const started = Date.now()
  const [base, prose] = await Promise.all([
    loadReviewFacts(),
    fetchAllParallel<ProseRow>('v_review_search', PROSE_COLUMNS, 'review_id'),
  ])

  // Paired on review_id, which both tiers now select.
  //
  // The first version grouped prose rows by listing and zipped them onto the
  // facts in arrival order. That only worked while both reads happened to come
  // back in the same order — an assumption that was already false, since neither
  // read was ordered at all, and one that would have silently mismatched a
  // review's text to another review's rating.
  const proseById = new Map(prose.map((row) => [row.review_id, row]))

  const facts = base.map((fact) => {
    const row = proseById.get(fact.reviewId)
    const text = row ? reviewText([row.title, row.body, row.pros, row.cons]) : ''
    const mentions = brandsNamedIn(text, fact.brandSlug)
    return {
      ...fact,
      defects: defectsIn(text),
      mentions,
      readsAsSwitch: mentions.length > 0 && readsAsSwitch(text),
      perception: perceptionOf(row?.context_data ?? null),
      returningBuyer: wasReturningBuyer(row?.context_data ?? null),
      ownership: ownershipBucket(row?.context_data ?? null),
    }
  })

  proseCache = { facts, loadedAt: Date.now() }
  log.info('review prose loaded', {
    reviews: facts.length,
    flagged: facts.filter((f) => f.defects.length > 0).length,
    mentioning: facts.filter((f) => f.mentions.length > 0).length,
    ms: Date.now() - started,
  })
  return facts
}
