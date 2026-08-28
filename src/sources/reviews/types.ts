/**
 * The extension seam for review platforms.
 *
 * Deliberately a separate seam from SourceAdapter. The catalogue platform and
 * the review platform are independent choices a merchant makes: all three
 * brands here run Shopify, and all three run a *different* review app
 * (Bazaarvoice, Okendo, Judge.me). Folding reviews into SourceAdapter would
 * have forced a ShopifyBazaarvoiceAdapter / ShopifyOkendoAdapter cross-product.
 *
 * Like SourceAdapter, an implementation does no normalization and no database
 * work — it turns one storefront's review API into these plain shapes.
 */

/** A brand reply, or any later message in the chain hanging off a review. */
export interface RawReviewResponse {
  /** Only some platforms issue one; the pipeline hashes the body when absent. */
  sourceResponseId?: string | null
  /** 'Team JOOLA' — the department the platform attributes the reply to. */
  department?: string | null
  authorName?: string | null
  /** How the reply was submitted ('mc-api'), when exposed. */
  responseSource?: string | null
  body: string
  respondedAt?: string | null
}

export interface RawReview {
  sourceReviewId: string
  /** Storefront product id this review hangs off, as the review platform keys it. */
  sourceProductId: string

  rating: number | null
  /** Almost always 5. Carried because Okendo and Bazaarvoice both allow others. */
  ratingRange: number

  title?: string | null
  body?: string | null
  pros?: string | null
  cons?: string | null

  authorName?: string | null
  authorId?: string | null
  authorLocation?: string | null

  isVerifiedBuyer?: boolean | null
  isRecommended?: boolean | null
  isIncentivized?: boolean | null
  isSyndicated?: boolean | null
  /** A star with no words. Counts toward the average, excluded from text search. */
  isRatingsOnly: boolean

  helpfulCount: number
  unhelpfulCount: number
  photoCount: number
  videoCount: number

  variantLabel?: string | null
  sourceVariantId?: string | null

  /** Platform extras kept whole: age bracket, gender, ownership length, badges. */
  contextData: Record<string, unknown>
  media: Array<{ type: string; url: string; caption?: string | null }>

  /** When the customer wrote it. */
  submittedAt?: string | null
  sourceUpdatedAt?: string | null
  languageCode?: string | null

  responses: RawReviewResponse[]
}

/** One product's worth of reviews, plus whatever the platform claims the total is. */
export interface RawProductReviews {
  sourceProductId: string
  /**
   * The platform's own total. Compared against reviews.length by the pipeline so
   * a truncated fetch is recorded rather than silently averaged.
   */
  reportedTotal: number | null
  reviews: RawReview[]
}

/** Everything an adapter needs to address one storefront's review platform. */
export interface ReviewSiteTarget {
  siteId: string
  baseUrl: string
  /** Free-form per-platform settings from sites.review_config. */
  config: Record<string, string>
}

export interface ReviewSourceAdapter {
  readonly platform: string
  /**
   * Every review for one product, following pagination to the end.
   *
   * `since` is an optimisation, not a filter: when supplied, an implementation
   * may stop paging once it is reading reviews older than that instant. It must
   * still return complete pages, and must ignore the hint if its API cannot
   * sort by submission time descending.
   */
  fetchProductReviews(
    target: ReviewSiteTarget,
    sourceProductId: string,
    since?: Date | null,
  ): Promise<RawProductReviews>
}
