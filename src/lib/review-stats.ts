/**
 * Roll-ups over resolved review facts.
 *
 * Pure and free of 'server-only' so the arithmetic can be tested without a
 * database. Loading lives in review-analysis.ts.
 */
import { SHAPES, formatShape, formatThickness, type Shape } from './review-dimensions.js'

/** One review, reduced to only what the analysis page counts. */
export interface ReviewFact {
  productId: string
  productTitle: string
  modelId: string | null
  modelName: string | null
  brand: string
  brandSlug: string
  rating: number | null
  shape: Shape | null
  thicknessMm: number | null
}

export interface AnalysisFilter {
  brandSlug?: string | undefined
  productId?: string | undefined
  /** Exact star ratings to keep. Empty or absent means every rating. */
  ratings?: number[] | undefined
  /** 'none' selects reviews whose shape could not be resolved. */
  shape?: Shape | 'none' | undefined
  /** 'none' selects reviews whose thickness could not be resolved. */
  thicknessMm?: number | 'none' | undefined
}

export function matchesFilter(fact: ReviewFact, filter: AnalysisFilter): boolean {
  if (filter.brandSlug && fact.brandSlug !== filter.brandSlug) return false
  if (filter.productId && fact.productId !== filter.productId) return false
  if (filter.ratings?.length && (fact.rating === null || !filter.ratings.includes(fact.rating))) {
    return false
  }
  if (filter.shape !== undefined) {
    if (filter.shape === 'none' ? fact.shape !== null : fact.shape !== filter.shape) return false
  }
  if (filter.thicknessMm !== undefined) {
    if (filter.thicknessMm === 'none' ? fact.thicknessMm !== null : fact.thicknessMm !== filter.thicknessMm) {
      return false
    }
  }
  return true
}

export interface Tally {
  count: number
  rated: number
  ratingSum: number
  five: number
  four: number
  low: number
}

const emptyTally = (): Tally => ({ count: 0, rated: 0, ratingSum: 0, five: 0, four: 0, low: 0 })

function add(tally: Tally, fact: ReviewFact): void {
  tally.count++
  if (fact.rating === null) return
  tally.rated++
  tally.ratingSum += fact.rating
  if (fact.rating >= 5) tally.five++
  else if (fact.rating >= 4) tally.four++
  else tally.low++
}

export function averageOf(tally: Tally): number | null {
  return tally.rated === 0 ? null : tally.ratingSum / tally.rated
}

export interface RankedEntry extends Tally {
  key: string
  label: string
  /** Share of the total the ranking was taken over, 0-1. */
  share: number
}

function rank(groups: Map<string, { label: string; tally: Tally }>, total: number): RankedEntry[] {
  return [...groups]
    .map(([key, { label, tally }]) => ({
      ...tally,
      key,
      label,
      share: total === 0 ? 0 : tally.count / total,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function groupBy(
  facts: ReviewFact[],
  keyOf: (f: ReviewFact) => { key: string; label: string } | null,
): { ranked: RankedEntry[]; total: number } {
  const groups = new Map<string, { label: string; tally: Tally }>()
  let total = 0
  for (const fact of facts) {
    const id = keyOf(fact)
    if (!id) continue
    total++
    const group = groups.get(id.key) ?? { label: id.label, tally: emptyTally() }
    add(group.tally, fact)
    groups.set(id.key, group)
  }
  return { ranked: rank(groups, total), total }
}

/**
 * Reviews whose listing never resolved to a canonical model.
 *
 * Counted and shown rather than dropped: a brand whose leaderboard silently
 * omits 300 reviews is a brand whose leaderboard cannot be checked against the
 * review total on any other page.
 */
export interface BrandLeaderboard {
  brand: string
  brandSlug: string
  total: number
  tally: Tally
  models: RankedEntry[]
  unmatched: number
}

export function leaderboardsByBrand(facts: ReviewFact[]): BrandLeaderboard[] {
  const brands = new Map<string, ReviewFact[]>()
  for (const fact of facts) {
    const list = brands.get(fact.brandSlug) ?? []
    list.push(fact)
    brands.set(fact.brandSlug, list)
  }

  return [...brands]
    .map(([brandSlug, rows]) => {
      const { ranked } = groupBy(rows, (f) =>
        f.modelId && f.modelName ? { key: f.modelId, label: f.modelName } : null,
      )
      const tally = emptyTally()
      for (const row of rows) add(tally, row)
      return {
        brand: rows[0]!.brand,
        brandSlug,
        total: rows.length,
        tally,
        models: ranked,
        unmatched: rows.filter((f) => !f.modelId).length,
      }
    })
    .sort((a, b) => b.total - a.total)
}

export function byProduct(facts: ReviewFact[]): RankedEntry[] {
  return groupBy(facts, (f) => ({ key: f.productId, label: f.productTitle })).ranked
}

/**
 * Shape and thickness breakdowns always include a 'Not recorded' row, even at
 * zero, so the reader can see the coverage rather than having to infer it from
 * a total that does not add up.
 */
export function byShape(facts: ReviewFact[]): RankedEntry[] {
  const ranked = groupBy(facts, (f) => ({
    key: f.shape ?? 'none',
    label: formatShape(f.shape),
  })).ranked
  return withUnrecordedLast(ranked, 'none', formatShape(null))
}

export function byThickness(facts: ReviewFact[]): RankedEntry[] {
  const ranked = groupBy(facts, (f) => ({
    key: f.thicknessMm === null ? 'none' : String(f.thicknessMm),
    label: formatThickness(f.thicknessMm),
  })).ranked
  // Thickness reads as a scale, so it is ordered by millimetre rather than by
  // popularity; 'Not recorded' still sorts to the end.
  const recorded = ranked
    .filter((e) => e.key !== 'none')
    .sort((a, b) => Number(a.key) - Number(b.key))
  return withUnrecordedLast(recorded, 'none', formatThickness(null), ranked)
}

function withUnrecordedLast(
  entries: RankedEntry[],
  key: string,
  label: string,
  source: RankedEntry[] = entries,
): RankedEntry[] {
  const existing = source.find((e) => e.key === key)
  const rest = entries.filter((e) => e.key !== key)
  // An absent bucket is shown at zero rather than omitted, so full coverage
  // reads as 'Not recorded 0' instead of as a missing row.
  return [...rest, existing ?? { ...emptyTally(), key, label, share: 0 }]
}

/** The shapes actually present, in the vocabulary's own order. */
export function shapesPresent(facts: ReviewFact[]): Shape[] {
  const seen = new Set(facts.map((f) => f.shape).filter((s): s is Shape => s !== null))
  return SHAPES.filter((s) => seen.has(s))
}

export function thicknessesPresent(facts: ReviewFact[]): number[] {
  const seen = new Set(facts.map((f) => f.thicknessMm).filter((t): t is number => t !== null))
  return [...seen].sort((a, b) => a - b)
}

/** What fraction of these reviews resolved to a value at all, 0-1. */
export function coverage(facts: ReviewFact[], of: 'shape' | 'thickness'): number {
  if (facts.length === 0) return 0
  const known = facts.filter((f) => (of === 'shape' ? f.shape !== null : f.thicknessMm !== null))
  return known.length / facts.length
}
