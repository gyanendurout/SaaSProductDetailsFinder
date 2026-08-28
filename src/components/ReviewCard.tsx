import Link from 'next/link'
import { Badge } from './Badge'
import { Stars } from './Stars'
import type { ReviewRow, ReviewResponseRow } from '../lib/review-queries.js'

/**
 * One review and its reply chain.
 *
 * The reply is nested inside the card rather than listed separately: a brand
 * response only means anything next to what it is answering, and reading them
 * apart is how "we reply to everyone" survives contact with a wall of one-star
 * reviews that were never answered.
 */
export function ReviewCard({
  review,
  responses,
  showProduct = true,
}: {
  review: ReviewRow
  responses: ReviewResponseRow[]
  showProduct?: boolean
}) {
  const context = readContext(review.context_data)

  return (
    <article className="review" id={`r-${review.review_id}`}>
      <header className="review-head">
        <div className="review-rating">
          <Stars rating={review.rating} outOf={review.rating_range} />
          <span className="review-score num">
            {review.rating === null ? '—' : review.rating.toFixed(1)}
          </span>
        </div>

        <div className="review-meta">
          <span className="review-author">{review.author_name ?? 'Anonymous'}</span>
          {review.author_location && (
            <span className="faint"> · {review.author_location}</span>
          )}
          {review.submitted_at && (
            <>
              {' · '}
              <time dateTime={review.submitted_at} className="faint">
                {formatDate(review.submitted_at)}
              </time>
            </>
          )}
        </div>

        <div className="review-flags">
          {review.is_verified_buyer && <Badge tone="positive">verified</Badge>}
          {review.is_incentivized && <Badge tone="warning">incentivised</Badge>}
          {review.is_recommended === false && <Badge tone="danger">not recommended</Badge>}
          {review.is_ratings_only && <Badge tone="neutral">rating only</Badge>}
        </div>
      </header>

      {showProduct && (
        <p className="review-product">
          {review.model_id ? (
            <Link className="strong-link" href={`/models/${review.model_id}`}>
              {review.model_name ?? review.product_title}
            </Link>
          ) : (
            <span className="strong-link">{review.product_title}</span>
          )}
          <span className="brand-mark"> {review.brand}</span>
          {review.variant_label && <span className="faint"> · {review.variant_label}</span>}
        </p>
      )}

      {review.title && <h3 className="review-title">{review.title}</h3>}
      {review.body && <p className="review-body">{review.body}</p>}

      {(review.pros || review.cons) && (
        <dl className="review-proscons">
          {review.pros && (
            <div>
              <dt>Pros</dt>
              <dd>{review.pros}</dd>
            </div>
          )}
          {review.cons && (
            <div>
              <dt>Cons</dt>
              <dd>{review.cons}</dd>
            </div>
          )}
        </dl>
      )}

      {context.length > 0 && (
        <ul className="review-context">
          {context.map(([key, value]) => {
            const rendered = humaniseValue(value)
            if (rendered === null) return null
            return (
              <li key={key}>
                <span className="faint">{humanise(key)}</span> {rendered}
              </li>
            )
          })}
        </ul>
      )}

      {responses.length > 0 && (
        <div className="review-replies">
          {responses.map((response) => (
            <div className="review-reply" key={response.id}>
              <p className="review-reply-head">
                <strong>{response.department ?? response.author_name ?? 'Brand response'}</strong>
                {response.responded_at && (
                  <time dateTime={response.responded_at} className="faint">
                    {' '}
                    · {formatDate(response.responded_at)}
                  </time>
                )}
              </p>
              <p className="review-reply-body">{response.body}</p>
            </div>
          ))}
        </div>
      )}

      <footer className="review-foot faint">
        <span className="mono">{review.review_platform}</span>
        {review.helpful_count > 0 && <span> · {review.helpful_count} found helpful</span>}
        {review.photo_count > 0 && <span> · {review.photo_count} photo(s)</span>}
        {review.product_url && (
          <>
            {' · '}
            <a href={review.product_url} target="_blank" rel="noreferrer noopener">
              source
            </a>
          </>
        )}
        <span> · first seen {formatDate(review.first_seen_at)}</span>
      </footer>
    </article>
  )
}

/**
 * Bazaarvoice ships demographics as ContextDataValues (Age, Gender,
 * LengthOfOwnership). Keys prefixed with '_' are our own internal extras
 * (badges, secondary ratings) and are not shown as reader-facing facts.
 */
function readContext(data: Record<string, unknown> | null): Array<[string, unknown]> {
  if (!data) return []
  return Object.entries(data).filter(
    ([key, value]) => !key.startsWith('_') && value !== null && value !== '',
  )
}

function humanise(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

/**
 * Source vocabulary is machine-shaped: '55to64', '3months'.
 *
 * Values are not all scalars. Okendo's 'centered-range' attributes — Selkirk
 * asks "Right amount of power/pop" on a labelled slider — are stored by the
 * adapter as { value, scale: [minLabel, midLabel, maxLabel] }, because a signed
 * number means nothing without its poles. String(value) rendered every one of
 * those as the literal text "[object Object]": 45 on the first page alone.
 *
 * So the shapes the pipeline actually stores are handled, and an unrecognised
 * shape returns null and is dropped by the caller rather than printed as noise.
 */
function humaniseValue(value: unknown): string | null {
  if (value === null || value === undefined) return null

  if (Array.isArray(value)) {
    const parts = value.map(humaniseValue).filter((v): v is string => v !== null)
    return parts.length > 0 ? parts.join(', ') : null
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const scalar = humaniseValue(record['value'])
    const scale = Array.isArray(record['scale'])
      ? record['scale'].filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      : []

    if (scalar !== null && scale.length > 0) return scalar + ' · ' + scale.join(' → ')
    return scalar
  }

  const text = String(value)
    .replace(/(\d+)to(\d+)/, '$1–$2')
    .replace(/^(\d+)(months?|weeks?|years?|days?)$/, '$1 $2')

  return text.trim() === '' ? null : text
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
