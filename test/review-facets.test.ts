import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyRatingPredicate,
  facetScope,
  hasNarrowingFilters,
  meanRating,
  starMatches,
  tallyFacets,
} from '../src/lib/review-facets.js'

/**
 * The shipped bug these pin: every summary number on /reviews was computed from
 * a different predicate set than the rows below it.
 *
 *   - "Average rating" read 4.62 while the list showed only one-star reviews
 *   - a product chip advertised 306 and returned 12 once a star filter was on
 *   - the sidebar said JOOLA 5,189 whatever was filtered
 */

test('star predicate: an exact star filter admits only that star', () => {
  assert.equal(starMatches(1, 1, undefined), true)
  assert.equal(starMatches(2, 1, undefined), false)
  assert.equal(starMatches(5, 5, undefined), true)
})

test('star predicate: positive sentiment is 4 and up, complaints are 3 and down', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((s) => starMatches(s, undefined, 'positive')), [
    false, false, false, true, true,
  ])
  assert.deepEqual([1, 2, 3, 4, 5].map((s) => starMatches(s, undefined, 'negative')), [
    true, true, true, false, false,
  ])
})

test('star predicate: an exact star wins over a sentiment carried in the same URL', () => {
  // Both can appear in a hand-edited query string. The narrower one is safer.
  assert.equal(starMatches(5, 1, 'positive'), false)
  assert.equal(starMatches(1, 1, 'positive'), true)
})

test('star predicate: nothing active admits every star', () => {
  for (const star of [1, 2, 3, 4, 5]) assert.equal(starMatches(star, undefined, undefined), true)
})

test('average: with no rating filter it is the mean of the whole histogram', () => {
  // 100 one-star and 100 five-star average to exactly 3.
  assert.equal(meanRating(applyRatingPredicate([100, 0, 0, 0, 100])), 3)
})

test('average: a one-star filter reports 1.00, not the unfiltered mean', () => {
  // This is the bug verbatim: the page printed 4.62 over a list of one-star rows.
  const distribution = [412, 180, 260, 1_900, 18_019]
  assert.ok(meanRating(distribution)! > 4.6)
  assert.equal(meanRating(applyRatingPredicate(distribution, 1)), 1)
})

test('average: a complaints filter averages only 1-3', () => {
  const distribution = [100, 100, 100, 0, 0]
  assert.equal(meanRating(applyRatingPredicate(distribution, undefined, 'negative')), 2)
})

test('average: a set with no rated rows has no average rather than zero', () => {
  assert.equal(meanRating([0, 0, 0, 0, 0]), null)
  assert.equal(meanRating(applyRatingPredicate([0, 0, 0, 10, 5], 2)), null)
})

test('narrowing: brand and product alone leave the pre-aggregated views correct', () => {
  assert.equal(hasNarrowingFilters({}), false)
  assert.equal(hasNarrowingFilters({ brand: 'joola' }), false)
  assert.equal(hasNarrowingFilters({ brand: 'joola', productId: 'p1' }), false)
  // Paging and sorting reorder rows; they never remove any.
  assert.equal(hasNarrowingFilters({ page: 4, pageSize: 50, sort: 'helpful' }), false)
})

test('narrowing: every predicate that removes rows is recognised', () => {
  const narrowing = [
    { q: 'grip' },
    { modelId: 'm1' },
    { rating: 5 },
    { sentiment: 'negative' as const },
    { verifiedOnly: true },
    { withTextOnly: true },
    { withResponse: true },
    { from: '2026-01-01' },
    { to: '2026-01-01' },
  ]
  for (const query of narrowing) {
    assert.equal(hasNarrowingFilters(query), true, JSON.stringify(query))
  }
})

test('narrowing: a whitespace-only search term narrows nothing', () => {
  // It is stripped before the query is built, so treating it as narrowing would
  // buy a full read for a filter that is not there.
  assert.equal(hasNarrowingFilters({ q: '   ' }), false)
})

test('narrowing: rating 0 is not a filter, but it must not read as one either', () => {
  // `rating: 0` cannot come from the page (1-5 only), but `?rating=0` can, and
  // an `undefined` check rather than a truthiness check is what keeps the two
  // sides of the branch agreeing about it.
  assert.equal(hasNarrowingFilters({ rating: 0 }), true)
})

test('scope: the facet read drops brand, product and everything about paging', () => {
  const scope = facetScope({
    q: 'grip',
    brand: 'joola',
    productId: 'p1',
    rating: 5,
    sort: 'helpful',
    page: 3,
    pageSize: 50,
  })
  assert.deepEqual(scope, { q: 'grip', rating: 5 })
})

test('scope: predicates that are not brand or product survive untouched', () => {
  const scope = facetScope({ verifiedOnly: true, withResponse: true, from: '2026-01-01' })
  assert.deepEqual(scope, { verifiedOnly: true, withResponse: true, from: '2026-01-01' })
})

const ROWS = [
  { product_id: 'perseus-4', brand_slug: 'joola' },
  { product_id: 'perseus-4', brand_slug: 'joola' },
  { product_id: 'perseus-5', brand_slug: 'joola' },
  { product_id: 'omni', brand_slug: 'selkirk' },
]

test('tally: with no brand selected every product is counted', () => {
  const { byProduct, byBrand } = tallyFacets(ROWS, {})
  assert.equal(byProduct.get('perseus-4'), 2)
  assert.equal(byProduct.get('omni'), 1)
  assert.equal(byBrand.get('joola'), 3)
  assert.equal(byBrand.get('selkirk'), 1)
})

test('tally: a product chip is counted within the brand its link keeps', () => {
  const { byProduct } = tallyFacets(ROWS, { brand: 'joola' })
  assert.equal(byProduct.get('perseus-4'), 2)
  assert.equal(byProduct.has('omni'), false)
})

test('tally: a brand chip ignores the product filter its link deletes', () => {
  // BrandSwitcher drops ?product= when switching brand, so the count beside
  // Selkirk has to be Selkirk's whole filtered total, not zero.
  const { byBrand } = tallyFacets(ROWS, { brand: 'joola', productId: 'perseus-4' })
  assert.equal(byBrand.get('joola'), 3)
  assert.equal(byBrand.get('selkirk'), 1)
})

test('tally: a brand with no surviving rows is absent rather than zero', () => {
  // Absent lets the caller decide between hiding the chip and printing 0; a
  // stored 0 would force one of those choices on every reader.
  const { byBrand } = tallyFacets([{ product_id: 'omni', brand_slug: 'selkirk' }], {})
  assert.equal(byBrand.has('joola'), false)
})
