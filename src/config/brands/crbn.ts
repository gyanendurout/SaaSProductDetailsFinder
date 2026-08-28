import type { BrandRules } from './types.js'

/**
 * CRBN Pickleball — Costa Mesa, California. Shopify, USD.
 *
 * A third naming grammar, and the one that bends the model furthest:
 *
 *   CRBN¹ TruFoam Barrage (Elongated, Long Handle)
 *   └┬──┘ └──┬──┘ └──┬──┘  └────────┬───────────┘
 *   shape   series  model      shape, again in words
 *
 * The superscript is not a version and not a line — it is the **shape**. CRBN¹
 * is elongated with a long handle, CRBN² is square, CRBN³ elongated, CRBN⁴
 * hybrid. So where JOOLA numbers generations and Selkirk names its shapes after
 * models, CRBN numbers its shapes, and the same paddle exists as four products
 * that differ only in face geometry.
 *
 * Two consequences:
 *
 *   - The line is the series (TruFoam, X Series, Classic), never the number.
 *   - The digits are typographic superscripts — U+00B9, U+00B2, U+00B3,
 *     U+2074 — not ASCII. They survive `\d` filters and slugify into nothing,
 *     so they are normalised to ASCII before anything else looks at the title.
 *
 * CRBN merchandises no skill tier and no play style: there are no beginner or
 * control collections, and the tags are display labels ('_label_New',
 * '_label_sale') carrying no taxonomy. Both resolve to 'unknown', which is the
 * correct answer rather than a gap to be filled in.
 */
export const CRBN_RULES: BrandRules = {
  slug: 'crbn',
  name: 'CRBN',

  productLines: [
    { slug: 'trufoam', name: 'TruFoam' },
    { slug: 'x-series', name: 'X Series' },
    { slug: 'classic', name: 'Classic' },
  ],

  // No endorsement naming: colourways are colours, not athletes.
  players: [],

  // No generations. CRBN reissues under a new series name, not a version
  // number — the numerals belong to shape, and treating them as generations
  // would file four shapes of one paddle as four versions of it.
  generations: [],

  // The model within a series: Barrage, Waves, Genesis, and the Summit
  // limited drop. Matched so the name keeps them rather than collapsing every
  // TruFoam paddle into one row.
  subLinePattern: /\b(Barrage|Waves Summit|Waves|Genesis|Summit)\b/,

  // The leading alternative strips the whole parenthetical. On this store it is
  // always a restatement of the shape — '(Elongated, Long Handle)', '(Square)',
  // '(Hybrid, AeroCurve)' — which `shapeAliases` has already read. Leaving it in
  // split one paddle into 'TruFoam Barrage' and 'TruFoam Barrage Long Handle'.
  titleNoisePattern:
    /\([^)]*\)|\b(CRBN|Pickleball|Paddle|Paddles|LIMITED DROP|Paddle Optimization)\b/gi,

  // CRBN sells one range and does not grade it. Left deliberately empty so
  // every model reads 'unknown' instead of a tier being inferred from prose.
  tierAliases: [],

  shapeAliases: [
    // The parenthetical, which is unambiguous where it appears.
    { pattern: /\blong\s?handle\b/i, shape: 'elongated' },
    { pattern: /\baerocurve\b/i, shape: 'hybrid' },
    { pattern: /\belongated\b/i, shape: 'elongated' },
    { pattern: /\bsquare\b/i, shape: 'square' },
    { pattern: /\bhybrid\b/i, shape: 'hybrid' },
    // The numeral, after superscripts have been folded to ASCII. Written to
    // match a whole token so a '1' inside '12MM' cannot be read as a shape.
    { pattern: /\bcrbn-?1\b/i, shape: 'elongated' },
    { pattern: /\bcrbn-?2\b/i, shape: 'square' },
    { pattern: /\bcrbn-?3\b/i, shape: 'elongated' },
    { pattern: /\bcrbn-?4\b/i, shape: 'hybrid' },
  ],

  lineByCollection: {
    'crbn-original-series-pickleball-paddles': 'classic',
    'crbn-trufoam-foam-pickleball-paddles': 'trufoam',
    'crbn-power-series-pickleball-paddles': 'x-series',
  },

  // No power/control/hybrid merchandising, so no pattern. 'hybrid' appears in
  // CRBN's vocabulary as a face shape, and matching it here would report a
  // shape as a playing style.
}
