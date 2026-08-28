import { PoliteClient } from '../../lib/http.js'
import { createLogger } from '../../lib/logger.js'
import type {
  RawProductReviews,
  RawReview,
  RawReviewResponse,
  ReviewSiteTarget,
  ReviewSourceAdapter,
} from './types.js'

const log = createLogger('reviews:okendo')

const PAGE_SIZE = 20
const MAX_PAGES = 1000
const API_BASE = 'https://api.okendo.io/v1'

interface OkendoAttribute {
  title?: string | null
  value?: unknown
  type?: string | null
  minLabel?: string | null
  midLabel?: string | null
  maxLabel?: string | null
}

interface OkendoReply {
  body?: string | null
  content?: string | null
  dateCreated?: string | null
  authorName?: string | null
  name?: string | null
}

type OkendoLocation =
  | string
  | {
      city?: string | null
      region?: string | null
      state?: string | null
      country?: { name?: string | null; code?: string | null } | null
    }
  | null
  | undefined

export interface OkendoReview {
  reviewId: string
  productId: string
  subscriberId?: string
  rating: number | null
  title?: string | null
  body?: string | null
  dateCreated?: string | null
  dateUpdated?: string | null
  reviewer?: { displayName?: string | null; location?: OkendoLocation } | null
  isRecommended?: boolean | null
  isIncentivized?: boolean | null
  helpfulCount?: number | null
  unhelpfulCount?: number | null
  status?: string | null
  languageCode?: string | null
  productVariantName?: string | null
  variantId?: string | null
  externalProvider?: string | null
  media?: Array<{ type?: string; url?: string; caption?: string | null }> | null
  /** Slider questions: "Right amount of power/pop", -N..N with labelled poles. */
  attributesWithRating?: OkendoAttribute[] | null
  /** Choice questions: "Did this paddle help improve your game" -> "Yes". */
  productAttributes?: OkendoAttribute[] | null
  // Okendo names the merchant reply inconsistently across store versions.
  reply?: OkendoReply | null
  replies?: OkendoReply[] | null
  comments?: OkendoReply[] | null
}

interface OkendoPage {
  reviews?: OkendoReview[]
  nextUrl?: string | null
  areReviewsGrouped?: boolean
  meta?: { total?: number } | null
}

/**
 * Okendo, read through the same public store API the storefront widget calls.
 * No key, no header — only the store's `subscriberId`, which is printed in the
 * PDP HTML.
 *
 *     GET https://api.okendo.io/v1/stores/<subscriberId>/products/shopify-<productId>/reviews
 *
 * Two cautions learned from selkirk.com:
 *
 *  - The PDP carries three Okendo UUIDs. Only one is the store subscriber; the
 *    others belong to other widgets on the page and return a 200 with an empty
 *    body. `npm run reviews:probe` is what tells them apart.
 *  - Pagination is cursor-based via `nextUrl`, not offsets. The cursor is
 *    followed as given rather than reconstructed, since its encoding is not
 *    part of any published contract.
 *
 * Verified against selkirk.com 2026-08-28. See docs/REVIEWS_RESEARCH.md.
 */
export class OkendoReviewAdapter implements ReviewSourceAdapter {
  readonly platform = 'okendo'

  constructor(private readonly http: PoliteClient = new PoliteClient()) {}

  async fetchProductReviews(
    target: ReviewSiteTarget,
    sourceProductId: string,
    since?: Date | null,
  ): Promise<RawProductReviews> {
    const subscriberId = target.config['subscriberId']
    if (!subscriberId) {
      throw new Error(
        'okendo: review_config.subscriberId is required. It is printed in the PDP HTML as data-oke-* / subscriberId.',
      )
    }
    // Okendo namespaces product ids by their source platform.
    const okendoProductId = `shopify-${sourceProductId}`

    const reviews: RawReview[] = []
    let reportedTotal: number | null = null

    let url: string | null =
      `${API_BASE}/stores/${encodeURIComponent(subscriberId)}` +
      `/products/${encodeURIComponent(okendoProductId)}/reviews?limit=${PAGE_SIZE}`

    for (let page = 0; page < MAX_PAGES && url; page++) {
      const body: OkendoPage = await this.http.getJson<OkendoPage>(url, {
        Referer: `${target.baseUrl}/`,
        Origin: target.baseUrl,
      })
      const batch = body.reviews ?? []
      reportedTotal ??= body.meta?.total ?? null

      for (const raw of batch) reviews.push(toRawReview(raw, sourceProductId))

      if (batch.length === 0) break
      if (since && batch.every((r) => olderThan(r.dateCreated, since))) {
        log.info('incremental stop', { sourceProductId, collected: reviews.length })
        break
      }
      url = resolveNext(body.nextUrl)
    }

    return { sourceProductId, reportedTotal, reviews }
  }
}

/**
 * Resolves Okendo's pagination cursor.
 *
 * `nextUrl` is version-relative but root-anchored:
 *
 *     /stores/<id>/products/<id>/reviews?limit=20&lastEvaluated=%7B...%7D
 *
 * Both obvious readings are wrong, and each fails in its own quiet way:
 *
 *  - Requiring an absolute URL drops the cursor, ending pagination after page
 *    one. Every product then reports exactly 20 reviews, which looks like data
 *    rather than a bug.
 *  - `new URL(nextUrl, API_BASE + '/')` resolves a leading-slash path against
 *    the ORIGIN, silently discarding `/v1`. The resulting URL answers 403.
 *
 * So the version prefix is prepended explicitly. The host is re-checked
 * afterwards because the cursor arrives in a response body, and a value that
 * points somewhere else must not be followed.
 */
function resolveNext(nextUrl: string | null | undefined): string | null {
  if (!nextUrl) return null
  try {
    const absolute = nextUrl.startsWith('http')
      ? nextUrl
      : `${API_BASE}${nextUrl.startsWith('/') ? '' : '/'}${nextUrl}`
    const resolved = new URL(absolute)
    return resolved.host === 'api.okendo.io' ? resolved.toString() : null
  } catch {
    return null
  }
}

export function toRawReview(r: OkendoReview, sourceProductId: string): RawReview {
  const media = (r.media ?? [])
    .filter((m) => m.url)
    .map((m) => ({ type: m.type ?? 'photo', url: m.url as string, caption: m.caption ?? null }))
  const body = (r.body ?? '').trim()

  return {
    sourceReviewId: r.reviewId,
    sourceProductId,
    rating: r.rating ?? null,
    ratingRange: 5,
    title: r.title ?? null,
    body: body || null,
    pros: null,
    cons: null,
    authorName: r.reviewer?.displayName ?? null,
    authorId: null,
    authorLocation: flattenLocation(r.reviewer?.location),
    // Okendo exposes the acquisition channel rather than a verified flag;
    // 'shopify-shop' means the order came from the store itself.
    isVerifiedBuyer: r.externalProvider ? r.externalProvider.startsWith('shopify') : null,
    isRecommended: r.isRecommended ?? null,
    isIncentivized: r.isIncentivized ?? null,
    isSyndicated: null,
    // Okendo has no ratings-only flag, so it is derived: a star with no words.
    isRatingsOnly: body === '',
    helpfulCount: r.helpfulCount ?? 0,
    unhelpfulCount: r.unhelpfulCount ?? 0,
    photoCount: media.filter((m) => m.type !== 'video').length,
    videoCount: media.filter((m) => m.type === 'video').length,
    variantLabel: r.productVariantName ?? null,
    sourceVariantId: r.variantId ?? null,
    contextData: buildContext(r),
    media,
    submittedAt: r.dateCreated ?? null,
    sourceUpdatedAt: r.dateUpdated ?? null,
    languageCode: r.languageCode ?? null,
    responses: collectResponses(r),
  }
}

/**
 * Selkirk asks its reviewers a structured questionnaire alongside the free text
 * — "Right amount of power/pop" on a labelled slider, "Would you consider this a
 * power, hybrid or control paddle", "What kind of player would you recommend
 * this to". That is a graded opinion per attribute, which is more directly
 * useful than the prose it sits next to, so it is kept rather than discarded.
 *
 * Sliders are `centered-range`: the value is signed around zero and only means
 * something next to its pole labels, so the labels are stored with it.
 */
function buildContext(r: OkendoReview): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const attr of r.productAttributes ?? []) {
    if (!attr.title) continue
    out[attr.title] = attr.value
  }

  for (const attr of r.attributesWithRating ?? []) {
    if (!attr.title) continue
    out[attr.title] =
      attr.type === 'centered-range'
        ? {
            value: attr.value,
            scale: [attr.minLabel, attr.midLabel, attr.maxLabel].filter(Boolean),
          }
        : attr.value
  }

  return out
}

/**
 * Merchant replies.
 *
 * This endpoint returned no reply field of any name across selkirk.com — the
 * full field set is body, title, rating, reviewer, media, the two attribute
 * arrays and bookkeeping, with nothing reply-shaped. So an empty result here is
 * the correct answer for this store, not a parsing failure.
 *
 * The three spellings are still checked because Okendo does offer merchant
 * responses, and a store that enables them should start collecting without a
 * code change.
 */
function collectResponses(r: OkendoReview): RawReviewResponse[] {
  const candidates = [...(r.reply ? [r.reply] : []), ...(r.replies ?? []), ...(r.comments ?? [])]
  const out: RawReviewResponse[] = []
  for (const c of candidates) {
    const body = (c.body ?? c.content ?? '').trim()
    if (!body) continue
    out.push({
      sourceResponseId: null,
      department: null,
      authorName: c.authorName ?? c.name ?? null,
      responseSource: 'okendo',
      body,
      respondedAt: c.dateCreated ?? null,
    })
  }
  return out
}

function olderThan(iso: string | null | undefined, since: Date): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t < since.getTime()
}

/**
 * Okendo's reviewer.location is polymorphic: most reviews carry a plain string,
 * but 225 of Selkirk's 1,864 return an object — {"country":{"name":"United
 * States","code":"US"}} — with no flag distinguishing the two. Both shapes are
 * flattened to the most specific human-readable line available, so a reader
 * filtering by location sees "Austin, Texas" and "United States" side by side
 * rather than one of them silently becoming null.
 */
function flattenLocation(value: OkendoLocation): string | null {
  if (!value) return null
  if (typeof value === 'string') return value.trim() || null

  const parts = [value.city, value.region ?? value.state, value.country?.name ?? value.country?.code]
    .map((p) => (typeof p === 'string' ? p.trim() : null))
    .filter((p): p is string => !!p)

  return parts.length > 0 ? [...new Set(parts)].join(', ') : null
}
