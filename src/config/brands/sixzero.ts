import type { BrandRules } from './types.js'

/**
 * Six Zero — Oxnard, California (US store). Shopify, USD.
 *
 * Six Zero names paddles after gemstones and minerals, not after a series and a
 * version:
 *
 *   Double Black Diamond Control      Black Opal 14mm Elongated
 *   └────────┬────────┘ └──┬──┘       └───┬────┘ └┬─┘ └───┬───┘
 *         the line       style           line   thickness shape
 *
 * The line IS the gemstone, and the words around it are modifiers. That makes
 * this the opposite problem to CRBN: there is no numbering to decode, but the
 * line name is multi-word and its prefixes matter — 'Black Diamond' and
 * 'Double Black Diamond' are different paddles, and matching the shorter one
 * first would collapse them. `productLines` is therefore ordered longest-first,
 * and the resolver takes the first hit.
 *
 * Three further quirks of this store:
 *
 *   - Shape is a real variant option ('Hybrid', 'Elongated', 'Widebody'), the
 *     way Selkirk does it, rather than something to be read out of a title.
 *   - Thickness appears in the title AND as an option, and the two disagree in
 *     places: 'Black Opal 14mm Elongated' ships a 14mm option only, while
 *     'Double Black Diamond Control' offers 16mm / 15mm Elongated / 14mm. The
 *     option wins, because it is what is actually purchasable.
 *   - Collaboration editions are quoted in the title: 'Coral ''Rainbow''
 *     Edition 16mm', 'Ruby Pro ''Dick's Sporting Goods'' Edition 14mm'. The
 *     quoted part is a colourway, not a model, so it is stripped as noise.
 *
 * Six Zero publishes no skill tier and no play-style collections. 'Pro' in a
 * title is an edition marker ('Ruby Pro', 'Coral Pro') rather than a grading —
 * the same paddle in a different build — so tierAliases is deliberately empty
 * and every model reads 'unknown'. Inferring 'pro' from that word would grade
 * half the range on a naming habit.
 */
export const SIXZERO_RULES: BrandRules = {
  slug: 'sixzero',
  name: 'Six Zero',

  // Longest first: 'Double Black Diamond' must beat 'Black Diamond', and
  // 'Black Opal' must beat 'Opal'.
  productLines: [
    { slug: 'infinity-edgeless-double-black-diamond', name: 'Infinity Edgeless Double Black Diamond' },
    { slug: 'infinity-edgeless-black-diamond', name: 'Infinity Edgeless Black Diamond' },
    { slug: 'double-black-diamond', name: 'Double Black Diamond' },
    { slug: 'black-diamond', name: 'Black Diamond' },
    { slug: 'boulder-opal', name: 'Boulder Opal' },
    { slug: 'black-opal', name: 'Black Opal' },
    { slug: 'coral', name: 'Coral' },
    { slug: 'ruby', name: 'Ruby' },
    { slug: 'sapphire', name: 'Sapphire' },
    { slug: 'quartz', name: 'Quartz' },
  ],

  // Colourways are minerals and colours, never athletes.
  players: [],

  // No version vocabulary. Six Zero replaces a paddle by naming a new stone,
  // so a null generation is the right answer rather than a gap.
  generations: [],

  // The build modifier that sits between line and colourway. 'Pro' and
  // 'Lightweight' are genuinely different paddles under the same line name.
  subLinePattern: /\b(Pro|Control|Power|Lightweight)\b/,

  // Strips the quoted edition name, the parenthetical, the thickness token and
  // the shape words — all of which are read from the options instead.
  titleNoisePattern:
    /['’][^'’]*['’]|\([^)]*\)|\b\d{2}(?:\.\d)?\s?mm\b|\b(Edition|Pickleball|Paddle|Paddles|Elongated|Hybrid|Widebody|Standard)\b/gi,

  // Deliberately empty — see the note above about 'Pro'.
  tierAliases: [],

  shapeAliases: [
    { pattern: /\bedgeless\b/i, shape: 'elongated' },
    { pattern: /\belongated\b/i, shape: 'elongated' },
    { pattern: /\bwide\s?body\b/i, shape: 'widebody' },
    { pattern: /\bhybrid\b/i, shape: 'hybrid' },
    { pattern: /\bstandard\b/i, shape: 'standard' },
  ],

  // 'Control' and 'Power' are part of the model name here ('Double Black
  // Diamond Control'), which makes them a genuine play-style statement.
  playStylePattern: /\b(power|control)\b/i,
}
