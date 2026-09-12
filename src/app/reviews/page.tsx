import Link from 'next/link'
import { ReviewCard } from '../../components/ReviewCard'
import { ProductFilter } from '../../components/ProductFilter'
import { Pager } from '../../components/Pager'
import { resolveBrand } from '../../lib/queries.js'
import { RatingHistogram, Stars } from '../../components/Stars'
import {
  getReviewFacets,
  getReviewedProducts,
  searchReviews,
  type ReviewQuery,
  type ReviewSort,
} from '../../lib/review-queries.js'
import { clampPageSize, lastPageOf } from '../../lib/pagination.js'

export const dynamic = 'force-dynamic'

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

const SORTS: Array<{ value: ReviewSort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'rating_desc', label: 'Highest rated' },
  { value: 'rating_asc', label: 'Lowest rated' },
  { value: 'helpful', label: 'Most helpful' },
]

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  // ?brand= is canonically a slug, but links shared before that change carry
  // the display name; resolving here keeps them working.
  const scope = await resolveBrand(params.brand)
  const query = toQuery(params, scope?.slug)

  // Facets and brand chips do not depend on the page, so they are issued
  // alongside the page query rather than after it.
  const [page, facets, products] = await Promise.all([
    searchReviews(query),
    getReviewFacets(query),
    getReviewedProducts(query.brand),
  ])

  const lastPage = lastPageOf(page.total, page.pageSize)
  const href = (overrides: Partial<SearchParams>) => buildHref(params, overrides)

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
          defaultValue={params.q ?? ''}
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
            active={!params.sentiment && !params.rating}
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
          {SORTS.map((s) => (
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

      {products.length > 0 && (
        <ProductFilter
          products={products.map((p) => ({
            id: p.product_id,
            title: p.product_title,
            count: p.review_count ?? 0,
            href: href({ product: p.product_id, page: undefined }),
          }))}
          allHref={href({ product: undefined, page: undefined })}
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

function toQuery(params: SearchParams, brandSlug?: string): ReviewQuery {
  const rating = Number(params.rating)
  return {
    q: params.q,
    brand: brandSlug,
    productId: params.product,
    modelId: params.model,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
    sentiment:
      params.sentiment === 'positive' || params.sentiment === 'negative'
        ? params.sentiment
        : undefined,
    verifiedOnly: params.verified === '1',
    withTextOnly: params.text === '1',
    withResponse: params.replied === '1',
    from: params.from,
    to: params.to,
    sort: (SORTS.find((s) => s.value === params.sort)?.value ?? 'newest') as ReviewSort,
    page: Math.max(1, Number(params.page) || 1),
    pageSize: clampPageSize(params.size),
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
