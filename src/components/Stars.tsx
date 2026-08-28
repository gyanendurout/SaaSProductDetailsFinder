/**
 * A star rating, drawn as one SVG with a clip rather than five glyphs.
 *
 * Font stars ('★') render at wildly different widths and baselines across
 * platforms and would break the alignment of a dense list. Partial fills also
 * matter here: Okendo can emit half stars, and rounding an average of 4.4 to
 * four full stars misstates it in the one place a reader looks first.
 */
export function Stars({
  rating,
  outOf = 5,
  size = 14,
}: {
  rating: number | null
  outOf?: number
  size?: number
}) {
  if (rating === null) {
    return (
      <span className="stars" data-empty="true" aria-label="no rating">
        —
      </span>
    )
  }

  const clamped = Math.max(0, Math.min(outOf, rating))
  const pct = (clamped / outOf) * 100

  return (
    <span
      className="stars"
      role="img"
      aria-label={`${clamped} out of ${outOf} stars`}
      style={{ ['--star-size' as string]: `${size}px`, ['--star-fill' as string]: `${pct}%` }}
    >
      <span className="stars-track" aria-hidden="true">
        {Array.from({ length: outOf }, (_, i) => (
          <Star key={i} size={size} />
        ))}
      </span>
      <span className="stars-fill" aria-hidden="true">
        {Array.from({ length: outOf }, (_, i) => (
          <Star key={i} size={size} />
        ))}
      </span>
    </span>
  )
}

function Star({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 1.6l2.47 5.3 5.53.72-4.07 3.9 1.05 5.68L10 14.5l-4.98 2.7 1.05-5.68L2 7.62l5.53-.72z" />
    </svg>
  )
}

/** The 5→1 histogram. Each bar links to that star's filter. */
export function RatingHistogram({
  distribution,
  onHrefFor,
  activeRating,
}: {
  distribution: number[]
  onHrefFor: (rating: number) => string
  activeRating?: number
}) {
  const max = Math.max(1, ...distribution)
  const total = distribution.reduce((n, c) => n + c, 0)

  return (
    <div className="histogram">
      {[5, 4, 3, 2, 1].map((star) => {
        const count = distribution[star - 1] ?? 0
        const share = total > 0 ? (count / total) * 100 : 0
        return (
          <a
            key={star}
            className="histogram-row"
            href={onHrefFor(star)}
            data-active={activeRating === star}
            title={`${count} ${star}-star review${count === 1 ? '' : 's'} (${share.toFixed(1)}%)`}
          >
            <span className="histogram-label">{star}★</span>
            <span className="histogram-track">
              <span
                className="histogram-bar"
                data-star={star}
                style={{ width: `${(count / max) * 100}%` }}
              />
            </span>
            <span className="histogram-count num">{count.toLocaleString()}</span>
          </a>
        )
      })}
    </div>
  )
}
