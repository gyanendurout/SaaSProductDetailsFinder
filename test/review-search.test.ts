import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toIlikeValue } from '../src/lib/review-search-term.js'

const BS = String.fromCharCode(92)

/**
 * These pin the escaping that a shipped bug got wrong in both directions.
 *
 * Before the fix, `, ( ) * \ %` were replaced with spaces, so:
 *   - `100%` searched for `100` and returned 117 rows instead of 63
 *   - `%` alone became an EMPTY term, which meant "no filter" and returned all
 *     20,771 reviews rather than the 161 containing a literal percent sign
 *   - `_` was never handled at all, so `g_ip` returned all 1,221 hits for `grip`
 *
 * The two escaping layers were verified against the live API: Postgres LIKE
 * treats backslash as its escape character, and PostgREST consumes one level of
 * backslash inside a quoted value, so each one has to be doubled.
 */

test('escaping: a plain term is quoted and wrapped in wildcards', () => {
  assert.equal(toIlikeValue('grip'), '"*grip*"')
})

test('escaping: a literal percent is escaped, not dropped', () => {
  // Two backslashes: one for LIKE, doubled to survive PostgREST's own parsing.
  assert.equal(toIlikeValue('100%'), `"*100${BS}${BS}%*"`)
})

test('escaping: a literal underscore stops being a single-char wildcard', () => {
  assert.equal(toIlikeValue('add_on'), `"*add${BS}${BS}_on*"`)
  assert.equal(toIlikeValue('g_ip'), `"*g${BS}${BS}_ip*"`)
})

test('escaping: a literal backslash survives both layers', () => {
  // One backslash in, four out: LIKE-escaped to two, then doubled to four.
  assert.equal(toIlikeValue(BS), `"*${BS.repeat(4)}*"`)
})

test('escaping: a double quote cannot terminate the quoted value', () => {
  // Otherwise the term could close the value and inject filter syntax.
  assert.equal(toIlikeValue('say "hi"'), `"*say ${BS}"hi${BS}"*"`)
})

test('escaping: commas and parentheses need no stripping once quoted', () => {
  // These used to be replaced with spaces because they are PostgREST `or=`
  // syntax. Quoting is what makes them safe, so they now match literally.
  assert.equal(toIlikeValue('a,b'), '"*a,b*"')
  assert.equal(toIlikeValue('(x)'), '"*(x)*"')
})

test('escaping: every metacharacter in one term', () => {
  const value = toIlikeValue('50%_off')
  assert.equal(value, `"*50${BS}${BS}%${BS}${BS}_off*"`)
})

test('escaping: a term with no metacharacters is left alone inside the quotes', () => {
  // Guards against over-escaping, which would silently stop ordinary searches
  // matching anything.
  for (const term of ['Perseus Pro V', '16mm', 'Ben Johns', '3S']) {
    assert.equal(toIlikeValue(term), `"*${term}*"`)
  }
})
