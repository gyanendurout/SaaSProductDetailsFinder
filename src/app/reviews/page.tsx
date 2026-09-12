import type { Metadata } from 'next'
import Link from 'next/link'
import { ReviewCard } from '../../components/ReviewCard'
import { ProductFilter } from '../../components/ProductFilter'
import { Pager } from '../../components/Pager'
import { resolveBrand } from '../../lib/queries.js'
import { RatingHistogram, Stars } from '../../components/Stars'
import {
  getFacetCounts,
  getReviewFacets,
  getReviewedProducts,
  searchReviews,
  type FacetCounts,
  type ReviewFacets,
  type ReviewPage,
  type ReviewQuery,
  type ReviewSort,
} from '../../lib/review-queries.js'
import { DEFAULT_REVIEW_PAGE_SIZE, lastPageOf } from '../../lib/pagination.js'
import { REVIEW_SORTS, parseReviewFilter } from '../../lib/review-facets.js'
import { createLogger } from '../../lib/logger.js'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Reviews',
  description:
    'Every review each storefront publishes, reconciled across Bazaarvoice, Okendo, Judge.me and Yotpo so a complaint can be compared with a complaint.',
}

const log = createLogger('reviews-page')

/** What the page renders when the search could not be run at all. */
const EMPTY_PAGE: ReviewPage = {
  rows: [],
  responses: new Map(),
  total: 0,
  page: 1,
  pageSize: DEFAULT_REVIEW_PAGE_SIZE,
}
const EMPTY_FACETS: ReviewFacets = {
  total: 0,
  averageRating: null,
  withText: 0,
  withResponse: 0,
  verified: 0,
  distribution: [],
}

interface SearchParams {
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

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  // ?brand= is canonically a slug, but links shared before that change carry
  // the display name; resolving here keeps them working.
  const scope = await resolveBrand(params.brand)
  // Parsed by the same function the rail's count endpoint uses, so the two
  // can never disagree about what the URL asked for.
  const query: ReviewQuery = parseReviewFilter(params, scope?.slug)

  // Facets and brand chips do not depend on the page, so they are issued
  // alongside the page query rather than after it.
  //
  // Wrapped, because a search term must never be able to take the route down.
  // Some strings — 'OR 1=1 --' among them — are rejected by the WAF in front of
  // the database, which answers with an HTML block page rather than JSON. That
  // surfaced as an unhandled throw and the whole page became "Something went
  // wrong", on an HTTP 200 so nothing monitored it. The query is parameterised
  // and the term is escaped (see toIlikeValue), so this is a false positive at
  // the edge rather than an injection — but the fix a reader needs is the page
  // still rendering.
  let failure: 'none' | 'rejected' | 'unavailable' = 'none'
  let page = EMPTY_PAGE
  let facets = EMPTY_FACETS
  let products: Awaited<ReturnType<typeof getReviewedProducts>> = []
  let counts: FacetCounts | null = null
  try {
    ;[page, facets, products, counts] = await Promise.all([
      searchReviews(query),
      getReviewFacets(query),
      getReviewedProducts(query.brand),
      // Null when brand and product are the only filters — the pre-aggregated
      // counts are exactly right then, and this read is worth several seconds.
      getFacetCounts(query),
    ])
  } catch (error) {
    failure = classifyFailure(error)
    log.warn('review search failed; rendering the empty state', {
      q: query.q ?? null,
      failure,
      message: describeError(error).slice(0, 160),
    })
  }

  const lastPage = lastPageOf(page.total, page.pageSize)
  const href = (overrides: Partial<SearchParams>) => buildHref(params, overrides)

  // Under a narrowing filter the product chips carry the count that filter
  // produces, and a product with nothing left in it drops out of the list
  // rather than sitting there advertising a click that leads nowhere. The
  // currently selected product stays visible either way, so there is always a
  // way to read and clear it.
  const productOptions = (counts
    ? products
        .map((p) => ({ ...p, review_count: counts.byProduct.get(p.product_id) ?? 0 }))
        .filter((p) => p.review_count > 0 || p.product_id === params.product)
        .sort((a, b) => (b.review_count ?? 0) - (a.review_count ?? 0))
    : products
  ).map((p) => ({
    id: p.product_id,
    title: p.product_title,
    count: p.review_count ?? 0,
    href: href({ product: p.product_id, page: undefined }),
  }))

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Reviews</p>
        <h1>What buyers actually said</h1>
        <p className="lede">
          Every review each storefront publishes — star, text, author, the brand&apos;s
          reply, and the demographics the review platform attaches. Three brands run
          three different review apps (Bazaarvoice, Okendo, Judge.me); they are
          reconciled here so a complaint can be compared with a complaint.
        </p>
      </div>

      <form className="review-search" method="get">
        {/* Filters other than the query are carried through the search box so
            typing a term does not silently drop the brand you had selected. */}
        {passthrough(params, ['q', 'page'])}
        <input
          type="search"
          name="q"
          defaultValue={query.q ?? ''}
          placeholder="Search reviews — a word, a phrase, a reviewer, a fault…"
          aria-label="Search reviews"
        />
        <button className="btn" type="submit">
          Search
        </button>
        {params.q && (
          <Link className="btn" href={href({ q: undefined, page: undefined })}>
            Clear
          </Link>
        )}
      </form>

      <section className="review-summary">
        <div className="stats">
          <Stat label="Matching reviews" value={facets.total.toLocaleString()} />
          <Stat
            label="Average rating"
            value={facets.averageRating === null ? '—' : facets.averageRating.toFixed(2)}
            note={
              facets.averageRating === null ? undefined : (
                <Stars rating={facets.averageRating} />
              )
            }
          />
          <Stat label="With written text" value={facets.withText.toLocaleString()} />
          <Stat label="Answered by brand" value={facets.withResponse.toLocaleString()} />
          <Stat label="Verified buyers" value={facets.verified.toLocaleString()} />
        </div>

        <div className="card">
          <RatingHistogram
            distribution={facets.distribution}
            activeRating={query.rating}
            onHrefFor={(star) =>
              href({
                rating: String(query.rating === star ? '' : star) || undefined,
                sentiment: undefined,
                page: undefined,
              })
            }
          />
        </div>
      </section>

      <div className="filters">
        <FilterGroup label="Sentiment">
          <Chip
            href={href({ sentiment: undefined, rating: undefined, page: undefined })}
            active={!params.sentiment && !query.rating}
          >
            All
          </Chip>
          <Chip
            href={href({ sentiment: 'positive', rating: undefined, page: undefined })}
            active={params.sentiment === 'positive'}
          >
            Positive (4–5)
          </Chip>
          <Chip
            href={href({ sentiment: 'negative', rating: undefined, page: undefined })}
            active={params.sentiment === 'negative'}
          >
            Complaints (1–3)
          </Chip>
          {/* Picking a bar in the histogram is a filter like any other, but it
              lives in a different control, so this row used to show nothing
              selected while one star was in force — three chips, none active,
              and no visible way to clear it. */}
          {query.rating !== undefined && (
            <Chip href={href({ rating: undefined, page: undefined })} active>
              {query.rating} star only ✕
            </Chip>
          )}
        </FilterGroup>

        <FilterGroup label="Only">
          <Chip href={href({ text: params.text ? undefined : '1', page: undefined })} active={params.text === '1'}>
            With text
          </Chip>
          <Chip
            href={href({ verified: params.verified ? undefined : '1', page: undefined })}
            active={params.verified === '1'}
          >
            Verified
          </Chip>
          <Chip
            href={href({ replied: params.replied ? undefined : '1', page: undefined })}
            active={params.replied === '1'}
          >
            Brand replied
          </Chip>
        </FilterGroup>

        <FilterGroup label="Sort">
          {REVIEW_SORTS.map((s) => (
            <Chip
              key={s.value}
              href={href({ sort: s.value, page: undefined })}
              active={(params.sort ?? 'newest') === s.value}
            >
              {s.label}
            </Chip>
          ))}
        </FilterGroup>
      </div>

      {productOptions.length > 0 && (
        <ProductFilter
          products={productOptions}
          allHref={href({ product: undefined, page: undefined })}
          scoped={counts !== null}
          {...(params.product ? { activeId: params.product } : {})}
        />
      )}

      {params.model && (
        <p className="notice">
          Filtered to one model.{' '}
          <Link href={buildHref(params, { model: undefined, page: undefined })}>
            Show all models
          </Link>
        </p>
      )}

      {failure !== 'none' && (
        <div className="notice" data-tone="danger">
          {failure === 'rejected' ? (
            <>
              <strong>That search term was rejected.</strong> The firewall in front of the
              database blocks a few punctuation patterns before the query runs. Try the words
              without the punctuation, or{' '}
              <Link href={href({ q: undefined, page: undefined })}>clear the search</Link>.
            </>
          ) : (
            <>
              <strong>Reviews could not be loaded just now.</strong> The database did not answer
              in time — this is usually brief. Reload the page to try again.
            </>
          )}
        </div>
      )}

      <p className="muted review-count-line">
        {page.total === 0
          ? 'No reviews match those filters.'
          : `Showing ${((page.page - 1) * page.pageSize + 1).toLocaleString()}–${Math.min(
              page.page * page.pageSize,
              page.total,
            ).toLocaleString()} of ${page.total.toLocaleString()}`}
      </p>

      {page.rows.length === 0 ? (
        <div className="empty">
          Nothing here yet. If the crawl has not run the reviews stage, try{' '}
          <span className="mono">npm run reviews</span>.
        </div>
      ) : (
        <div className="review-list">
          {page.rows.map((review) => (
            <ReviewCard
              key={review.review_id}
              review={review}
              responses={page.responses.get(review.review_id) ?? []}
              showProduct={!params.product}
            />
          ))}
        </div>
      )}

      {page.rows.length > 0 && (
        <Pager page={page.page} lastPage={lastPage} pageSize={page.pageSize} />
      )}
    </>
  )
}

/**
 * Why the read failed, because the two causes need different words.
 *
 * A term the WAF rejects is the user's to fix — drop the punctuation. A gateway
 * timeout is not, and telling someone their search term was rejected when the
 * database merely timed out sends them rewriting a query that was always fine.
 */
function classifyFailure(error: unknown): 'rejected' | 'unavailable' {
  const text = describeError(error)
  // 'rejected' only on positive evidence — the WAF answers with an HTML block
  // page or a 403 where JSON was expected. Everything else, including the empty
  // message supabase-js produces on a gateway timeout, is treated as the
  // database being briefly unavailable.
  //
  // The default matters. Telling someone their search term was rejected when
  // the database merely timed out sends them rewriting a query that was always
  // fine: `100` and `grip` both drew that message during testing, purely
  // because the instance was busy.
  const blocked = /<!DOCTYPE html|<html|forbidden|403|blocked|access denied/i.test(text)
  return blocked ? 'rejected' : 'unavailable'
}

/** supabase-js can throw an Error with an empty message, so look wider. */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  try {
    return JSON.stringify(error) || String(error)
  } catch {
    return String(error)
  }
}

/** Current filters plus overrides; an undefined override removes the key. */
function buildHref(current: SearchParams, overrides: Partial<SearchParams>): string {
  const next = new URLSearchParams()
  const merged: Record<string, string | undefined> = { ...current, ...overrides }
  for (const [key, value] of Object.entries(merged)) {
    if (value) next.set(key, value)
  }
  const qs = next.toString()
  return qs ? `/reviews?${qs}` : '/reviews'
}

/** Hidden inputs so a GET form submit preserves the filters it does not own. */
function passthrough(params: SearchParams, exclude: string[]) {
  return Object.entries(params)
    .filter(([key, value]) => value && !exclude.includes(key))
    .map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)
}

function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: React.ReactNode
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="filter-group">
      <span>{label}</span>
      {children}
    </div>
  )
}

function Chip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link className="pill" href={href} data-active={active}>
      {children}
    </Link>
  )
}
