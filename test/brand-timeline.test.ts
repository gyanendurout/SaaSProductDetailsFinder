import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildObservations,
  clusterInstants,
  diff,
  elapsedDays,
  latestChange,
  median,
  perWeek,
  type PriceSnapshot,
  type ReviewRecord,
} from '../src/lib/brand-timeline.js'

/**
 * The shape of the real data these are written against:
 *
 *   prices  2026-08-27 and 2026-09-12
 *   reviews 2026-08-28 and 2026-09-12
 *
 * Three brands (Six Zero, Paddletek, GAMMA) joined the crawl after August, so
 * they hold one observation and no before at all.
 */

const price = (
  variantId: string,
  observedAt: string,
  over: Partial<PriceSnapshot> = {},
): PriceSnapshot => ({
  variantId,
  observedAt,
  price: 100,
  isOnSale: false,
  discountPct: null,
  isAvailable: true,
  ...over,
})

const review = (firstSeenAt: string, over: Partial<ReviewRecord> = {}): ReviewRecord => ({
  firstSeenAt,
  submittedAt: firstSeenAt,
  rating: 5,
  ...over,
})

/** Shorthand so each test names only the part it is about. */
const build = (input: Partial<Parameters<typeof buildObservations>[0]>) =>
  buildObservations({ prices: [], reviewRuns: [], reviews: [], ...input })

test('clustering: runs on the same day are one observation', () => {
  const clusters = clusterInstants(['2026-09-12T05:43:00Z', '2026-09-12T07:06:00Z'])
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0]!.start, '2026-09-12T05:43:00Z')
  assert.equal(clusters[0]!.end, '2026-09-12T07:06:00Z')
})

test('clustering: prices on the 27th and reviews on the 28th are ONE observation', () => {
  // The case that rules out grouping by calendar date. Two rows here would show
  // August as a month where price moved with no reviews, then reviews moved
  // with no price — movement the brand never made.
  const clusters = clusterInstants(['2026-08-27T08:52:00Z', '2026-08-28T05:13:00Z'])
  assert.equal(clusters.length, 1)
})

test('clustering: runs weeks apart are separate observations', () => {
  const clusters = clusterInstants([
    '2026-08-27T08:52:00Z',
    '2026-08-28T05:13:00Z',
    '2026-09-12T05:43:00Z',
  ])
  assert.equal(clusters.length, 2)
  assert.equal(clusters[0]!.start, '2026-08-27T08:52:00Z')
  assert.equal(clusters[1]!.start, '2026-09-12T05:43:00Z')
})

test('clustering: a steady drip cannot chain into one endless cluster', () => {
  // Anchored to the cluster's FIRST instant, not the previous one. Anchored to
  // the previous instant, crawls every two days would fold a whole month into a
  // single observation.
  const everyTwoDays = Array.from({ length: 10 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i * 2))
    return d.toISOString()
  })
  const clusters = clusterInstants(everyTwoDays)
  assert.ok(clusters.length >= 5, `expected several clusters, got ${clusters.length}`)
  for (const c of clusters) {
    assert.ok(elapsedDays(c.start, c.end) <= 3, 'a cluster grew wider than the tolerance')
  }
})

test('clustering: duplicate instants collapse', () => {
  assert.equal(clusterInstants(['2026-09-12T05:43:00Z', '2026-09-12T05:43:00Z']).length, 1)
})

test('clustering: nothing in, nothing out', () => {
  assert.deepEqual(clusterInstants([]), [])
})

test('observations: price and review runs a day apart land on one row', () => {
  const obs = build({
    prices: [price('v1', '2026-08-27T08:52:00Z')],
    reviewRuns: ['2026-08-28T05:13:00Z'],
    reviews: [review('2026-08-28T05:13:00Z')],
  })
  assert.equal(obs.length, 1)
  assert.equal(obs[0]!.hasPrices, true)
  assert.equal(obs[0]!.hasReviews, true)
  assert.equal(obs[0]!.metrics.skus, 1)
  assert.equal(obs[0]!.metrics.reviewsHeld, 1)
})

test('observations: a variant crawled twice in one visit is counted once', () => {
  // Several sites were crawled twice on 2026-09-12 — once for the catalogue and
  // once for reviews. Counting both rows would double the SKU count.
  const obs = build({
    prices: [
      price('v1', '2026-09-12T05:43:00Z', { price: 100 }),
      price('v1', '2026-09-12T07:06:00Z', { price: 120 }),
    ],
  })
  assert.equal(obs[0]!.metrics.skus, 1)
  // And it is the newer row that survives.
  assert.equal(obs[0]!.metrics.priceMedian, 120)
})

test('metrics: arrivals are withheld on a first observation, but the stock is not', () => {
  // new_review_count counts rows first seen in that run, so the first ever crawl
  // of a product marks its entire backlog as new. Reporting it would show a
  // brand receiving thousands of reviews in a week.
  const obs = build({
    reviewRuns: ['2026-08-28T00:00:00Z', '2026-09-12T00:00:00Z'],
    reviews: [
      ...Array.from({ length: 6288 }, () => review('2026-08-28T00:00:00Z')),
      ...Array.from({ length: 37 }, () => review('2026-09-12T00:00:00Z')),
    ],
  })
  assert.equal(obs[0]!.metrics.newCollected, null)
  assert.equal(obs[0]!.metrics.reviewsHeld, 6288, 'the backlog is still the stock')
  assert.equal(obs[1]!.metrics.newCollected, 37)
  assert.equal(obs[1]!.metrics.reviewsHeld, 6325, 'stock is cumulative')
})

test('metrics: the average is weighted by each product own review count', () => {
  // A paddle with four reviews must not move the brand as much as one with 2,500.
  const obs = build({
    reviewRuns: ['2026-09-12T00:00:00Z'],
    reviews: [
      ...Array.from({ length: 1000 }, () => review('2026-09-12T00:00:00Z', { rating: 5 })),
      ...Array.from({ length: 10 }, () => review('2026-09-12T00:00:00Z', { rating: 1 })),
    ],
  })
  const avg = obs[0]!.metrics.averageRating!
  assert.ok(avg > 4.9, `ten reviews must not outweigh a thousand, got ${avg}`)
})

test('metrics: a product with no average does not drag the mean towards zero', () => {
  const obs = build({
    reviewRuns: ['2026-09-12T00:00:00Z'],
    reviews: [
      review('2026-09-12T00:00:00Z', { rating: 4 }),
      review('2026-09-12T00:00:00Z', { rating: null }),
    ],
  })
  assert.equal(obs[0]!.metrics.averageRating, 4)
  assert.equal(obs[0]!.metrics.reviewsHeld, 2, 'an unrated review is still a review')
})

test('metrics: unknown stock is excluded rather than counted as in stock', () => {
  // A storefront that does not report availability is not reporting everything
  // available; treating null as in-stock would understate every outage.
  const obs = build({
    prices: [
      price('a', '2026-09-12T00:00:00Z', { isAvailable: false }),
      price('b', '2026-09-12T00:00:00Z', { isAvailable: null }),
    ],
  })
  assert.equal(obs[0]!.metrics.outOfStockShare, 1)
})

test('metrics: price band and median come from priced SKUs only', () => {
  const obs = build({
    prices: [
      price('a', '2026-09-12T00:00:00Z', { price: 100 }),
      price('b', '2026-09-12T00:00:00Z', { price: 300 }),
      price('c', '2026-09-12T00:00:00Z', { price: null }),
    ],
  })
  const m = obs[0]!.metrics
  assert.equal(m.skus, 2)
  assert.equal(m.priceLow, 100)
  assert.equal(m.priceHigh, 300)
})

test('metrics: an observation with no prices reports null rather than zero', () => {
  // Zero would read as "this brand sells nothing", which is a different claim
  // from "this crawl did not collect prices".
  const obs = build({
    reviewRuns: ['2026-09-12T00:00:00Z'],
    reviews: [review('2026-09-12T00:00:00Z')],
  })
  const m = obs[0]!.metrics
  assert.equal(m.priceMedian, null)
  assert.equal(m.onSaleShare, null)
  assert.equal(m.outOfStockShare, null)
  assert.equal(obs[0]!.hasPrices, false)
})

test('median: the lower middle is chosen so the result is a real price', () => {
  assert.equal(median([100, 200]), 100)
  assert.equal(median([100, 200, 300]), 200)
  assert.equal(median([]), null)
})

test('change: a brand with one observation has no change, not a zero change', () => {
  // Six Zero, Paddletek and GAMMA are in exactly this state.
  const obs = build({ prices: [price('v1', '2026-09-12T00:00:00Z')] })
  assert.equal(latestChange(obs), null)
})

test('change: elapsed days are measured between the two real observations', () => {
  const obs = build({
    prices: [price('v1', '2026-08-27T08:52:00Z'), price('v1', '2026-09-12T05:43:00Z')],
  })
  const change = latestChange(obs)!
  assert.equal(change.elapsedDays, 16)
})

test('change: assortment churn names what arrived and what went', () => {
  const obs = build({
    prices: [
      price('kept', '2026-08-27T00:00:00Z'),
      price('gone', '2026-08-27T00:00:00Z'),
      price('kept', '2026-09-12T00:00:00Z'),
      price('new', '2026-09-12T00:00:00Z'),
    ],
  })
  const change = latestChange(obs)!
  assert.deepEqual(change.added, ['new'])
  assert.deepEqual(change.removed, ['gone'])
})

test('rates: a count is normalised by the gap it accumulated over', () => {
  // 90 new reviews over 90 days is not the same brand as 90 over 9.
  assert.equal(perWeek(90, 90), 7)
  assert.equal(perWeek(90, 9), 70)
})

test('rates: a gap under a day yields no rate rather than a huge one', () => {
  assert.equal(perWeek(5, 0), null)
  assert.equal(perWeek(null, 30), null)
})

test('diff: an unknown on either side yields an unknown, not a zero', () => {
  assert.equal(diff(null, 5), null)
  assert.equal(diff(5, null), null)
  assert.equal(diff(5, 8), 3)
  assert.equal(diff(8, 5), -3)
})

test('elapsed: never negative, even if clocks disagree', () => {
  assert.equal(elapsedDays('2026-09-12T00:00:00Z', '2026-08-27T00:00:00Z'), 0)
})

test('metrics: collected and written are different questions', () => {
  // A deeper crawl collects reviews written long ago. Reporting that as arrivals
  // would show a brand suddenly receiving thousands of reviews; separating the
  // two is what keeps collection progress from reading as demand.
  const obs = build({
    reviewRuns: ['2026-08-28T00:00:00Z', '2026-09-12T00:00:00Z'],
    reviews: [
      review('2026-08-28T00:00:00Z', { submittedAt: '2026-08-01T00:00:00Z' }),
      // Collected in September, written years earlier: progress, not demand.
      review('2026-09-12T00:00:00Z', { submittedAt: '2024-03-01T00:00:00Z' }),
      // Collected and written in the window: a real arrival.
      review('2026-09-12T00:00:00Z', { submittedAt: '2026-09-05T00:00:00Z' }),
    ],
  })
  assert.equal(obs[1]!.metrics.newCollected, 2)
  assert.equal(obs[1]!.metrics.writtenInWindow, 1)
})

test('metrics: a review with no submitted date never counts as written in a window', () => {
  const obs = build({
    reviewRuns: ['2026-08-28T00:00:00Z', '2026-09-12T00:00:00Z'],
    reviews: [
      review('2026-08-28T00:00:00Z'),
      review('2026-09-12T00:00:00Z', { submittedAt: null }),
    ],
  })
  assert.equal(obs[1]!.metrics.newCollected, 1)
  assert.equal(obs[1]!.metrics.writtenInWindow, 0)
})

test('metrics: low-star share is over rated reviews, not all of them', () => {
  const obs = build({
    reviewRuns: ['2026-09-12T00:00:00Z'],
    reviews: [
      review('2026-09-12T00:00:00Z', { rating: 1 }),
      review('2026-09-12T00:00:00Z', { rating: 5 }),
      review('2026-09-12T00:00:00Z', { rating: null }),
    ],
  })
  assert.equal(obs[0]!.metrics.lowStarShare, 0.5)
})

test('observations: review figures carry forward when only prices were crawled', () => {
  // A catalogue-only crawl does not lose a brand its reviews; it means the
  // review figures are inherited, which hasReviews reports.
  const obs = build({
    prices: [price('v1', '2026-08-27T00:00:00Z'), price('v1', '2026-10-01T00:00:00Z')],
    reviewRuns: ['2026-08-27T00:00:00Z'],
    reviews: [review('2026-08-27T00:00:00Z')],
  })
  assert.equal(obs[1]!.metrics.reviewsHeld, 1)
  assert.equal(obs[1]!.hasReviews, false, 'no review crawl happened in this observation')
})
