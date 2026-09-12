import type { PaddleShape } from '../../normalize/attributes.js'
import type { SkillTier } from '../../normalize/taxonomy.js'

/**
 * Per-brand normalization rules.
 *
 * The first version of this project hardcoded JOOLA's vocabulary into the
 * resolver — 'Pro IV', 'perseus-series', 'Ben Johns'. Adding Selkirk made that
 * untenable: Selkirk has no generations at all, calls its skill tiers
 * beginner/intermediate/advanced, names shapes after models (Epic, Invikta), and
 * merchandises a power/control/hybrid axis JOOLA does not have.
 *
 * So brand knowledge lives here as data, and the resolver stays generic. Adding
 * brand #3 should be one file in this directory plus a `sites` row.
 */

export interface GenerationRule {
  slug: string
  name: string
  sequence?: number
  /** Matched against tags and collection handles (exact-ish). */
  tag?: RegExp
  /** Matched against the product title. */
  title?: RegExp
}

export interface BrandRules {
  slug: string
  name: string

  /** Known model families. The resolver still discovers unlisted ones. */
  productLines: ReadonlyArray<{ slug: string; name: string }>

  /** Endorsing athletes, used to keep names out of colourway fields. */
  players: readonly string[]

  /**
   * Version/generation vocabulary, most specific first. Empty for brands that
   * do not version their lines — a null generation is then the correct answer,
   * not a normalization failure.
   */
  generations: readonly GenerationRule[]

  /** Editions sitting between line and generation ('Dual', 'Control Air'). */
  subLinePattern?: RegExp

  /** Words to strip from a title before guessing a line. */
  titleNoisePattern: RegExp

  /**
   * Maps this brand's own tier words onto our shared vocabulary. Selkirk says
   * "advanced", JOOLA says "professional"; both mean the top of the range.
   */
  tierAliases: ReadonlyArray<{ pattern: RegExp; tier: SkillTier }>

  /** Shape names this brand uses, including model-specific ones. */
  shapeAliases: ReadonlyArray<{ pattern: RegExp; shape: PaddleShape }>

  /**
   * Core thickness written as a bare numeral in the product title, with no
   * 'mm' after it. Capture group 1 must be the number.
   *
   * GAMMA titles its paddles 'GAMMA Airbender 16 Pickleball Paddle' — the 16 is
   * millimetres, but the shared parser requires the unit, so without this 54 of
   * GAMMA's 62 SKUs resolve to a null thickness. Left unset for every brand
   * that writes the unit, because a bare two-digit number in a title is
   * ambiguous in general and only safe where the brand's naming makes it
   * unambiguous. The 10-25mm sanity range still applies afterwards.
   */
  bareThicknessInTitle?: RegExp

  /**
   * Play style — power / control / hybrid. Real merchandising for Selkirk,
   * absent for JOOLA, so it is optional per brand.
   */
  playStylePattern?: RegExp

  /**
   * Collection handle -> product line slug, for series a title never names.
   *
   * CRBN's original paddles are titled only 'CRBN¹' and 'CRBN²'. Nothing in the
   * title says which series they belong to; the only statement of it is the
   * shelf they sit on, whose handle
   * ('crbn-original-series-pickleball-paddles') does not contain the word
   * 'Classic' either. Without this they resolve to no line at all and read as
   * two unrelated products rather than two shapes of one.
   */
  lineByCollection?: Readonly<Record<string, string>>
}

export function lineMap(rules: BrandRules): Map<string, string> {
  return new Map(rules.productLines.map((l) => [l.slug, l.name]))
}
