import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModel } from '../src/normalize/model-resolver.js'
import { classifyAssortment } from '../src/normalize/assortment.js'
import { lineMap } from '../src/config/brands/types.js'
import { SELKIRK_RULES } from '../src/config/brands/selkirk.js'
import { JOOLA_RULES } from '../src/config/brands/joola.js'
import type { RawProduct } from '../src/sources/types.js'

function product(
  title: string,
  opts: { tags?: string[]; collections?: string[] } = {},
): RawProduct {
  return {
    sourceProductId: title,
    handle: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title,
    vendor: null,
    productType: null,
    tags: opts.tags ?? [],
    bodyHtml: null,
    url: 'https://example.com',
    imageUrl: null,
    publishedAt: null,
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    categoryHandles: opts.collections ?? ['pickleball-paddles'],
    variants: [],
  }
}

const nameOf = (title: string, rules = SELKIRK_RULES, opts = {}) =>
  resolveModel(product(title, opts), rules, lineMap(rules)).modelName

// ---------------------------------------------------------------------------
// Model naming
// ---------------------------------------------------------------------------

test('keeps the model word that distinguishes one paddle from another', () => {
  // These three are different paddles. Naming from line + sub-line alone made
  // all of them 'SLK Max', because Max is the shape they happen to share.
  assert.equal(nameOf('SLK Latitude - Max - Pickleball Paddle'), 'SLK Latitude')
  assert.equal(nameOf('SLK Nexus - Max - Pickleball Paddle'), 'SLK Nexus')
  assert.equal(nameOf('SLK Atlas - Max - Pickleball Paddle'), 'SLK Atlas')
})

test('puts a family on one model regardless of which shape page it came from', () => {
  assert.equal(
    nameOf('SLK Atlas - Max - Pickleball Paddle'),
    nameOf('SLK Atlas - XL - Pickleball Paddle'),
  )
})

test('preserves the order the title uses', () => {
  // Slot assembly reordered this into 'Vision Agassi Heat Edge'.
  assert.equal(
    nameOf('JOOLA Agassi Edge Heat Vision Pickleball Paddle', JOOLA_RULES),
    'Agassi Edge Heat Vision',
  )
})

test('names a JOOLA generation exactly once', () => {
  // A regex '\b' written in a template literal became U+0008 and never matched,
  // so the generation was appended to a name that already contained it.
  assert.equal(nameOf('JOOLA Perseus Pro IV 16mm Pickleball Paddle', JOOLA_RULES), 'Perseus Pro IV')
  assert.equal(nameOf('JOOLA Perseus Pro V 14mm Pickleball Paddle', JOOLA_RULES), 'Perseus Pro V')
})

test('appends a generation the title states only numerically', () => {
  // '3S' is stripped as numeric, so it has to come back from the generation.
  assert.match(nameOf('JOOLA Perseus 3S Pickleball Paddle', JOOLA_RULES), /^Perseus 3S$/)
})

test('drops collaboration markers left behind by brand stripping', () => {
  // 'Selkirk' is noise, which would otherwise leave a name starting with 'x'.
  assert.equal(
    nameOf('Selkirk x Holderness Family AMPED Pro Air'),
    'Holderness Family AMPED Pro Air',
  )
})

test('keeps a thickness out of the model name', () => {
  assert.equal(nameOf('JOOLA Ben Johns Hyperion CGS 16 Pickleball Paddle', JOOLA_RULES), 'Hyperion CGS')
})

// ---------------------------------------------------------------------------
// Product line
// ---------------------------------------------------------------------------

test('reads the line as the first one the title names', () => {
  // 'Agassi' and 'Vision' are both six characters, so a longest-first tiebreak
  // fell through to map order and filed this under Vision.
  const resolved = resolveModel(
    product('JOOLA Agassi Edge Heat Vision Pickleball Paddle'),
    JOOLA_RULES,
    lineMap(JOOLA_RULES),
  )
  assert.equal(resolved.productLineName, 'Agassi')
})

// ---------------------------------------------------------------------------
// Assortment
// ---------------------------------------------------------------------------

test('excludes merchandise even when it is tagged as a paddle', () => {
  const verdict = classifyAssortment(
    product('JOOLA 3s Keychain', { tags: ['pickleball-paddles'] }),
  )
  assert.equal(verdict.isInAssortment, false)
  assert.match(verdict.reason, /merchandise/)
})

test('excludes a free gift riding along in a paddle collection', () => {
  assert.equal(
    classifyAssortment(product('Free Gift - Boomstik Carbon Fiber Insert Card')).isInAssortment,
    false,
  )
})

test('admits a paddle whose title is plural', () => {
  // '\bpaddle\b' does not match 'Paddles'.
  const verdict = classifyAssortment(product('LABS Project Boomstik Pro UPA Paddles', { tags: [] }))
  assert.equal(verdict.isInAssortment, true)
})

test('admits an untagged paddle by the shelf it sits on', () => {
  // No tags, no 'paddle' in the title — only its collection says what it is.
  const verdict = classifyAssortment(
    product('SLK OMEGA Hybrid Air', { tags: [], collections: ['edgeless-pickleball-paddles'] }),
  )
  assert.equal(verdict.isInAssortment, true)
  assert.match(verdict.reason, /shelved in edgeless-pickleball-paddles/)
})

test('does not let a sale shelf readmit an accessory', () => {
  // 'paddle-markdowns' matches the paddle pattern but contains bags too, so the
  // shelf rule must sit below the non-paddle title check.
  const verdict = classifyAssortment(
    product('Selkirk Tour Bag', { tags: [], collections: ['paddle-markdowns'] }),
  )
  assert.equal(verdict.isInAssortment, false)
})
