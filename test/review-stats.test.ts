import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  averageOf,
  byShape,
  byThickness,
  coverage,
  leaderboardsByBrand,
  matchesFilter,
  thicknessesPresent,
  type ReviewFact,
} from '../src/lib/review-stats.js'
import type { Shape } from '../src/lib/review-dimensions.js'

let seq = 0
function fact(over: Partial<ReviewFact> = {}): ReviewFact {
  seq++
  return {
    productId: `p${seq}`,
    productTitle: `Listing ${seq}`,
    modelId: 'm1',
    modelName: 'Perseus Pro IV',
    brand: 'JOOLA',
    brandSlug: 'joola',
    rating: 5,
    shape: null,
    thicknessMm: null,
    submittedAt: null,
    playStyle: null,
    ...over,
  }
}

const many = (n: number, over: Partial<ReviewFact> = {}) =>
  Array.from({ length: n }, () => fact(over))

test('leaderboard: the most-reviewed model of each brand comes first', () => {
  const facts = [
    ...many(3, { modelId: 'a', modelName: 'Perseus Pro IV' }),
    ...many(7, { modelId: 'b', modelName: 'Perseus Pro V' }),
    ...many(5, { modelId: 'c', modelName: 'OMNI', brand: 'Selkirk', brandSlug: 'selkirk' }),
  ]
  const boards = leaderboardsByBrand(facts)
  const joola = boards.find((b) => b.brandSlug === 'joola')!
  assert.equal(joola.models[0]?.label, 'Perseus Pro V')
  assert.equal(joola.models[0]?.count, 7)
  assert.equal(joola.models[1]?.label, 'Perseus Pro IV')
})

test('leaderboard: brands are ordered by how many reviews they hold', () => {
  const boards = leaderboardsByBrand([
    ...many(2, { brand: 'GAMMA', brandSlug: 'gamma' }),
    ...many(9, { brand: 'CRBN', brandSlug: 'crbn' }),
  ])
  assert.deepEqual(boards.map((b) => b.brandSlug), ['crbn', 'gamma'])
})

test('leaderboard: share is of the brand, not of everything', () => {
  const boards = leaderboardsByBrand([
    ...many(3, { modelId: 'a', modelName: 'A' }),
    ...many(1, { modelId: 'b', modelName: 'B' }),
    ...many(96, { brand: 'CRBN', brandSlug: 'crbn', modelId: 'z', modelName: 'Z' }),
  ])
  const joola = boards.find((b) => b.brandSlug === 'joola')!
  assert.equal(joola.models[0]?.share, 0.75)
})

test('leaderboard: listings with no model are counted, not silently dropped', () => {
  // A brand whose leaderboard quietly omits reviews cannot be reconciled
  // against the review count shown anywhere else.
  const boards = leaderboardsByBrand([
    ...many(4, { modelId: 'a', modelName: 'A' }),
    ...many(2, { modelId: null, modelName: null }),
  ])
  const joola = boards[0]!
  assert.equal(joola.total, 6)
  assert.equal(joola.unmatched, 2)
  assert.equal(joola.models.reduce((n, m) => n + m.count, 0), 4)
})

test('tally: star buckets split at 4 and 5', () => {
  const boards = leaderboardsByBrand([
    ...many(2, { rating: 5 }),
    ...many(3, { rating: 4 }),
    ...many(4, { rating: 2 }),
  ])
  const t = boards[0]!.tally
  assert.equal(t.five, 2)
  assert.equal(t.four, 3)
  assert.equal(t.low, 4)
})

test('tally: an unrated review counts as a review but not toward the average', () => {
  const boards = leaderboardsByBrand([...many(1, { rating: null }), ...many(1, { rating: 4 })])
  const t = boards[0]!.tally
  assert.equal(t.count, 2)
  assert.equal(t.rated, 1)
  assert.equal(averageOf(t), 4)
})

test('tally: an average over nothing is null, not zero', () => {
  const boards = leaderboardsByBrand(many(2, { rating: null }))
  assert.equal(averageOf(boards[0]!.tally), null)
})

test('filter: exact star ratings', () => {
  const five = fact({ rating: 5 })
  const four = fact({ rating: 4 })
  assert.equal(matchesFilter(five, { ratings: [4, 5] }), true)
  assert.equal(matchesFilter(four, { ratings: [5] }), false)
  // An empty list means "no rating filter", not "nothing matches".
  assert.equal(matchesFilter(four, { ratings: [] }), true)
})

test('filter: an unrated review is excluded by any star filter', () => {
  assert.equal(matchesFilter(fact({ rating: null }), { ratings: [5] }), false)
  assert.equal(matchesFilter(fact({ rating: null }), {}), true)
})

test("filter: 'none' selects exactly the unresolved reviews", () => {
  const known = fact({ shape: 'elongated' as Shape })
  const unknown = fact({ shape: null })
  assert.equal(matchesFilter(unknown, { shape: 'none' }), true)
  assert.equal(matchesFilter(known, { shape: 'none' }), false)
  assert.equal(matchesFilter(known, { shape: 'elongated' as Shape }), true)
})

test('filter: thickness 0 would be a value, not an absence', () => {
  // Guards the shape of the undefined/none check: only `undefined` means "no
  // filter", so a falsy-but-real value still filters.
  assert.equal(matchesFilter(fact({ thicknessMm: 16 }), { thicknessMm: undefined }), true)
  assert.equal(matchesFilter(fact({ thicknessMm: 16 }), { thicknessMm: 14 }), false)
})

test('breakdown: Not recorded is always present, even at zero', () => {
  const rows = byShape(many(3, { shape: 'elongated' as Shape }))
  const last = rows[rows.length - 1]!
  assert.equal(last.label, 'Not recorded')
  assert.equal(last.count, 0)
})

test('breakdown: Not recorded carries its real count when there is one', () => {
  const rows = byShape([...many(3, { shape: 'elongated' as Shape }), ...many(2, { shape: null })])
  assert.equal(rows[rows.length - 1]?.count, 2)
  assert.equal(rows.reduce((n, r) => n + r.count, 0), 5)
})

test('breakdown: thickness is ordered by millimetre, not by popularity', () => {
  const rows = byThickness([
    ...many(1, { thicknessMm: 16 }),
    ...many(9, { thicknessMm: 14 }),
    ...many(3, { thicknessMm: 12 }),
  ])
  assert.deepEqual(rows.map((r) => r.label), ['12mm', '14mm', '16mm', 'Not recorded'])
})

test('coverage: the fraction that resolved at all', () => {
  const facts = [...many(3, { shape: 'hybrid' as Shape }), ...many(1, { shape: null })]
  assert.equal(coverage(facts, 'shape'), 0.75)
  assert.equal(coverage(facts, 'thickness'), 0)
  assert.equal(coverage([], 'shape'), 0)
})

test('present values list only what is actually there, in order', () => {
  const facts = [...many(1, { thicknessMm: 16 }), ...many(1, { thicknessMm: 12 })]
  assert.deepEqual(thicknessesPresent(facts), [12, 16])
})
