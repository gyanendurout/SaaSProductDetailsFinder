import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeVariantsAcrossProducts } from '../src/normalize/dedupe.js'
import { SELKIRK_RULES } from '../src/config/brands/selkirk.js'
import { JOOLA_RULES } from '../src/config/brands/joola.js'
import type { RawProduct, RawVariant } from '../src/sources/types.js'

function variant(id: string): RawVariant {
  return {
    sourceVariantId: id,
    sku: `SKU-${id}`,
    barcode: null,
    title: `Variant ${id}`,
    position: 1,
    imageUrl: null,
    options: [],
    price: 100,
    compareAtPrice: null,
    currency: 'USD',
    isAvailable: true,
    inventoryQuantity: null,
  }
}

function product(
  handle: string,
  variantIds: string[],
  categoryHandles: string[] = [],
): RawProduct {
  return {
    sourceProductId: `p-${handle}`,
    handle,
    title: handle,
    vendor: null,
    productType: null,
    tags: [],
    bodyHtml: null,
    url: `https://example.com/products/${handle}`,
    imageUrl: null,
    publishedAt: null,
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    categoryHandles,
    variants: variantIds.map(variant),
  }
}

test('leaves a feed with no shared SKUs untouched', () => {
  const input = [product('perseus-pro-v', ['1', '2']), product('hyperion', ['3'])]
  const out = dedupeVariantsAcrossProducts(input, JOOLA_RULES)

  assert.equal(out.movedVariants, 0)
  assert.equal(out.droppedProducts, 0)
  assert.equal(out.products, input, 'should return the same array, not a copy')
})

test('gives a shared SKU to the umbrella product, not the per-shape page', () => {
  // The real shape: /amped-control carries all three shapes, and each per-shape
  // page repeats a subset of the very same variant ids.
  const out = dedupeVariantsAcrossProducts(
    [
      product('amped-control', ['e1', 'e2', 'i1', 'i2', 's1', 's2v']),
      product('amped-control-epic', ['e1', 'e2']),
      product('amped-control-invikta', ['i1', 'i2']),
      product('amped-control-s2', ['s1', 's2v']),
    ],
    SELKIRK_RULES,
  )

  assert.equal(out.products.length, 1)
  assert.equal(out.products[0]!.handle, 'amped-control')
  assert.equal(out.products[0]!.variants.length, 6)
  assert.equal(out.movedVariants, 6)
  assert.equal(out.droppedProducts, 3)
})

test('every SKU survives deduplication exactly once', () => {
  const input = [
    product('slk-evo-control', ['a', 'b', 'c', 'd', 'e', 'f']),
    product('slk-evo-control-max', ['a', 'b', 'c']),
    product('slk-evo-control-xl', ['d', 'e', 'f']),
  ]
  const before = new Set(input.flatMap((p) => p.variants.map((v) => v.sourceVariantId)))
  const out = dedupeVariantsAcrossProducts(input, SELKIRK_RULES)
  const after = out.products.flatMap((p) => p.variants.map((v) => v.sourceVariantId))

  assert.equal(after.length, new Set(after).size, 'no duplicates remain')
  assert.deepEqual(new Set(after), before, 'no SKU was lost')
})

test('breaks an exact tie against the shape-named listing', () => {
  // VANGUARD Power Air and vanguard-air-s2 carry the same five SKUs, so variant
  // count cannot decide. The family name should win over the shape sub-page.
  const out = dedupeVariantsAcrossProducts(
    [product('vanguard-air-s2', ['1', '2', '3', '4', '5']),
     product('vanguard-power-air', ['1', '2', '3', '4', '5'])],
    SELKIRK_RULES,
  )

  assert.equal(out.products.length, 1)
  assert.equal(out.products[0]!.handle, 'vanguard-power-air')
})

test('inherits the shelves of a listing it absorbs', () => {
  // Collection handles drive skill-tier and play-style resolution, so dropping
  // the sub-page must not discard the shelves only it appeared on.
  const out = dedupeVariantsAcrossProducts(
    [
      product('amped-control', ['a'], ['pickleball-paddles', 'control']),
      product('amped-control-epic', ['a'], ['epic-paddles', 'advanced-paddles']),
    ],
    SELKIRK_RULES,
  )

  assert.equal(out.products.length, 1)
  assert.deepEqual(
    [...out.products[0]!.categoryHandles].sort(),
    ['advanced-paddles', 'control', 'epic-paddles', 'pickleball-paddles'],
  )
})

test('keeps a partially-duplicated listing, minus the SKUs it lost', () => {
  const out = dedupeVariantsAcrossProducts(
    [
      product('umbrella', ['a', 'b', 'c']),
      product('other-epic', ['a', 'own1', 'own2']),
    ],
    SELKIRK_RULES,
  )

  assert.equal(out.products.length, 2)
  const other = out.products.find((p) => p.handle === 'other-epic')!
  assert.deepEqual(
    other.variants.map((v) => v.sourceVariantId),
    ['own1', 'own2'],
    'keeps only the SKUs it exclusively owns',
  )
  assert.equal(out.droppedProducts, 0)
})

test('is deterministic — a second pass changes nothing', () => {
  const input = [
    product('amped-pro-air', ['1', '2', '3']),
    product('amped-pro-air-epic-pickleball-paddle', ['1', '2']),
  ]
  const once = dedupeVariantsAcrossProducts(input, SELKIRK_RULES)
  const twice = dedupeVariantsAcrossProducts(once.products, SELKIRK_RULES)

  assert.equal(twice.movedVariants, 0)
  assert.deepEqual(
    twice.products.map((p) => p.handle),
    once.products.map((p) => p.handle),
  )
})
