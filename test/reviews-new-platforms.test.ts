import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseJsonReview, type JudgeMeJsonReview } from '../src/sources/reviews/judgeme.js'
import { parseYotpoReview, type YotpoReview } from '../src/sources/reviews/yotpo.js'
import { buildReviewAdapter, REVIEW_PLATFORMS } from '../src/sources/reviews/index.js'
import { PoliteClient } from '../src/lib/http.js'
import { LOCAL_SITES } from '../src/config/sites.js'

/**
 * The two review shapes added with Six Zero, Paddletek and GAMMA.
 *
 * Both fixtures are real payloads, trimmed: the Judge.me one from
 * us.sixzeropickleball.com, the Yotpo one from gammasports.com, both captured
 * 2026-09-12.
 *
 * The cases worth pinning are the ones that fail silently rather than loudly —
 * a shop answering in the shape the adapter does not expect returns zero
 * reviews, which the pipeline records as "this product has no reviews" and then
 * carries forward as fact.
 */

// --- Judge.me, structured JSON shape ----------------------------------------

const SIXZERO_REVIEW: JudgeMeJsonReview = {
  uuid: '885df91b-c77f-40c6-8f2b-77f6a3fa80a5',
  title: 'Opal Boulder',
  rating: 5,
  body_html: '<p>Best paddle you’ve made so far!</p>',
  verified_buyer: true,
  created_at: '2026-09-11T22:25:13.357Z',
  reviewer_name: 'Anonymous',
  is_anonymous_reviewer: true,
  location: '(United States)',
  location_country: 'United States',
  thumb_up: 3,
  thumb_down: 1,
  pictures_urls: [{ original: 'a.jpg' }, { original: 'b.jpg' }],
  video_external_ids: [],
  reply_content: null,
  product_variant_title: '14mm / Hybrid',
  language: 'en',
  cf_answers: [],
}

test('judge.me json: maps the structured shape onto a raw review', () => {
  const r = parseJsonReview(SIXZERO_REVIEW, 'p-1')
  assert.ok(r)
  assert.equal(r.sourceReviewId, '885df91b-c77f-40c6-8f2b-77f6a3fa80a5')
  assert.equal(r.rating, 5)
  assert.equal(r.title, 'Opal Boulder')
  assert.equal(r.authorName, 'Anonymous')
  assert.equal(r.isVerifiedBuyer, true)
  assert.equal(r.helpfulCount, 3)
  assert.equal(r.unhelpfulCount, 1)
  assert.equal(r.photoCount, 2)
  assert.equal(r.variantLabel, '14mm / Hybrid')
  assert.equal(r.submittedAt, '2026-09-11T22:25:13.357Z')
})

test('judge.me json: body_html becomes text, entities and all', () => {
  // Stored as markup by the platform. A review rendered as literal '<p>' tags
  // in the dashboard is the visible failure; '&amp;' surviving is the quiet one.
  const r = parseJsonReview(
    { ...SIXZERO_REVIEW, body_html: '<p>Light &amp; powerful.</p><p>Worth it.</p>' },
    'p-1',
  )
  assert.equal(r?.body, 'Light & powerful.\n\nWorth it.')
})

test('judge.me json: the location parentheses are presentation, not data', () => {
  const r = parseJsonReview(SIXZERO_REVIEW, 'p-1')
  assert.equal(r?.authorLocation, 'United States')
})

test('judge.me json: a review with no words is ratings-only', () => {
  const r = parseJsonReview({ ...SIXZERO_REVIEW, title: '', body_html: '' }, 'p-1')
  assert.equal(r?.isRatingsOnly, true)
  assert.equal(r?.body, null)
  assert.equal(r?.title, null)
})

test('judge.me json: a populated reply becomes a response, an empty one does not', () => {
  const withReply = parseJsonReview(
    { ...SIXZERO_REVIEW, reply_content: '<p>Thanks for playing!</p>', shop_reply_name: 'Six Zero' },
    'p-1',
  )
  assert.equal(withReply?.responses.length, 1)
  assert.equal(withReply?.responses[0]?.body, 'Thanks for playing!')
  assert.equal(withReply?.responses[0]?.authorName, 'Six Zero')

  for (const empty of [null, '', '   ']) {
    const r = parseJsonReview({ ...SIXZERO_REVIEW, reply_content: empty }, 'p-1')
    assert.equal(r?.responses.length, 0, `reply_content ${JSON.stringify(empty)} is not a reply`)
  }
})

test('judge.me json: a review without a uuid is dropped, not stored with a null id', () => {
  assert.equal(parseJsonReview({ ...SIXZERO_REVIEW, uuid: undefined }, 'p-1'), null)
})

// --- Yotpo ------------------------------------------------------------------

const GAMMA_REVIEW: YotpoReview = {
  id: 826527259,
  score: 5,
  votes_up: 2,
  votes_down: 0,
  content: 'Great touch with a solid sweet spot for power.',
  title: 'Great foam paddle with lots of touch!',
  sentiment: 0.98683125,
  created_at: '2026-04-03T14:38:52.000Z',
  deleted: false,
  verified_buyer: true,
  source_review_id: null,
  custom_fields: null,
  is_incentivized: false,
  incentive_type: null,
  images_data: null,
  comment: null,
  user: { user_id: 174934457, display_name: 'Ken C.' },
  language: 'en',
}

test('yotpo: maps a review, and the id survives as a string', () => {
  const r = parseYotpoReview(GAMMA_REVIEW, 'p-2')
  assert.ok(r)
  // Numeric in the payload; the natural key is text, and 826527259 must not
  // arrive as a number that stringifies differently later.
  assert.equal(r.sourceReviewId, '826527259')
  assert.equal(r.rating, 5)
  assert.equal(r.title, 'Great foam paddle with lots of touch!')
  assert.equal(r.authorName, 'Ken C.')
  assert.equal(r.authorId, '174934457')
  assert.equal(r.isVerifiedBuyer, true)
  assert.equal(r.helpfulCount, 2)
  assert.equal(r.submittedAt, '2026-04-03T14:38:52.000Z')
  assert.equal(r.languageCode, 'en')
})

test('yotpo: sentiment is kept — no other platform here ships one', () => {
  const r = parseYotpoReview(GAMMA_REVIEW, 'p-2')
  assert.equal(r?.contextData['sentiment'], 0.98683125)
})

test('yotpo: a zero score is a rating, not a missing one', () => {
  // `score: 0` is falsy. A truthiness check here would turn a real rating into
  // a null and quietly lift the product's average.
  const r = parseYotpoReview({ ...GAMMA_REVIEW, score: 0 }, 'p-2')
  assert.equal(r?.rating, 0)
})

test('yotpo: a brand comment becomes a response with its own id and date', () => {
  const r = parseYotpoReview(
    {
      ...GAMMA_REVIEW,
      comment: {
        id: 55,
        content: 'Glad you are enjoying it!',
        created_at: '2026-04-05T10:00:00.000Z',
        user: { display_name: 'GAMMA Support' },
      },
    },
    'p-2',
  )
  assert.equal(r?.responses.length, 1)
  assert.equal(r?.responses[0]?.sourceResponseId, '55')
  assert.equal(r?.responses[0]?.authorName, 'GAMMA Support')
  assert.equal(r?.responses[0]?.respondedAt, '2026-04-05T10:00:00.000Z')
})

test('yotpo: an imported review is marked syndicated', () => {
  // source_review_id is set only when Yotpo pulled the review from elsewhere.
  const own = parseYotpoReview(GAMMA_REVIEW, 'p-2')
  assert.equal(own?.isSyndicated, null)
  const imported = parseYotpoReview({ ...GAMMA_REVIEW, source_review_id: 'ext-9' }, 'p-2')
  assert.equal(imported?.isSyndicated, true)
})

test('yotpo: a review with no id is dropped', () => {
  assert.equal(parseYotpoReview({ ...GAMMA_REVIEW, id: undefined }, 'p-2'), null)
})

// --- wiring -----------------------------------------------------------------

test('every configured review_platform resolves to an adapter', () => {
  const http = new PoliteClient()
  for (const site of LOCAL_SITES) {
    if (!site.review_platform) continue
    assert.ok(
      REVIEW_PLATFORMS.includes(site.review_platform as (typeof REVIEW_PLATFORMS)[number]),
      `${site.brand_slug} declares an unregistered platform "${site.review_platform}"`,
    )
    assert.ok(
      buildReviewAdapter(site.review_platform, http),
      `${site.brand_slug} has no adapter`,
    )
  }
})

test('yotpo sites carry the appKey their adapter requires', () => {
  // A missing key throws only once a crawl reaches the reviews stage, minutes
  // in. Config is checkable now.
  for (const site of LOCAL_SITES.filter((s) => s.review_platform === 'yotpo')) {
    assert.ok(
      site.review_config?.['appKey'],
      `${site.brand_slug} runs Yotpo but declares no appKey`,
    )
  }
})

test('judge.me sites carry a shopDomain matching their storefront', () => {
  for (const site of LOCAL_SITES.filter((s) => s.review_platform === 'judgeme')) {
    const shop = site.review_config?.['shopDomain']
    assert.ok(shop, `${site.brand_slug} runs Judge.me but declares no shopDomain`)
    // Six Zero's US store and its AU parent are different Judge.me shops on
    // similar hosts; pointing at the wrong one returns 404 and zero reviews.
    assert.equal(
      shop,
      new URL(site.base_url).host,
      `${site.brand_slug} shopDomain does not match base_url`,
    )
  }
})
