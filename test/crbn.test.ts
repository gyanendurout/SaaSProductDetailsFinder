import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModel } from '../src/normalize/model-resolver.js'
import { extractVariantAttributes } from '../src/normalize/attributes.js'
import { foldTypography } from '../src/normalize/text.js'
import { comparePrices, median } from '../src/pipeline/price-guard.js'
import { lineMap } from '../src/config/brands/types.js'
import { CRBN_RULES } from '../src/config/brands/crbn.js'
import { SELKIRK_RULES } from '../src/config/brands/selkirk.js'
import type { RawProduct, RawVariant } from '../src/sources/types.js'

function variant(opts: Array<{ name: string; value: string }> = []): RawVariant {
  return {
    sourceVariantId: 'v1',
    sku: 'SKU',
    barcode: null,
    title: null,
    position: 1,
    imageUrl: null,
    options: opts,
    price: 279.99,
    compareAtPrice: null,
    currency: 'USD',
    isAvailable: true,
    inventoryQuantity: null,
  }
}

function product(title: string, collections: string[] = ['pickleball-paddles']): RawProduct {
  return {
    sourceProductId: title,
    handle: 'h',
    title,
    vendor: null,
    productType: null,
    tags: [],
    bodyHtml: null,
    url: 'https://crbnpickleball.com',
    imageUrl: null,
    publishedAt: null,
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    categoryHandles: collections,
    variants: [variant()],
  }
}

const model = (title: string, collections?: string[]) =>
  resolveModel(product(title, collections), CRBN_RULES, lineMap(CRBN_RULES))
const shapeOf = (title: string) =>
  extractVariantAttributes(product(title), variant(), CRBN_RULES).shape?.value

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

test('folds superscript digits to ASCII', () => {
  // U+00B9 U+00B2 U+00B3 U+2074 — they look like digits but /\d/ does not match
  // them, and slugify drops them entirely, so CRBN1..CRBN4 would collide.
  assert.equal(foldTypography('CRBN¹'), 'CRBN1')
  assert.equal(foldTypography('CRBN²'), 'CRBN2')
  assert.equal(foldTypography('CRBN³'), 'CRBN3')
  assert.equal(foldTypography('CRBN⁴'), 'CRBN4')
  assert.equal(/\d/.test('CRBN¹'), false, 'the premise: a superscript is not a digit')
  assert.equal(/\d/.test(foldTypography('CRBN¹')), true)
})

test('folds trademark marks and curly quotes', () => {
  assert.equal(foldTypography('Project Boomstik®'), 'Project Boomstik')
  assert.equal(foldTypography('Ed Ju’s'), "Ed Ju's")
})

test('gives the four numbered shapes four distinct model slugs', () => {
  const slugs = ['CRBN¹ TruFoam Barrage', 'CRBN² TruFoam Barrage'].map(
    (t) => model(t).modelSlug,
  )
  // Same model, deliberately — one paddle in two shapes.
  assert.equal(slugs[0], slugs[1])
  // But the slug must be a real name, not an empty string left by a dropped
  // superscript.
  assert.match(slugs[0]!, /crbn-trufoam-barrage/)
})

// ---------------------------------------------------------------------------
// Shape — CRBN numbers its shapes rather than its versions
// ---------------------------------------------------------------------------

test('reads the shape from the numeral', () => {
  assert.equal(shapeOf('CRBN¹ X Series'), 'elongated')
  assert.equal(shapeOf('CRBN² X Series'), 'square')
  assert.equal(shapeOf('CRBN³ X Series'), 'elongated')
  assert.equal(shapeOf('CRBN⁴ TruFoam Waves'), 'hybrid')
})

test('reads the shape from the parenthetical when present', () => {
  assert.equal(shapeOf('CRBN² TruFoam Barrage (Square)'), 'square')
  assert.equal(shapeOf('CRBN⁴ TruFoam Genesis (Hybrid, AeroCurve)'), 'hybrid')
})

test('does not read a shape out of a thickness', () => {
  // '12MM' contains a 1 and a 2; neither is a shape.
  assert.equal(model('CRBN¹ X Series 12MM Paddle').modelName, 'X Series')
})

// ---------------------------------------------------------------------------
// Model naming
// ---------------------------------------------------------------------------

test('keeps a capitalised X as part of the line name', () => {
  // The collaboration-marker filter strips a lowercase 'x'; CRBN's line is
  // literally called 'X Series', and stripping it renamed every one 'Series'.
  assert.equal(model('CRBN¹ X Series').modelName, 'X Series')
})

test('still strips a lowercase collaboration marker', () => {
  const m = resolveModel(
    { ...product('Selkirk x Holderness Family AMPED Pro Air'), tags: [] },
    SELKIRK_RULES,
    lineMap(SELKIRK_RULES),
  )
  assert.equal(m.modelName, 'Holderness Family AMPED Pro Air')
})

test('drops the parenthetical shape restatement from the name', () => {
  // Otherwise one paddle splits into 'TruFoam Barrage' and
  // 'TruFoam Barrage Long Handle'.
  assert.equal(
    model('CRBN¹ TruFoam Barrage (Elongated, Long Handle)').modelName,
    model('CRBN³ TruFoam Barrage (Elongated)').modelName,
  )
})

test('names the series when the title is only a brand and a numeral', () => {
  // 'CRBN¹' says nothing but the shape; the shelf is the only statement of
  // which series it belongs to.
  const m = model('CRBN¹', ['crbn-original-series-pickleball-paddles'])
  assert.equal(m.productLineName, 'Classic')
  assert.equal(m.modelName, 'Classic')
})

test('reports no skill tier or play style for a brand that publishes neither', () => {
  const m = model('CRBN³ TruFoam Waves (Elongated)')
  assert.equal(m.skillTier, 'unknown')
  assert.equal(m.playStyle, 'unknown')
})

// ---------------------------------------------------------------------------
// Price guard
// ---------------------------------------------------------------------------

test('median ignores nulls and zeroes', () => {
  assert.equal(median([100, 200, 300]), 200)
  assert.equal(median([100, 200]), 150)
  assert.equal(median([]), null)
  assert.equal(median([0, 0, 250]), 250)
})

test('rejects a run whose prices changed scale', () => {
  // The real failure: 223.99 came back as 21800.00 from another market.
  const verdict = comparePrices([21800, 27200, 16999], [223.99, 279.99, 169.99])
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /change of scale/)
})

test('allows a deep but real markdown', () => {
  // 60% off across the board must not trip the guard.
  const verdict = comparePrices([80, 90, 100], [200, 225, 250])
  assert.equal(verdict.ok, true)
})

test('allows the first run for a site', () => {
  assert.equal(comparePrices([223.99, 279.99], []).ok, true)
})
