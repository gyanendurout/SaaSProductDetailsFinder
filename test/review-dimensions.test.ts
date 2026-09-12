import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agreedValue,
  formatShape,
  formatThickness,
  resolveShape,
  resolveThickness,
  shapeFromLabel,
  thicknessFromLabel,
} from '../src/lib/review-dimensions.js'

test('shape from label: the real labels the platforms publish', () => {
  assert.equal(shapeFromLabel('Elongated / Canyon Clay'), 'elongated')
  assert.equal(shapeFromLabel('Widebody / 1776 Limited Edition'), 'widebody')
  assert.equal(shapeFromLabel('Wide Body / Black'), 'widebody')
})

test('shape from label: wide body is matched before the bare words', () => {
  // 'Widebody' contains no standalone 'body' token, but a naive ordering that
  // tested 'standard' or 'square' first would still be wrong on a label naming
  // both. The longest phrase has to win.
  assert.equal(shapeFromLabel('Widebody Standard Grip'), 'widebody')
})

test('shape from label: a colourway that is not a shape resolves to null', () => {
  for (const label of ['Selkirk Red', 'Shadow Gray', 'Catherine', 'Gift', null, undefined, '']) {
    assert.equal(shapeFromLabel(label), null, `${String(label)} is not a shape`)
  }
})

test('thickness from label: mm is read with or without a space', () => {
  assert.equal(thicknessFromLabel('16mm / Blaze Red'), 16)
  assert.equal(thicknessFromLabel('14 mm / Black'), 14)
  assert.equal(thicknessFromLabel('14.3mm'), 14.3)
})

test('thickness from label: a number outside core range is not a core thickness', () => {
  // A grip length or an edition year sitting next to 'mm' must not become a
  // thickness. Cores run about 10-25mm.
  assert.equal(thicknessFromLabel('40mm grip'), null)
  assert.equal(thicknessFromLabel('2023 Edition'), null)
})

test('agreed value: SKUs that agree give that value', () => {
  assert.equal(agreedValue(['elongated', 'elongated', 'elongated']), 'elongated')
  assert.equal(agreedValue([16, 16]), 16)
})

test('agreed value: SKUs that disagree give null, never a winner', () => {
  // This is the load-bearing case. A listing selling 14mm and 16mm tells us
  // nothing about which one a given reviewer bought, and picking the more
  // common one would manufacture a fact.
  assert.equal(agreedValue([14, 16]), null)
  assert.equal(agreedValue(['elongated', 'widebody']), null)
})

test('agreed value: unknown and null are absent, not values', () => {
  assert.equal(agreedValue(['unknown', 'elongated', null]), 'elongated')
  assert.equal(agreedValue(['unknown', null, undefined]), null)
  assert.equal(agreedValue([]), null)
})

test('agreed value: one real value among unknowns still counts as agreement', () => {
  assert.equal(agreedValue([null, 16, null]), 16)
})

test('resolution: the review label beats the listing', () => {
  // The label describes the SKU this reviewer actually bought; the listing is
  // only an inference from the SKUs on sale.
  assert.equal(resolveShape('Widebody / Black', 'elongated'), 'widebody')
  assert.equal(resolveThickness('14mm / Red', 16), 14)
})

test('resolution: the listing is used when the label names nothing', () => {
  assert.equal(resolveShape('Canyon Clay', 'elongated'), 'elongated')
  assert.equal(resolveThickness('Canyon Clay', 16), 16)
})

test('resolution: nothing known stays null', () => {
  assert.equal(resolveShape('Canyon Clay', null), null)
  assert.equal(resolveThickness(null, null), null)
})

test('formatting: null reads as Not recorded, not as a blank or a zero', () => {
  assert.equal(formatShape(null), 'Not recorded')
  assert.equal(formatThickness(null), 'Not recorded')
})

test('formatting: whole millimetres lose the decimal, fractional keep it', () => {
  assert.equal(formatThickness(16), '16mm')
  assert.equal(formatThickness(14.3), '14.3mm')
})

test('formatting: widebody is written as two words for a reader', () => {
  assert.equal(formatShape('widebody'), 'Wide body')
  assert.equal(formatShape('elongated'), 'Elongated')
})
