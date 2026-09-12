import type { BrandRules } from './types.js'
import { JOOLA_RULES } from './joola.js'
import { SELKIRK_RULES } from './selkirk.js'
import { CRBN_RULES } from './crbn.js'
import { SIXZERO_RULES } from './sixzero.js'
import { PADDLETEK_RULES } from './paddletek.js'
import { GAMMA_RULES } from './gamma.js'

export type { BrandRules } from './types.js'
export { lineMap } from './types.js'

const REGISTRY = new Map<string, BrandRules>([
  [JOOLA_RULES.slug, JOOLA_RULES],
  [SELKIRK_RULES.slug, SELKIRK_RULES],
  [CRBN_RULES.slug, CRBN_RULES],
  [SIXZERO_RULES.slug, SIXZERO_RULES],
  [PADDLETEK_RULES.slug, PADDLETEK_RULES],
  [GAMMA_RULES.slug, GAMMA_RULES],
])

/**
 * Fallback for a brand with no rules file yet. The resolver still discovers
 * product lines from `<line>-series` tags and title text, so an unregistered
 * brand degrades to generic behaviour instead of failing.
 */
const GENERIC: BrandRules = {
  slug: 'generic',
  name: 'Generic',
  productLines: [],
  players: [],
  generations: [],
  titleNoisePattern: /\b(Pickleball|Paddle|Paddles|Set|Bundle)\b/gi,
  tierAliases: [
    { pattern: /(^|[^a-z])(pro|professional|advanced)([^a-z]|$)/i, tier: 'pro' },
    { pattern: /(performance|intermediate)/i, tier: 'performance' },
    { pattern: /premium/i, tier: 'premium' },
    { pattern: /(junior|youth|kids)/i, tier: 'junior' },
    { pattern: /(recreational|beginner|entry)/i, tier: 'recreational' },
  ],
  shapeAliases: [
    { pattern: /\belongated\b/i, shape: 'elongated' },
    { pattern: /\bhybrid\b/i, shape: 'hybrid' },
    { pattern: /\bwide\s?body\b/i, shape: 'widebody' },
    { pattern: /\bstandard\b/i, shape: 'standard' },
  ],
  playStylePattern: /\b(power|control|hybrid)\b/i,
}

export function rulesFor(brandSlug: string): BrandRules {
  return REGISTRY.get(brandSlug.toLowerCase()) ?? { ...GENERIC, slug: brandSlug }
}

export function allBrandRules(): BrandRules[] {
  return [...REGISTRY.values()]
}
