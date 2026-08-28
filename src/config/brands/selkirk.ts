import type { BrandRules } from './types.js'

/**
 * Selkirk Sport. Verified against selkirk.com — 33 paddle products, 233 SKUs.
 *
 * Structurally the opposite of JOOLA: far fewer products, far more variants,
 * because Shape, Color, Weight and Thickness are all real Shopify options rather
 * than being baked into separate products.
 *
 * Three things needed generalising to support it:
 *
 *  1. **No generations.** Selkirk versions with names (VANGUARD, LUXX, AMPED,
 *     SLK) rather than numbers, and those are product lines, not generations.
 *     The list below is deliberately near-empty — a null generation here is the
 *     correct answer, not a parsing failure.
 *  2. **Shape is model-specific vocabulary.** 'Epic' and 'Invikta' are Selkirk
 *     shape names, not lines, and they appear as Shape option values.
 *  3. **Play style is merchandised.** Power / Control / Hybrid is a first-class
 *     axis here, tagged on the product.
 */
export const SELKIRK_RULES: BrandRules = {
  slug: 'selkirk',
  name: 'Selkirk',

  productLines: [
    { slug: 'vanguard', name: 'VANGUARD' },
    { slug: 'luxx', name: 'LUXX' },
    { slug: 'amped', name: 'AMPED' },
    { slug: 'slk', name: 'SLK' },
    { slug: 'labs', name: 'LABS' },
    { slug: 'omni', name: 'OMNI' },
    { slug: 'halo', name: 'HALO' },
    { slug: 'era', name: 'ERA' },
    { slug: 'geo', name: 'Geo' },
    { slug: 'valkyrie', name: 'Valkyrie' },
    { slug: 'dauntless', name: 'Dauntless' },
    { slug: 'boomstik', name: 'Project Boomstik' },
    { slug: 'prime', name: 'Prime' },
    { slug: 'evo', name: 'Evo' },
  ],

  // Selkirk markets through staff pros rather than signature colourways, so
  // this stays empty until a signature paddle actually appears.
  players: [],

  // Intentionally empty — see the note above.
  generations: [],

  // 'Control Air' and 'Power Air' are editions riding on a line (LUXX Control
  // Air, VANGUARD Power Air), which is exactly the sub-line slot.
  //
  // Max, XL, Invikta, Epic and S2 are deliberately NOT here. They are shapes,
  // and treating them as sub-lines merged three different paddles — SLK
  // Latitude, SLK Nexus and SLK Atlas — into one model called "SLK Max". They
  // are resolved through shapeAliases instead, which puts each family's shapes
  // on one model rather than splitting the family across several.
  subLinePattern: /\b(Control Air|Power Air|Pro Air|Control|Power|Air)\b/,

  titleNoisePattern:
    /\b(Selkirk|Sport|Pickleball|Paddle|Paddles|with\s+InfiniGrit|InfiniGrit)\b/gi,

  tierAliases: [
    // Selkirk's own words. 'advanced' is the top of their range and maps to the
    // same shelf JOOLA calls 'pro', so cross-brand tier comparison holds.
    { pattern: /(^|[^a-z])(advanced|pro)([^a-z]|$)/i, tier: 'pro' },
    { pattern: /intermediate/i, tier: 'performance' },
    { pattern: /(beginner|entry|recreational)/i, tier: 'recreational' },
    { pattern: /(junior|youth|kids)/i, tier: 'junior' },
  ],

  shapeAliases: [
    // Selkirk's proprietary shape names come first — they are more specific than
    // the generic geometry words that follow.
    { pattern: /\binvikta\b/i, shape: 'elongated' },
    { pattern: /\bepic\b/i, shape: 'standard' },
    // S2 is the third AMPED shape, alongside Epic and Invikta. It appears as a
    // Shape option value and as a handle suffix on the per-shape sub-pages.
    { pattern: /\bs2\b/i, shape: 'standard' },
    { pattern: /\bmaxima\b/i, shape: 'elongated' },
    { pattern: /\b(max|xl)\b/i, shape: 'widebody' },
    { pattern: /\belongated\b/i, shape: 'elongated' },
    { pattern: /\bwide\s?body\b/i, shape: 'widebody' },
    { pattern: /\bhybrid\b/i, shape: 'hybrid' },
    { pattern: /\bstandard\b/i, shape: 'standard' },
  ],

  playStylePattern: /\b(power|control|hybrid)\b/i,
}
