import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tierOf, PRICE_TIERS } from '../src/lib/price-tiers.js'

/**
 * Tiers are fixed boundaries, so the only thing that can silently rot is which
 * side of a boundary a price falls on. A paddle at exactly $100 moving between
 * "value" and "mid" would reshuffle every tier-mix column without any visible
 * error, so the edges are pinned explicitly.
 */
test('price tiers: boundaries are exclusive upper bounds', () => {
  assert.equal(tierOf(99.99), 'value')
  assert.equal(tierOf(100), 'mid', '$100 is the first mid price, not the last value price')
  assert.equal(tierOf(199.99), 'mid')
  assert.equal(tierOf(200), 'premium', '$200 is the first premium price')
})

test('price tiers: the observed extremes land where a reader expects', () => {
  assert.equal(tierOf(19.95), 'value')
  assert.equal(tierOf(333), 'premium')
})

test('price tiers: every tier is reachable and the last one is unbounded', () => {
  const reached = new Set([tierOf(1), tierOf(150), tierOf(1_000_000)])
  assert.deepEqual([...reached].sort(), ['mid', 'premium', 'value'])
  assert.equal(PRICE_TIERS[PRICE_TIERS.length - 1]?.upperBound, Number.POSITIVE_INFINITY)
})
