import type { BrandRules } from './types.js'

/**
 * Paddletek — Chicago, Illinois. Shopify, USD.
 *
 * Paddletek is the cleanest grammar of the six: a line, then a model code.
 *
 *   Bantam TKO-CX        Phoenix Genesis Pro       Tempest Wave Pro-C
 *   └──┬──┘ └──┬──┘      └──┬──┘ └────┬─────┘      └──┬───┘ └───┬────┘
 *    line    model         line     model            line     model
 *
 * The suffix letters are construction, not version: -C is carbon, -X and -CX
 * are face variants. They belong to the model name, so `subLinePattern` keeps
 * them rather than stripping them — 'Bantam TKO-C' and 'Bantam TKO-CX' are two
 * paddles, and collapsing them would merge two price points into one row.
 *
 * Core thickness is a first-class variant option and is published in
 * millimetres to one decimal — 12.7 mm and 14.3 mm, which are 1/2" and 9/16"
 * converted. Nothing else in this catalogue uses decimal thicknesses, and the
 * attribute parser already reads `\d{1,2}(\.\d)?\s*mm`, so they survive intact.
 *
 * Two naming exceptions worth knowing:
 *
 *   - 'The Reserve Honeyfoam™' inverts the grammar and carries its shape as the
 *     option instead ('Paddle Shape=TKO-X').
 *   - Signature paddles put the athlete first: 'Trae Young Signature Tempest
 *     Wave Pro-C'. The name is listed in `players` so it is stripped from the
 *     line guess rather than being read as one.
 *
 * Paddletek merchandises no skill tier and no power/control axis — its
 * collections are 'All Paddles', 'All Carbon Paddles', 'Custom Paddles' — so
 * tier resolves to 'unknown' throughout. The trademark symbol on 'Honeyfoam™'
 * is part of the published title and is stripped as noise so it does not end up
 * inside a slug.
 */
export const PADDLETEK_RULES: BrandRules = {
  slug: 'paddletek',
  name: 'Paddletek',

  productLines: [
    { slug: 'the-reserve', name: 'The Reserve' },
    { slug: 'honeyfoam', name: 'Honeyfoam' },
    { slug: 'bantam', name: 'Bantam' },
    { slug: 'phoenix', name: 'Phoenix' },
    { slug: 'tempest', name: 'Tempest' },
  ],

  // Signature athletes, so the name is not mistaken for a line.
  players: ['Trae Young'],

  // No generations: Paddletek revises within a model code rather than shipping
  // a numbered version, so null is correct here.
  generations: [],

  // The model code within a line. Ordered so the longer codes match first —
  // 'TKO-CX' must beat 'TKO-C', and 'EX-L Pro' must beat 'EX-L'.
  subLinePattern:
    /\b(Wave Pro-C|Genesis Carbon|Sabre Carbon|Genesis Pro|Genesis II|Genesis|Firestorm|Talon|TKO-CX|TKO-X|TKO-C|GTO-C|ESQ-C|ESQ|EXL-C|EX-L Pro|EX-L|TS-5 Pro|TS-5|G6)\b/,

  titleNoisePattern:
    /[™®]|\b(Signature|Edition|Pickleball|Paddle|Paddles)\b/gi,

  // Deliberately empty: Paddletek publishes no tier vocabulary at all.
  tierAliases: [],

  shapeAliases: [
    { pattern: /\belongated\b/i, shape: 'elongated' },
    { pattern: /\bhybrid\b/i, shape: 'hybrid' },
    { pattern: /\bwide\s?body\b/i, shape: 'widebody' },
    { pattern: /\bstandard\b/i, shape: 'standard' },
  ],
}
