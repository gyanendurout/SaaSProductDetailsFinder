import type { BrandRules } from './types.js'

/**
 * JOOLA. Verified against joola.com — 85 paddle products, 129 SKUs.
 *
 * Distinctive traits: strong generation vocabulary (Gen 1 → Pro IV → Pro V →
 * 3S), colourways named after endorsing athletes, and an inconsistent product
 * model where Pro V uses variant options while Pro IV ships one product per
 * thickness and colourway.
 */
export const JOOLA_RULES: BrandRules = {
  slug: 'joola',
  name: 'JOOLA',

  productLines: [
    { slug: 'perseus', name: 'Perseus' },
    { slug: 'hyperion', name: 'Hyperion' },
    { slug: 'scorpeus', name: 'Scorpeus' },
    { slug: 'magnus', name: 'Magnus' },
    { slug: 'vision', name: 'Vision' },
    { slug: 'agassi', name: 'Agassi' },
    { slug: 'graf', name: 'Graf' },
    { slug: 'kosmos', name: 'Kosmos' },
    { slug: 'astro', name: 'Astro' },
    { slug: 'dash', name: 'Dash' },
    { slug: 'beacon', name: 'Beacon' },
    { slug: 'essentials', name: 'Essentials' },
  ],

  players: [
    'Ben Johns',
    'Collin Johns',
    'Anna Bright',
    'Tyson McGuffin',
    'Simone Jardim',
    'Federico Staksrud',
    'Andre Agassi',
    'Steffi Graf',
    'Hugo Calderano',
  ],

  // Most specific first: '3S' before the roman-numeral rules, and 'Pro V'
  // before 'Pro IV' would greedily match 'Pro I'.
  generations: [
    { slug: '3s', name: '3S', sequence: 6, tag: /^(3s|joola-3s)$/i, title: /\b3S\b/ },
    { slug: 'pro-v', name: 'Pro V', sequence: 5, tag: /^pro-?v$/i, title: /\bPro\s+V\b/ },
    { slug: 'pro-iv', name: 'Pro IV', sequence: 4, tag: /^pro-?iv$/i, title: /\bPro\s+IV\b/ },
    { slug: 'pro-iii', name: 'Pro III', sequence: 3, tag: /^pro-?iii$/i, title: /\bPro\s+III\b/ },
    { slug: 'pro-ii', name: 'Pro II', sequence: 2, tag: /^pro-?ii$/i, title: /\bPro\s+II\b/ },
    { slug: 'gen-3', name: 'Gen 3', sequence: 3, tag: /^gen-?3$/i, title: /\bGen\s*3\b/i },
    { slug: 'gen-2', name: 'Gen 2', sequence: 2, tag: /^gen-?2$/i, title: /\bGen\s*2\b/i },
    { slug: 'gen-1', name: 'Gen 1', sequence: 1, tag: /^gen-?1$/i, title: /\bGen\s*1\b/i },
  ],

  subLinePattern:
    /\b(Double Vision|Heat Vision|Vision|Champion|Dual|CFS|CGS|CAS|Edge|Elite|Ultra)\b/,

  titleNoisePattern:
    /\b(JOOLA|Pickleball|Paddle|Paddles|Table\s+Tennis|Racket|Blade|Set|Bundle)\b/gi,

  tierAliases: [
    { pattern: /(^|[^a-z])(pro|professional)([^a-z]|$)/i, tier: 'pro' },
    { pattern: /performance/i, tier: 'performance' },
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
}
