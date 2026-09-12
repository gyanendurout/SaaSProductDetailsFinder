/**
 * Attributing a review to a paddle shape and a core thickness.
 *
 * Neither is recorded on a review. Both live on the SKU, and every review
 * platform we read attaches a review to a LISTING rather than to the SKU the
 * reviewer actually bought. So there are exactly two honest sources:
 *
 *   1. The review's own variant_label, where the platform happened to record
 *      the option bought — 'Elongated / Canyon Clay'. Authoritative when
 *      present, because it names what that reviewer had.
 *   2. The listing's SKUs, but only where they AGREE. A listing selling nothing
 *      but elongated SKUs means any reviewer of it held an elongated paddle. A
 *      listing selling both 14mm and 16mm says nothing about which one a given
 *      reviewer chose, so it resolves to null rather than to a guess.
 *
 * Measured over the 20,771 reviews held at the time of writing:
 *
 *   shape      60.8% resolved (4.8% from a label, the rest from the listing)
 *   thickness  24.5% resolved
 *
 * Thickness is far worse because 14mm and 16mm are usually two options under
 * ONE listing, while elongated and widebody are more often separate listings.
 * 36.6% of reviews sit on a listing selling several thicknesses and only 0.4%
 * name one in their label.
 *
 * null is therefore a common and truthful answer, not an edge case. Every
 * caller must surface it as its own bucket: folding unresolved reviews into
 * '16mm' because it is the popular choice would invent 15,688 facts.
 *
 * Kept free of 'server-only' imports so the resolution rules can be tested
 * directly rather than through a database.
 */

/** Shape codes as the `shapes` vocabulary defines them. */
export const SHAPES = ['elongated', 'widebody', 'hybrid', 'square', 'standard'] as const
export type Shape = (typeof SHAPES)[number]

/**
 * Ordered longest-phrase-first: 'wide body' has to be tested before the bare
 * words or a label reading 'Widebody / Black' would fall through.
 */
const SHAPE_PATTERNS: Array<[RegExp, Shape]> = [
  [/\bwide\s?body\b/i, 'widebody'],
  [/\belongated\b/i, 'elongated'],
  [/\bhybrid\b/i, 'hybrid'],
  [/\bsquare\b/i, 'square'],
  [/\bstandard\b/i, 'standard'],
]

/** The shape a review's own variant label names, if it names one. */
export function shapeFromLabel(label: string | null | undefined): Shape | null {
  if (!label) return null
  for (const [pattern, shape] of SHAPE_PATTERNS) {
    if (pattern.test(label)) return shape
  }
  return null
}

/**
 * The thickness a review's own variant label names, if it names one.
 *
 * Range-checked for the same reason the catalogue resolver is: a label like
 * '2023 Edition / 40mm grip' contains a number followed by mm that is not a
 * core thickness. Paddle cores run roughly 10-25mm.
 */
export function thicknessFromLabel(label: string | null | undefined): number | null {
  if (!label) return null
  const match = /\b(\d{2}(?:\.\d)?)\s*mm\b/i.exec(label)
  if (!match?.[1]) return null
  const mm = Number(match[1])
  return Number.isFinite(mm) && mm >= 10 && mm <= 25 ? mm : null
}

/**
 * The single value shared by every SKU under a listing, or null where they
 * disagree or none is known.
 *
 * Disagreement is the whole point: it is what separates "we know" from "we
 * would be guessing", and it is why this returns null instead of a mode.
 */
export function agreedValue<T extends string | number>(values: Array<T | null | undefined>): T | null {
  const known = new Set<T>()
  for (const v of values) {
    if (v === null || v === undefined) continue
    if (v === 'unknown') continue
    known.add(v)
    if (known.size > 1) return null
  }
  const [only] = known
  return known.size === 1 && only !== undefined ? only : null
}

/** The label wins where it exists, because it describes this reviewer's SKU. */
export function resolveShape(label: string | null | undefined, listingShape: Shape | null): Shape | null {
  return shapeFromLabel(label) ?? listingShape
}

export function resolveThickness(
  label: string | null | undefined,
  listingThickness: number | null,
): number | null {
  return thicknessFromLabel(label) ?? listingThickness
}

/** How a thickness is written for a reader. Whole numbers lose the '.0'. */
export function formatThickness(mm: number | null): string {
  if (mm === null) return 'Not recorded'
  return `${Number.isInteger(mm) ? mm : mm.toFixed(1)}mm`
}

export function formatShape(shape: Shape | null): string {
  if (shape === null) return 'Not recorded'
  return shape === 'widebody' ? 'Wide body' : shape[0]!.toUpperCase() + shape.slice(1)
}
