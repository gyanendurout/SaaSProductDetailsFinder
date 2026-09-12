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
import type { ReviewFact } from './review-stats.js'

const log = createLogger('review-analysis')

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
 * Six rather than twenty-one because this is someone's shared Supabase instance
 * and a page load should not open a connection per thousand rows.
 */
const CONCURRENCY = 6

const REVIEW_COLUMNS = 'product_id,product_title,model_id,model_name,brand,brand_slug,rating,variant_label'
const VARIANT_COLUMNS = 'product_id,variant_shape,core_thickness_mm'

interface ReviewRow {
  product_id: string
  product_title: string | null
  model_id: string | null
  model_name: string | null
  brand: string
  brand_slug: string
  rating: number | null
  variant_label: string | null
}

interface VariantRow {
  product_id: string
  variant_shape: string | null
  core_thickness_mm: number | null
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
  loadedAt: number
}
const TTL_MS = 120_000
let cache: CacheEntry | null = null

export function reviewFactsCachedAt(): number | null {
  return cache && Date.now() - cache.loadedAt < TTL_MS ? cache.loadedAt : null
}

export async function loadReviewFacts(): Promise<ReviewFact[]> {
  const fresh = cache && Date.now() - cache.loadedAt < TTL_MS
  if (cache && fresh) return cache.facts

  const started = Date.now()
  const [reviews, variants] = await Promise.all([
    fetchAllParallel<ReviewRow>('v_review_search', REVIEW_COLUMNS),
    fetchAllParallel<VariantRow>('v_variant_current', VARIANT_COLUMNS),
  ])

  const listings = listingDimensions(variants)
  const facts = reviews.map((r) => toFact(r, listings.get(r.product_id)))

  cache = { facts, loadedAt: Date.now() }
  log.info('review facts loaded', {
    reviews: facts.length,
    variants: variants.length,
    ms: Date.now() - started,
  })
  return facts
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
    productId: row.product_id,
    productTitle: row.product_title ?? 'Untitled listing',
    modelId: row.model_id,
    modelName: row.model_name,
    brand: row.brand,
    brandSlug: row.brand_slug,
    rating: row.rating,
    shape: resolveShape(row.variant_label, listing?.shape ?? null),
    thicknessMm: resolveThickness(row.variant_label, listing?.thicknessMm ?? null),
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
async function fetchAllParallel<T>(view: string, columns: string): Promise<T[]> {
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
            .range(index * PAGE, index * PAGE + PAGE - 1)
          if (error) throw new Error(`select ${view}: ${error.message}`)
          return (data ?? []) as T[]
        }, `select ${view} page ${index}`)
      }
    }),
  )
  return out.flat()
}
