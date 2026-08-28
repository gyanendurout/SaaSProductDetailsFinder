'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

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

  // Model detail is scoped to one model already; a brand filter there is
  // meaningless, so the switcher points back at the catalogue.
  const basePath = pathname.startsWith('/models') ? '/catalogue' : pathname

  // The number beside a brand has to be the number you get when you click it.
  // On reviews that is reviews; everywhere else it is SKUs. Showing one source
  // on every page is how the chips came to advertise 13,520 and return 6,161.
  const onReviews = pathname.startsWith('/reviews')
  const countOf = (b: BrandScopeOption) => (onReviews ? b.reviews : b.skus)

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
    <nav className="brand-scope" aria-label="Brand">
      <p className="rail-label">Brand</p>
      <Link className="rail-item rail-scope" href={href(undefined)} data-active={!active}>
        <span className="rail-item-name">All brands</span>
      </Link>
      {brands.map((b) => {
        const count = countOf(b)
        return (
          <Link
            key={b.slug}
            className="rail-item rail-scope"
            href={href(b.slug)}
            data-active={active === b.slug}
          >
            <span className="rail-item-name">{b.name}</span>
            {typeof count === 'number' && <span className="rail-count">{count.toLocaleString()}</span>}
          </Link>
        )
      })}
    </nav>
  )
}
