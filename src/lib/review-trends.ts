/**
 * Time-series maths over review facts.
 *
 * Pure, so the bucketing and the trailing-average rules can be tested without
 * a database.
 *
 * The governing caveat, repeated wherever these are rendered: review VOLUME is
 * a demand proxy only WITHIN a brand over time. Across brands it measures
 * solicitation policy as much as sales — JOOLA on Bazaarvoice and CRBN on
 * Judge.me run different review-request programmes, so "CRBN gets more reviews
 * per week than JOOLA" is a statement about email, not about paddles.
 */

export interface DatedPoint {
  /** ISO timestamp. Rows without one are the caller's job to drop. */
  submittedAt: string
  rating: number | null
}

export interface Bucket {
  /** ISO date of the first day in the bucket. */
  start: string
  count: number
  rated: number
  ratingSum: number
}

export type Grain = 'week' | 'month' | 'quarter'

/** Start of the period containing this date, as an ISO date string. */
export function bucketStart(iso: string, grain: Grain): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  if (grain === 'month') return isoDate(Date.UTC(y, m, 1))
  if (grain === 'quarter') return isoDate(Date.UTC(y, Math.floor(m / 3) * 3, 1))
  // Weeks start Monday, so a chart's last bucket is a comparable full week
  // rather than whatever fragment the crawl happened to land on.
  const day = d.getUTCDay()
  const back = (day + 6) % 7
  return isoDate(Date.UTC(y, m, d.getUTCDate() - back))
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Reviews per period, with EVERY period between the first and last present.
 *
 * Gaps are emitted as zero rather than skipped. A line chart that simply joins
 * the periods that happen to have data draws a flat line across a silent month
 * and makes a dead product look steady.
 */
export function bucketize(points: DatedPoint[], grain: Grain): Bucket[] {
  const byStart = new Map<string, Bucket>()
  for (const p of points) {
    const start = bucketStart(p.submittedAt, grain)
    if (!start) continue
    const b = byStart.get(start) ?? { start, count: 0, rated: 0, ratingSum: 0 }
    b.count++
    if (p.rating !== null) {
      b.rated++
      b.ratingSum += p.rating
    }
    byStart.set(start, b)
  }
  if (byStart.size === 0) return []

  const starts = [...byStart.keys()].sort()
  const out: Bucket[] = []
  for (const start of eachPeriod(starts[0]!, starts[starts.length - 1]!, grain)) {
    out.push(byStart.get(start) ?? { start, count: 0, rated: 0, ratingSum: 0 })
  }
  return out
}

function* eachPeriod(first: string, last: string, grain: Grain): Generator<string> {
  let cursor = new Date(first + 'T00:00:00Z')
  const end = new Date(last + 'T00:00:00Z')
  while (cursor.getTime() <= end.getTime()) {
    yield cursor.toISOString().slice(0, 10)
    const y = cursor.getUTCFullYear()
    const m = cursor.getUTCMonth()
    const d = cursor.getUTCDate()
    cursor =
      grain === 'week'
        ? new Date(Date.UTC(y, m, d + 7))
        : new Date(Date.UTC(y, m + (grain === 'quarter' ? 3 : 1), 1))
  }
}

export interface TrendPoint {
  start: string
  count: number
  /** Mean rating of this period alone, or null if nothing was rated in it. */
  average: number | null
  /** Mean over this period and the preceding `window - 1`, or null if thin. */
  trailing: number | null
}

/**
 * The rating trajectory.
 *
 * A per-period mean over a handful of reviews swings wildly — one 1-star in a
 * quiet week drops the line a full point and reads as a quality collapse. The
 * trailing mean is what should be plotted; the raw period mean is kept beside
 * it so a genuine single-period shock is still visible.
 *
 * `minRated` suppresses the trailing figure until enough ratings are in the
 * window, rather than drawing a confident line through two reviews.
 */
export function trajectory(buckets: Bucket[], window = 4, minRated = 5): TrendPoint[] {
  return buckets.map((b, i) => {
    const slice = buckets.slice(Math.max(0, i - window + 1), i + 1)
    const rated = slice.reduce((n, s) => n + s.rated, 0)
    const sum = slice.reduce((n, s) => n + s.ratingSum, 0)
    return {
      start: b.start,
      count: b.count,
      average: b.rated === 0 ? null : b.ratingSum / b.rated,
      trailing: rated >= minRated ? sum / rated : null,
    }
  })
}

/**
 * Periods since the model's first review, so two models that launched years
 * apart can be compared on the same axis.
 */
export function alignToLaunch(buckets: Bucket[]): Array<Bucket & { period: number }> {
  return buckets.map((b, i) => ({ ...b, period: i }))
}

/** Reviews in the last `days`, and in the `days` before that. */
export function recentSplit(
  points: DatedPoint[],
  days: number,
  now = Date.now(),
): { recent: DatedPoint[]; prior: DatedPoint[] } {
  const [recent, prior] = rollingWindows(points, days, 2, now)
  return { recent: recent?.points ?? [], prior: prior?.points ?? [] }
}

export interface Window {
  /** 0 is the most recent window, 1 the one before it, and so on. */
  index: number
  /** Whole days ago the window starts and ends, e.g. 90 and 180. */
  fromDaysAgo: number
  toDaysAgo: number
  points: DatedPoint[]
  /** Mean rating inside the window, or null if nothing in it was rated. */
  average: number | null
}

/**
 * The last `count` windows of `days` each, newest first.
 *
 * Generalises recentSplit from two windows to any number, so a reader can see
 * whether a drop is a blip or the fourth quarter of a slide. Each window is
 * half-open — a review exactly on a boundary belongs to the newer window — so
 * no review is counted twice and none falls between two windows.
 */
export function rollingWindows(
  points: DatedPoint[],
  days: number,
  count: number,
  now = Date.now(),
): Window[] {
  const ms = days * 24 * 60 * 60 * 1000
  const windows: Window[] = Array.from({ length: count }, (_, index) => ({
    index,
    fromDaysAgo: index * days,
    toDaysAgo: (index + 1) * days,
    points: [],
    average: null,
  }))

  for (const p of points) {
    const t = new Date(p.submittedAt).getTime()
    if (Number.isNaN(t)) continue
    const age = now - t
    if (age < 0) continue
    const index = Math.floor(age / ms)
    if (index < count) windows[index]!.points.push(p)
  }

  for (const w of windows) {
    const rated = w.points.filter((p) => p.rating !== null)
    w.average =
      rated.length === 0 ? null : rated.reduce((n, p) => n + (p.rating ?? 0), 0) / rated.length
  }
  return windows
}

/**
 * Change between two counts as a ratio.
 *
 * Growth from zero is unbounded, so it returns null rather than Infinity: a
 * model's first-ever review is not "infinite growth", it is a launch, and the
 * caller should say so instead of printing a number.
 */
export function growthRatio(recent: number, prior: number): number | null {
  if (prior === 0) return null
  return (recent - prior) / prior
}
