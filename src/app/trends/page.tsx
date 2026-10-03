import Link from 'next/link'
import type { Metadata } from 'next'
import { getBrandTimelines, type BrandTimeline } from '../../lib/brand-timeline-queries.js'
import {
  diff,
  elapsedDays,
  perWeek,
  type BrandObservation,
} from '../../lib/brand-timeline.js'
import { InfoTip, Eg } from '../review-analysis/panels'
import { When } from '../../components/When'
import { fmtMoney } from '../../lib/format.js'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Trends',
  description:
    'How each brand has moved between crawls — range, pricing, promotion, availability and reception, observation by observation.',
}

/**
 * Brand movement between crawls.
 *
 * Every other page answers "what is true now". This one answers "what changed",
 * and it is built around one awkward fact: crawls here are ad-hoc. Nothing
 * schedules them, so there is no such thing as a month-over-month figure. Every
 * comparison below is between two OBSERVATIONS and states the real number of
 * days between them, because a 15-day gap and a 90-day gap are not the same
 * question and labelling either one "monthly" would be an invention.
 */
export default async function TrendsPage() {
  const timelines = await getBrandTimelines()

  if (timelines.length === 0) {
    return (
      <>
        <Head />
        <div className="empty">
          Nothing observed yet. Trends need at least one completed crawl; two before
          anything can be compared.
        </div>
      </>
    )
  }

  const newest = timelines
    .flatMap((t) => t.observations.map((o) => o.end))
    .sort()
    .pop()
  const staleDays = newest ? elapsedDays(newest, new Date().toISOString()) : 0
  const withoutPrior = timelines.filter((t) => t.change === null)

  return (
    <>
      <Head />

      {staleDays > 7 && (
        <div className="notice" data-tone="warning">
          <strong>The newest observation is {staleDays} days old.</strong> Crawls run on
          demand, so nothing here has moved since the last one — these are not live
          figures. Run a crawl from <Link href="/pipeline">Pipeline</Link> to add an
          observation.
        </div>
      )}

      {withoutPrior.length > 0 && (
        <div className="notice">
          <strong>
            {withoutPrior.map((t) => t.brand).join(', ')}{' '}
            {withoutPrior.length === 1 ? 'has' : 'have'} only one observation.
          </strong>{' '}
          {withoutPrior.length === 1 ? 'It was' : 'They were'} added to the crawl after the
          earlier run, so there is nothing to compare against yet — shown as{' '}
          <span className="mono">—</span> rather than as no change.
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <h2>
            Latest observation against the one before
            <InfoTip label="latest against previous">
              Each brand&apos;s most recent crawl compared with the crawl before it. The gap
              column is the real number of days between the two — it is not fixed, because
              crawls are triggered by hand rather than scheduled.
              <Eg>
                <strong>Selkirk · 15d · 186 SKUs (−14) · $100 (—) · 51% on sale (+4pt)</strong>{' '}
                means that over the 15 days between the last two crawls Selkirk dropped 14
                SKUs from the range, its median price did not move, and the share of its
                range on sale rose by four percentage points.
              </Eg>
            </InfoTip>
          </h2>
        </div>
        <div className="table-wrap" role="region" aria-label="Latest observation against the one before">
          <table>
            <thead>
              <tr>
                <th scope="col">Brand</th>
                <th scope="col" className="num">Gap</th>
                <th scope="col" className="num">SKUs</th>
                <th scope="col" className="num">Median</th>
                <th scope="col" className="num">On sale</th>
                <th scope="col" className="num">Out of stock</th>
                <th scope="col" className="num">Reviews held</th>
                <th scope="col" className="num">Written/wk</th>
                <th scope="col" className="num">Avg rating</th>
              </tr>
            </thead>
            <tbody>
              {timelines.map((t) => (
                <ScorecardRow key={t.brandSlug} timeline={t} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="analysis-note">
          <strong>Written/wk</strong> counts reviews whose own submitted date falls inside
          the gap, divided by the gap — so it is comparable between a 15-day gap and a
          90-day one. It is deliberately not the number of reviews collected: a crawl that
          reaches deeper than the last one picks up reviews written years ago, and Selkirk
          collected 4,763 of those in a window where buyers wrote 108.
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>
            What came and went
            <InfoTip label="assortment churn">
              SKUs priced in the latest observation that were absent from the previous one,
              and the reverse. This is the clearest signal of a brand launching or quietly
              retiring a paddle.
              <Eg>
                <strong>Selkirk: 2 added, 16 dropped</strong> means sixteen SKUs that were
                on sale at the previous crawl were no longer listed at the latest one —
                end-of-line colourways, usually.
              </Eg>
            </InfoTip>
          </h2>
        </div>
        {timelines.every((t) => !t.change || (t.change.added.length === 0 && t.change.removed.length === 0)) ? (
          <div className="empty">No SKU came or went between the last two observations.</div>
        ) : (
          <div className="churn-grid">
            {timelines.map((t) =>
              t.change && (t.change.added.length > 0 || t.change.removed.length > 0) ? (
                <ChurnCard key={t.brandSlug} timeline={t} />
              ) : null,
            )}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>
            Every observation
            <InfoTip label="every observation">
              The full history held for each brand, oldest first. One row is one visit to
              the storefront. Runs within three days of each other are folded into a single
              observation, because prices and reviews are often collected on consecutive
              days and splitting them would show movement that never happened.
              <Eg>
                <strong>27 Aug 2026 · 200 SKUs · $100 · 1,525 reviews</strong> is what
                Selkirk looked like at that visit — not on that date in general, but at the
                moment we looked.
              </Eg>
            </InfoTip>
          </h2>
        </div>
        {timelines.map((t) => (
          <HistoryCard key={t.brandSlug} timeline={t} />
        ))}
      </section>
    </>
  )
}

function Head() {
  return (
    <div className="page-head">
      <p className="eyebrow">Trends</p>
      <h1>How each brand is moving</h1>
      <p className="lede">
        Every crawl stores a full snapshot of price, stock and reception. This page reads
        those snapshots as a series rather than as a current state, so a brand&apos;s range,
        discounting and reviews can be compared with where they were at the previous visit.
        Crawls are run on demand, so each comparison states the real gap it covers.
      </p>
    </div>
  )
}

function ScorecardRow({ timeline }: { timeline: BrandTimeline }) {
  const { change } = timeline
  const current = timeline.observations[timeline.observations.length - 1]!

  if (!change) {
    const m = current.metrics
    return (
      <tr data-active={false}>
        <th scope="row">{timeline.brand}</th>
        <td className="num faint" title="Only one observation held">—</td>
        <td className="num">{m.skus.toLocaleString()}</td>
        <td className="num">{m.priceMedian === null ? '—' : fmtMoney(m.priceMedian, 'USD', 0)}</td>
        <td className="num">{share(m.onSaleShare)}</td>
        <td className="num">{share(m.outOfStockShare)}</td>
        <td className="num">{m.reviewsHeld.toLocaleString()}</td>
        <td className="num faint">—</td>
        <td className="num">{m.averageRating?.toFixed(2) ?? '—'}</td>
      </tr>
    )
  }

  const before = change.previous.metrics
  const after = change.current.metrics
  const written = perWeek(after.writtenInWindow, change.elapsedDays)

  return (
    <tr>
      <th scope="row">{timeline.brand}</th>
      <td className="num faint">{change.elapsedDays}d</td>
      <Cell value={after.skus.toLocaleString()} delta={diff(before.skus, after.skus)} />
      <Cell
        value={after.priceMedian === null ? '—' : fmtMoney(after.priceMedian, 'USD', 0)}
        delta={diff(before.priceMedian, after.priceMedian)}
        format={(d) => `${d > 0 ? '+' : '−'}${fmtMoney(Math.abs(d), 'USD', 0)}`}
        // A price rise is not good news for a buyer, and this dashboard reads
        // from the buyer's side, so the tone is inverted against the arithmetic.
        invert
      />
      <Cell
        value={share(after.onSaleShare)}
        delta={points(before.onSaleShare, after.onSaleShare)}
        format={pt}
      />
      <Cell
        value={share(after.outOfStockShare)}
        delta={points(before.outOfStockShare, after.outOfStockShare)}
        format={pt}
        invert
      />
      <Cell
        value={after.reviewsHeld.toLocaleString()}
        delta={diff(before.reviewsHeld, after.reviewsHeld)}
      />
      <td className="num">{written === null ? '—' : written.toFixed(1)}</td>
      <Cell
        value={after.averageRating?.toFixed(2) ?? '—'}
        delta={diff(before.averageRating, after.averageRating)}
        format={(d) => `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`}
        epsilon={0.005}
      />
    </tr>
  )
}

/**
 * A figure with its movement underneath.
 *
 * A null delta renders nothing rather than "0". The two mean different things:
 * one is "we have no earlier figure", the other is "it did not move", and the
 * brands in the first state are exactly the ones a reader is most likely to
 * misjudge.
 *
 * `epsilon` is half the smallest unit the cell displays. Without it CRBN's
 * average rating moved by about four thousandths of a star and rendered as
 * "−0.00" in the colour of a decline — a movement the cell could not show,
 * claimed anyway. Anything that would print as zero is not printed.
 */
function Cell({
  value,
  delta,
  format = (d: number) => `${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString()}`,
  invert = false,
  epsilon = 0.5,
}: {
  value: string
  delta: number | null
  format?: (d: number) => string
  invert?: boolean
  epsilon?: number
}) {
  const moved = delta !== null && Math.abs(delta) >= epsilon
  const tone = !moved ? undefined : (delta as number) > 0 !== invert ? 'positive' : 'warning'
  return (
    <td className="num">
      {value}
      {moved && (
        <span className="trend-delta" data-tone={tone}>
          {format(delta as number)}
        </span>
      )}
    </td>
  )
}

function ChurnCard({ timeline }: { timeline: BrandTimeline }) {
  const change = timeline.change!
  const name = (id: string) => timeline.labels.get(id) ?? id
  return (
    <div className="card churn-card">
      <h3>
        {timeline.brand}{' '}
        <span className="faint">over {change.elapsedDays} days</span>
      </h3>
      <ChurnList label="Added" ids={change.added} name={name} tone="positive" />
      <ChurnList label="Dropped" ids={change.removed} name={name} tone="warning" />
    </div>
  )
}

const CHURN_SHOWN = 8

function ChurnList({
  label,
  ids,
  name,
  tone,
}: {
  label: string
  ids: string[]
  name: (id: string) => string
  tone: 'positive' | 'warning'
}) {
  if (ids.length === 0) return null
  const shown = ids.slice(0, CHURN_SHOWN).map(name).sort()
  return (
    <div className="churn-list">
      <p className="churn-label" data-tone={tone}>
        {label} · {ids.length}
      </p>
      <ul>
        {shown.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {ids.length > CHURN_SHOWN && (
        <p className="faint">and {ids.length - CHURN_SHOWN} more</p>
      )}
    </div>
  )
}

function HistoryCard({ timeline }: { timeline: BrandTimeline }) {
  return (
    <div className="card">
      <h3>{timeline.brand}</h3>
      <div className="table-wrap" role="region" aria-label={`${timeline.brand} observations`}>
        <table>
          <thead>
            <tr>
              <th scope="col">Observed</th>
              <th scope="col">Collected</th>
              <th scope="col" className="num">SKUs</th>
              <th scope="col" className="num">Low</th>
              <th scope="col" className="num">Median</th>
              <th scope="col" className="num">High</th>
              <th scope="col" className="num">On sale</th>
              <th scope="col" className="num">Out of stock</th>
              <th scope="col" className="num">Reviews held</th>
              <th scope="col" className="num">Avg</th>
              <th scope="col" className="num">1–2★</th>
            </tr>
          </thead>
          <tbody>
            {timeline.observations.map((o) => (
              <ObservationRow key={o.start} observation={o} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ObservationRow({ observation: o }: { observation: BrandObservation }) {
  const m = o.metrics
  // Which halves of this observation were actually refreshed. A catalogue-only
  // crawl leaves the review figures inherited from the previous visit, and a
  // reader comparing rows needs to know that rather than read it as "unchanged".
  const collected = [o.hasPrices ? 'prices' : null, o.hasReviews ? 'reviews' : null]
    .filter(Boolean)
    .join(' + ')
  return (
    <tr>
      <th scope="row">
        <When iso={o.end} />
      </th>
      <td className="muted mono">{collected || '—'}</td>
      <td className="num">{m.skus ? m.skus.toLocaleString() : <span className="faint">—</span>}</td>
      <td className="num faint">{m.priceLow === null ? '—' : fmtMoney(m.priceLow, 'USD', 0)}</td>
      <td className="num">{m.priceMedian === null ? '—' : fmtMoney(m.priceMedian, 'USD', 0)}</td>
      <td className="num faint">{m.priceHigh === null ? '—' : fmtMoney(m.priceHigh, 'USD', 0)}</td>
      <td className="num">{share(m.onSaleShare)}</td>
      <td className="num">{share(m.outOfStockShare)}</td>
      <td className="num">{m.reviewsHeld.toLocaleString()}</td>
      <td className="num">{m.averageRating?.toFixed(2) ?? '—'}</td>
      <td className="num">{share(m.lowStarShare)}</td>
    </tr>
  )
}

function share(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

/** Percentage-point move, which is what a share difference actually is. */
function points(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null
  return Math.round(after * 100) - Math.round(before * 100)
}

function pt(d: number): string {
  return `${d > 0 ? '+' : '−'}${Math.abs(d)}pt`
}
