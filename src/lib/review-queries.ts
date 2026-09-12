import 'server-only'
import { db, selectAll } from './supabase.js'
import { withRetry } from './retry.js'
import { sanitiseTerm, toIlikeValue } from './review-search-term.js'

/**
 * Read layer for reviews.
 *
 * Separate from queries.ts, and built differently on purpose.
 *
 * Everything else in the dashboard reads a few hundred rows and can pull a view
 * whole with selectAll(). Reviews are tens of thousands and grow every week, so
 * nothing here loads a full table: filtering, sorting, paging and counting all
 * happen in Postgres, and a page holds exactly one screen of rows.
 */

export interface ReviewRow {
  review_id: string
  review_platform: string
  rating: number | null
  rating_range: number
  title: string | null
  body: string | null
  pros: string | null
  cons: string | null
  author_name: string | null
  author_location: string | null
  is_verified_buyer: boolean | null
  is_recommended: boolean | null
  is_incentivized: boolean | null
  is_ratings_only: boolean
  helpful_count: number
  unhelpful_count: number
  response_count: number
  photo_count: number
  variant_label: string | null
  context_data: Record<string, unknown> | null
  submitted_at: string | null
  first_seen_at: string
  product_id: string
  product_title: string
  product_url: string | null
  product_image_url: string | null
  model_id: string | null
  model_name: string | null
  product_line: string | null
  generation: string | null
  brand: string
  brand_slug: string
}

export interface ReviewResponseRow {
  id: string
  review_id: string
  author_name: string | null
  department: string | null
  body: string
  responded_at: string | null
}

export type ReviewSort = 'newest' | 'oldest' | 'rating_desc' | 'rating_asc' | 'helpful'

export interface ReviewQuery {
  q?: string
  brand?: string
  productId?: string
  modelId?: string
  rating?: number
  /** 'positive' = 4 and up, 'negative' = 3 and below. The complaint filter. */
  sentiment?: 'positive' | 'negative'
  verifiedOnly?: boolean
  withTextOnly?: boolean
  withResponse?: boolean
  from?: string
  to?: string
  sort?: ReviewSort
  page?: number
  pageSize?: number
}

export interface ReviewPage {
  rows: ReviewRow[]
  responses: Map<string, ReviewResponseRow[]>
  total: number
  page: number
  pageSize: number
}

const REVIEW_COLUMNS =
  'review_id,review_platform,rating,rating_range,title,body,pros,cons,author_name,author_location,is_verified_buyer,is_recommended,is_incentivized,is_ratings_only,helpful_count,unhelpful_count,response_count,photo_count,variant_label,context_data,submitted_at,first_seen_at,product_id,product_title,product_url,product_image_url,model_id,model_name,product_line,generation,brand,brand_slug'

export const REVIEW_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 200

/**
 * One page of reviews, plus the reply chain for exactly those rows.
 *
 * Replies come from a second query rather than a join: a review can carry
 * several, and joining would repeat the review once per reply — breaking both
 * the page size and the exact count the pager depends on.
 */
export async function searchReviews(query: ReviewQuery): Promise<ReviewPage> {
  // Math.floor, not just Math.max. `?page=2.7` used to compute an offset of
  // 85 and return rows 86-135 — a window straddling two pages, so rows showed
  // up twice across the pager.
  const requested = Math.max(1, Math.floor(query.page ?? 1) || 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize ?? REVIEW_PAGE_SIZE)))

  let result = await fetchPage(query, requested, pageSize)
  let page = requested

  // PostgREST answers a range that starts past the end with 416, which used to
  // surface as an unhandled throw and take the whole route to its error
  // boundary — `?page=9999` returned "This page could not load" on an HTTP 200.
  // The count comes back on that response, so the last real page is known and
  // the honest thing is to serve it.
  if (result === RANGE_PAST_END) {
    const total = await countReviews(query)
    page = Math.max(1, Math.ceil(total / pageSize))
    const retry = await fetchPage(query, page, pageSize)
    result = retry === RANGE_PAST_END ? { rows: [], count: total } : retry
  }

  return {
    rows: result.rows,
    responses: await getReviewResponses(result.rows.map((r) => r.review_id)),
    total: result.count,
    page,
    pageSize,
  }
}

interface PageResult {
  rows: ReviewRow[]
  count: number
}

/** Sentinel for "the requested range starts past the end of the result set". */
const RANGE_PAST_END = Symbol('range past end')

async function fetchPage(
  query: ReviewQuery,
  page: number,
  pageSize: number,
): Promise<PageResult | typeof RANGE_PAST_END> {
  const offset = (page - 1) * pageSize
  return withRetry(async () => {
    const base = db().from('v_review_search').select(REVIEW_COLUMNS, { count: 'exact' })
    let q = applyReviewFilters(base, query)
    q = applyReviewSort(q, query.sort ?? 'newest')

    const { data, error, count } = await q.range(offset, offset + pageSize - 1)
    // Returned rather than thrown, so withRetry does not spend three attempts
    // on a request that cannot succeed.
    if (error && isRangeError(error)) return RANGE_PAST_END
    if (error) throw new Error(error.message)
    return { rows: (data ?? []) as unknown as ReviewRow[], count: count ?? 0 }
  }, 'searchReviews')
}

async function countReviews(query: ReviewQuery): Promise<number> {
  return withRetry(async () => {
    const base = db().from('v_review_search').select('review_id', { count: 'exact', head: true })
    const { count, error } = await applyReviewFilters(base, query)
    if (error) throw new Error(error.message)
    return count ?? 0
  }, 'countReviews')
}

function isRangeError(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST103' || /range not satisfiable/i.test(error.message ?? '')
}

/**
 * PostgREST builders are heavily generic and each chained call narrows the type
 * further; naming that type precisely buys nothing here, and the filters below
 * are all standard operators. `any` is confined to these two helpers and never
 * escapes into a result type.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function applyReviewFilters(builder: any, query: ReviewQuery): any {
  let q = builder
  if (query.brand) q = q.eq('brand_slug', query.brand)
  if (query.productId) q = q.eq('product_id', query.productId)
  if (query.modelId) q = q.eq('model_id', query.modelId)
  if (query.rating) q = q.eq('rating', query.rating)
  if (query.sentiment === 'positive') q = q.gte('rating', 4)
  if (query.sentiment === 'negative') q = q.lte('rating', 3)
  if (query.verifiedOnly) q = q.eq('is_verified_buyer', true)
  if (query.withTextOnly) q = q.eq('is_ratings_only', false)
  if (query.withResponse) q = q.gt('response_count', 0)
  if (query.from) q = q.gte('submitted_at', query.from)
  if (query.to) q = q.lte('submitted_at', query.to)

  const term = sanitiseTerm(query.q)
  if (term) {
    // ILIKE across the three fields a reader means by "search", rather than
    // full-text against search_tsv. English stemming drops exactly the tokens
    // this catalogue is searched by — a model number, "3S", "Pro V" — and a
    // substring match finds them. The trigram index on body serves it, and the
    // tsvector column stays in place for the ranked/phrase search that the
    // sentiment work will want.
    const value = toIlikeValue(term)
    q = q.or(`title.ilike.${value},body.ilike.${value},author_name.ilike.${value}`)
  }
  return q
}

function applyReviewSort(builder: any, sort: ReviewSort): any {
  let q = builder
  switch (sort) {
    case 'oldest':
      q = q.order('submitted_at', { ascending: true, nullsFirst: false })
      break
    case 'rating_desc':
      q = q.order('rating', { ascending: false, nullsFirst: false })
      break
    case 'rating_asc':
      q = q.order('rating', { ascending: true, nullsFirst: false })
      break
    case 'helpful':
      q = q.order('helpful_count', { ascending: false })
      break
    default:
      q = q.order('submitted_at', { ascending: false, nullsFirst: false })
  }
  // A stable tiebreaker. Without it, rows sharing a sort key can reappear on
  // the next page while others are never shown at all.
  return q.order('review_id', { ascending: false })
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function getReviewResponses(
  reviewIds: string[],
): Promise<Map<string, ReviewResponseRow[]>> {
  const out = new Map<string, ReviewResponseRow[]>()
  if (reviewIds.length === 0) return out

  const rows = await withRetry(async () => {
    const { data, error } = await db()
      .from('review_responses')
      .select('id,review_id,author_name,department,body,responded_at')
      .in('review_id', reviewIds)
      .order('responded_at', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as ReviewResponseRow[]
  }, 'getReviewResponses')

  for (const row of rows) {
    const list = out.get(row.review_id)
    if (list) list.push(row)
    else out.set(row.review_id, [row])
  }
  return out
}

export interface ReviewFacets {
  total: number
  withText: number
  withResponse: number
  verified: number
  averageRating: number | null
  /** Index 0 is one star. */
  distribution: number[]
}

/**
 * Headline numbers for the current filter, as count-only queries (`head: true`)
 * so not a single row crosses the wire to produce them.
 */
export async function getReviewFacets(query: ReviewQuery): Promise<ReviewFacets> {
  const countWith = (extra: Partial<ReviewQuery>): Promise<number> =>
    withRetry(async () => {
      const base = db().from('v_review_search').select('review_id', { count: 'exact', head: true })
      const { error, count } = await applyReviewFilters(base, { ...query, ...extra })
      if (error) throw new Error(error.message)
      return count ?? 0
    }, 'reviewFacetCount')

  const [total, withText, withResponse, verified, one, two, three, four, five] = await Promise.all([
    // The star counts must ignore an active star filter, or selecting "3 star"
    // would zero out every other bar in the distribution.
    countWith({}),
    countWith({ withTextOnly: true }),
    countWith({ withResponse: true }),
    countWith({ verifiedOnly: true }),
    countWith({ rating: 1, sentiment: undefined }),
    countWith({ rating: 2, sentiment: undefined }),
    countWith({ rating: 3, sentiment: undefined }),
    countWith({ rating: 4, sentiment: undefined }),
    countWith({ rating: 5, sentiment: undefined }),
  ])

  const distribution = [one, two, three, four, five]
  const rated = distribution.reduce((n, c) => n + c, 0)
  const weighted = distribution.reduce((n, c, i) => n + c * (i + 1), 0)

  return {
    total,
    withText,
    withResponse,
    verified,
    averageRating: rated > 0 ? weighted / rated : null,
    distribution,
  }
}

export interface ReviewBrandCount {
  brand: string
  brand_slug: string
  count: number
}

/**
 * Brand chips for the filter bar.
 *
 * This used to sum review_count across products from the snapshot view, which
 * made every chip lie: Selkirk advertised 13,520 and returned 6,161, JOOLA
 * advertised 5,189 and returned 2,477. A review syndicated across a paddle's
 * twelve colourway listings is counted once per listing in the snapshots and
 * exactly once in the reviews table, so the two numbers can never agree.
 *
 * A chip's number now comes from the same query the chip performs, so clicking
 * it can only ever produce the count it advertised. One count per brand is
 * three round trips rather than one, which is the price of the label being true.
 */
export async function getReviewBrandCounts(): Promise<ReviewBrandCount[]> {
  const brands = await selectAll<{ name: string; slug: string }>('brands', 'name,slug')

  const counted = await Promise.all(
    brands.map(async (b) => {
      const count = await withRetry(async () => {
        const { error, count: n } = await db()
          .from('v_review_search')
          .select('review_id', { count: 'exact', head: true })
          .eq('brand_slug', b.slug)
        if (error) throw new Error(error.message)
        return n ?? 0
      }, 'reviewBrandCount')

      return { brand: b.name, brand_slug: b.slug, count }
    }),
  )

  // A brand with nothing stored has no chip: an always-empty filter is noise.
  return counted.filter((c) => c.count > 0).sort((a, b) => b.count - a.count)
}

export interface ReviewTrendPoint {
  observed_at: string
  review_count: number
  average_rating: number | null
  new_review_count: number
  rating_1_count: number
  rating_2_count: number
  rating_3_count: number
  rating_4_count: number
  rating_5_count: number
}

/**
 * The review time series for one product — the answer to "how is this changing
 * over months and years". Reads product_review_snapshots directly: it is
 * already exactly one row per run.
 */
export async function getReviewTrend(productId: string): Promise<ReviewTrendPoint[]> {
  return withRetry(async () => {
    const { data, error } = await db()
      .from('product_review_snapshots')
      .select(
        'observed_at,review_count,average_rating,new_review_count,rating_1_count,rating_2_count,rating_3_count,rating_4_count,rating_5_count',
      )
      .eq('product_id', productId)
      .order('observed_at', { ascending: true })
      .limit(400)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as ReviewTrendPoint[]
  }, 'getReviewTrend')
}

export interface ReviewedProduct {
  product_id: string
  product_title: string
  brand: string
  brand_slug: string
  review_count: number | null
  average_rating: number | null
  observed_at: string | null
}

/**
 * Product picker for the reviews filter bar.
 *
 * Sourced from v_review_product_counts (migration 0007), which groups the
 * reviews table itself. The previous source — the snapshot view — listed 126
 * products, and 116 of them returned "no reviews match those filters" when
 * clicked, because a syndicated review carries exactly one product_id while the
 * snapshots record a count for every listing it appears under.
 *
 * If the migration has not been applied the view is absent; rather than take
 * the page down we fall back to the old source and mark the result, so the
 * caller can say why the list looks the way it does.
 */
export async function getReviewedProducts(brand?: string): Promise<ReviewedProduct[]> {
  try {
    const rows = await selectAll<ReviewedProduct>(
      'v_review_product_counts',
      'product_id,product_title,brand,brand_slug,review_count,average_rating',
      (q) => (brand ? q.eq('brand_slug', brand) : q),
      { orderBy: 'product_id' },
    )
    return sortProducts(rows)
  } catch (error) {
    if (!isMissingRelation(error)) throw error

    const rows = await selectAll<ReviewedProduct>(
      'v_product_reviews_current',
      'product_id,product_title,brand,brand_slug,review_count,average_rating,observed_at',
      (q) => {
        const filtered = q.gt('review_count', 0)
        return brand ? filtered.eq('brand_slug', brand) : filtered
      },
      { orderBy: 'product_id' },
    )
    return sortProducts(rows)
  }
}

function sortProducts(rows: ReviewedProduct[]): ReviewedProduct[] {
  return [...rows].sort(
    (a, b) =>
      (b.review_count ?? 0) - (a.review_count ?? 0) ||
      a.product_title.localeCompare(b.product_title),
  )
}

/** PostgREST reports an unapplied migration as PGRST205 / "Could not find the table". */
function isMissingRelation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('PGRST205') || message.includes('Could not find the table')
}
