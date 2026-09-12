import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Page not found',
}

/**
 * The 404.
 *
 * Without this file Next serves its own built-in page, which carries none of the
 * shell's stylesheet — white background, Times New Roman, "404 This page could
 * not be found". Reaching it from a styled dashboard reads as the site having
 * broken rather than the address being wrong, and it offers no way back.
 *
 * It renders inside the root layout, so the rail and the brand switcher are
 * still there: on a dashboard the fastest recovery is usually a different view,
 * not the front page.
 */
export default function NotFound() {
  return (
    <>
      <div className="page-head">
        <p className="eyebrow">404</p>
        <h1>No such page</h1>
        <p className="lede">
          That address does not match anything here. The likeliest causes are a model
          id that has since been re-crawled under a new id, or a link that was
          truncated on its way here.
        </p>
      </div>

      <div className="empty">
        <p style={{ marginTop: 0 }}>Try one of these instead:</p>
        <p style={{ marginBottom: 0 }}>
          <Link href="/">Overview</Link> · <Link href="/catalogue">Catalogue</Link> ·{' '}
          <Link href="/reviews">Reviews</Link> ·{' '}
          <Link href="/review-analysis">Review analysis</Link> ·{' '}
          <Link href="/prices">Prices</Link> · <Link href="/changes">Changes</Link>
        </p>
      </div>
    </>
  )
}
