'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { hasNarrowingFilters, parseReviewFilter } from '../lib/review-facets.js'

export interface BrandScopeOption {
  slug: string
  name: string
  /** SKUs held for this brand — what Overview, Catalogue and Discounts count. */
  skus: number
  /** Reviews stored for this brand, when we have them. */
  reviews?: number
}

/**
 * Brand scope for the whole dashboard.
 *
 * Kept in the URL rather than in component state so a filtered view is
 * shareable — the point of this site is that someone can send a colleague a
 * link to exactly what they were looking at.
 *
 * The URL carries the brand SLUG. It used to carry the display name, which
 * looked harmless until the reviews page arrived: that page filters on
 * brand_slug, so picking a brand up here sent `?brand=Selkirk` into a query
 * matching `selkirk` and the page went empty. A slug is also stable across a
 * rename and needs no escaping, so it is the form every page now agrees on.
 */
export function BrandSwitcher({ brands }: { brands: BrandScopeOption[] }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const active = searchParams.get('brand')
  const scoped = useScopedReviewCounts(pathname, searchParams)

  // Model detail is scoped to one model already; a brand filter there is
  // meaningless, so the switcher points back at the catalogue.
  const basePath = pathname.startsWith('/models') ? '/catalogue' : pathname

  // The number beside a brand has to be the number you get when you click it.
  // On reviews that is reviews; everywhere else it is SKUs. Showing one source
  // on every page is how the chips came to advertise 13,520 and return 6,161.
  const onReviews = pathname.startsWith('/reviews')
  const countOf = (b: BrandScopeOption): number | undefined => {
    if (!onReviews) return b.skus
    if (scoped.counts) return scoped.counts[b.slug] ?? 0
    return b.reviews
  }

  const href = (slug?: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (slug) params.set('brand', slug)
    else params.delete('brand')
    // Changing brand invalidates brand-specific filters.
    params.delete('generation')
    params.delete('line')
    params.delete('product')
    params.delete('page')
    const qs = params.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  return (
    <nav className="brand-scope" aria-label="Brand" aria-busy={scoped.pending || undefined}>
      <p className="rail-label">Brand</p>
      <Link
        className="rail-item rail-scope"
        href={href(undefined)}
        data-active={!active}
        aria-current={!active ? 'true' : undefined}
      >
        <span className="rail-item-name">All brands</span>
      </Link>
      {brands.map((b) => {
        // While a narrowing filter is on, the stored total is not what clicking
        // this link returns, so an ellipsis stands in rather than a number that
        // is about to be replaced by a different one.
        const count = scoped.pending ? null : countOf(b)
        return (
          <Link
            key={b.slug}
            className="rail-item rail-scope"
            href={href(b.slug)}
            data-active={active === b.slug}
            // The rail scopes the page rather than navigating between pages, so
            // aria-current="true" rather than "page".
            aria-current={active === b.slug ? 'true' : undefined}
          >
            <span className="rail-item-name">{b.name}</span>
            {count === null ? (
              <span className="rail-count faint" aria-label="counting">
                &hellip;
              </span>
            ) : (
              typeof count === 'number' && (
                <span className="rail-count">{count.toLocaleString()}</span>
              )
            )}
          </Link>
        )
      })}
    </nav>
  )
}

interface ScopedCounts {
  /** Brand slug to matching reviews, or null when the stored totals still hold. */
  counts: Record<string, number> | null
  pending: boolean
}

/**
 * Per-brand review counts for the filters currently in the URL.
 *
 * The rail is rendered by the root layout, which the App Router never gives
 * search params to — it does not re-render when they change, so it cannot know
 * what is filtered. Reading the URL here and asking the server is the only way
 * the number beside a brand can mean "what you get when you click this".
 *
 * Nothing is fetched unless the page is /reviews AND something beyond brand and
 * product is filtered: in every other case the totals the layout already
 * rendered are exactly right, and a request would buy nothing.
 */
function useScopedReviewCounts(
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams>,
): ScopedCounts {
  const onReviews = pathname.startsWith('/reviews')
  const qs = searchParams.toString()
  const [state, setState] = useState<ScopedCounts>({ counts: null, pending: false })

  useEffect(() => {
    const params = Object.fromEntries(new URLSearchParams(qs))
    const narrowing = onReviews && hasNarrowingFilters(parseReviewFilter(params, undefined))
    if (!narrowing) {
      setState({ counts: null, pending: false })
      return
    }

    // Abort rather than race. Typing in the search box changes the URL on every
    // submit, and a slow earlier response landing after a fast later one would
    // leave the rail showing counts for a filter that is no longer applied.
    const abort = new AbortController()
    setState({ counts: null, pending: true })
    fetch(`/api/review-brand-counts?${qs}`, { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { scoped?: boolean; counts?: Record<string, number> } | null) => {
        if (abort.signal.aborted) return
        setState({
          counts: body?.scoped ? (body.counts ?? {}) : null,
          pending: false,
        })
      })
      .catch(() => {
        // An aborted fetch is the normal path when filters change quickly, and
        // a failed one falls back to the stored totals rather than to nothing.
        if (!abort.signal.aborted) setState({ counts: null, pending: false })
      })

    return () => abort.abort()
  }, [onReviews, qs])

  return state
}
