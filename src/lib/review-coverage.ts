/**
 * How complete our review collection is, per MODEL.
 *
 * Pure and free of 'server-only' so the rule can be tested directly — it is
 * arithmetic, and it previously shipped wrong.
 */

/**
 * Per listing is the wrong unit, and produced a false alarm.
 *
 * JOOLA sells the Perseus Pro IV under three listings, and Bazaarvoice reports
 * the same family-wide 306 on every one of them, while our reviews are
 * deduplicated and each attaches to exactly one listing: 41 + 45 + 228 = 314.
 * Comparing any single listing's 41 against the family's 306 reads as 87%
 * missing when in fact nothing is missing at all.
 *
 * So `stored` is summed across a model's listings and `reported` is the LARGEST
 * figure any of them claims, never the sum.
 */
export interface ModelCoverage {
  modelId: string
  modelName: string
  brand: string
  /** Reviews we hold across every listing of this model. */
  stored: number
  /** The largest total any of its listings reports. */
  reported: number
  /** How many listings this model is sold under. */
  listings: number
}

/**
 * Gaps worth showing a reader.
 *
 * Two guards, and both are needed. The proportional one drops rounding noise on
 * a large model; the absolute one drops a model holding 35 of 37, where the
 * difference is a crawl landing between a review being posted and the
 * platform's own counter catching up.
 */
export function materialGaps(coverage: ModelCoverage[]): ModelCoverage[] {
  return coverage
    .filter((c) => c.reported > c.stored && c.reported - c.stored >= 25)
    .filter((c) => (c.reported - c.stored) / c.reported >= 0.1)
    .sort((a, b) => b.reported - b.stored - (a.reported - a.stored))
}
