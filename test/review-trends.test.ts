import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bucketStart,
  bucketize,
  growthRatio,
  recentSplit,
  trajectory,
  type DatedPoint,
} from '../src/lib/review-trends.js'

const at = (d: string, rating: number | null = 5): DatedPoint => ({
  submittedAt: `${d}T12:00:00Z`,
  rating,
})

test('bucket start: weeks begin on Monday', () => {
  // 2026-09-12 is a Saturday; its week starts Monday the 7th.
  assert.equal(bucketStart('2026-09-12T00:00:00Z', 'week'), '2026-09-07')
  assert.equal(bucketStart('2026-09-07T00:00:00Z', 'week'), '2026-09-07')
  // Sunday belongs to the week that began six days earlier, not the next one.
  assert.equal(bucketStart('2026-09-13T23:59:00Z', 'week'), '2026-09-07')
})

test('bucket start: months and quarters', () => {
  assert.equal(bucketStart('2026-09-12T00:00:00Z', 'month'), '2026-09-01')
  assert.equal(bucketStart('2026-09-12T00:00:00Z', 'quarter'), '2026-07-01')
  assert.equal(bucketStart('2026-01-31T00:00:00Z', 'quarter'), '2026-01-01')
})

test('bucket start: an unparseable date is refused, not silently bucketed', () => {
  assert.equal(bucketStart('not a date', 'month'), null)
})

test('bucketize: silent periods are emitted as zero, not skipped', () => {
  // The load-bearing case: joining only the months that have data draws a flat
  // line across a dead quarter and makes an abandoned model look healthy.
  const buckets = bucketize([at('2026-01-05'), at('2026-04-05')], 'month')
  assert.deepEqual(buckets.map((b) => b.start), [
    '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01',
  ])
  assert.deepEqual(buckets.map((b) => b.count), [1, 0, 0, 1])
})

test('bucketize: counts and rating sums land in the right period', () => {
  const buckets = bucketize([at('2026-01-05', 4), at('2026-01-20', 2), at('2026-02-01', 5)], 'month')
  assert.equal(buckets[0]?.count, 2)
  assert.equal(buckets[0]?.ratingSum, 6)
  assert.equal(buckets[1]?.count, 1)
})

test('bucketize: an unrated review counts toward volume but not the mean', () => {
  const buckets = bucketize([at('2026-01-05', null), at('2026-01-06', 4)], 'month')
  assert.equal(buckets[0]?.count, 2)
  assert.equal(buckets[0]?.rated, 1)
  assert.equal(buckets[0]?.ratingSum, 4)
})

test('bucketize: no input gives no buckets rather than one empty one', () => {
  assert.deepEqual(bucketize([], 'month'), [])
})

test('bucketize: a year boundary does not restart the sequence', () => {
  const buckets = bucketize([at('2025-11-05'), at('2026-02-05')], 'month')
  assert.deepEqual(buckets.map((b) => b.start), [
    '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01',
  ])
})

test('trajectory: the trailing mean is withheld until enough ratings are in', () => {
  // Drawing a confident rating line through two reviews is the thing this
  // guard exists to prevent.
  const points = trajectory(bucketize([at('2026-01-05', 5), at('2026-02-05', 1)], 'month'), 4, 5)
  assert.equal(points[0]?.trailing, null)
  assert.equal(points[1]?.trailing, null)
})

test('trajectory: the trailing mean smooths a single-period shock', () => {
  const rows = [
    ...Array.from({ length: 10 }, () => at('2026-01-05', 5)),
    ...Array.from({ length: 2 }, () => at('2026-02-05', 1)),
  ]
  const points = trajectory(bucketize(rows, 'month'), 4, 5)
  // February alone reads as 1.0; across the window it is much higher, which is
  // the honest read of two bad reviews after ten good ones.
  assert.equal(points[1]?.average, 1)
  assert.ok((points[1]?.trailing ?? 0) > 4, `trailing was ${points[1]?.trailing}`)
})

test('trajectory: a period with no ratings has a null average, not zero', () => {
  const points = trajectory(bucketize([at('2026-01-05', 5), at('2026-03-05', 5)], 'month'), 4, 1)
  assert.equal(points[1]?.average, null)
  assert.equal(points[1]?.count, 0)
})

test('recent split: the two windows are equal length and adjacent', () => {
  const now = Date.parse('2026-09-12T00:00:00Z')
  const { recent, prior } = recentSplit(
    // 2 days ago, 23 days ago (both inside 30), 38 days ago (the prior window),
    // and one far outside that must land in neither.
    [at('2026-09-10'), at('2026-08-20'), at('2026-08-05'), at('2026-01-01')],
    30,
    now,
  )
  assert.equal(recent.length, 2)
  assert.equal(prior.length, 1)
})

test('growth: from zero is null, not infinity', () => {
  // A model's first-ever review is a launch, not infinite growth.
  assert.equal(growthRatio(5, 0), null)
  assert.equal(growthRatio(0, 0), null)
})

test('growth: ordinary ratios', () => {
  assert.equal(growthRatio(15, 10), 0.5)
  assert.equal(growthRatio(5, 10), -0.5)
  assert.equal(growthRatio(0, 10), -1)
})
