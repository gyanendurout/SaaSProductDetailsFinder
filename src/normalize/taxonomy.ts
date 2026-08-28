import type { RawCategory } from '../sources/types.js'
import type { BrandRules } from '../config/brands/types.js'

export type CategoryRole =
  | 'sport'
  | 'assortment'
  | 'skill_tier'
  | 'generation'
  | 'series'
  | 'signature'
  | 'play_style'
  | 'shape'
  | 'material'
  | 'sale'
  | 'accessory'
  | 'other'

export type SkillTier =
  | 'pro'
  | 'performance'
  | 'recreational'
  | 'premium'
  | 'junior'
  | 'unknown'

export type PlayStyle = 'power' | 'control' | 'hybrid' | 'unknown'

/**
 * Collections mean different things. 'Pro' is a skill tier, 'Pro IV' a
 * generation, 'Perseus 3S' a series, 'Outlet Paddles' a sale shelf. Selkirk adds
 * play-style, shape and material shelves on top.
 *
 * Order matters: the first match wins, so specific patterns are tested before
 * generic ones.
 */
const ROLE_RULES: Array<{ role: CategoryRole; handle?: RegExp; title?: RegExp }> = [
  // Generations first — 'pro-iv' must not be caught by the 'pro' tier rule.
  { role: 'generation', handle: /^(gen-\d+|pro-i{1,3}v?|pro-v|pro-iv|joola-3s|3s)$/i },
  { role: 'generation', title: /^(gen\s*\d+|pro\s+[ivx]+|\d+s)$/i },

  // Series shelves.
  { role: 'series', handle: /-(series|3s)$/i },
  {
    role: 'series',
    handle:
      /^(perseus|hyperion|scorpeus|magnus|vision|agassi|graf|kosmos|astro|vanguard|luxx|amped|slk|labs|omni|halo|epic|invikta|maxima|boomstik|everglade)(-|$)/i,
  },

  { role: 'signature', handle: /(ben-johns|signature|x-joola|pros-favorites)/i },
  { role: 'sale', handle: /(sale|outlet|clearance|flash|deal|markdown|black-friday|under-\d+)/i },

  // Skill tiers — brand vocabularies differ, so both are listed.
  {
    role: 'skill_tier',
    handle:
      /(professional-pickleball-paddles|pickleball-paddles-professional|paddles-performance|paddles-premium|recreational-pickleball-paddles|junior-paddles)/i,
  },
  { role: 'skill_tier', handle: /^(beginner|intermediate|advanced)(-|$)/i },
  {
    role: 'skill_tier',
    title: /^(pro|professional|performance|premium|recreational|beginner|intermediate|advanced)( series| paddles)?$/i,
  },

  // Play style — Selkirk merchandises this heavily.
  { role: 'play_style', handle: /^(control|power|hybrid)(-|$)/i },
  { role: 'play_style', handle: /-(control|power|hybrid)-(pickleball-)?paddles/i },

  { role: 'shape', handle: /(elongated|widebody|edgeless|long-handle|lightweight|midweight)/i },
  { role: 'material', handle: /(carbon-fiber|fiberglass|graphite)/i },

  {
    role: 'accessory',
    handle:
      /(grip|bag|ball|net|court|barrier|caddie|accessor|apparel|footwear|shoe|suitcase|clothing|care|tag)/i,
  },

  { role: 'assortment', handle: /^(pickleball-paddles|individual-paddles|paddle-sets)$/i },
  { role: 'sport', handle: /^(pickleball|table-tennis)(-\d+)?$/i },
]

export function classifyCategory(category: RawCategory): CategoryRole {
  for (const rule of ROLE_RULES) {
    if (rule.handle?.test(category.handle)) return rule.role
    if (rule.title?.test(category.title.trim())) return rule.role
  }
  return 'other'
}

/** Handles that name a version, not a tier — 'pro-iv' is Pro IV, not Pro. */
const GENERATION_HANDLE = /^(gen-\d+|pro-i{1,3}v?|pro-v|3s)$/i

/**
 * Skill tier from tags and collection membership, using the brand's own words.
 * Collections outrank tags: a merchandiser placing a paddle on the Advanced
 * shelf is a stronger statement than a tag that may be legacy.
 */
export function resolveSkillTier(
  tags: string[],
  categoryHandles: string[],
  rules: BrandRules,
): SkillTier {
  for (const handle of categoryHandles) {
    if (GENERATION_HANDLE.test(handle)) continue
    for (const { pattern, tier } of rules.tierAliases) {
      if (pattern.test(handle)) return tier
    }
  }
  for (const tag of tags) {
    if (GENERATION_HANDLE.test(tag)) continue
    for (const { pattern, tier } of rules.tierAliases) {
      if (pattern.test(tag)) return tier
    }
  }
  return 'unknown'
}

/**
 * Power / control / hybrid. Only meaningful for brands that merchandise it;
 * returns 'unknown' for the rest rather than guessing from marketing copy.
 */
export function resolvePlayStyle(
  tags: string[],
  categoryHandles: string[],
  rules: BrandRules,
): PlayStyle {
  if (!rules.playStylePattern) return 'unknown'
  const normalise = (value: string): PlayStyle | null => {
    const m = rules.playStylePattern!.exec(value)
    const word = m?.[1]?.toLowerCase()
    return word === 'power' || word === 'control' || word === 'hybrid' ? word : null
  }
  for (const tag of tags) {
    const style = normalise(tag)
    if (style) return style
  }
  for (const handle of categoryHandles) {
    const style = normalise(handle)
    if (style) return style
  }
  return 'unknown'
}
