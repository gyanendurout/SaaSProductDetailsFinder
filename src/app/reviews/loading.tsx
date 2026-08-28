/**
 * The reviews page issues four queries against a remote Postgres and has been
 * observed rendering anywhere from 338ms to 18s. Without a loading boundary the
 * App Router holds the previous page until that whole payload lands, so clicking
 * "Reviews" in the nav looked like it did nothing at all — the URL did not even
 * change for thirteen seconds.
 *
 * This boundary is the fix for that: the route swaps immediately and the shape
 * of the page appears while the data is still in flight. The skeleton mirrors
 * the real layout — search bar, five stats, histogram, filter rows, list — so
 * the content lands into the frame it already drew rather than shoving it down.
 */
export default function LoadingReviews() {
  return (
    <section className="reviews-loading" aria-busy="true" aria-live="polite">
      <p className="eyebrow">Reviews</p>
      <h1>What buyers actually said</h1>
      <p className="sr-only">Loading reviews…</p>

      <div className="skeleton skeleton-search" />

      <div className="review-summary">
        {Array.from({ length: 5 }, (_, i) => (
          <div className="skeleton-stat" key={i}>
            <div className="skeleton skeleton-line skeleton-label" />
            <div className="skeleton skeleton-line skeleton-value" />
          </div>
        ))}
      </div>

      <div className="skeleton skeleton-filters" />
      <div className="skeleton skeleton-filters skeleton-filters-short" />

      <div className="review-list">
        {Array.from({ length: 6 }, (_, i) => (
          <article className="review skeleton-review" key={i}>
            <div className="skeleton skeleton-line skeleton-head" />
            <div className="skeleton skeleton-line skeleton-title" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line skeleton-short" />
          </article>
        ))}
      </div>
    </section>
  )
}
