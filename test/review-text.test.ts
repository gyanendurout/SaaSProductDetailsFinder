import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brandsNamedIn, defectsIn, readsAsSwitch, reviewText } from '../src/lib/review-text.js'
import { ownershipRank, perceptionOf, wasReturningBuyer } from '../src/lib/review-context.js'

test('text: the parts a reviewer filled in are joined, the empty ones skipped', () => {
  assert.equal(reviewText(['Title', null, '', 'Body']), 'Title \n Body')
  assert.equal(reviewText([null, undefined]), '')
})

test('defects: real failure language is caught', () => {
  assert.deepEqual(defectsIn('The face started to delaminate after a month'), ['delamination'])
  assert.deepEqual(defectsIn('there is a dead spot near the throat'), ['dead_spot'])
  assert.ok(defectsIn('the paddle cracked at the edge').includes('cracked'))
})

test('defects: praise that merely contains the words is NOT a defect', () => {
  // This is the whole reason the vocabulary is narrow. 'dead' and 'soft' are
  // compliments in this category and matching them bare would bury the signal.
  for (const praise of [
    'dead accurate placement every time',
    'lovely soft hands at the kitchen',
    'great pop off the face',
    'the sweet spot is huge',
  ]) {
    assert.deepEqual(defectsIn(praise), [], `false positive on: ${praise}`)
  }
})

test('defects: one review can carry several distinct failures', () => {
  const found = defectsIn('It cracked and now there is a dead spot too')
  assert.ok(found.includes('cracked'))
  assert.ok(found.includes('dead_spot'))
})

test('defects: empty text finds nothing', () => {
  assert.deepEqual(defectsIn(''), [])
})

test('mentions: another brand named in the prose is picked up', () => {
  assert.deepEqual(brandsNamedIn('Much better than my old JOOLA', 'selkirk'), ['joola'])
})

test('mentions: the brand being reviewed is never its own competitor', () => {
  // "my third Selkirk" is loyalty. Counting it would make every brand its own
  // biggest rival and the conquest map meaningless.
  assert.deepEqual(brandsNamedIn('This is my third Selkirk and the best yet', 'selkirk'), [])
})

test('mentions: several rivals in one review are all captured', () => {
  const found = brandsNamedIn('Tried the CRBN and the Vatic before this', 'joola')
  assert.deepEqual(found.sort(), ['crbn', 'vatic'])
})

test('mentions: ambiguous common words are deliberately not brands', () => {
  // Head, Legacy, Prince and Vulcan are real brands and ordinary English. They
  // are excluded on purpose; these must not match anything.
  for (const text of [
    'the head of the paddle is balanced',
    'a worthy legacy of the original',
    'the prince of dinking',
  ]) {
    assert.deepEqual(brandsNamedIn(text, 'joola'), [], `false positive on: ${text}`)
  }
})

test('switch: directional language separates a switch from a mention', () => {
  assert.equal(readsAsSwitch('I switched from my CRBN to this'), true)
  assert.equal(readsAsSwitch('upgraded from the older model'), true)
  assert.equal(readsAsSwitch('my previous paddle was heavier'), true)
  // Naming a rival without arriving from it is ambient comparison, not conquest.
  assert.equal(readsAsSwitch('plays a lot like a CRBN does'), false)
})

test('perception: the Okendo scale maps into thirds, so the middle is hybrid', () => {
  const scale = ['Power paddle', 'Hybrid paddle', 'Control paddle']
  const key = 'Would you consider this paddle a power paddle, hybrid paddle or control paddle'
  assert.equal(perceptionOf({ [key]: { scale, value: -1 } }), 'power')
  assert.equal(perceptionOf({ [key]: { scale, value: 0 } }), 'hybrid')
  assert.equal(perceptionOf({ [key]: { scale, value: 1 } }), 'control')
  assert.equal(perceptionOf({ [key]: { scale, value: -0.2 } }), 'hybrid')
})

test('perception: a malformed or absent answer is null, never a default', () => {
  assert.equal(perceptionOf(null), null)
  assert.equal(perceptionOf({}), null)
  assert.equal(perceptionOf({ other: 'thing' }), null)
})

test('returning buyer: reads the brand-own option out of the scale', () => {
  const key = 'Was your previous paddle a Selkirk paddle or other brand?'
  const scale = ['Selkirk paddle', 'Other brand']
  assert.equal(wasReturningBuyer({ [key]: { scale, value: -1 } }), true)
  assert.equal(wasReturningBuyer({ [key]: { scale, value: 1 } }), false)
  assert.equal(wasReturningBuyer(null), null)
})

test('ownership buckets order from newest owner to longest', () => {
  const ranks = ['less than a month', '1-6 months', '6-12 months', 'more than a year']
    .map(ownershipRank)
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b))
})
