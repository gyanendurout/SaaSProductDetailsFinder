import { insertAll, selectAll, upsertReturning, upsertAll } from '../../lib/supabase.js'
import { stableHash } from '../../lib/hash.js'
import { PoliteClient } from '../../lib/http.js'
import { buildReviewAdapter } from '../../sources/reviews/index.js'
import type { RawReview, ReviewSiteTarget } from '../../sources/reviews/types.js'
import type { RunContext } from '../context.js'
import type { CatalogResult } from './catalog.js'

/**
 * Stage 5 — customer reviews, brand replies, and the review time series.
 *
 * Three writes per run, in this order:
 *
 *   reviews                   upsert on (site, platform, source id)
 *   review_responses          upsert on (review, body hash)
 *   product_review_snapshots  insert — one row per product, the series
 *
 * The ordering matters: a response needs its review's uuid, and the snapshot
 * counts what the first two just wrote.
 *
 * Incremental by default. The first run of a product reads every page; later
 * runs stop once a whole page predates what we already hold for that product,
 * because every adapter sorts newest-first. That turns a weekly re-crawl of
 * ~50k reviews into a few pages per product instead of thousands, while a
 * `--full` run still re-reads everything to pick up edits and late replies.
 */
export interface ReviewStageOptions {
  /** Ignore the per-product watermark and re-read every page. */
  full?: boolean
  /** Re-read anything submitted within this many days, to catch late replies. */
  overlapDays?: number
}

/**
 * Default overlap. A brand replying a week after the review is normal (JOOLA's
 * observed replies land 1-5 days later), so an incremental run deliberately
 * re-reads the trailing fortnight rather than stopping dead at the newest
 * review it already has.
 */
const DEFAULT_OVERLAP_DAYS = 14

interface WatermarkRow {
  product_id: string
  submitted_at: string | null
}

export async function runReviewsStage(
  ctx: RunContext,
  catalog: CatalogResult,
  options: ReviewStageOptions = {},
): Promise<void> {
  const platform = ctx.site.review_platform
  if (!platform) {
    ctx.log.info('no review_platform configured for this site; skipping reviews')
    return
  }

  const http = new PoliteClient(ctx.site.crawl_delay_ms)
  const adapter = buildReviewAdapter(platform, http)
  if (!adapter) return

  const target: ReviewSiteTarget = {
    siteId: ctx.site.id,
    baseUrl: ctx.site.base_url,
    config: ctx.site.review_config ?? {},
  }

  // Only products that are actually part of the assortment. Reviews on an
  // accessory that slipped into a collection are noise we would pay for on
  // every run.
  const products = catalog.products.filter((p) => catalog.productIds.has(p.sourceProductId))

  if (ctx.dryRun) {
    await dryRunProbe(ctx, adapter, target, products)
    return
  }

  const watermarks = options.full
    ? new Map<string, Date>()
    : await loadWatermarks(ctx, options.overlapDays ?? DEFAULT_OVERLAP_DAYS)

  const observedAt = new Date().toISOString()
  const snapshotRows: Array<Record<string, unknown>> = []
  let totalFound = 0
  let totalNew = 0
  let totalResponses = 0
  const failures: string[] = []

  for (const product of products) {
    const productId = catalog.productIds.get(product.sourceProductId)
    if (!productId) continue

    // The fetch AND the write are both inside the guard. Only the fetch used to
    // be, which meant a single malformed field in one product's payload threw
    // out of persistProductReviews and killed the stage for the whole site —
    // Selkirk lost 1,480 of its 1,864 reviews that way. Anything that can fail
    // per product belongs in here.
    let fetched
    let written
    try {
      fetched = await adapter.fetchProductReviews(
        target,
        product.sourceProductId,
        watermarks.get(productId) ?? null,
      )
      written = await persistProductReviews(
        ctx,
        productId,
        platform,
        fetched.reviews,
        observedAt,
      )
    } catch (err) {
      // One product's review widget being broken must not cost us the other
      // eighty-four. Recorded, counted, and the run finishes partial.
      failures.push(product.handle)
      ctx.log.warn('review fetch failed', {
        handle: product.handle,
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    totalFound += fetched.reviews.length
    totalNew += written.newReviews
    totalResponses += written.newResponses

    snapshotRows.push(
      buildSnapshotRow(ctx, productId, observedAt, fetched.reportedTotal, written.stored),
    )

    if (
      fetched.reportedTotal !== null &&
      fetched.reviews.length < fetched.reportedTotal &&
      !watermarks.has(productId)
    ) {
      // Only meaningful on a full read: an incremental run is *expected* to
      // return fewer than the total.
      ctx.log.warn('fetched fewer reviews than the platform reports', {
        handle: product.handle,
        fetched: fetched.reviews.length,
        reported: fetched.reportedTotal,
      })
    }
  }

  if (snapshotRows.length > 0) await insertAll('product_review_snapshots', snapshotRows)

  ctx.stats.reviews_found = totalFound
  ctx.stats.reviews_new = totalNew
  ctx.stats.review_responses_new = totalResponses

  ctx.log.info('reviews stored', {
    products: snapshotRows.length,
    reviewsSeen: totalFound,
    reviewsNew: totalNew,
    responsesNew: totalResponses,
    failedProducts: failures.length,
    observedAt,
  })

  if (failures.length > 0) {
    throw Object.assign(
      new Error(`${failures.length} product(s) failed review fetch: ${failures.slice(0, 5).join(', ')}`),
      { target: failures[0] },
    )
  }
}

/**
 * Upserts one product's reviews and their reply chains, and returns what is now
 * stored for that product so the snapshot can be computed without reading back.
 */
async function persistProductReviews(
  ctx: RunContext,
  productId: string,
  platform: string,
  reviews: RawReview[],
  observedAt: string,
): Promise<{ newReviews: number; newResponses: number; stored: StoredReview[] }> {
  if (reviews.length === 0) {
    // A product can genuinely have no reviews; its snapshot is still written so
    // the series has a zero rather than a hole.
    return { newReviews: 0, newResponses: 0, stored: await loadStoredReviews(productId) }
  }

  const known = await loadKnownIds(productId, platform)

  const toRow = (r: RawReview): Record<string, unknown> => ({
    site_id: ctx.site.id,
    product_id: productId,
    review_platform: platform,
    source_review_id: r.sourceReviewId,
    rating: r.rating,
    rating_range: r.ratingRange,
    title: nullIfBlank(r.title),
    body: nullIfBlank(r.body),
    pros: nullIfBlank(r.pros),
    cons: nullIfBlank(r.cons),
    author_name: nullIfBlank(r.authorName),
    author_id: nullIfBlank(r.authorId),
    author_location: nullIfBlank(r.authorLocation),
    is_verified_buyer: r.isVerifiedBuyer,
    is_recommended: r.isRecommended,
    is_incentivized: r.isIncentivized,
    is_syndicated: r.isSyndicated,
    is_ratings_only: r.isRatingsOnly,
    helpful_count: r.helpfulCount,
    unhelpful_count: r.unhelpfulCount,
    response_count: r.responses.length,
    photo_count: r.photoCount,
    video_count: r.videoCount,
    variant_label: nullIfBlank(r.variantLabel),
    source_variant_id: nullIfBlank(r.sourceVariantId),
    context_data: r.contextData,
    media: r.media,
    submitted_at: r.submittedAt,
    source_updated_at: r.sourceUpdatedAt,
    language_code: nullIfBlank(r.languageCode),
    last_seen_at: observedAt,
    last_seen_run_id: ctx.runId,
  })

  // Split by whether we have seen the review before, and write the two groups
  // as separate statements.
  //
  // Two reasons, and either alone would force it:
  //
  //  - first_seen_at must be set on insert and must NOT be touched on update,
  //    or every re-crawl rewrites the date we discovered the review to today
  //    and the collection history is destroyed.
  //  - PostgREST requires every object in a bulk write to carry identical keys
  //    and rejects the batch with PGRST102 otherwise. Conditionally spreading
  //    first_seen_at onto only the new rows would therefore fail outright on
  //    any run that mixes new and known reviews — which is every incremental
  //    run after the first.
  const freshRows: Array<Record<string, unknown>> = []
  const knownRows: Array<Record<string, unknown>> = []
  for (const review of reviews) {
    const row = toRow(review)
    if (known.has(review.sourceReviewId)) {
      knownRows.push(row)
    } else {
      freshRows.push({ ...row, first_seen_at: observedAt, first_seen_run_id: ctx.runId })
    }
  }

  const onConflict = 'site_id,review_platform,source_review_id'
  const columns = 'id,source_review_id'
  const storedRows = [
    ...(freshRows.length > 0
      ? await upsertReturning<Record<string, unknown>, { id: string; source_review_id: string }>(
          'reviews',
          freshRows,
          onConflict,
          columns,
        )
      : []),
    ...(knownRows.length > 0
      ? await upsertReturning<Record<string, unknown>, { id: string; source_review_id: string }>(
          'reviews',
          knownRows,
          onConflict,
          columns,
        )
      : []),
  ]

  const idBySource = new Map(storedRows.map((r) => [r.source_review_id, r.id]))
  const newReviews = freshRows.length

  // ---- reply chains --------------------------------------------------------
  const responseRows: Array<Record<string, unknown>> = []
  for (const review of reviews) {
    const reviewId = idBySource.get(review.sourceReviewId)
    if (!reviewId) continue
    // Two identical replies on one review are indistinguishable and would
    // collide on the hash key, so the same statement cannot carry both.
    const seenHashes = new Set<string>()
    for (const response of review.responses) {
      const hash = stableHash(response.body.trim().replace(/\s+/g, ' '))
      if (seenHashes.has(hash)) continue
      seenHashes.add(hash)
      responseRows.push({
        review_id: reviewId,
        site_id: ctx.site.id,
        source_response_id: nullIfBlank(response.sourceResponseId),
        response_hash: hash,
        author_name: nullIfBlank(response.authorName),
        department: nullIfBlank(response.department),
        response_source: nullIfBlank(response.responseSource),
        body: response.body,
        responded_at: response.respondedAt,
        last_seen_at: observedAt,
      })
    }
  }

  let newResponses = 0
  if (responseRows.length > 0) {
    const knownResponses = await loadKnownResponseHashes([...idBySource.values()])
    newResponses = responseRows.filter(
      (r) => !knownResponses.has(`${r['review_id']}:${r['response_hash']}`),
    ).length
    await upsertAll('review_responses', responseRows, 'review_id,response_hash')
  }

  return { newReviews, newResponses, stored: await loadStoredReviews(productId) }
}

interface StoredReview {
  rating: number | null
  is_ratings_only: boolean
  is_recommended: boolean | null
  is_verified_buyer: boolean | null
  response_count: number
  first_seen_run_id: string | null
}

/**
 * Reads back what is stored for a product so the snapshot describes the whole
 * product, not just the slice this run happened to fetch. On an incremental run
 * those differ by every review we correctly skipped.
 */
async function loadStoredReviews(productId: string): Promise<StoredReview[]> {
  return selectAll<StoredReview>(
    'reviews',
    'rating,is_ratings_only,is_recommended,is_verified_buyer,response_count,first_seen_run_id',
    (q) => q.eq('product_id', productId),
  )
}

async function loadKnownIds(productId: string, platform: string): Promise<Set<string>> {
  const rows = await selectAll<{ source_review_id: string }>('reviews', 'source_review_id', (q) =>
    q.eq('product_id', productId).eq('review_platform', platform),
  )
  return new Set(rows.map((r) => r.source_review_id))
}

async function loadKnownResponseHashes(reviewIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  // `in` has a URL-length ceiling in PostgREST, so this is chunked.
  for (let i = 0; i < reviewIds.length; i += 200) {
    const chunk = reviewIds.slice(i, i + 200)
    const rows = await selectAll<{ review_id: string; response_hash: string }>(
      'review_responses',
      'review_id,response_hash',
      (q) => q.in('review_id', chunk),
    )
    for (const r of rows) out.add(`${r.review_id}:${r.response_hash}`)
  }
  return out
}

/**
 * Newest review we already hold per product, less an overlap window.
 *
 * The overlap is the whole point: reviews are immutable but the things hanging
 * off them are not. Stopping exactly at the newest review we hold would mean a
 * brand reply written three days later is never collected.
 */
async function loadWatermarks(ctx: RunContext, overlapDays: number): Promise<Map<string, Date>> {
  // Only the two columns the watermark needs: this reads every review row for
  // the site, so the projection is what keeps it cheap at 50k rows.
  const rows = await selectAll<WatermarkRow>('reviews', 'product_id,submitted_at', (q) =>
    q.eq('site_id', ctx.site.id),
  )

  const newest = new Map<string, number>()
  for (const row of rows) {
    if (!row.submitted_at) continue
    const t = Date.parse(row.submitted_at)
    if (!Number.isFinite(t)) continue
    const current = newest.get(row.product_id)
    if (current === undefined || t > current) newest.set(row.product_id, t)
  }

  const overlapMs = overlapDays * 24 * 60 * 60 * 1000
  const out = new Map<string, Date>()
  for (const [productId, t] of newest) out.set(productId, new Date(t - overlapMs))

  ctx.log.info('review watermarks loaded', {
    products: out.size,
    overlapDays,
    knownReviews: rows.length,
  })
  return out
}

function buildSnapshotRow(
  ctx: RunContext,
  productId: string,
  observedAt: string,
  reportedTotal: number | null,
  stored: StoredReview[],
): Record<string, unknown> {
  const buckets = [0, 0, 0, 0, 0]
  let ratingSum = 0
  let rated = 0

  for (const r of stored) {
    if (r.rating === null) continue
    const bucket = Math.round(Number(r.rating))
    if (bucket >= 1 && bucket <= 5) buckets[bucket - 1]! += 1
    ratingSum += Number(r.rating)
    rated++
  }

  const ratingsOnly = stored.filter((r) => r.is_ratings_only).length

  return {
    run_id: ctx.runId,
    product_id: productId,
    site_id: ctx.site.id,
    observed_at: observedAt,
    reported_total: reportedTotal,
    review_count: stored.length,
    with_text_count: stored.length - ratingsOnly,
    ratings_only_count: ratingsOnly,
    average_rating: rated > 0 ? Number((ratingSum / rated).toFixed(3)) : null,
    rating_1_count: buckets[0],
    rating_2_count: buckets[1],
    rating_3_count: buckets[2],
    rating_4_count: buckets[3],
    rating_5_count: buckets[4],
    recommended_count: stored.filter((r) => r.is_recommended === true).length,
    not_recommended_count: stored.filter((r) => r.is_recommended === false).length,
    verified_count: stored.filter((r) => r.is_verified_buyer === true).length,
    with_response_count: stored.filter((r) => r.response_count > 0).length,
    new_review_count: stored.filter((r) => r.first_seen_run_id === ctx.runId).length,
  }
}

/**
 * A dry run reads a handful of products and prints what it found. This is how a
 * new brand's review platform and config get validated against the live site
 * before a single row is written.
 */
async function dryRunProbe(
  ctx: RunContext,
  adapter: ReturnType<typeof buildReviewAdapter> & object,
  target: ReviewSiteTarget,
  products: Array<{ sourceProductId: string; handle: string }>,
): Promise<void> {
  const sample = products.slice(0, 3)
  ctx.log.info('dry-run: probing review source', {
    platform: adapter.platform,
    products: sample.length,
  })

  for (const product of sample) {
    try {
      const result = await adapter.fetchProductReviews(target, product.sourceProductId, null)
      const withText = result.reviews.filter((r) => !r.isRatingsOnly).length
      const withReply = result.reviews.filter((r) => r.responses.length > 0).length
      const rated = result.reviews.filter((r) => r.rating !== null)
      const avg =
        rated.length > 0
          ? (rated.reduce((n, r) => n + (r.rating ?? 0), 0) / rated.length).toFixed(2)
          : 'n/a'
      ctx.log.info(`  ${product.handle}`, {
        reported: result.reportedTotal,
        fetched: result.reviews.length,
        withText,
        withReply,
        avgRating: avg,
      })
    } catch (err) {
      ctx.log.error(`  ${product.handle} failed`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/**
 * Every argument here comes from a third-party review API, and those APIs do not
 * honour our types: Okendo returns reviewer.location as a string on most reviews
 * and as an object on others. Typing the parameter as `string` did not prevent
 * that — it only meant the mismatch surfaced as "value?.trim is not a function"
 * deep inside a bulk write, aborting a whole site's stage over one field.
 *
 * So the boundary is enforced at runtime rather than assumed: scalars are
 * coerced, and anything structural narrows this one column to null instead of
 * taking the run down with it. Adapters should still flatten their own shapes —
 * this is the net, not the plan.
 */
function nullIfBlank(value: unknown): string | null {
  if (value === null || value === undefined) return null

  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number'
        ? Number.isFinite(value)
          ? String(value)
          : ''
        : typeof value === 'boolean'
          ? String(value)
          : ''

  const trimmed = text.trim()
  return trimmed ? trimmed : null
}
