'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

export interface ProductFilterOption {
  id: string
  title: string
  count: number
  href: string
}

interface ProductFilterProps {
  products: ProductFilterOption[]
  allHref: string
  activeId?: string
}

/**
 * The product picker, with a search box.
 *
 * Filtering happens in the browser rather than through the URL on purpose. The
 * list is bounded — one entry per product that actually has reviews stored —
 * so it is already in memory, and a round trip to narrow a visible list would
 * cost seconds to save a scroll. The chips themselves are still ordinary links,
 * so choosing a product is a real navigation that survives a reload and can be
 * shared, bookmarked and opened in a new tab.
 *
 * Matching is accent- and case-insensitive and matches on any word boundary, so
 * "boom" finds "LABS Project Boomstik®" and "pro v" finds "Graf Pro V".
 */
export function ProductFilter({ products, allHref, activeId }: ProductFilterProps) {
  const [term, setTerm] = useState('')

  const normalised = useMemo(
    () => products.map((p) => ({ ...p, haystack: normalise(p.title) })),
    [products],
  )

  const matches = useMemo(() => {
    const needle = normalise(term)
    if (!needle) return normalised
    return normalised.filter((p) => p.haystack.includes(needle))
  }, [normalised, term])

  return (
    <details className="review-products" open={Boolean(activeId)}>
      <summary>
        Filter by product ({products.length})
        {activeId && (
          <span className="faint">
            {' '}
            — showing {products.find((p) => p.id === activeId)?.title}
          </span>
        )}
      </summary>

      <div className="product-search">
        <label className="sr-only" htmlFor="product-search-input">
          Search products
        </label>
        <input
          id="product-search-input"
          type="search"
          value={term}
          placeholder="Search products — a model, a line, a number…"
          autoComplete="off"
          onChange={(event) => setTerm(event.target.value)}
        />
        {term && (
          <button type="button" className="product-search-clear" onClick={() => setTerm('')}>
            Clear
          </button>
        )}
      </div>

      <p className="product-search-count muted" aria-live="polite">
        {term
          ? `${matches.length} of ${products.length} products match “${term}”`
          : `${products.length} products with reviews`}
      </p>

      <div className="chips">
        <Link className="pill" href={allHref} data-active={!activeId}>
          All products
        </Link>
        {matches.map((p) => (
          <Link key={p.id} className="pill" href={p.href} data-active={activeId === p.id}>
            {p.title} <span className="brand-chip-count">{p.count.toLocaleString()}</span>
          </Link>
        ))}
      </div>

      {term && matches.length === 0 && (
        <p className="empty-inline muted">
          No product matches “{term}”. Only products with reviews stored against them are listed.
        </p>
      )}
    </details>
  )
}

/** Lower-cased and stripped of diacritics, so "Boomstik®" matches "boomstik". */
function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
