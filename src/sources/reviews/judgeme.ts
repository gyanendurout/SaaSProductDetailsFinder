import { PoliteClient } from '../../lib/http.js'
import { createLogger } from '../../lib/logger.js'
import type {
  RawProductReviews,
  RawReview,
  RawReviewResponse,
  ReviewSiteTarget,
  ReviewSourceAdapter,
} from './types.js'

const log = createLogger('reviews:judgeme')

/**
 * 10 per page, deliberately.
 *
 * `per_page` is accepted but not honoured above ~23: measured against
 * crbnpickleball.com, per_page=50 and per_page=100 both rendered 23 reviews,
 * which would silently drop 27 of every 50 if the code trusted the parameter.
 * 10 is the widget's own value and returns exactly 10. Paging at 10 across a
 * 188-review product yielded 188 unique ids and zero duplicates.
 */
const PAGE_SIZE = 10
const MAX_PAGES = 1000

interface JudgeMePage {
  html: string
  total_count: number
  page: number
}

/**
 * Judge.me, read through the public widget endpoint the storefront itself calls:
 *
 *     GET https://judge.me/reviews/reviews_for_widget
 *         ?url=<shop>&shop_domain=<shop>&platform=shopify&page=<n>&per_page=10&product_id=<id>
 *
 * No key. It answers `{html, total_count, page}` where the reviews are rendered
 * markup, so this is the one adapter that parses HTML rather than JSON.
 *
 * robots.txt note: judge.me disallows `/api/*`, but this endpoint is under
 * `/reviews/` and is not disallowed. PoliteClient enforces that independently.
 *
 * The markup is machine-generated from a fixed template, and every field is
 * carried on a stable `jdgm-` class or a `data-` attribute, so targeted regex is
 * appropriate here and a DOM parser would be a dependency for no accuracy gain.
 * Anything not matched degrades to null rather than to a wrong value.
 *
 * Verified against crbnpickleball.com 2026-08-28. See docs/REVIEWS_RESEARCH.md.
 */
export class JudgeMeReviewAdapter implements ReviewSourceAdapter {
  readonly platform = 'judgeme'

  constructor(private readonly http: PoliteClient = new PoliteClient()) {}

  async fetchProductReviews(
    target: ReviewSiteTarget,
    sourceProductId: string,
    since?: Date | null,
  ): Promise<RawProductReviews> {
    const shopDomain = target.config['shopDomain'] ?? new URL(target.baseUrl).host
    const reviews: RawReview[] = []
    const seen = new Set<string>()
    let reportedTotal: number | null = null

    for (let page = 1; page <= MAX_PAGES; page++) {
      const q = new URLSearchParams({
        url: shopDomain,
        shop_domain: shopDomain,
        platform: 'shopify',
        page: String(page),
        per_page: String(PAGE_SIZE),
        product_id: sourceProductId,
      })
      const body = await this.http.getJson<JudgeMePage>(
        `https://judge.me/reviews/reviews_for_widget?${q.toString()}`,
        { Referer: `${target.baseUrl}/` },
      )
      reportedTotal ??= body.total_count ?? null

      const batch = parseReviewBlocks(body.html ?? '', sourceProductId)
      if (batch.length === 0) break

      // Judge.me keeps serving the last page rather than 404ing past the end on
      // some shops, so identity is the stop condition, not just emptiness.
      let added = 0
      for (const r of batch) {
        if (seen.has(r.sourceReviewId)) continue
        seen.add(r.sourceReviewId)
        reviews.push(r)
        added++
      }
      if (added === 0) break

      if (since && batch.every((r) => olderThan(r.submittedAt, since))) {
        log.info('incremental stop', { sourceProductId, collected: reviews.length })
        break
      }
      if (reportedTotal !== null && reviews.length >= reportedTotal) break
    }

    return { sourceProductId, reportedTotal, reviews }
  }
}

/** Splits the widget HTML on the review container and parses each block. */
export function parseReviewBlocks(html: string, sourceProductId: string): RawReview[] {
  const out: RawReview[] = []
  // Blocks start at `<div class='jdgm-rev ...'` and run to the next one.
  const starts: number[] = []
  const re = /<div class='jdgm-rev\s[^']*'/g
  for (let m = re.exec(html); m; m = re.exec(html)) starts.push(m.index)

  for (const [i, start] of starts.entries()) {
    const block = html.slice(start, starts[i + 1] ?? html.length)
    const review = parseReviewBlock(block, sourceProductId)
    if (review) out.push(review)
  }
  return out
}

function parseReviewBlock(block: string, sourceProductId: string): RawReview | null {
  const id = attr(block, 'data-review-id')
  if (!id) return null

  const body = text(between(block, "class='jdgm-rev__body'"))
  const title = text(between(block, "class='jdgm-rev__title'"))
  const rating = Number(matchOne(block, /class='jdgm-rev__rating'[^>]*data-score='(\d+(?:\.\d+)?)'/))

  return {
    sourceReviewId: id,
    sourceProductId,
    rating: Number.isFinite(rating) ? rating : null,
    ratingRange: 5,
    title: title || null,
    body: body || null,
    pros: null,
    cons: null,
    authorName: text(between(block, "class='jdgm-rev__author'")) || null,
    authorId: null,
    // Rendered as ' (United States) '; the parentheses are presentation.
    authorLocation:
      text(between(block, "class='jdgm-rev__location'")).replace(/^\(|\)$/g, '').trim() || null,
    isVerifiedBuyer: attr(block, 'data-verified-buyer') === 'true',
    isRecommended: null,
    // Judge.me states this as a transparency badge rather than a field.
    isIncentivized: /data-badge-type=review_earned_for_future_purchase/.test(block)
      ? true
      : /data-badge-type=/.test(block)
        ? false
        : null,
    isSyndicated: null,
    isRatingsOnly: body === '' && title === '',
    helpfulCount: int(attr(block, 'data-thumb-up-count')),
    unhelpfulCount: int(attr(block, 'data-thumb-down-count')),
    photoCount: countOccurrences(between(block, "class='jdgm-rev__pics'"), '<img'),
    videoCount: countOccurrences(between(block, "class='jdgm-rev__vids'"), '<video'),
    variantLabel: null,
    sourceVariantId: null,
    contextData: buildContext(block),
    media: [],
    submittedAt: matchOne(block, /class='jdgm-rev__timestamp[^']*'\s+datetime='([^']+)'/) ?? null,
    sourceUpdatedAt: null,
    languageCode: attr(block, 'data-review-language') || null,
    responses: collectResponses(block),
  }
}

/**
 * The shop's reply. On crbnpickleball.com every `jdgm-rev__reply` observed was
 * an empty container — that shop does not reply — so the inner markup of a
 * populated one could not be confirmed against a live example. The container is
 * therefore read as a whole and reduced to its text, which is correct for any
 * inner structure Judge.me chooses, and yields nothing when there is no reply.
 */
function collectResponses(block: string): RawReviewResponse[] {
  const raw = between(block, "class='jdgm-rev__reply'")
  const body = text(raw)
  if (!body) return []
  return [
    {
      sourceResponseId: null,
      department: null,
      authorName: text(between(raw, "class='jdgm-rev__reply-author'")) || null,
      responseSource: 'judgeme',
      body,
      respondedAt: matchOne(raw, /datetime='([^']+)'/) ?? null,
    },
  ]
}

function buildContext(block: string): Record<string, unknown> {
  const badges = [...block.matchAll(/data-badge-type=([a-z_]+)/g)].map((m) => m[1])
  return badges.length > 0 ? { _badges: badges } : {}
}

// --- small HTML helpers -----------------------------------------------------
// Scoped to Judge.me's generated markup; not a general-purpose parser.

/** The inner HTML of the first element carrying `marker`, by tag-depth counting. */
function between(html: string, marker: string): string {
  const at = html.indexOf(marker)
  if (at === -1) return ''
  const open = html.lastIndexOf('<', at)
  const tag = matchOne(html.slice(open), /^<([a-z0-9]+)/i)
  if (!tag) return ''
  const contentStart = html.indexOf('>', at)
  if (contentStart === -1) return ''

  const openRe = new RegExp(`<${tag}[\\s>]`, 'gi')
  const closeRe = new RegExp(`</${tag}>`, 'gi')
  openRe.lastIndex = contentStart
  closeRe.lastIndex = contentStart

  let depth = 1
  let nextOpen = openRe.exec(html)
  let nextClose = closeRe.exec(html)
  while (nextClose) {
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++
      nextOpen = openRe.exec(html)
      continue
    }
    depth--
    if (depth === 0) return html.slice(contentStart + 1, nextClose.index)
    nextClose = closeRe.exec(html)
  }
  return ''
}

function attr(html: string, name: string): string {
  return matchOne(html, new RegExp(`${name}='([^']*)'`)) ?? ''
}

function matchOne(html: string, re: RegExp): string | null {
  return html.match(re)?.[1] ?? null
}

/** Strips tags and decodes the entities Judge.me actually emits. */
function text(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

function countOccurrences(html: string, needle: string): number {
  if (!html) return 0
  return html.split(needle).length - 1
}

function int(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function olderThan(iso: string | null | undefined, since: Date): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t < since.getTime()
}
