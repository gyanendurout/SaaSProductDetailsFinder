import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_REVIEW_PAGE_SIZE,
  REVIEW_PAGE_SIZES,
  clampPageSize,
  lastPageOf,
  pageAfterResize,
  pageWindow,
} from '../src/lib/pagination.js'

test('page size: every offered size is accepted', () => {
  for (const size of REVIEW_PAGE_SIZES) {
    assert.equal(clampPageSize(String(size)), size)
  }
})

test('page size: anything not offered falls back to the default', () => {
  // Not clamped into range — a value the dropdown cannot display would leave
  // the control showing a size the list is not actually using.
  for (const bad of ['99', '0', '-20', '1000', 'abc', '', undefined, null, '20.5']) {
    assert.equal(clampPageSize(bad), DEFAULT_REVIEW_PAGE_SIZE, `${String(bad)} should fall back`)
  }
})

test('page window: a short list is shown whole, with no gaps', () => {
  assert.deepEqual(pageWindow(1, 5), [1, 2, 3, 4, 5])
  assert.deepEqual(pageWindow(3, 5), [1, 2, 3, 4, 5])
})

test('page window: the first and last page are always reachable', () => {
  const tokens = pageWindow(500, 1039)
  assert.equal(tokens[0], 1)
  assert.equal(tokens[tokens.length - 1], 1039)
  assert.ok(tokens.includes(500))
})

test('page window: a run of hidden pages collapses to one gap', () => {
  assert.deepEqual(pageWindow(50, 100), [1, 'gap', 48, 49, 50, 51, 52, 'gap', 100])
})

test('page window: a gap is never used to hide a single page', () => {
  // 1 … 3 4 5 would waste the ellipsis on page 2; show the number instead.
  assert.deepEqual(pageWindow(4, 20), [1, 2, 3, 4, 5, 6, 'gap', 20])
})

test('page window: no page is ever listed twice', () => {
  for (const current of [1, 2, 3, 50, 998, 999, 1000]) {
    const numbers = pageWindow(current, 1000).filter((t): t is number => t !== 'gap')
    assert.equal(new Set(numbers).size, numbers.length, `duplicate at page ${current}`)
  }
})

test('page window: tokens stay in ascending order', () => {
  const numbers = pageWindow(77, 500).filter((t): t is number => t !== 'gap')
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b))
})

test('page window: a single page yields just that page', () => {
  assert.deepEqual(pageWindow(1, 1), [1])
})

test('resize: the first row on screen stays on screen', () => {
  // Page 5 of 20 starts at row 80. At 50 per page row 80 is on page 2.
  assert.equal(pageAfterResize(5, 20, 50), 2)
  // And back again: page 2 of 50 starts at row 50, which is page 3 of 20.
  assert.equal(pageAfterResize(2, 50, 20), 3)
})

test('resize: page 1 stays page 1 at any size', () => {
  for (const from of REVIEW_PAGE_SIZES) {
    for (const to of REVIEW_PAGE_SIZES) {
      assert.equal(pageAfterResize(1, from, to), 1)
    }
  }
})

test('resize: a deep page survives a growing page size', () => {
  // Page 1000 of 20 starts at row 19,980, which is page 200 of 100.
  assert.equal(pageAfterResize(1000, 20, 100), 200)
})

test('last page: an empty result set is page 1 of 1, not page 1 of 0', () => {
  assert.equal(lastPageOf(0, 20), 1)
})

test('last page: a partial final page is counted', () => {
  assert.equal(lastPageOf(21, 20), 2)
  assert.equal(lastPageOf(20, 20), 1)
  assert.equal(lastPageOf(20771, 20), 1039)
  assert.equal(lastPageOf(20771, 100), 208)
})
