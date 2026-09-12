/**
 * This route reads every review in order to count them — measured at roughly
 * 4.6s cold, and near-instant while the load is still cached. Without a
 * boundary the App Router would hold the previous page for that whole time and
 * clicking "Review analysis" would look like it did nothing, which is the exact
 * failure the reviews route already had.
 *
 * The skeleton mirrors the real layout — filters, four stats, brand boards,
 * two breakdown tables — so the numbers land into a frame that is already
 * drawn rather than shoving the page around as each section arrives.
 */
export default function LoadingReviewAnalysis() {
  return (
    <section className="reviews-loading" aria-busy="true" aria-live="polite">
      <p className="eyebrow">Review analysis</p>
      <h1>Which paddle people actually talk about</h1>
      <p className="sr-only">Counting reviews…</p>

      <div className="skeleton skeleton-filters" />
      <div className="skeleton skeleton-filters skeleton-filters-short" />

      <div className="review-summary">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="skeleton-stat" key={i}>
            <div className="skeleton skeleton-line skeleton-label" />
            <div className="skeleton skeleton-line skeleton-value" />
          </div>
        ))}
      </div>

      <div className="board-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <article className="card skeleton-board" key={i}>
            <div className="skeleton skeleton-line skeleton-head" />
            {Array.from({ length: 5 }, (_, row) => (
              <div className="skeleton skeleton-line" key={row} />
            ))}
          </article>
        ))}
      </div>
    </section>
  )
}
