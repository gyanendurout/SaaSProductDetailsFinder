import { slugify } from '../lib/hash.js'
import type { RawProduct } from '../sources/types.js'
import type { BrandRules } from '../config/brands/types.js'
import { classifyAssortment } from './assortment.js'
import { foldTypography } from './text.js'
import { resolveSkillTier, resolvePlayStyle, type SkillTier, type PlayStyle } from './taxonomy.js'

/**
 * Resolves a source product to its canonical model:
 *
 *   product_line   Perseus      | VANGUARD
 *   generation     Pro V        | (none — Selkirk does not version numerically)
 *   sub_line       Dual         | Control Air
 *   =>  model      Perseus Pro V | VANGUARD Control Air
 *
 * All brand vocabulary arrives via BrandRules; nothing here is brand-specific.
 */

export interface ResolvedModel {
  productLineSlug: string | null
  productLineName: string | null
  generationSlug: string | null
  generationName: string | null
  generationSequence: number | null
  subLine: string | null
  modelSlug: string
  modelName: string
  skillTier: SkillTier
  playStyle: PlayStyle
  confidence: number
}

export function resolveModel(
  product: RawProduct,
  rules: BrandRules,
  knownLines: ReadonlyMap<string, string>,
): ResolvedModel {
  const { isBundle } = classifyAssortment(product)
  // A bundle like 'Agassi/Graf Champion Pack' spans two lines; forcing one would
  // invent a product line that does not exist.
  const line = isBundle ? null : resolveProductLine(product, rules, knownLines)
  const generation = resolveGeneration(product, rules)
  const subLine = rules.subLinePattern?.exec(product.title)?.[1] ?? null
  const skillTier = resolveSkillTier(product.tags, product.categoryHandles, rules)
  const playStyle = resolvePlayStyle(product.tags, product.categoryHandles, rules)

  const modelName = buildModelName(product.title, rules, generation?.name ?? null, line?.name ?? null)

  let confidence = 1
  if (!line && !isBundle) confidence -= 0.4
  // Only penalise a missing generation for brands that actually use them.
  if (!generation && rules.generations.length > 0) confidence -= 0.3
  if (skillTier === 'unknown') confidence -= 0.1

  return {
    productLineSlug: line?.slug ?? null,
    productLineName: line?.name ?? null,
    generationSlug: generation?.slug ?? null,
    generationName: generation?.name ?? null,
    generationSequence: generation?.sequence ?? null,
    subLine,
    modelSlug: slugify(`${rules.slug} ${modelName}`),
    modelName,
    skillTier,
    playStyle,
    confidence: Math.max(0, Number(confidence.toFixed(2))),
  }
}

function resolveGeneration(
  product: RawProduct,
  rules: BrandRules,
): { slug: string; name: string; sequence: number | null } | null {
  if (rules.generations.length === 0) return null

  const asResult = (r: (typeof rules.generations)[number]) => ({
    slug: r.slug,
    name: r.name,
    sequence: r.sequence ?? null,
  })

  // Tags are authoritative — a merchandiser set them deliberately.
  for (const rule of rules.generations) {
    if (rule.tag && product.tags.some((t) => rule.tag!.test(t.trim()))) return asResult(rule)
  }
  // Collection membership is the next-strongest signal.
  for (const rule of rules.generations) {
    if (rule.tag && product.categoryHandles.some((h) => rule.tag!.test(h))) return asResult(rule)
  }
  // Finally the title.
  for (const rule of rules.generations) {
    if (rule.title?.test(product.title)) return asResult(rule)
  }
  return null
}

function resolveProductLine(
  product: RawProduct,
  rules: BrandRules,
  knownLines: ReadonlyMap<string, string>,
): { slug: string; name: string } | null {
  // '<line>-series' tags are the cleanest signal where a brand publishes them.
  // A product often carries several ('hyperion-3-series' AND 'hyperion-series'),
  // so strip any generation suffix and prefer whichever the title names first —
  // a title reads line-then-edition, which breaks the tie correctly where tag
  // order and slug length both fail.
  const seriesCandidates = dedupe(
    product.tags
      .map((tag) => /^(.+?)-series$/i.exec(tag.trim())?.[1])
      .filter((base): base is string => Boolean(base))
      .map((base) => slugify(base).replace(/-(\d+s?|pro-?[iv]+|gen-?\d+)$/i, ''))
      .filter(Boolean),
  )
  if (seriesCandidates.length > 0) {
    return pickByTitlePosition(seriesCandidates, product.title, knownLines)
  }

  // A known line named in the title, earliest mention first — a title reads
  // line-then-edition, so 'JOOLA Agassi Edge Heat Vision' is an Agassi, not a
  // Vision. Length breaks a positional tie, keeping 'Project Boomstik' ahead of
  // a shorter line that is merely a substring of it.
  const titleMatches = [...knownLines.entries()]
    .map(([slug, name]) => ({
      slug,
      name,
      at: new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').exec(product.title)?.index ?? -1,
    }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at || b.name.length - a.name.length)
  if (titleMatches[0]) {
    return { slug: titleMatches[0].slug, name: titleMatches[0].name }
  }

  // A bare tag matching a known line.
  for (const tag of product.tags) {
    const slug = slugify(tag)
    if (knownLines.has(slug)) return { slug, name: knownLines.get(slug)! }
  }

  // A shelf the brand has declared to mean a series.
  for (const handle of product.categoryHandles) {
    const slug = rules.lineByCollection?.[handle]
    if (slug && knownLines.has(slug)) return { slug, name: knownLines.get(slug)! }
  }

  // Unknown line: first meaningful word once brand noise and athlete names are
  // stripped, so a genuinely new series is discovered rather than every
  // signature paddle collapsing into a line called 'Ben'.
  const firstWord = cleanTitle(product.title, rules).split(/\s+/)[0]
  if (firstWord && firstWord.length > 2 && !/\d/.test(firstWord)) {
    return { slug: slugify(firstWord), name: firstWord }
  }
  return null
}

function pickByTitlePosition(
  candidates: string[],
  title: string,
  knownLines: ReadonlyMap<string, string>,
): { slug: string; name: string } {
  const lower = title.toLowerCase()
  const ranked = candidates
    .map((slug) => {
      const name = knownLines.get(slug) ?? titleCase(slug)
      const idx = lower.indexOf(name.toLowerCase())
      return { slug, name, rank: idx === -1 ? Number.MAX_SAFE_INTEGER : idx }
    })
    .sort((a, b) => a.rank - b.rank || a.slug.length - b.slug.length)
  const best = ranked[0]!
  return { slug: best.slug, name: best.name }
}

function cleanTitle(title: string, rules: BrandRules): string {
  // Fold first: a superscript survives every filter below and then slugifies
  // away, collapsing CRBN1..CRBN4 onto one model key.
  let out = foldTypography(title).split(' - ')[0]! // drop the colourway suffix
  for (const player of rules.players) {
    out = out.replace(new RegExp(escapeRegExp(player), 'gi'), ' ')
  }
  return out
    .replace(rules.titleNoisePattern, ' ')
    .replace(/\d{1,2}(\.\d)?\s*mm/gi, ' ')
    .replace(/[®™©]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 'LUXX Control Control' -> 'LUXX Control' — line and sub-line can overlap. */
function dedupeWords(text: string): string {
  const seen = new Set<string>()
  return text
    .split(/\s+/)
    .filter((word) => {
      const key = word.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(' ')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * The model name is the title with the noise removed, in the title's own order.
 *
 * An earlier version assembled it from slots — line + sub-line + generation —
 * which discarded anything the title said beyond those. That worked for JOOLA,
 * whose titles are exactly 'JOOLA <line> <generation>', and failed for Selkirk,
 * whose titles are '<line> <model> - <shape> - Pickleball Paddle': the model
 * word was dropped, so SLK Latitude, SLK Nexus and SLK Atlas all became one row
 * called 'SLK Max'. Slot assembly also reordered words, turning
 * 'Agassi Edge Heat Vision' into 'Vision Agassi Heat Edge'.
 *
 * Reading the title is both simpler and more faithful. Line, sub-line and
 * generation remain separate structured fields for filtering; this is only the
 * display name.
 *
 * Removed as noise: shape names, which belong on the variant; anything numeric,
 * which is a thickness ('16' in 'Hyperion CGS 16'); and single characters left
 * by punctuation. cleanTitle has already dropped the brand, athlete names, the
 * colourway suffix after ' - ', and millimetre figures.
 */
function buildModelName(
  title: string,
  rules: BrandRules,
  generationName: string | null,
  lineName: string | null = null,
): string {
  const cleaned = cleanTitle(title, rules)
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^[^\w]+|[^\w]+$/g, ''))
    // Keep single letters: the 'V' of 'Pro V' is a roman numeral, not debris.
    .filter((w) => w.length > 1 || /^[a-z]$/i.test(w))
    .filter((w) => !/\d/.test(w))
    // Collaboration markers: 'Selkirk x Holderness Family AMPED Pro Air' loses
    // the brand as noise and would otherwise be named 'x Holderness Family...'.
    //
    // Case-sensitive on purpose. A collaboration 'x' is written lowercase by
    // convention, while a product line capitalises it — CRBN's line is called
    // 'X Series', and a case-insensitive test renamed every one of them
    // 'Series'.
    .filter((w) => w !== 'x' && w !== 'by')
    .filter((w) => !rules.shapeAliases.some((a) => new RegExp(`^${a.pattern.source}$`, 'i').test(w)))

  let name = dedupeWords(words.join(' '))

  // A generation stripped as numeric ('3S', 'Pro IV') still belongs in the name.
  // Note the doubled backslashes: inside a template literal `\b` is the
  // backspace character, not a word boundary, and the test would never match.
  if (generationName && !new RegExp(`\\b${escapeRegExp(generationName)}\\b`, 'i').test(name)) {
    // dedupeWords again: 'Agassi Pro' + 'Pro V' would otherwise read
    // 'Agassi Pro Pro V'.
    name = dedupeWords(`${name} ${generationName}`.trim())
  }

  // Nothing survived the filters. 'CRBN¹' is entirely brand plus numeral, so
  // the series it belongs to is the only name left that means anything; the
  // raw title is the last resort.
  return name || lineName || cleaned || title
}
