'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/catalogue', label: 'Catalogue' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/discounts', label: 'Discounts' },
  { href: '/changes', label: 'Changes' },
  { href: '/pipeline', label: 'Pipeline' },
]

/**
 * Pages that read ?brand=. Carrying the scope across a page change is the whole
 * point of putting it in the shell — switching from Catalogue to Reviews while
 * looking at Selkirk should keep looking at Selkirk.
 *
 * Pipeline is the exception: it lists crawl runs, which are infrastructure
 * rather than catalogue, and it ignores the parameter. Sending a stale brand
 * there would leave the rail highlighting a scope the page does not honour.
 */
const BRAND_AWARE = new Set(['/', '/catalogue', '/reviews', '/discounts', '/changes'])

export function Nav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const brand = searchParams.get('brand')

  return (
    <nav className="rail-nav" aria-label="Views">
      <p className="rail-label">View</p>
      {LINKS.map((link) => {
        const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href)
        const href = brand && BRAND_AWARE.has(link.href) ? `${link.href}?brand=${brand}` : link.href
        return (
          <Link key={link.href} className="rail-item" href={href} data-active={active}>
            <span className="rail-item-name">{link.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
