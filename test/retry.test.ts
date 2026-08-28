import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { isTransient, withRetry } from '../src/lib/retry.js'

describe('transient classification', () => {
  test('treats the observed Supabase gateway error as transient', () => {
    assert.equal(isTransient(new Error('select v_variant_current: JWT issued at future')), true)
  })

  test('treats network failures as transient', () => {
    assert.equal(isTransient(new Error('fetch failed')), true)
    assert.equal(isTransient(new Error('ECONNRESET')), true)
    assert.equal(isTransient(new Error('upstream request timeout')), true)
  })

  test('does NOT retry a real query error', () => {
    // Retrying these three times would hide a genuine bug behind latency.
    assert.equal(isTransient(new Error('column products.nope does not exist')), false)
    assert.equal(isTransient(new Error('relation "public.brands" does not exist')), false)
    assert.equal(isTransient(new Error('new row violates row-level security policy')), false)
  })
})

describe('withRetry', () => {
  test('returns the value without retrying when the call succeeds', async () => {
    let calls = 0
    const result = await withRetry(async () => {
      calls++
      return 'ok'
    }, 'test')
    assert.equal(result, 'ok')
    assert.equal(calls, 1)
  })

  test('recovers from a transient failure', async () => {
    let calls = 0
    const result = await withRetry(async () => {
      calls++
      if (calls === 1) throw new Error('JWT issued at future')
      return 'recovered'
    }, 'test')
    assert.equal(result, 'recovered')
    assert.equal(calls, 2)
  })

  test('gives up after the attempt budget and rethrows', async () => {
    let calls = 0
    await assert.rejects(
      withRetry(
        async () => {
          calls++
          throw new Error('JWT issued at future')
        },
        'test',
        3,
      ),
      /JWT issued at future/,
    )
    assert.equal(calls, 3)
  })

  test('fails immediately on a non-transient error', async () => {
    let calls = 0
    await assert.rejects(
      withRetry(async () => {
        calls++
        throw new Error('column does not exist')
      }, 'test'),
      /column does not exist/,
    )
    assert.equal(calls, 1)
  })
})
