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

/**
 * Ordering for ownership buckets, shortest first.
 *
 * The patterns this matched were written from what Bazaarvoice's documentation
 * calls these options in prose — "less than a month", "1-6 months". What it
 * actually stores are codes: 1week, 1month, 3months, 6months, 1year. Not one of
 * them matched, so every bucket tied on the fallback and the table fell back to
 * the order the rows happened to arrive in — which is corpus order, and so
 * roughly descending by volume.
 *
 * That was worse than an arbitrary order, because the table's caption tells the
 * reader to compare the FIRST row with the LAST as new owners against long-term
 * owners. It was inviting a durability reading of a popularity sort. In the
 * corpus as it stands that put "1week" second rather than first.
 *
 * The prose patterns are kept alongside the codes: Bazaarvoice's own reporting
 * exports use them, so a future backfill may well arrive in that shape. They are
 * written with separators already stripped, because the bucket is normalised
 * before it is matched — '1-6 months' is compared as '16months'.
 *
 * Order within the list is load-bearing: '16months' contains '6months', so the
 * 1-6 bucket has to be tested before the 6-12 one.
 */
export function ownershipRank(bucket: string): number {
  const b = bucket.toLowerCase().replace(/[\s_-]+/g, '')
  for (let i = 0; i < OWNERSHIP_ORDER.length; i++) {
    if (OWNERSHIP_ORDER[i]!.match.some((m) => b.includes(m))) return i
  }
  return OWNERSHIP_ORDER.length
}

/**
 * Shortest to longest, with the stored code and the prose form side by side.
 *
 * `label` says only what the stored value says. Bazaarvoice does not record
 * whether "1month" means "about a month" or "up to a month", and inventing a
 * comparator would put a claim in the table that the data does not carry.
 */
const OWNERSHIP_ORDER: ReadonlyArray<{ match: string[]; label: string }> = [
  { match: ['lessthanaweek', '<1week', '1week'], label: '1 week' },
  { match: ['lessthanamonth', '<1month', '1month'], label: '1 month' },
  { match: ['3months', '1to6months', '16months'], label: '3 months' },
  { match: ['6months', '6to12months', '612months'], label: '6 months' },
  { match: ['1year', '12year', 'morethanayear'], label: '1 year' },
  { match: ['2years', 'morethan2', '2+'], label: '2 years or more' },
]

/**
 * An ownership bucket in words.
 *
 * The column printed the stored code — a reader met "1month" and "3months" in a
 * table of otherwise ordinary English. An unrecognised code is returned as it
 * is rather than guessed at: showing an unknown value plainly is honest, and
 * mislabelling it is not.
 */
export function ownershipLabel(bucket: string): string {
  const rank = ownershipRank(bucket)
  return OWNERSHIP_ORDER[rank]?.label ?? bucket
}

export function demographic(
  context: Record<string, unknown> | null,
  which: 'age' | 'gender',
): string | null {
  const raw = context?.[which === 'age' ? AGE_KEY : GENDER_KEY]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}
