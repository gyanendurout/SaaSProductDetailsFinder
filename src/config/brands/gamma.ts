import type { BrandRules } from './types.js'

/**
 * GAMMA Sports — Pittsburgh, Pennsylvania. Shopify, USD.
 *
 * GAMMA is the odd one in this set: pickleball is a minority of the catalogue.
 * Of 237 products, 12 are pickleball paddles; the rest is tennis string,
 * stringing machines, padel rackets, court equipment and apparel. Every other
 * brand here sells paddles and accessories for paddles.
 *
 * That makes the assortment gate load-bearing rather than a formality. The
 * store types its products precisely — `product_type` is exactly
 * 'Pickleball Paddle' on the twelve — and the paddle collections are clean, so
 * the gate has something reliable to work with. Two entries in that type are
 * still not single paddles: 'Rainmaker Bundle' (two paddles) and 'Airbender 16
 * Deluxe Box Set'. Both are stripped by `titleNoisePattern` so they do not
 * invent a 'Bundle' or 'Box Set' product line.
 *
 * The naming grammar is a line plus a number:
 *
 *   GAMMA Airbender 16 Pickleball Paddle
 *         └───┬────┘ └┬┘
 *           line   thickness in mm
 *
 * The number is the core thickness, not a version and not a shape — Airbender
 * ships at 10, 13, 16 and 22mm. Crucially it is written bare, with no 'mm'
 * suffix, which the shared attribute parser (`/\d{1,2}(\.\d)?\s*mm/`) will not
 * read. So on this brand thickness comes from the product title via the
 * numeric token, and the bare number is stripped from the line guess here so
 * 'Airbender 16' and 'Airbender 22' resolve to one line rather than two.
 *
 * GAMMA publishes control/power collections ('Control Paddles', 'All Court
 * Paddles'), so play style is real here. It publishes no skill tier.
 */
export const GAMMA_RULES: BrandRules = {
  slug: 'gamma',
  name: 'GAMMA',

  productLines: [
    { slug: 'airbender', name: 'Airbender' },
    { slug: 'obsidian', name: 'Obsidian' },
    { slug: 'knockout', name: 'Knockout' },
    { slug: 'rainmaker', name: 'Rainmaker' },
    { slug: 'fusion', name: 'Fusion' },
  ],

  players: [],

  // No version vocabulary: the numerals are thickness.
  generations: [],

  // 'Power' and 'SW' distinguish builds within the Fusion line.
  subLinePattern: /\b(Power SW|Power|SW)\b/,

  // Strips the brand word GAMMA prints on every title, the bare thickness
  // number, and the bundle wording.
  titleNoisePattern:
    /\bGAMMA\b|\b\d{2}\b|\b(Deluxe Box Set|Box Set|Bundle|Pickleball|Paddle|Paddles)\b/gi,

  // Deliberately empty: GAMMA grades nothing.
  tierAliases: [],

  shapeAliases: [
    { pattern: /\belongated\b/i, shape: 'elongated' },
    { pattern: /\bhybrid\b/i, shape: 'hybrid' },
    { pattern: /\bwide\s?body\b/i, shape: 'widebody' },
    { pattern: /\ball\s?court\b/i, shape: 'standard' },
    { pattern: /\bstandard\b/i, shape: 'standard' },
  ],

  playStylePattern: /\b(power|control)\b/i,

  // 'GAMMA Airbender 16 Pickleball Paddle' — the 16 is millimetres. Unambiguous
  // on this brand because the only bare two-digit number a GAMMA paddle title
  // carries is its core thickness, and the 10-25mm sanity check still runs
  // afterwards. Without it, 54 of GAMMA's 62 SKUs resolve to a null thickness.
  bareThicknessInTitle: /\b(\d{2})\b/,
}
