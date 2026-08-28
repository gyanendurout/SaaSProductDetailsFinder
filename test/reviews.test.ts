import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseReviewBlocks } from '../src/sources/reviews/judgeme.js'
import { toRawReview, type OkendoReview } from '../src/sources/reviews/okendo.js'
import { buildReviewAdapter, REVIEW_PLATFORMS } from '../src/sources/reviews/index.js'
import { PoliteClient } from '../src/lib/http.js'
import { LOCAL_SITES } from '../src/config/sites.js'

/**
 * These cover the three things that were actually wrong during development, and
 * the two that would fail silently if they broke.
 *
 * The Judge.me fixture is real markup captured from crbnpickleball.com, trimmed
 * to two reviews. It is the only adapter that parses HTML, so it is the only one
 * where a template change can turn a review into a null without any error.
 */

const JUDGEME_HTML = `<div class='jdgm-rev-widg__reviews'><div class='jdgm-rev jdgm-divider-top' data-verified-buyer='true' data-review-id='3c239d86-b372-4d71-adee-bd23968ff192' data-review-language='' data-product-title='CRBN4 TruFoam Barrage' data-thumb-up-count='2' data-thumb-down-count='1'> <div class='jdgm-rev__header'>  <div class='jdgm-rev__icon' > A </div>  <span class='jdgm-rev__rating' data-score='5' tabindex='0' aria-label='5 star review' role='img'> <span class='jdgm-star jdgm--on'></span> </span> <time class='jdgm-rev__timestamp jdgm-spinner' datetime='2026-08-27T18:29:10Z' data-content='2026-08-27 18:29:10 UTC'></time> <span class='jdgm-rev__author-wrapper'> <span class='jdgm-rev__author'>Ayesha Pardesi</span> <span class='jdgm-rev__location'  data-country-code="US" > (United States) </span> </span> </div> <div class='jdgm-rev__content'> <b class='jdgm-rev__title'>Light but mighty</b> <div class='jdgm-rev__body'><p>I love my new paddle! It is light &amp; powerful.</p></div> <div class='jdgm-rev__pics'></div> <div class='jdgm-rev__vids'></div> <div class='jdgm-rev__transparency-badge' data-badge-type=review_collected_via_store_invitation></div> </div> <div class='jdgm-rev__reply'></div> </div><div class='jdgm-rev jdgm-divider-top' data-verified-buyer='false' data-review-id='second-id-0002' data-thumb-up-count='0' data-thumb-down-count='0'> <div class='jdgm-rev__header'> <span class='jdgm-rev__rating' data-score='2' role='img'></span> <time class='jdgm-rev__timestamp' datetime='2026-07-01T09:00:00Z'></time> <span class='jdgm-rev__author'>Dominic</span> </div> <div class='jdgm-rev__content'> <b class='jdgm-rev__title'>Grip cracked</b> <div class='jdgm-rev__body'><p>Handle came apart after 3 weeks.</p></div> </div> <div class='jdgm-rev__reply'><div class='jdgm-rev__reply-content'>Sorry to hear that — please contact support for a warranty replacement.</div></div> </div></div>`

test('judge.me: parses every review block in a widget page', () => {
  const reviews = parseReviewBlocks(JUDGEME_HTML, '8991710183576')
  assert.equal(reviews.length, 2)
  assert.deepEqual(
    reviews.map((r) => r.sourceReviewId),
    ['3c239d86-b372-4d71-adee-bd23968ff192', 'second-id-0002'],
  )
})

test('judge.me: extracts rating, title, body, author and dates', () => {
  const [first] = parseReviewBlocks(JUDGEME_HTML, 'p1')
  assert.ok(first)
  assert.equal(first.rating, 5)
  assert.equal(first.title, 'Light but mighty')
  assert.equal(first.body, 'I love my new paddle! It is light & powerful.')
  assert.equal(first.authorName, 'Ayesha Pardesi')
  assert.equal(first.authorLocation, 'United States')
  assert.equal(first.submittedAt, '2026-08-27T18:29:10Z')
  assert.equal(first.isVerifiedBuyer, true)
  assert.equal(first.helpfulCount, 2)
  assert.equal(first.unhelpfulCount, 1)
  assert.equal(first.isRatingsOnly, false)
})

test('judge.me: an empty reply container yields no response', () => {
  // The container is always rendered; only a populated one is a real reply.
  // Treating the empty div as a reply would report 100% response coverage.
  const [first] = parseReviewBlocks(JUDGEME_HTML, 'p1')
  assert.deepEqual(first?.responses, [])
})

test('judge.me: a populated reply is captured as a response', () => {
  const [, second] = parseReviewBlocks(JUDGEME_HTML, 'p1')
  assert.equal(second?.responses.length, 1)
  assert.equal(
    second?.responses[0]?.body,
    'Sorry to hear that — please contact support for a warranty replacement.',
  )
  assert.equal(second?.rating, 2)
  assert.equal(second?.isVerifiedBuyer, false)
})

test('judge.me: unparseable markup yields no reviews rather than a broken one', () => {
  assert.deepEqual(parseReviewBlocks('<div>nothing here</div>', 'p1'), [])
  assert.deepEqual(parseReviewBlocks('', 'p1'), [])
})

test('judge.me: a block without a review id is skipped, not emitted as null', () => {
  const html = `<div class='jdgm-rev jdgm-divider-top' data-thumb-up-count='0'><b class='jdgm-rev__title'>orphan</b></div>`
  assert.deepEqual(parseReviewBlocks(html, 'p1'), [])
})

test('adapter factory: resolves every declared platform', () => {
  const http = new PoliteClient(0)
  for (const platform of REVIEW_PLATFORMS) {
    const adapter = buildReviewAdapter(platform, http)
    assert.ok(adapter, `${platform} should resolve`)
    assert.equal(adapter.platform, platform)
  }
})

test('adapter factory: no platform is a skip, an unknown platform is an error', () => {
  const http = new PoliteClient(0)
  // A site with reviews not yet mapped must not fail the whole crawl...
  assert.equal(buildReviewAdapter(null, http), null)
  assert.equal(buildReviewAdapter(undefined, http), null)
  assert.equal(buildReviewAdapter('', http), null)
  // ...but a typo in config must not silently collect nothing forever.
  assert.throws(() => buildReviewAdapter('bazarvoice', http), /Unknown review_platform/)
})

test('site config: every configured review platform is one we implement', () => {
  for (const site of LOCAL_SITES) {
    if (!site.review_platform) continue
    assert.ok(
      (REVIEW_PLATFORMS as readonly string[]).includes(site.review_platform),
      `${site.brand_slug} declares unknown review platform "${site.review_platform}"`,
    )
  }
})

test('site config: each review platform has the config its adapter requires', () => {
  const required: Record<string, string[]> = {
    bazaarvoice: ['client', 'displayCode'],
    okendo: ['subscriberId'],
    judgeme: ['shopDomain'],
  }
  for (const site of LOCAL_SITES) {
    if (!site.review_platform) continue
    for (const key of required[site.review_platform] ?? []) {
      assert.ok(
        site.review_config?.[key],
        `${site.brand_slug}: review_config.${key} is required for ${site.review_platform}`,
      )
    }
  }
})

/**
 * Okendo returns reviewer.location as a string on most reviews and as a nested
 * country object on others — 225 of Selkirk's 1,864. The object form used to
 * reach nullIfBlank(), which called .trim() on it and threw out of the bulk
 * write, taking down the whole site's reviews stage. These pin both shapes.
 */
const okendoReview = (location: unknown): OkendoReview =>
  ({
    reviewId: 'rev-1',
    rating: 5,
    title: 'Great paddle',
    body: 'Plenty of pop.',
    reviewer: { displayName: 'Sam', location },
  }) as OkendoReview

test('okendo: a string location is passed through', () => {
  const r = toRawReview(okendoReview('Austin, Texas'), '123')
  assert.equal(r.authorLocation, 'Austin, Texas')
})

test('okendo: a country-object location is flattened, not thrown on', () => {
  const r = toRawReview(okendoReview({ country: { name: 'United States', code: 'US' } }), '123')
  assert.equal(r.authorLocation, 'United States')
})

test('okendo: a full city/region/country object keeps every part', () => {
  const r = toRawReview(
    okendoReview({ city: 'Austin', region: 'Texas', country: { name: 'United States' } }),
    '123',
  )
  assert.equal(r.authorLocation, 'Austin, Texas, United States')
})

test('okendo: an absent or empty location is null, never a stray comma', () => {
  assert.equal(toRawReview(okendoReview(undefined), '123').authorLocation, null)
  assert.equal(toRawReview(okendoReview(null), '123').authorLocation, null)
  assert.equal(toRawReview(okendoReview('   '), '123').authorLocation, null)
  assert.equal(toRawReview(okendoReview({}), '123').authorLocation, null)
  assert.equal(toRawReview(okendoReview({ country: {} }), '123').authorLocation, null)
})

test('okendo: a country with only a code falls back to the code', () => {
  const r = toRawReview(okendoReview({ country: { code: 'US' } }), '123')
  assert.equal(r.authorLocation, 'US')
})
