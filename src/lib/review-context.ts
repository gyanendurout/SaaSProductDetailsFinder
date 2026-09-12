/**
 * The structured answers review platforms collect alongside the stars.
 *
 * Every platform asks a different set, so NONE of this is comparable across
 * brands. Selkirk's Okendo form asks where a paddle sits on a power-to-control
 * scale; JOOLA's Bazaarvoice form asks the reviewer's age and how long they
 * have owned it; Judge.me stores only badges. Putting two brands' answers in
 * one chart would be comparing questionnaires, not paddles — so callers must
 * scope these to a single brand, and the UI says which brand each panel covers.
 */

/** Okendo writes a scale answer as {scale:[...labels], value:-1..1}. */
interface OkendoScale {
  scale?: unknown
  value?: unknown
}

function asScale(raw: unknown): { labels: string[]; value: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const { scale, value } = raw as OkendoScale
  if (!Array.isArray(scale) || typeof value !== 'number' || !Number.isFinite(value)) return null
  const labels = scale.filter((s): s is string => typeof s === 'string')
  return labels.length >= 2 ? { labels, value } : null
}

const PERCEPTION_KEY =
  'Would you consider this paddle a power paddle, hybrid paddle or control paddle'
const PREVIOUS_BRAND_KEY = 'Was your previous paddle a Selkirk paddle or other brand?'
const OWNERSHIP_KEY = 'LengthOfOwnership'
const AGE_KEY = 'Age'
const GENDER_KEY = 'Gender'

export type Perception = 'power' | 'hybrid' | 'control'

/**
 * Where the buyer places the paddle on the power-to-control axis.
 *
 * The raw value runs -1 to +1 across three labels. Thirds rather than a
 * sign test, so the middle of the scale reads as 'hybrid' — which is a real
 * answer the form offers, not a fence-sit to be pushed to one side.
 */
export function perceptionOf(context: Record<string, unknown> | null): Perception | null {
  const scale = asScale(context?.[PERCEPTION_KEY])
  if (!scale) return null
  if (scale.value <= -1 / 3) return 'power'
  if (scale.value >= 1 / 3) return 'control'
  return 'hybrid'
}

/** Whether the reviewer's previous paddle was this brand's — Selkirk's form only. */
export function wasReturningBuyer(context: Record<string, unknown> | null): boolean | null {
  const raw = context?.[PREVIOUS_BRAND_KEY]
  const scale = asScale(raw)
  if (scale) {
    // Label order decides polarity; index 0 is the brand's own option.
    const own = /selkirk/i.test(scale.labels[0] ?? '')
    return own ? scale.value <= 0 : scale.value >= 0
  }
  if (typeof raw === 'string') return /selkirk/i.test(raw)
  return null
}

/**
 * How long the reviewer had owned the paddle when they wrote — Bazaarvoice.
 *
 * The durability signal: the same paddle rated on arrival and rated after a
 * season are two different measurements, and only the second says anything
 * about whether it lasts.
 */
export function ownershipBucket(context: Record<string, unknown> | null): string | null {
  const raw = context?.[OWNERSHIP_KEY]
  const value = typeof raw === 'string' ? raw : null
  return value && value.trim() ? value.trim() : null
}

/** Rough ordering for ownership buckets, so a chart reads left to right. */
export function ownershipRank(bucket: string): number {
  const b = bucket.toLowerCase()
  if (b.includes('less than a month') || b.includes('< 1 month')) return 0
  if (b.includes('1-6') || b.includes('1 to 6')) return 1
  if (b.includes('6-12') || b.includes('6 to 12')) return 2
  if (b.includes('1-2 year') || b.includes('more than a year') || b.includes('1+')) return 3
  if (b.includes('more than 2') || b.includes('2+')) return 4
  return 5
}

export function demographic(
  context: Record<string, unknown> | null,
  which: 'age' | 'gender',
): string | null {
  const raw = context?.[which === 'age' ? AGE_KEY : GENDER_KEY]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}
