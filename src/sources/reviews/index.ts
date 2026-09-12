import { PoliteClient } from '../../lib/http.js'
import { BazaarvoiceReviewAdapter } from './bazaarvoice.js'
import { OkendoReviewAdapter } from './okendo.js'
import { JudgeMeReviewAdapter } from './judgeme.js'
import { YotpoReviewAdapter } from './yotpo.js'
import type { ReviewSourceAdapter } from './types.js'

export * from './types.js'
export { BazaarvoiceReviewAdapter } from './bazaarvoice.js'
export { OkendoReviewAdapter } from './okendo.js'
export { JudgeMeReviewAdapter } from './judgeme.js'
export { YotpoReviewAdapter } from './yotpo.js'

export const REVIEW_PLATFORMS = ['bazaarvoice', 'okendo', 'judgeme', 'yotpo'] as const
export type ReviewPlatform = (typeof REVIEW_PLATFORMS)[number]

/**
 * Resolves a storefront's `review_platform` to an adapter.
 *
 * Returns null rather than throwing for an unset platform: a site with no
 * reviews configured is a normal state (a new brand, or one whose review app we
 * have not mapped yet), and the reviews stage should skip it, not fail the run.
 * An unknown non-empty value IS an error — it means a typo in config, which
 * would otherwise silently collect nothing forever.
 */
export function buildReviewAdapter(
  platform: string | null | undefined,
  http: PoliteClient,
): ReviewSourceAdapter | null {
  if (!platform) return null
  switch (platform) {
    case 'bazaarvoice':
      return new BazaarvoiceReviewAdapter(http)
    case 'okendo':
      return new OkendoReviewAdapter(http)
    case 'judgeme':
      return new JudgeMeReviewAdapter(http)
    case 'yotpo':
      return new YotpoReviewAdapter(http)
    default:
      throw new Error(
        `Unknown review_platform "${platform}". Expected one of ${REVIEW_PLATFORMS.join(', ')}, ` +
          `or implement ReviewSourceAdapter in src/sources/reviews/.`,
      )
  }
}
