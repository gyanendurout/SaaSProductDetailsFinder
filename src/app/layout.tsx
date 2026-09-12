import { Suspense } from 'react'
import type { Metadata } from 'next'
import './globals.css'
import './reviews.css'
import './prices.css'
import { Nav } from '../components/Nav'
import { TableScroll } from '../components/TableScroll'
import { BrandSwitcher, type BrandScopeOption } from '../components/BrandSwitcher'
import { getBrandSummaries } from '../lib/queries.js'
import { getReviewBrandCounts } from '../lib/review-queries.js'

/**
 * The default, and the template every page's own title is poured into.
 *
 * Every page used to share this one title exactly, so eight open tabs read
 * "Product Finder" eight times, browser history was unnavigable and a shared
 * link previewed as the site rather than the page. Pages now export their own
 * `metadata`; `%s` is where it lands.
 */
export const metadata: Metadata = {
  title: {
    default: 'Product Finder',
    template: '%s · Product Finder',
  },
  description:
    'Catalogue, assortment and price intelligence across tracked paddle brands.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The rail is part of the shell so brand scope and page are always visible
  // together. If the database is unreachable the rail's brand list is simply
  // omitted rather than taking the whole site down with it.
  const [summaries, reviewCounts] = await Promise.all([
    getBrandSummaries().catch(() => []),
    getReviewBrandCounts().catch(() => []),
  ])

  // Both counts travel with the brand so the rail can show whichever one the
  // current page actually filters by. Deciding that here rather than in the
  // client keeps a second round trip off every navigation.
  const reviewsBySlug = new Map(reviewCounts.map((c) => [c.brand_slug, c.count]))
  const brands: BrandScopeOption[] = summaries.map((b) => {
    const reviews = reviewsBySlug.get(b.slug)
    return {
      slug: b.slug,
      name: b.name,
      skus: b.skus,
      ...(typeof reviews === 'number' ? { reviews } : {}),
    }
  })

  return (
    // suppressHydrationWarning is scoped to this one element: browser
    // extensions (Google Tag Assistant writes data-tag-assistant-prod-present,
    // password managers and translators write their own) mutate <html> before
    // React hydrates, and the resulting attribute mismatch is not ours to fix.
    // React only suppresses one level deep, so real mismatches anywhere inside
    // the tree still surface normally.
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* First thing in the tab order: the rail and an eight-item nav sit
            before the content, so reaching the page itself took a dozen tabs on
            every navigation. Visible only while focused. */}
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {/* Renders nothing. Marks wide tables as focusable regions, but only
            the ones that actually overflow — see the component. */}
        <TableScroll />
        <div className="shell">
          <header className="masthead">
            <div className="masthead-inner">
              <div className="wordmark">
                Product<em>Finder</em>
              </div>
            </div>
          </header>

          <div className="shell-body">
            <aside className="rail" aria-label="Scope and views">
              {/* The aside stretches to the content's height so its surface and
                  border run the whole page; this inner column is what sticks. */}
              <div className="rail-inner">
                {brands.length > 0 && (
                  <Suspense fallback={null}>
                    <BrandSwitcher brands={brands} />
                  </Suspense>
                )}
                <Suspense fallback={null}>
                  <Nav />
                </Suspense>
              </div>
            </aside>

            <div className="shell-content">
              <main id="main" tabIndex={-1}>
                {children}
              </main>

              <footer className="foot">
                Data collected from public storefront endpoints. Prices shown in each
                store&rsquo;s native currency, never converted. Charts step between
                observations — a flat line means we did not observe a change, not that
                nothing happened.
              </footer>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
