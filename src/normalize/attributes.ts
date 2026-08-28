import type { RawProduct, RawVariant } from '../sources/types.js'
import type { BrandRules } from '../config/brands/types.js'
import { foldTypography } from './text.js'

/**
 * Attribute extraction.
 *
 * The problem this solves, observed live on joola.com 2026-08-27:
 *
 *   Perseus Pro V   1 product, 4 variants   options: Size=[16mm,14mm], Color=[...]
 *   Perseus Pro IV  6 products, 1 variant   thickness + colour live in the TITLE
 *
 * Both are Perseus paddles at two thicknesses in several colourways. Any query
 * like "what thicknesses does Perseus come in" has to see through that. So every
 * attribute is resolved from whichever evidence is available, in a fixed
 * precedence order, and records WHICH evidence won.
 *
 * Precedence: explicit option value > product title > tag > collection > LLM.
 * An option value is the publisher stating the fact; a title is us parsing prose.
 */

export type AttrSource = 'source_option' | 'title' | 'tag' | 'collection' | 'pdp' | 'llm' | 'manual'

export interface Resolved<T> {
  value: T
  source: AttrSource
  confidence: number
}

export interface VariantAttributes {
  coreThicknessMm: Resolved<number> | null
  colorway: Resolved<string> | null
  colorPrimary: string | null
  colorSecondary: string | null
  endorsedPlayer: Resolved<string> | null
  shape: Resolved<PaddleShape> | null
  weightGrams: Resolved<number> | null
}

/**
 * 'square' arrived with CRBN, whose CRBN² is a genuinely square face rather
 * than any of the four shapes JOOLA and Selkirk between them use. Adding it
 * needed no migration: shapes became a reference table in
 * 20260827000005, so `npm run sync` inserts the new code before the crawl that
 * first uses it.
 */
export type PaddleShape =
  | 'elongated'
  | 'hybrid'
  | 'standard'
  | 'widebody'
  | 'square'
  | 'unknown'

const THICKNESS_RE = /(\d{1,2}(?:\.\d)?)\s*mm/i
/** 'Blaze Red (Ben Johns)' -> colour 'Blaze Red', player 'Ben Johns' */
const PLAYER_IN_PARENS_RE = /^(.*?)\s*\(([^)]+)\)\s*$/
/** Option names that carry thickness on this and most paddle stores. */
const THICKNESS_OPTION_NAMES = new Set(['size', 'thickness', 'core', 'core thickness'])
const COLOR_OPTION_NAMES = new Set(['color', 'colour', 'colorway', 'colourway'])
/** Selkirk publishes shape and weight as real Shopify options. */
const SHAPE_OPTION_NAMES = new Set(['shape', 'profile'])
const WEIGHT_OPTION_NAMES = new Set(['weight'])

// Weight parsing. Ranges are matched before single values, because
// 'Lightweight (7.6-8.0 oz)' would otherwise match only the 8.0.
const OZ_RANGE_RE = /(\d{1,2}(?:\.\d+)?)\s*[-–—]\s*(\d{1,2}(?:\.\d+)?)\s*oz/i
const OZ_RE = /(\d{1,2}(?:\.\d+)?)\s*oz/i
const G_RANGE_RE = /(\d{2,3}(?:\.\d+)?)\s*[-–—]\s*(\d{2,3}(?:\.\d+)?)\s*g\b/i
const G_RE = /(\d{2,3}(?:\.\d+)?)\s*g\b/i

const SHAPE_KEYWORDS: Array<[RegExp, PaddleShape]> = [
  [/\belongated\b/i, 'elongated'],
  [/\bhybrid\b/i, 'hybrid'],
  [/\bwide\s?body\b/i, 'widebody'],
  [/\bstandard\b/i, 'standard'],
]

/**
 * Resolve one SKU's physical attributes from the variant, its parent product,
 * and the collections it sits in.
 */
export function extractVariantAttributes(
  product: RawProduct,
  variant: RawVariant,
  rules?: BrandRules,
): VariantAttributes {
  const knownPlayers = rules?.players ?? []
  const colorway = resolveColorway(product, variant, knownPlayers)
  return {
    coreThicknessMm: resolveThickness(product, variant),
    colorway,
    ...splitColors(colorway?.value ?? null),
    endorsedPlayer: resolvePlayer(product, variant, knownPlayers),
    shape: resolveShape(product, variant, rules),
    weightGrams: resolveWeight(variant),
  }
}

function resolveThickness(product: RawProduct, variant: RawVariant): Resolved<number> | null {
  // 1. An explicit option — the publisher stating it outright.
  for (const opt of variant.options) {
    if (!THICKNESS_OPTION_NAMES.has(opt.name.trim().toLowerCase())) continue
    const mm = matchThickness(opt.value)
    if (mm !== null) return { value: mm, source: 'source_option', confidence: 1 }
  }
  // 2. The variant title, e.g. '16mm / Blaze Red'.
  const fromVariantTitle = matchThickness(variant.title ?? '')
  if (fromVariantTitle !== null) {
    return { value: fromVariantTitle, source: 'source_option', confidence: 0.95 }
  }
  // 3. The product title — how Pro IV encodes it.
  const fromProductTitle = matchThickness(product.title)
  if (fromProductTitle !== null) {
    return { value: fromProductTitle, source: 'title', confidence: 0.9 }
  }
  // 4. A tag such as '16mm'.
  for (const tag of product.tags) {
    const mm = matchThickness(tag)
    if (mm !== null) return { value: mm, source: 'tag', confidence: 0.7 }
  }
  // 5. The PDP copy. Lines without a generation (Vision, Dash, Beacon) state the
  //    core only in prose. Accepted ONLY when every in-range measurement in the
  //    body agrees — a description that mentions both 14mm and 16mm is talking
  //    about a range or a cross-sell, and guessing there would be worse than
  //    leaving the field null.
  const fromBody = uniqueThicknessInProse(product.bodyHtml ?? '')
  if (fromBody !== null) return { value: fromBody, source: 'pdp', confidence: 0.6 }

  return null
}

function uniqueThicknessInProse(html: string): number | null {
  const text = html.replace(/<[^>]+>/g, ' ')
  const found = new Set<number>()
  for (const match of text.matchAll(/(\d{1,2}(?:\.\d)?)\s*mm/gi)) {
    const mm = Number(match[1])
    if (Number.isFinite(mm) && mm >= 10 && mm <= 25) found.add(mm)
  }
  return found.size === 1 ? [...found][0]! : null
}

function matchThickness(text: string): number | null {
  const m = THICKNESS_RE.exec(text)
  if (!m?.[1]) return null
  const mm = Number(m[1])
  // Paddle cores are 10-25mm. Anything outside that is a different measurement
  // (grip length, handle) that happened to be written in mm.
  return Number.isFinite(mm) && mm >= 10 && mm <= 25 ? mm : null
}

function resolveColorway(
  product: RawProduct,
  variant: RawVariant,
  knownPlayers: readonly string[] = [],
): Resolved<string> | null {
  for (const opt of variant.options) {
    if (COLOR_OPTION_NAMES.has(opt.name.trim().toLowerCase())) {
      return { value: cleanColor(opt.value), source: 'source_option', confidence: 1 }
    }
  }
  // Pro IV puts it after a dash: 'Perseus Pro IV 16mm Pickleball Paddle - Tropical Red/Pink'
  const dashIdx = product.title.lastIndexOf(' - ')
  if (dashIdx > 0) {
    const tail = product.title.slice(dashIdx + 3).trim()
    // ...but the same slot also carries signature editions
    // ('Hyperion Pro IV 16mm Pickleball Paddle - Simone Jardim'). A player name
    // is an endorsement, not a colour, and storing it as one corrupts every
    // "which colourways exist" answer.
    //
    // Only an exact match against a known player counts. The shape heuristic
    // used for parenthesised names is unusable here: 'Tropical Red' and 'Mellow
    // Mango' are also two capitalised words, and rejecting those would discard
    // most of the real colourways.
    const isPlayer = knownPlayers.some((p) => p.toLowerCase() === tail.toLowerCase())
    if (tail && !THICKNESS_RE.test(tail) && !isPlayer) {
      return { value: cleanColor(tail), source: 'title', confidence: 0.85 }
    }
  }
  return null
}

/** 'Tropical Red/Pink' -> primary 'Tropical Red', secondary 'Pink'. */
function splitColors(colorway: string | null): {
  colorPrimary: string | null
  colorSecondary: string | null
} {
  if (!colorway) return { colorPrimary: null, colorSecondary: null }
  const parts = colorway.split('/').map((p) => p.trim()).filter(Boolean)
  return {
    colorPrimary: parts[0] ?? null,
    colorSecondary: parts[1] ?? null,
  }
}

function resolvePlayer(
  product: RawProduct,
  variant: RawVariant,
  knownPlayers: readonly string[],
): Resolved<string> | null {
  // Colour options name the athlete in parentheses: 'Blaze Red (Ben Johns)'.
  for (const opt of variant.options) {
    const m = PLAYER_IN_PARENS_RE.exec(opt.value)
    const candidate = m?.[2]?.trim()
    if (candidate && looksLikePersonName(candidate)) {
      return { value: candidate, source: 'source_option', confidence: 0.95 }
    }
  }
  // Signature tags such as 'featured-ben johns'.
  const haystack = foldTypography(`${product.title} ${product.tags.join(' ')}`).toLowerCase()
  for (const player of knownPlayers) {
    if (haystack.includes(player.toLowerCase())) {
      return { value: player, source: 'tag', confidence: 0.8 }
    }
  }
  return null
}

/** Two or three capitalised words and no digits — enough to reject 'Simone Jardim' from '16mm'. */
function looksLikePersonName(text: string): boolean {
  if (/\d/.test(text)) return false
  const words = text.trim().split(/\s+/)
  if (words.length < 2 || words.length > 3) return false
  return words.every((w) => /^[A-Z][A-Za-z.'-]*$/.test(w))
}

function resolveShape(
  product: RawProduct,
  variant: RawVariant,
  rules?: BrandRules,
): Resolved<PaddleShape> | null {
  const aliases = rules?.shapeAliases ?? SHAPE_KEYWORDS.map(([pattern, shape]) => ({ pattern, shape }))

  // A Shape option is the publisher stating it outright. Selkirk does this, and
  // its values include proprietary names ('Epic', 'Invikta') that only the
  // brand's own alias table can decode.
  for (const opt of variant.options) {
    if (!SHAPE_OPTION_NAMES.has(opt.name.trim().toLowerCase())) continue
    for (const { pattern, shape } of aliases) {
      if (pattern.test(opt.value)) {
        return { value: shape, source: 'source_option', confidence: 1 }
      }
    }
  }

  const haystack = foldTypography(`${product.title} ${product.tags.join(' ')}`)
  for (const { pattern, shape } of aliases) {
    if (pattern.test(haystack)) return { value: shape, source: 'title', confidence: 0.75 }
  }
  if (product.bodyHtml) {
    for (const { pattern, shape } of aliases) {
      if (pattern.test(product.bodyHtml)) return { value: shape, source: 'pdp', confidence: 0.6 }
    }
  }
  return null
}

const OZ_TO_G = 28.3495

/**
 * Weight from an option value.
 *
 * Selkirk publishes a *band*, not a figure: 'Lightweight (7.6-8.0 oz)'. A naive
 * regex silently grabs whichever number sits next to the unit — 8.0 here — and
 * stores it as though the paddle weighs exactly that, overstating every light
 * paddle by half an ounce. A range is recorded as its midpoint at reduced
 * confidence, which is honest about the imprecision rather than hiding it
 * behind a decimal point.
 */
function resolveWeight(variant: RawVariant): Resolved<number> | null {
  for (const opt of variant.options) {
    if (!WEIGHT_OPTION_NAMES.has(opt.name.trim().toLowerCase())) continue

    const ozRange = OZ_RANGE_RE.exec(opt.value)
    if (ozRange?.[1] && ozRange[2]) {
      const midpoint = (Number(ozRange[1]) + Number(ozRange[2])) / 2
      return { value: round1(midpoint * OZ_TO_G), source: 'source_option', confidence: 0.7 }
    }

    const oz = OZ_RE.exec(opt.value)
    if (oz?.[1]) {
      return { value: round1(Number(oz[1]) * OZ_TO_G), source: 'source_option', confidence: 0.9 }
    }

    const gRange = G_RANGE_RE.exec(opt.value)
    if (gRange?.[1] && gRange[2]) {
      const midpoint = (Number(gRange[1]) + Number(gRange[2])) / 2
      return { value: round1(midpoint), source: 'source_option', confidence: 0.7 }
    }

    const g = G_RE.exec(opt.value)
    if (g?.[1]) {
      return { value: Number(g[1]), source: 'source_option', confidence: 1 }
    }
  }
  return null
}

function round1(value: number): number {
  return Number(value.toFixed(1))
}

function cleanColor(value: string): string {
  // Drop a trailing '(Ben Johns)' — the athlete is captured separately.
  const m = PLAYER_IN_PARENS_RE.exec(value)
  const base = m?.[2] && looksLikePersonName(m[2].trim()) ? (m[1] ?? value) : value
  return base.trim().replace(/\s+/g, ' ')
}

/** Lowest confidence across all resolved attributes — the row's trust score. */
export function overallConfidence(attrs: VariantAttributes): number | null {
  const scores = [
    attrs.coreThicknessMm?.confidence,
    attrs.colorway?.confidence,
    attrs.endorsedPlayer?.confidence,
    attrs.shape?.confidence,
    attrs.weightGrams?.confidence,
  ].filter((s): s is number => typeof s === 'number')
  if (scores.length === 0) return null
  return Math.min(...scores)
}

/** The provenance map stored in variants.attr_source. */
export function attrSourceMap(attrs: VariantAttributes): Record<string, AttrSource> {
  const map: Record<string, AttrSource> = {}
  if (attrs.coreThicknessMm) map['core_thickness_mm'] = attrs.coreThicknessMm.source
  if (attrs.colorway) map['colorway'] = attrs.colorway.source
  if (attrs.endorsedPlayer) map['endorsed_player'] = attrs.endorsedPlayer.source
  if (attrs.shape) map['shape'] = attrs.shape.source
  if (attrs.weightGrams) map['weight_grams'] = attrs.weightGrams.source
  return map
}
