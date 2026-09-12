import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHANGE_EVENT_TYPES, changeValue, eventLabel, vocabLabel } from '../src/lib/format.js'
import { ownershipLabel, ownershipRank } from '../src/lib/review-context.js'

/**
 * These pin the places where a stored column value was reaching the page as-is:
 * "in_stock", "widebody", "1month", and a price rendered as the bare string
 * "179.99" with no currency on it.
 */

test('change values: a price move carries a currency symbol', () => {
  assert.equal(changeValue('price_increase', '179.99'), '$179.99')
  assert.equal(changeValue('price_decrease', '129.00'), '$129.00')
  assert.equal(changeValue('listed', '249.99'), '$249.99')
  assert.equal(changeValue('delisted', '99.5'), '$99.50')
})

test('change values: a stockout reads as words, not as column values', () => {
  assert.equal(changeValue('went_oos', 'in_stock'), 'In stock')
  assert.equal(changeValue('went_oos', 'out_of_stock'), 'Out of stock')
  assert.equal(changeValue('back_in_stock', 'in_stock'), 'In stock')
})

test('change values: a discount already carries its own unit and is left alone', () => {
  assert.equal(changeValue('discount_started', '20%'), '20%')
  assert.equal(changeValue('discount_deepened', '35%'), '35%')
})

test('change values: a missing side of the comparison renders as a dash', () => {
  // discount_started has no "before", delisted has no "after".
  assert.equal(changeValue('discount_started', null), '—')
  assert.equal(changeValue('delisted', null), '—')
  assert.equal(changeValue('price_increase', ''), '—')
})

test('change values: an unknown event type passes its value through untouched', () => {
  assert.equal(changeValue('category_added', 'Best Sellers'), 'Best Sellers')
})

test('change types: the chips and the table label every type the same way', () => {
  // The chips iterate CHANGE_EVENT_TYPES; the table looks each row's type up in
  // the same map. Deriving the list from the map is what keeps a newly written
  // event type from appearing in the table with no chip above it.
  assert.ok(CHANGE_EVENT_TYPES.length >= 11)
  for (const type of ['price_increase', 'went_oos', 'discount_started']) {
    assert.ok(CHANGE_EVENT_TYPES.includes(type), `${type} missing from the chip list`)
    assert.notEqual(eventLabel(type), type, `${type} has no label`)
  }
  // 'listed' and 'delisted' are already the words; a label the same as the code
  // is correct there, which is why the check above is not applied to all of them.
  assert.equal(eventLabel('listed'), 'listed')
})

test('vocabulary: codes become words', () => {
  assert.equal(vocabLabel('power'), 'Power')
  assert.equal(vocabLabel('all_court'), 'All-court')
  assert.equal(vocabLabel('widebody'), 'Wide body')
  assert.equal(vocabLabel('performance'), 'Performance')
})

test('vocabulary: a missing code is Unknown rather than blank', () => {
  assert.equal(vocabLabel(null), 'Unknown')
  assert.equal(vocabLabel(undefined), 'Unknown')
  assert.equal(vocabLabel(''), 'Unknown')
})

/**
 * The ownership ordering matched prose ("less than a month") while Bazaarvoice
 * stores codes ("1month"). Nothing matched, every bucket tied on the fallback,
 * and the table fell back to arrival order — which the caption then invited the
 * reader to read as a durability curve.
 */
test('ownership: the codes actually stored sort shortest-first', () => {
  const stored = ['1month', '1week', '3months', '6months', '1year']
  const sorted = [...stored].sort((a, b) => ownershipRank(a) - ownershipRank(b))
  assert.deepEqual(sorted, ['1week', '1month', '3months', '6months', '1year'])
})

test('ownership: no stored code falls through to the unrecognised rank', () => {
  // A tie on the fallback rank is precisely what produced the volume ordering.
  for (const code of ['1week', '1month', '3months', '6months', '1year']) {
    assert.ok(ownershipRank(code) < 6, `${code} is unranked`)
  }
})

test('ownership: the prose forms rank alongside the codes', () => {
  assert.equal(ownershipRank('Less than a month'), ownershipRank('1month'))
  assert.equal(ownershipRank('6-12 months'), ownershipRank('6months'))
  assert.equal(ownershipRank('More than 2 years'), ownershipRank('2years'))
})

test('ownership: buckets are labelled in words', () => {
  assert.equal(ownershipLabel('1week'), '1 week')
  assert.equal(ownershipLabel('3months'), '3 months')
  assert.equal(ownershipLabel('1year'), '1 year')
})

test('ownership: an unrecognised bucket is shown as stored rather than guessed', () => {
  // Inventing a label for a value nobody has seen would put a claim in the
  // table that the data does not support.
  assert.equal(ownershipLabel('18months'), '18months')
  assert.equal(ownershipRank('18months'), 6)
})
