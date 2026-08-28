import { PoliteClient } from '../../lib/http.js'
import { createLogger } from '../../lib/logger.js'
import type {
  RawProductReviews,
  RawReview,
  RawReviewResponse,
  ReviewSiteTarget,
  ReviewSourceAdapter,
} from './types.js'

const log = createLogger('reviews:bazaarvoice')

/**
 * Bazaarvoice refuses limits above 20 (`ERROR_PARAM_INVALID_LIMIT`), so this is
 * a hard protocol constant rather than a tuning knob.
 */
const PAGE_SIZE = 20
/** ~20k reviews on one product. Far past anything real; stops a runaway loop. */
const MAX_PAGES = 1000
/** Replies per review. The chain is short in practice; this is headroom. */
const COMMENT_LIMIT = 10

interface BvClientResponse {
  Id?: string | null
  Department?: string | null
  Name?: string | null
  Response?: string | null
  ResponseSource?: string | null
  Date?: string | null
  SourceClientName?: string | null
}

interface BvReview {
  Id: number | string
  ProductId: string | number
  Rating: number | null
  RatingRange: number | null
  Title: string | null
  ReviewText: string | null
  Pros: string | null
  Cons: string | null
  UserNickname: string | null
  UserLocation: string | null
  AuthorId: string | null
  IsRecommended: boolean | null
  IsSyndicated: boolean | null
  IsRatingsOnly: boolean | null
  IsFeatured: boolean | null
  TotalPositiveFeedbackCount: number | null
  TotalNegativeFeedbackCount: number | null
  SubmissionTime: string | null
  LastModificationTime: string | null
  ContentLocale: string | null
  Badges?: Record<string, unknown> | null
  SecondaryRatings?: Record<string, unknown> | null
  ContextDataValues?: Record<string, { Value?: unknown; Id?: string }> | null
  TagDimensions?: Record<string, unknown> | null
  Photos?: Array<{ Id?: string; Sizes?: Record<string, { Url?: string }>; Caption?: string | null }> | null
  Videos?: Array<{ VideoUrl?: string; Caption?: string | null }> | null
  ClientResponses?: BvClientResponse[] | null
  CommentIds?: string[] | null
}

interface BvComment {
  Id?: string | number
  ReviewId?: string | number
  CommentText?: string | null
  UserNickname?: string | null
  SubmissionTime?: string | null
}

interface BvEnvelope {
  response?: {
    Limit: number
    Offset: number
    TotalResults: number
    Results: BvReview[]
    Includes?: { Comments?: Record<string, BvComment> }
    HasErrors?: boolean
    Errors?: Array<{ Message?: string; Code?: string }>
  }
}

/**
 * Bazaarvoice, read through the same passkey-free BFD proxy the storefront's own
 * widget uses.
 *
 * The only non-obvious part is the `bv-bfd-token` header. Without it the proxy
 * answers 400 `'Bv-Bfd-Token' is not sent or invalid`; with it, no API key is
 * involved at all. The token is not a secret — it is three pieces of public
 * deployment config joined by commas:
 *
 *     <displayCode>,<deploymentZone>,<locale>     e.g. 21461_3_0,shopify,en_US
 *
 * all three of which are published in
 * `apps.bazaarvoice.com/deployments/<client>/<zone>/production/<locale>/api-config.js`
 * and repeated in the widget's own query string.
 *
 * Brand replies arrive as `ClientResponses[]`. `CommentIds` is also read, since
 * Bazaarvoice can put the chain in either place depending on how the client has
 * the deployment configured — on JOOLA it is consistently ClientResponses.
 *
 * Verified against joola.com 2026-08-28. See docs/REVIEWS_RESEARCH.md.
 */
export class BazaarvoiceReviewAdapter implements ReviewSourceAdapter {
  readonly platform = 'bazaarvoice'

  constructor(private readonly http: PoliteClient = new PoliteClient()) {}

  async fetchProductReviews(
    target: ReviewSiteTarget,
    sourceProductId: string,
    since?: Date | null,
  ): Promise<RawProductReviews> {
    const client = required(target.config, 'client')
    const displayCode = required(target.config, 'displayCode')
    const zone = target.config['deploymentZone'] ?? 'shopify'
    const locale = target.config['locale'] ?? 'en_US'

    const headers = {
      // Not a credential. See the class comment.
      'bv-bfd-token': `${displayCode},${zone},${locale}`,
      Referer: `${target.baseUrl}/`,
      Origin: target.baseUrl,
    }

    const reviews: RawReview[] = []
    let reportedTotal: number | null = null

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE
      const url = this.buildUrl(client, displayCode, locale, sourceProductId, offset)
      const body = await this.http.getJson<BvEnvelope>(url, headers)
      const payload = body.response

      if (!payload) throw new Error('bazaarvoice: response envelope missing')
      if (payload.HasErrors && payload.Errors?.length) {
        const first = payload.Errors[0]
        throw new Error(`bazaarvoice: ${first?.Code ?? 'error'} ${first?.Message ?? ''}`.trim())
      }

      reportedTotal ??= payload.TotalResults ?? null
      const batch = payload.Results ?? []
      const comments = payload.Includes?.Comments ?? {}
      for (const raw of batch) reviews.push(toRawReview(raw, comments))

      if (batch.length < PAGE_SIZE) break
      if (offset + batch.length >= (payload.TotalResults ?? 0)) break

      // Results are sorted submissiontime:desc, so once a whole page predates
      // the watermark everything after it does too.
      if (since && batch.every((r) => olderThan(r.SubmissionTime, since))) {
        log.info('incremental stop', { sourceProductId, atOffset: offset })
        break
      }
    }

    return { sourceProductId, reportedTotal, reviews }
  }

  private buildUrl(
    client: string,
    displayCode: string,
    locale: string,
    productId: string,
    offset: number,
  ): string {
    const q = new URLSearchParams({
      resource: 'reviews',
      action: 'REVIEWS_N_STATS',
      filter: `productid:eq:${productId}`,
      include: 'authors,products,comments',
      filteredstats: 'reviews',
      Stats: 'Reviews',
      limit: String(PAGE_SIZE),
      offset: String(offset),
      limit_comments: String(COMMENT_LIMIT),
      // Newest first is what makes the `since` watermark usable.
      sort: 'submissiontime:desc',
      apiversion: '5.5',
      displaycode: `${displayCode}-${locale.toLowerCase()}`,
    })
    return (
      `https://apps.bazaarvoice.com/bfd/v1/clients/${encodeURIComponent(client)}` +
      `/api-products/cv2/resources/data/reviews.json?${q.toString()}`
    )
  }
}

function toRawReview(r: BvReview, comments: Record<string, BvComment>): RawReview {
  const photos = r.Photos ?? []
  const videos = r.Videos ?? []

  return {
    sourceReviewId: String(r.Id),
    sourceProductId: String(r.ProductId),
    rating: r.Rating ?? null,
    ratingRange: r.RatingRange ?? 5,
    title: r.Title ?? null,
    body: r.ReviewText ?? null,
    pros: r.Pros ?? null,
    cons: r.Cons ?? null,
    authorName: r.UserNickname ?? null,
    authorId: r.AuthorId ?? null,
    authorLocation: r.UserLocation ?? null,
    // Bazaarvoice expresses "verified purchaser" as the presence of a badge
    // rather than a boolean field.
    isVerifiedBuyer: Boolean(r.Badges && 'verifiedPurchaser' in r.Badges),
    isRecommended: r.IsRecommended ?? null,
    isIncentivized: null,
    isSyndicated: r.IsSyndicated ?? null,
    isRatingsOnly: Boolean(r.IsRatingsOnly),
    helpfulCount: r.TotalPositiveFeedbackCount ?? 0,
    unhelpfulCount: r.TotalNegativeFeedbackCount ?? 0,
    photoCount: photos.length,
    videoCount: videos.length,
    variantLabel: null,
    sourceVariantId: null,
    contextData: buildContext(r),
    media: [
      ...photos.map((p) => ({
        type: 'photo',
        url: p.Sizes?.['normal']?.Url ?? p.Sizes?.['large']?.Url ?? '',
        caption: p.Caption ?? null,
      })),
      ...videos.map((v) => ({ type: 'video', url: v.VideoUrl ?? '', caption: v.Caption ?? null })),
    ].filter((m) => m.url !== ''),
    submittedAt: r.SubmissionTime ?? null,
    sourceUpdatedAt: r.LastModificationTime ?? null,
    languageCode: r.ContentLocale ?? null,
    responses: collectResponses(r, comments),
  }
}

/**
 * Age / Gender / LengthOfOwnership arrive as `{Age: {Value: '55to64', Id: 'Age'}}`.
 * Flattened to `{Age: '55to64'}` so a later segment query is a plain ->> lookup,
 * with badges and secondary ratings kept alongside under their own keys.
 */
function buildContext(r: BvReview): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(r.ContextDataValues ?? {})) {
    if (value && typeof value === 'object' && 'Value' in value) out[key] = value.Value
  }
  if (r.SecondaryRatings && Object.keys(r.SecondaryRatings).length > 0) {
    out['_secondaryRatings'] = r.SecondaryRatings
  }
  if (r.Badges && Object.keys(r.Badges).length > 0) {
    out['_badges'] = Object.keys(r.Badges)
  }
  if (r.IsFeatured) out['_isFeatured'] = true
  return out
}

function collectResponses(
  r: BvReview,
  comments: Record<string, BvComment>,
): RawReviewResponse[] {
  const out: RawReviewResponse[] = []

  for (const c of r.ClientResponses ?? []) {
    const body = (c.Response ?? '').trim()
    if (!body) continue
    out.push({
      sourceResponseId: c.Id ? String(c.Id) : null,
      department: c.Department ?? null,
      authorName: c.Name || c.SourceClientName || null,
      responseSource: c.ResponseSource ?? null,
      body,
      respondedAt: c.Date ?? null,
    })
  }

  // The other place a chain can live, depending on deployment config.
  for (const id of r.CommentIds ?? []) {
    const c = comments[id]
    const body = (c?.CommentText ?? '').trim()
    if (!body) continue
    out.push({
      sourceResponseId: String(id),
      department: null,
      authorName: c?.UserNickname ?? null,
      responseSource: 'comment',
      body,
      respondedAt: c?.SubmissionTime ?? null,
    })
  }

  return out
}

function olderThan(iso: string | null | undefined, since: Date): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t < since.getTime()
}

function required(config: Record<string, string>, key: string): string {
  const value = config[key]
  if (!value) {
    throw new Error(
      `bazaarvoice: review_config.${key} is required. ` +
        `Read it from apps.bazaarvoice.com/deployments/<client>/<zone>/production/<locale>/api-config.js`,
    )
  }
  return value
}
