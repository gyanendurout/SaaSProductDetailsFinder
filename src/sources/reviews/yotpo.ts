import { PoliteClient } from '../../lib/http.js'
import { createLogger } from '../../lib/logger.js'
import type {
  RawProductReviews,
  RawReview,
  RawReviewResponse,
  ReviewSiteTarget,
  ReviewSourceAdapter,
} from './types.js'

const log = createLogger('reviews:yotpo')

/**
 * 15 per page — the widget's own value, and what the endpoint returns whatever
 * you ask for. Unlike Judge.me, `pagination.total` is authoritative here, so
 * paging stops on a computed page count rather than on an empty batch.
 */
const PAGE_SIZE = 15
const MAX_PAGES = 1000

interface YotpoUser {
  user_id?: number
  display_name?: string | null
  social_image?: string | null
}

interface YotpoComment {
  id?: number
  content?: string | null
  created_at?: string | null
  user?: YotpoUser | null
}

export interface YotpoReview {
  id?: number
  score?: number | null
  votes_up?: number
  votes_down?: number
  content?: string | null
  title?: string | null
  sentiment?: number | null
  created_at?: string | null
  deleted?: boolean
  verified_buyer?: boolean | null
  source_review_id?: string | null
  custom_fields?: Record<string, unknown> | null
  product_id?: number
  is_incentivized?: boolean | null
  incentive_type?: string | null
  images_data?: unknown[] | null
  comment?: YotpoComment | null
  user?: YotpoUser | null
  language?: string | null
}

interface YotpoResponse {
  response?: {
    pagination?: { page?: number; per_page?: number; total?: number }
    bottomline?: { total_review?: number; average_score?: number }
    reviews?: YotpoReview[]
  }
}

/**
 * Yotpo, read through the public widget API the storefront's own loader calls:
 *
 *     GET https://api-cdn.yotpo.com/v1/widget/<appKey>/products/<productId>/reviews.json
 *         ?per_page=15&page=<n>
 *
 * The app key is public deployment config, not a credential: it is printed in
 * the loader URL on every page of the storefront
 * (cdn-widgetsrepository.yotpo.com/v1/loader/<appKey>) and grants read access to
 * the same reviews the page already displays. The same class of value as
 * Bazaarvoice's displayCode and Okendo's subscriberId.
 *
 * Why the API rather than the page: GAMMA server-renders reviews into the PDP
 * for SEO, but caps that block at 10 and gives each one no stable id — a
 * product with 21 reviews renders 10 anonymous-to-us blocks. The API returns
 * all of them, paginated, each with a numeric id that survives a re-crawl.
 *
 * `api-cdn` is the cached read replica the widget itself uses; `api.yotpo.com`
 * answers identically. The cached host is preferred so a crawl does not hit the
 * origin for data every visitor already reads from cache.
 *
 * Verified against gammasports.com 2026-09-12.
 */
export class YotpoReviewAdapter implements ReviewSourceAdapter {
  readonly platform = 'yotpo'

  constructor(private readonly http: PoliteClient = new PoliteClient()) {}

  async fetchProductReviews(
    target: ReviewSiteTarget,
    sourceProductId: string,
    since?: Date | null,
  ): Promise<RawProductReviews> {
    const appKey = target.config['appKey']
    if (!appKey) {
      throw new Error(
        `Yotpo needs an appKey in review_config for ${target.baseUrl}. ` +
          `It is printed on the storefront in the loader URL: ` +
          `cdn-widgetsrepository.yotpo.com/v1/loader/<appKey>.`,
      )
    }

    const reviews: RawReview[] = []
    const seen = new Set<string>()
    let reportedTotal: number | null = null

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        `https://api-cdn.yotpo.com/v1/widget/${encodeURIComponent(appKey)}` +
        `/products/${encodeURIComponent(sourceProductId)}/reviews.json` +
        `?per_page=${PAGE_SIZE}&page=${page}`

      const body = await this.http.getJson<YotpoResponse>(url, {
        Referer: `${target.baseUrl}/`,
      })
      const payload = body.response
      if (!payload) break

      reportedTotal ??= payload.bottomline?.total_review ?? payload.pagination?.total ?? null

      const batch = (payload.reviews ?? [])
        // A deleted review is still returned; it must not be stored as live.
        .filter((r) => !r.deleted)
        .map((r) => parseYotpoReview(r, sourceProductId))
        .filter((r): r is RawReview => r !== null)

      if (batch.length === 0) break

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

      const total = payload.pagination?.total ?? reportedTotal
      if (total !== null && total !== undefined && reviews.length >= total) break
    }

    return { sourceProductId, reportedTotal, reviews }
  }
}

/** Exported for tests. */
export function parseYotpoReview(r: YotpoReview, sourceProductId: string): RawReview | null {
  if (r.id === undefined || r.id === null) return null

  const body = (r.content ?? '').trim()
  const title = (r.title ?? '').trim()

  const context: Record<string, unknown> = {}
  // Yotpo scores its own sentiment, -1..1. Worth keeping: it is the only
  // platform here that ships one, and it is the raw material for the complaint
  // analysis this table exists to support.
  if (typeof r.sentiment === 'number') context['sentiment'] = r.sentiment
  if (r.incentive_type) context['incentive_type'] = r.incentive_type
  if (r.custom_fields && Object.keys(r.custom_fields).length > 0) {
    context['custom_fields'] = r.custom_fields
  }

  const reply = r.comment
  const responses: RawReviewResponse[] =
    reply && (reply.content ?? '').trim()
      ? [
          {
            sourceResponseId: reply.id === undefined ? null : String(reply.id),
            department: null,
            authorName: reply.user?.display_name ?? null,
            responseSource: 'yotpo',
            body: (reply.content ?? '').trim(),
            respondedAt: reply.created_at ?? null,
          },
        ]
      : []

  return {
    sourceReviewId: String(r.id),
    sourceProductId,
    rating: typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : null,
    ratingRange: 5,
    title: title || null,
    body: body || null,
    pros: null,
    cons: null,
    authorName: r.user?.display_name ?? null,
    authorId: r.user?.user_id === undefined ? null : String(r.user.user_id),
    // Yotpo collects no reviewer location.
    authorLocation: null,
    isVerifiedBuyer: r.verified_buyer ?? null,
    isRecommended: null,
    isIncentivized: r.is_incentivized ?? null,
    // `source_review_id` is set when Yotpo imported the review from elsewhere,
    // which is exactly what syndication means on this platform.
    isSyndicated: r.source_review_id ? true : null,
    isRatingsOnly: body === '' && title === '',
    helpfulCount: r.votes_up ?? 0,
    unhelpfulCount: r.votes_down ?? 0,
    photoCount: Array.isArray(r.images_data) ? r.images_data.length : 0,
    videoCount: 0,
    variantLabel: null,
    sourceVariantId: null,
    contextData: context,
    media: [],
    submittedAt: r.created_at ?? null,
    sourceUpdatedAt: null,
    languageCode: r.language ?? null,
    responses,
  }
}

function olderThan(iso: string | null | undefined, since: Date): boolean {
  if (!iso) return false
  const at = new Date(iso)
  return Number.isFinite(at.getTime()) && at < since
}
