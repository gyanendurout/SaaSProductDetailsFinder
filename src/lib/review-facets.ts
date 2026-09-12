/**
 * Facet arithmetic — the rules that decide what a count beside a filter means.
 *
 * Kept out of review-queries.ts because that module imports 'server-only', and
 * these rules need to be testable without a database. Nothing here touches the
 * network.
 *
 * The rule every function below serves:
 *
 *   A number printed beside a filter must equal the number of rows you get
 *   after clicking it.
 *
 * That is not the same as "count the current result set". A brand chip that
 * showed the count of the CURRENT brand's reviews would read 0 for every brand
 * you are not looking at. Each facet is therefore counted with every active
 * predicate EXCEPT the ones its own link would replace or drop.
 */

import { clampPageSize } from './pagination.js'

export type ReviewSort = 'newest' | 'oldest' | 'rating_desc' | 'rating_asc' | 'helpful'

/** The orders the reviews list offers, and the labels beside them. */
export const REVIEW_SORTS: ReadonlyArray<{ value: ReviewSort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'rating_desc', label: 'Highest rated' },
  { value: 'rating_asc', label: 'Lowest rated' },
  { value: 'helpful', label: 'Most helpful' },
]

/** Structural shape of a review filter. review-queries.ts extends this. */
export interface ReviewFilter {
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

/**
 * Does this star survive the active star/sentiment predicate?
 *
 * `rating` wins over `sentiment` because the two are mutually exclusive in the
 * UI — picking a star clears the sentiment chip and vice versa — and because a
 * query string can carry both, in which case the narrower one is the safer read.
 */
export function starMatches(
  star: number,
  rating?: number,
  sentiment?: 'positive' | 'negative',
): boolean {
  if (rating !== undefined) return star === rating
  if (sentiment === 'positive') return star >= 4
  if (sentiment === 'negative') return star <= 3
  return true
}

/**
 * The histogram counts each star WITH the star filter applied.
 *
 * The bars themselves must ignore it — selecting "3 star" would otherwise zero
 * out every other bar and there would be no way back. But the average printed
 * beside them must not: the page showed 4.62 while listing nothing but one-star
 * reviews, because the average was computed from these same unfiltered bars.
 *
 * Zeroing rather than re-querying is exact. Each bar is already counted with
 * every other active predicate applied, so the rows that survive `rating=1` are
 * precisely the rows in bar 1.
 */
export function applyRatingPredicate(
  distribution: readonly number[],
  rating?: number,
  sentiment?: 'positive' | 'negative',
): number[] {
  return distribution.map((count, i) => (starMatches(i + 1, rating, sentiment) ? count : 0))
}

/** Mean star, or null when nothing in the set carries a star at all. */
export function meanRating(distribution: readonly number[]): number | null {
  const rated = distribution.reduce((n, c) => n + c, 0)
  if (rated === 0) return null
  const weighted = distribution.reduce((n, c, i) => n + c * (i + 1), 0)
  return weighted / rated
}

/**
 * Is anything narrowing the set beyond brand and product?
 *
 * This is the question that decides whether the pre-aggregated views can be
 * trusted. v_review_product_counts groups the whole reviews table, so its
 * numbers are exactly right under a brand-or-product-only filter and wrong
 * under every other one. When this returns false the cheap source is correct;
 * when it returns true the counts have to be recomputed against the live filter.
 *
 * Erring towards true only costs a read. Erring towards false prints a wrong
 * number, so anything that narrows rows belongs in this list.
 */
export function hasNarrowingFilters(query: ReviewFilter): boolean {
  return Boolean(
    (query.q && query.q.trim()) ||
      query.modelId ||
      query.rating !== undefined ||
      query.sentiment ||
      query.verifiedOnly ||
      query.withTextOnly ||
      query.withResponse ||
      query.from ||
      query.to,
  )
}

/**
 * The filter a facet is counted under.
 *
 * Brand and product are dropped together rather than separately because one
 * read serves both facets: the rows that come back carry each row's brand and
 * product, so a single pass can group them either way.
 */
export function facetScope(query: ReviewFilter): ReviewFilter {
  const scope: ReviewFilter = { ...query }
  delete scope.brand
  delete scope.productId
  delete scope.page
  delete scope.pageSize
  delete scope.sort
  return scope
}

export interface ScopeRow {
  product_id: string
  brand_slug: string
}

export interface FacetCounts {
  /** Product id → rows matching the full filter with that product selected. */
  byProduct: Map<string, number>
  /** Brand slug → rows matching the filter a brand link actually navigates to. */
  byBrand: Map<string, number>
}

/**
 * Group one filtered read into both facets.
 *
 * The two differ in which predicate each drops, and that difference is not
 * cosmetic — it is dictated by what the links do:
 *
 *   A product chip's href keeps the brand. So a product's count is taken from
 *   the rows of the active brand only.
 *
 *   A brand link's href DELETES `product` (BrandSwitcher does this, because a
 *   product belongs to one brand and carrying it across would guarantee an
 *   empty page). So a brand's count ignores the active product.
 */
export function tallyFacets(rows: readonly ScopeRow[], query: ReviewFilter): FacetCounts {
  const byProduct = new Map<string, number>()
  const byBrand = new Map<string, number>()

  for (const row of rows) {
    byBrand.set(row.brand_slug, (byBrand.get(row.brand_slug) ?? 0) + 1)
    if (query.brand && row.brand_slug !== query.brand) continue
    byProduct.set(row.product_id, (byProduct.get(row.product_id) ?? 0) + 1)
  }

  return { byProduct, byBrand }
}

/** The query string of /reviews, before any of it has been believed. */
export interface RawReviewParams {
  q?: string
  brand?: string
  product?: string
  model?: string
  rating?: string
  sentiment?: string
  verified?: string
  text?: string
  replied?: string
  from?: string
  to?: string
  sort?: string
  page?: string
  size?: string
}

/**
 * The URL, turned into a filter.
 *
 * Shared rather than duplicated because two places need the same answer from
 * the same query string — the page itself, and the endpoint the rail calls to
 * find out what each brand link would return. Two parsers would eventually
 * disagree about one parameter, and the symptom would be a count that is right
 * on the page and wrong in the rail.
 *
 * `brandSlug` is passed in already resolved: ?brand= may carry a display name
 * from a link shared before slugs, and resolving it needs the database.
 */
export function parseReviewFilter(
  params: RawReviewParams,
  brandSlug?: string,
): ReviewFilter {
  const rating = Number(params.rating)
  // Trimmed here rather than at the query, so that everything downstream — the
  // search box, the count line, the "no results" wording — echoes the term the
  // search actually ran on. `?q=%20%20grip%20` searched for "grip" and told the
  // reader it had searched for "  grip ".
  const q = params.q?.trim()
  return {
    ...(q ? { q } : {}),
    ...(brandSlug ? { brand: brandSlug } : {}),
    ...(params.product ? { productId: params.product } : {}),
    ...(params.model ? { modelId: params.model } : {}),
    ...(Number.isInteger(rating) && rating >= 1 && rating <= 5 ? { rating } : {}),
    ...(params.sentiment === 'positive' || params.sentiment === 'negative'
      ? { sentiment: params.sentiment }
      : {}),
    ...(params.verified === '1' ? { verifiedOnly: true } : {}),
    ...(params.text === '1' ? { withTextOnly: true } : {}),
    ...(params.replied === '1' ? { withResponse: true } : {}),
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
    sort: REVIEW_SORTS.find((s) => s.value === params.sort)?.value ?? 'newest',
    // Floored as well as clamped: '2.7' otherwise produced an offset that
    // straddled two pages and repeated rows across them.
    page: Math.max(1, Math.floor(Number(params.page)) || 1),
    pageSize: clampPageSize(params.size),
  }
}
