import { test } from 'node:test'
import assert from 'node:assert/strict'
import { materialGaps, type ModelCoverage } from '../src/lib/review-coverage.js'

const model = (over: Partial<ModelCoverage>): ModelCoverage => ({
  modelId: 'm',
  modelName: 'Model',
  brand: 'Brand',
  stored: 0,
  reported: 0,
  listings: 1,
  ...over,
})

/**
 * These pin the fix for a false alarm that shipped: comparing ONE listing's
 * stored count against a family-wide reported total. JOOLA sells the Perseus
 * Pro IV under three listings and Bazaarvoice reports the same 306 on all
 * three, while our 314 reviews are split 41/45/228 across them. Read per
 * listing that looks like 87% missing; read per model, nothing is missing.
 */
test('coverage: a model split across listings is complete when the sum covers the max', () => {
  const perseus = model({ stored: 41 + 45 + 228, reported: 306, listings: 3 })
  assert.deepEqual(materialGaps([perseus]), [])
})

test('coverage: a genuine truncation is still flagged', () => {
  const capped = model({ modelName: 'Double Black Diamond Control', stored: 1000, reported: 8031 })
  assert.equal(materialGaps([capped]).length, 1)
})

test('coverage: a two-review difference is not a gap', () => {
  // 35 held of 37 is a crawl landing between a review being posted and the
  // platform's own counter catching up, not missing data.
  assert.deepEqual(materialGaps([model({ stored: 35, reported: 37 })]), [])
})

test('coverage: both guards are required, not either', () => {
  // Large absolute gap but proportionally tiny: 2% short of 10,000.
  assert.deepEqual(materialGaps([model({ stored: 9800, reported: 10_000 })]), [])
  // Large proportion but tiny absolute: 10 held of 30.
  assert.deepEqual(materialGaps([model({ stored: 10, reported: 30 })]), [])
  // Both material.
  assert.equal(materialGaps([model({ stored: 10, reported: 300 })]).length, 1)
})

test('coverage: holding more than reported is never a gap', () => {
  // Happens when a platform total lags our crawl, or counts one storefront
  // while we hold several.
  assert.deepEqual(materialGaps([model({ stored: 500, reported: 300 })]), [])
  assert.deepEqual(materialGaps([model({ stored: 500, reported: 0 })]), [])
})

test('coverage: gaps are ordered by how many reviews are missing', () => {
  const gaps = materialGaps([
    model({ modelId: 'small', stored: 100, reported: 200 }),
    model({ modelId: 'huge', stored: 1000, reported: 8031 }),
    model({ modelId: 'mid', stored: 50, reported: 500 }),
  ])
  assert.deepEqual(gaps.map((g) => g.modelId), ['huge', 'mid', 'small'])
})
