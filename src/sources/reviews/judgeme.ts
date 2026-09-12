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

/**
 * The endpoint answers in one of two shapes, decided per shop by which widget
 * version the storefront runs. Both were observed on the same day:
 *
 *   legacy  {html, total_count, page}              crbnpickleball.com, paddletek.com
 *   json    {reviews[], pagination, ...}           us.sixzeropickleball.com
 *
 * The JSON shape is strictly better — typed fields instead of scraped markup —
 * so it is preferred where offered, and the HTML parser stays for the shops
 * that still return it. Neither is a fallback for the other: a shop returns one
 * or the other, and a response carrying neither is an error worth surfacing.
 */
interface JudgeMePage {
  html?: string
  total_count?: number
  page?: number
  reviews?: JudgeMeJsonReview[]
  number_of_reviews?: number
  pagination?: { total_pages?: number; current_page?: number; per_page?: number }
}

export interface JudgeMeJsonReview {
  uuid?: string
  title?: string | null
  rating?: number | null
  body_html?: string | null
  verified_buyer?: boolean | null
  created_at?: string | null
  reviewer_name?: string | null
  is_anonymous_reviewer?: boolean
  location?: string | null
  location_country?: string | null
  thumb_up?: number
  thumb_down?: number
  pictures_urls?: unknown[]
  video_external_ids?: unknown[]
  media_platform_hosted_video_infos?: unknown[]
  reply_content?: string | null
  shop_reply_name?: string | null
  product_variant_title?: string | null
  transparency_badges?: unknown
  language?: string | null
  cf_answers?: unknown[]
  is_for_product_from_group?: boolean
  is_for_product_from_bundle?: boolean
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
      let body: JudgeMePage
      try {
        body = await this.http.getJson<JudgeMePage>(
          `https://judge.me/reviews/reviews_for_widget?${q.toString()}`,
          { Referer: `${target.baseUrl}/` },
        )
      } catch (error) {
        // A 404 means Judge.me holds no record of this product — it was never
        // synced to the review app. That is a true statement about the product
        // (it has no reviews), not a failure to collect them, and treating it
        // as an error marks the whole site's run `partial` on every future
        // crawl. paddletek.com/products/phoenix-genesis-carbon is one such.
        //
        // Only on the first page: a 404 partway through paging is the endpoint
        // changing under us, which is worth surfacing.
        if (isNotFound(error) && page === 1) {
          log.info('no judge.me record for product; treating as zero reviews', {
            sourceProductId,
            shopDomain,
          })
          return { sourceProductId, reportedTotal: 0, reviews: [] }
        }
        throw error
      }
      reportedTotal ??= body.total_count ?? body.number_of_reviews ?? null

      const batch = Array.isArray(body.reviews)
        ? body.reviews.map((r) => parseJsonReview(r, sourceProductId)).filter(isReview)
        : typeof body.html === 'string'
          ? parseReviewBlocks(body.html, sourceProductId)
          : missingShape(shopDomain, sourceProductId)
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

function isReview(r: RawReview | null): r is RawReview {
  return r !== null
}

/** Structural check — the http layer's HttpError carries a numeric `status`. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 404
  )
}

/**
 * A response carrying neither shape means the contract changed. Failing loudly
 * beats returning zero reviews, which the pipeline would record as "this
 * product has no reviews" and carry forward as fact.
 */
function missingShape(shopDomain: string, sourceProductId: string): never {
  throw new Error(
    `Judge.me returned neither \`html\` nor \`reviews\` for product ${sourceProductId} ` +
      `on ${shopDomain}. The widget response shape has changed.`,
  )
}

/** Strips tags from Judge.me's `body_html`, which is a <p>-wrapped paragraph. */
function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&(?:rsquo|#8217);/g, '’')
    .trim()
}

/** Judge.me's structured widget review. Exported for tests. */
export function parseJsonReview(r: JudgeMeJsonReview, sourceProductId: string): RawReview | null {
  if (!r.uuid) return null

  const body = htmlToText(r.body_html)
  const title = (r.title ?? '').trim()
  const badges = Array.isArray(r.transparency_badges)
    ? (r.transparency_badges as unknown[]).map((b) =>
        typeof b === 'string' ? b : ((b as { badge_type?: string })?.badge_type ?? ''),
      )
    : []

  const context: Record<string, unknown> = {}
  if (badges.length > 0) context['_badges'] = badges
  // Custom form answers — 'How long have you owned it', 'Skill level'. The same
  // material Bazaarvoice carries as secondary ratings.
  if (Array.isArray(r.cf_answers) && r.cf_answers.length > 0) context['cf_answers'] = r.cf_answers

  const responses: RawReviewResponse[] =
    r.reply_content && r.reply_content.trim()
      ? [
          {
            sourceResponseId: null,
            department: null,
            authorName: r.shop_reply_name ?? null,
            responseSource: 'judgeme',
            body: htmlToText(r.reply_content),
            respondedAt: null,
          },
        ]
      : []

  return {
    sourceReviewId: r.uuid,
    sourceProductId,
    rating: typeof r.rating === 'number' && Number.isFinite(r.rating) ? r.rating : null,
    ratingRange: 5,
    title: title || null,
    body: body || null,
    pros: null,
    cons: null,
    // An anonymous reviewer is rendered as the literal 'Anonymous'; keeping it
    // is honest, and the UI already falls back to the same word for a null.
    authorName: r.reviewer_name ?? null,
    authorId: null,
    // Rendered as '(United States)'; the parentheses are presentation.
    authorLocation: (r.location ?? r.location_country ?? '').replace(/^\(|\)$/g, '').trim() || null,
    isVerifiedBuyer: r.verified_buyer ?? null,
    isRecommended: null,
    isIncentivized: badges.length > 0
      ? badges.some((b) => /earned_for_future_purchase|incentiv/i.test(b))
      : null,
    // Judge.me's product groups are its syndication: one review shown across
    // every product in the group.
    isSyndicated: r.is_for_product_from_group ?? r.is_for_product_from_bundle ?? null,
    isRatingsOnly: body === '' && title === '',
    helpfulCount: r.thumb_up ?? 0,
    unhelpfulCount: r.thumb_down ?? 0,
    photoCount: Array.isArray(r.pictures_urls) ? r.pictures_urls.length : 0,
    videoCount:
      (Array.isArray(r.video_external_ids) ? r.video_external_ids.length : 0) +
      (Array.isArray(r.media_platform_hosted_video_infos)
        ? r.media_platform_hosted_video_infos.length
        : 0),
    variantLabel: r.product_variant_title ?? null,
    sourceVariantId: null,
    contextData: context,
    media: [],
    submittedAt: r.created_at ?? null,
    sourceUpdatedAt: null,
    languageCode: r.language ?? null,
    responses,
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
