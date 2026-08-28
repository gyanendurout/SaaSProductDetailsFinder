import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { extractVariantAttributes } from '../src/normalize/attributes.js'
import { resolveModel } from '../src/normalize/model-resolver.js'
import { classifyAssortment } from '../src/normalize/assortment.js'
import { classifyCategory, resolveSkillTier, resolvePlayStyle } from '../src/normalize/taxonomy.js'
import { JOOLA_RULES } from '../src/config/brands/joola.js'
import { SELKIRK_RULES } from '../src/config/brands/selkirk.js'
import { lineMap } from '../src/config/brands/types.js'
import type { RawProduct, RawVariant } from '../src/sources/types.js'

const LINES = lineMap(JOOLA_RULES)
const SK_LINES = lineMap(SELKIRK_RULES)

function product(overrides: Partial<RawProduct> = {}): RawProduct {
  return {
    sourceProductId: '1',
    handle: 'test',
    title: 'JOOLA Test Pickleball Paddle',
    tags: [],
    url: 'https://joola.com/products/test',
    variants: [],
    categoryHandles: [],
    ...overrides,
  }
}

function variant(overrides: Partial<RawVariant> = {}): RawVariant {
  return {
    sourceVariantId: 'v1',
    options: [],
    price: 199.95,
    compareAtPrice: null,
    currency: 'USD',
    isAvailable: true,
    ...overrides,
  }
}

// =============================================================================
// The central problem: the same physical hierarchy modelled two different ways.
// =============================================================================
describe('thickness resolves from either modelling', () => {
  test('reads an explicit Size option (how Pro V is modelled)', () => {
    const p = product({ title: 'JOOLA Perseus Pro V Pickleball Paddle' })
    const v = variant({ options: [{ name: 'Size', value: '16mm' }] })
    const attrs = extractVariantAttributes(p, v)
    assert.equal(attrs.coreThicknessMm?.value, 16)
    assert.equal(attrs.coreThicknessMm?.source, 'source_option')
  })

  test('reads the product title (how Pro IV is modelled)', () => {
    const p = product({ title: 'JOOLA Perseus Pro IV 14mm Pickleball Paddle' })
    const attrs = extractVariantAttributes(p, variant())
    assert.equal(attrs.coreThicknessMm?.value, 14)
    assert.equal(attrs.coreThicknessMm?.source, 'title')
  })

  test('an option outranks the title when they disagree', () => {
    const p = product({ title: 'JOOLA Perseus Pro IV 14mm Pickleball Paddle' })
    const v = variant({ options: [{ name: 'Size', value: '16mm' }] })
    assert.equal(extractVariantAttributes(p, v).coreThicknessMm?.value, 16)
  })

  test('falls back to PDP prose when every mention agrees', () => {
    const p = product({
      title: 'JOOLA Dash Pickleball Paddle',
      bodyHtml: '<p>A 10mm core.</p><p>The 10mm build is forgiving.</p>',
    })
    const attrs = extractVariantAttributes(p, variant())
    assert.equal(attrs.coreThicknessMm?.value, 10)
    assert.equal(attrs.coreThicknessMm?.source, 'pdp')
  })

  test('refuses PDP prose when mentions disagree', () => {
    const p = product({
      title: 'JOOLA Something Paddle',
      bodyHtml: '<p>Available in 14mm and 16mm.</p>',
    })
    assert.equal(extractVariantAttributes(p, variant()).coreThicknessMm, null)
  })

  test('ignores millimetre values that are not a core thickness', () => {
    const p = product({ title: 'JOOLA Paddle with 140mm handle' })
    assert.equal(extractVariantAttributes(p, variant()).coreThicknessMm, null)
  })
})

describe('colourway and endorsing player', () => {
  test('splits the athlete out of the colour option', () => {
    const v = variant({ options: [{ name: 'Color', value: 'Blaze Red (Ben Johns)' }] })
    const attrs = extractVariantAttributes(product(), v)
    assert.equal(attrs.colorway?.value, 'Blaze Red')
    assert.equal(attrs.endorsedPlayer?.value, 'Ben Johns')
  })

  test('splits a two-tone colourway', () => {
    const p = product({
      title: 'JOOLA Perseus Pro IV 16mm Pickleball Paddle - Tropical Red/Pink',
    })
    const attrs = extractVariantAttributes(p, variant())
    assert.equal(attrs.colorPrimary, 'Tropical Red')
    assert.equal(attrs.colorSecondary, 'Pink')
  })

  test('a signature edition in the title suffix is a player, not a colourway', () => {
    const p = product({
      title: 'JOOLA Hyperion Pro IV 16mm Pickleball Paddle - Simone Jardim',
    })
    const attrs = extractVariantAttributes(p, variant(), JOOLA_RULES)
    assert.equal(attrs.colorway, null)
    assert.equal(attrs.endorsedPlayer?.value, 'Simone Jardim')
  })

  test('a two-word colourway is still a colourway', () => {
    // Guards the fix above: 'Mellow Mango' has the same shape as a person name.
    const p = product({
      title: 'JOOLA Hyperion Pro IV 14mm Pickleball Paddle - Mellow Mango',
    })
    const attrs = extractVariantAttributes(p, variant(), JOOLA_RULES)
    assert.equal(attrs.colorway?.value, 'Mellow Mango')
  })

  test('does not mistake a non-name parenthetical for an athlete', () => {
    const v = variant({ options: [{ name: 'Color', value: 'Blue (16mm)' }] })
    assert.equal(extractVariantAttributes(product(), v).endorsedPlayer, null)
  })
})

describe('model resolution', () => {
  test('strips a generation suffix from a series tag', () => {
    const p = product({
      title: 'JOOLA Hyperion 3S Dual 16mm Pickleball Paddle',
      tags: ['3s', 'hyperion-3-series', 'hyperion-series'],
    })
    const m = resolveModel(p, JOOLA_RULES, LINES)
    assert.equal(m.productLineName, 'Hyperion')
    assert.equal(m.generationName, '3S')
    assert.equal(m.subLine, 'Dual')
  })

  test('prefers the line the title names first over a co-tagged edition', () => {
    const p = product({
      title: 'JOOLA Hyperion Double Vision Pickleball Paddle',
      tags: ['hyperion-series', 'vision-series'],
    })
    const m = resolveModel(p, JOOLA_RULES, LINES)
    assert.equal(m.productLineName, 'Hyperion')
    assert.equal(m.subLine, 'Double Vision')
  })

  test('does not turn an athlete name into a product line', () => {
    const p = product({ title: 'JOOLA Ben Johns Hyperion CGS 16 Pickleball Paddle', tags: [] })
    const m = resolveModel(p, JOOLA_RULES, LINES)
    assert.equal(m.productLineName, 'Hyperion')
  })

  test('leaves a multi-line bundle without a product line', () => {
    const p = product({
      title: 'JOOLA Agassi/Graf Champion Pickleball Pack',
      tags: ['agassi', 'graf', 'paddle-sets'],
    })
    assert.equal(resolveModel(p, JOOLA_RULES, LINES).productLineName, null)
  })

  test('a generation-less line reports no generation rather than guessing', () => {
    const p = product({ title: 'JOOLA Beacon Pickleball Paddle', tags: ['recreational-pickleball-paddles'] })
    const m = resolveModel(p, JOOLA_RULES, LINES)
    assert.equal(m.generationName, null)
    assert.equal(m.skillTier, 'recreational')
  })

  test('resolves the generation from collection membership', () => {
    const p = product({
      title: 'JOOLA Hyperion Pro V Pickleball Paddle',
      tags: ['hyperion-series'],
      categoryHandles: ['pro-v'],
    })
    assert.equal(resolveModel(p, JOOLA_RULES, LINES).generationName, 'Pro V')
  })
})

describe('skill tier vs generation', () => {
  test('the pro-iv collection is a generation, not the Pro tier', () => {
    assert.equal(classifyCategory({ sourceCategoryId: '1', handle: 'pro-iv', title: 'Pro IV' }), 'generation')
  })

  test('the professional collection is a skill tier', () => {
    assert.equal(
      classifyCategory({
        sourceCategoryId: '2',
        handle: 'professional-pickleball-paddles',
        title: 'Pro',
      }),
      'skill_tier',
    )
  })

  test('membership of pro-iv alone does not imply the Pro tier', () => {
    assert.equal(resolveSkillTier([], ['pro-iv'], JOOLA_RULES), 'unknown')
  })

  test('a collection outranks a tag', () => {
    assert.equal(
      resolveSkillTier(['recreational-pickleball-paddles'], ['professional-pickleball-paddles'], JOOLA_RULES),
      'pro',
    )
  })
})

describe('assortment gate', () => {
  test('keeps a tagged paddle', () => {
    const p = product({ title: 'JOOLA Perseus Pro V', tags: ['pickleball-paddles'] })
    assert.equal(classifyAssortment(p).isInAssortment, true)
  })

  test('drops a bag that leaked in from the sale collection', () => {
    assert.equal(classifyAssortment(product({ title: 'JOOLA Tour Elite Duffel Bag' })).isInAssortment, false)
  })

  test('drops table-tennis stock sharing the store', () => {
    assert.equal(classifyAssortment(product({ title: 'JOOLA Rhyzen Table Tennis Rubber' })).isInAssortment, false)
  })

  test('keeps a paddle bundle but flags it', () => {
    const verdict = classifyAssortment(
      product({ title: 'JOOLA Dash Pickleball Pack', tags: ['paddle-sets'] }),
    )
    assert.equal(verdict.isInAssortment, true)
    assert.equal(verdict.isBundle, true)
  })
})

// =============================================================================
// Selkirk — structurally the opposite of JOOLA. These pin the behaviours that
// forced the resolver to become brand-driven.
// =============================================================================
describe('Selkirk', () => {
  test('a brand with no generations reports none rather than guessing', () => {
    const p = product({ title: 'Selkirk LUXX Control Air with InfiniGrit', tags: ['paddles'] })
    const m = resolveModel(p, SELKIRK_RULES, SK_LINES)
    assert.equal(m.productLineName, 'LUXX')
    assert.equal(m.generationName, null)
    // No generation penalty for a brand that does not use them.
    assert.ok(m.confidence >= 0.9, `confidence was ${m.confidence}`)
  })

  test('maps Selkirk "advanced" onto the same tier as JOOLA "pro"', () => {
    assert.equal(resolveSkillTier(['advanced'], [], SELKIRK_RULES), 'pro')
    assert.equal(resolveSkillTier(['intermediate'], [], SELKIRK_RULES), 'performance')
    assert.equal(resolveSkillTier(['beginner'], [], SELKIRK_RULES), 'recreational')
  })

  test('reads play style, which JOOLA does not have', () => {
    assert.equal(resolvePlayStyle(['control', 'paddles'], [], SELKIRK_RULES), 'control')
    assert.equal(resolvePlayStyle(['power'], [], SELKIRK_RULES), 'power')
    assert.equal(resolvePlayStyle(['hybrid'], [], SELKIRK_RULES), 'hybrid')
    // JOOLA has no play-style vocabulary, so it must not invent one.
    assert.equal(resolvePlayStyle(['power'], [], JOOLA_RULES), 'unknown')
  })

  test('decodes proprietary shape names from the Shape option', () => {
    const p = product({ title: 'Selkirk AMPED Pro Air - Epic - Pickleball Paddle' })
    // 'Invikta' is a Selkirk shape name, not a product line.
    const v = variant({ options: [{ name: 'Shape', value: 'Invikta' }] })
    const attrs = extractVariantAttributes(p, v, SELKIRK_RULES)
    assert.equal(attrs.shape?.value, 'elongated')
    assert.equal(attrs.shape?.source, 'source_option')
  })

  test('records a weight BAND as its midpoint, not one end of it', () => {
    const v = variant({ options: [{ name: 'Weight', value: 'Lightweight (7.6-8.0 oz)' }] })
    const attrs = extractVariantAttributes(product(), v, SELKIRK_RULES)
    // Midpoint 7.8 oz -> ~221.1 g. Taking the 8.0 that sits next to the unit
    // would overstate every light paddle by half an ounce.
    assert.ok(attrs.weightGrams !== null)
    assert.ok(Math.abs(attrs.weightGrams!.value - 221.1) < 1, `got ${attrs.weightGrams!.value}`)
    assert.equal(attrs.weightGrams!.confidence, 0.7, 'a band is less certain than a figure')
  })

  test('records an exact ounce weight at higher confidence', () => {
    const v = variant({ options: [{ name: 'Weight', value: '8.0 oz' }] })
    const attrs = extractVariantAttributes(product(), v, SELKIRK_RULES)
    assert.ok(Math.abs(attrs.weightGrams!.value - 226.8) < 1)
    assert.equal(attrs.weightGrams!.confidence, 0.9)
  })

  test('parses a gram weight, which a corrupted regex once made impossible', () => {
    const v = variant({ options: [{ name: 'Weight', value: '225g' }] })
    assert.equal(extractVariantAttributes(product(), v, SELKIRK_RULES).weightGrams?.value, 225)
  })

  test('does not leak a Selkirk line into JOOLA resolution', () => {
    const p = product({ title: 'Selkirk VANGUARD Power Air', tags: ['paddles'] })
    // Resolved with JOOLA rules, VANGUARD is not a known line — it must be
    // discovered, not mismatched onto a JOOLA line.
    const m = resolveModel(p, JOOLA_RULES, LINES)
    assert.notEqual(m.productLineName, 'Perseus')
  })
})
