import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRobots, isAllowedByRobots, matchesRobotsPattern } from '../src/lib/http.js'

/**
 * These exist because the parser used to read `Disallow` and ignore `Allow`,
 * which is not the conservative simplification it looks like.
 *
 * Yotpo publishes a deny-by-default policy that then names its public widget
 * endpoints as open. Reading only the Disallow line turned "everything except
 * these" into "everything" and blocked all 15 of GAMMA's products on a path the
 * host explicitly permits — a silent zero-reviews result rather than an error.
 */

// Real, as served by api-cdn.yotpo.com on 2026-09-12.
const YOTPO = `# See http://www.robotstxt.org/wc/norobots.html
User-Agent: *
Disallow: /
Allow: /products/*/*/reviews
Allow: /products/*/*/bottomline
Allow: /v1/widget/*
Allow: /v1/star_distribution/*
Allow: /v3/rich_snippets/*`

test('robots: Allow lines are parsed, not discarded', () => {
  const rules = parseRobots(YOTPO)
  assert.deepEqual(rules.disallows, ['/'])
  assert.equal(rules.allows.length, 5)
})

test('robots: a specific Allow beats a blanket Disallow', () => {
  const rules = parseRobots(YOTPO)
  // The exact URL shape the Yotpo adapter builds.
  assert.equal(
    isAllowedByRobots('/v1/widget/APPKEY/products/10176061899067/reviews.json', rules),
    true,
  )
})

test('robots: the blanket Disallow still applies to everything else', () => {
  const rules = parseRobots(YOTPO)
  for (const path of ['/', '/admin', '/v2/private/thing', '/v1/widgets-not-widget']) {
    assert.equal(isAllowedByRobots(path, rules), false, `${path} should stay denied`)
  }
})

test('robots: the longest matching rule wins, whichever kind it is', () => {
  // Allow is broad, Disallow is specific: the specific one wins.
  const rules = parseRobots(`User-agent: *\nAllow: /docs/\nDisallow: /docs/internal/`)
  assert.equal(isAllowedByRobots('/docs/public', rules), true)
  assert.equal(isAllowedByRobots('/docs/internal/secret', rules), false)
})

test('robots: an equally specific Allow and Disallow resolves to allowed', () => {
  // RFC 9309 breaks the tie toward Allow.
  const rules = parseRobots(`User-agent: *\nDisallow: /x\nAllow: /x`)
  assert.equal(isAllowedByRobots('/x', rules), true)
})

test('robots: a path no rule matches is allowed', () => {
  const rules = parseRobots(`User-agent: *\nDisallow: /private/`)
  assert.equal(isAllowedByRobots('/anything/else', rules), true)
})

test('robots: only the wildcard group binds us', () => {
  // A rule aimed at another crawler must not be applied to ours, and must not
  // leak into the wildcard group that follows it.
  const rules = parseRobots(
    `User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /private/`,
  )
  assert.deepEqual(rules.disallows, ['/private/'])
  assert.equal(isAllowedByRobots('/public', rules), true)
})

test('robots: judge.me disallows /api/ but not the widget endpoint', () => {
  // The Judge.me adapter's documented justification, pinned so a parser change
  // cannot quietly invalidate it.
  const rules = parseRobots(`User-agent: *\nDisallow: /api/`)
  assert.equal(isAllowedByRobots('/reviews/reviews_for_widget', rules), true)
  assert.equal(isAllowedByRobots('/api/v1/reviews', rules), false)
})

test('robots: wildcards and the $ end anchor', () => {
  assert.equal(matchesRobotsPattern('/a/b/c/reviews', '/a/*/*/reviews'), true)
  assert.equal(matchesRobotsPattern('/a/b/reviews', '/a/*/*/reviews'), false)
  assert.equal(matchesRobotsPattern('/file.json', '/*.json$'), true)
  assert.equal(matchesRobotsPattern('/file.json.bak', '/*.json$'), false)
})

test('robots: regex metacharacters in a path are matched literally', () => {
  // A '.' in a pattern must not match any character, or '/v1.x/' would allow
  // '/v1Ax/' as well.
  assert.equal(matchesRobotsPattern('/v1Ax/thing', '/v1.x/'), false)
  assert.equal(matchesRobotsPattern('/v1.x/thing', '/v1.x/'), true)
})

test('robots: crawl-delay is read from the wildcard group', () => {
  const rules = parseRobots(`User-agent: *\nCrawl-delay: 2\nDisallow: /x`)
  assert.equal(rules.crawlDelayMs, 2000)
})
