/**
 * Signals mined from review prose.
 *
 * Pure and dependency-free so the vocabularies can be tested directly. Runs
 * once per corpus load rather than per request, and only the derived flags are
 * kept — the bodies themselves are never held in the cache.
 */

/**
 * Words buyers use when a paddle has physically failed.
 *
 * Grouped because the failure modes are worth telling apart: a delamination
 * complaint and an edge-guard complaint are different manufacturing problems
 * with different fixes.
 *
 * Deliberately narrow. 'dead' alone matches "dead accurate", 'soft' alone
 * matches "soft hands" — both are compliments in this category. Every term
 * here needs its qualifier.
 */
export const DEFECT_TERMS: Array<{ code: string; label: string; pattern: RegExp }> = [
  {
    code: 'delamination',
    label: 'Delamination',
    pattern: /\b(delam\w*|de-?laminat\w*|face (?:is )?separat\w*|peel(?:ing|ed)? (?:off|away|apart))\b/i,
  },
  {
    code: 'dead_spot',
    label: 'Dead / soft spot',
    pattern: /\b(dead ?spots?|soft ?spots?|core ?crush\w*|mushy ?spots?)\b/i,
  },
  {
    code: 'cracked',
    label: 'Cracked or broken',
    pattern: /\b(crack(?:ed|ing|s)?|broke|broken|snapped|shattered|fell apart|split (?:open|apart))\b/i,
  },
  {
    code: 'edge_guard',
    label: 'Edge guard failure',
    pattern: /\b(edge ?guard\w*)\b.{0,40}\b(came off|fell off|peel\w*|loose|separat\w*|lifting)\b/i,
  },
  {
    code: 'grip',
    label: 'Grip / handle fault',
    pattern: /\b(grip|handle)\b.{0,30}\b(came (?:off|loose)|unravel\w*|slip\w*|peel\w*|twist\w*)\b/i,
  },
  {
    code: 'durability',
    label: 'Wore out early',
    pattern: /\b(wore out|worn out|didn'?t last|did not last|lasted (?:only )?(?:a|one|two|three|\d+) (?:week|month)s?|fell apart)\b/i,
  },
]

/**
 * Paddle brands, for spotting a review that names someone other than the
 * brand being reviewed.
 *
 * Excludes Head, Legacy, Prince and Vulcan on purpose. They are real brands and
 * also ordinary English words — "the head of the paddle", "legacy of the
 * series", "the prince of pickleball" — and at this corpus size the false
 * positives would swamp the signal. Under-counting a few real mentions is the
 * better error: a conquest map that lists brands nobody named is worse than one
 * that misses a few.
 */
export const PADDLE_BRANDS: Array<{ slug: string; label: string; pattern: RegExp }> = [
  { slug: 'joola', label: 'JOOLA', pattern: /\bjoola\b/i },
  { slug: 'selkirk', label: 'Selkirk', pattern: /\bselkirk\b/i },
  { slug: 'crbn', label: 'CRBN', pattern: /\bcrbn\b/i },
  { slug: 'sixzero', label: 'Six Zero', pattern: /\bsix ?zero\b/i },
  { slug: 'paddletek', label: 'Paddletek', pattern: /\bpaddle ?tek\b/i },
  { slug: 'gamma', label: 'GAMMA', pattern: /\bgamma\b/i },
  { slug: 'engage', label: 'Engage', pattern: /\bengage\b/i },
  { slug: 'onix', label: 'Onix', pattern: /\bonix\b/i },
  { slug: 'vatic', label: 'Vatic Pro', pattern: /\bvatic\b/i },
  { slug: 'proton', label: 'Proton', pattern: /\bproton\b/i },
  { slug: '11six24', label: '11Six24', pattern: /\b11 ?six ?24\b/i },
  { slug: 'franklin', label: 'Franklin', pattern: /\bfranklin\b/i },
  { slug: 'electrum', label: 'Electrum', pattern: /\belectrum\b/i },
  { slug: 'ronbus', label: 'Ronbus', pattern: /\bronbus\b/i },
  { slug: 'volair', label: 'Volair', pattern: /\bvolair\b/i },
  { slug: 'diadem', label: 'Diadem', pattern: /\bdiadem\b/i },
  { slug: 'gearbox', label: 'Gearbox', pattern: /\bgear ?box\b/i },
  { slug: 'prokennex', label: 'ProKennex', pattern: /\bpro ?kennex\b/i },
  { slug: 'babolat', label: 'Babolat', pattern: /\bbabolat\b/i },
  { slug: 'yonex', label: 'Yonex', pattern: /\byonex\b/i },
  { slug: 'wilson', label: 'Wilson', pattern: /\bwilson\b/i },
  { slug: 'bread', label: 'Bread & Butter', pattern: /\bbread ?(?:&|and) ?butter\b/i },
]

/** Everything a reviewer wrote, as one searchable string. */
export function reviewText(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' \n ')
}

/** Defect codes this review mentions. Empty for the overwhelming majority. */
export function defectsIn(text: string): string[] {
  if (!text) return []
  return DEFECT_TERMS.filter((t) => t.pattern.test(text)).map((t) => t.code)
}

/**
 * Other brands this review names.
 *
 * `ownBrandSlug` is excluded, because a Selkirk review saying "my third
 * Selkirk" is loyalty, not a competitor mention, and leaving it in would make
 * every brand its own biggest rival.
 */
export function brandsNamedIn(text: string, ownBrandSlug: string): string[] {
  if (!text) return []
  return PADDLE_BRANDS.filter((b) => b.slug !== ownBrandSlug && b.pattern.test(text)).map(
    (b) => b.slug,
  )
}

/**
 * Whether the reviewer describes arriving from another brand, rather than just
 * naming one.
 *
 * A mention is ambient ("plays like a CRBN"); a switch is directional
 * ("switched from my CRBN"). Only the second is conquest, and the difference
 * matters if anyone is going to act on the number.
 */
const SWITCH_CUES =
  /\b(switch\w*|upgrad\w*|came? from|moving from|moved from|replac\w*|traded|sold my|used to (?:play|use|own)|previously|before this|my (?:old|last|previous))\b/i

export function readsAsSwitch(text: string): boolean {
  return SWITCH_CUES.test(text)
}
