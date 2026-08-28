import { db, upsertAll, upsertReturning } from '../lib/supabase.js'
import { slugify } from '../lib/hash.js'
import { allBrandRules, type BrandRules } from '../config/brands/index.js'
import { LOCAL_SITES } from '../config/sites.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('sync')

/**
 * Pushes the brand configuration in src/config/ into the database.
 *
 * This exists because onboarding a brand used to mean writing a migration: the
 * brand row, its storefront and its product lines were seeded in SQL, and any
 * vocabulary the brand introduced needed a CHECK constraint widened. Both are
 * DDL, both need a human pasting into the dashboard, and neither is schema —
 * a brand is data.
 *
 * Migration 20260827000005 turned the vocabularies into reference tables, which
 * leaves nothing about a new brand that cannot travel over the REST API. So the
 * whole of onboarding is now: add a rules file, add a site entry, run this.
 *
 * Idempotent by construction — every write is an upsert on a natural key, so it
 * is safe to run on every crawl, and it is what keeps the config files and the
 * database from drifting apart.
 */

export interface SyncCounts {
  vocabulary: number
  brands: number
  sites: number
  productLines: number
  players: number
  generations: number
}

interface BrandIdRow {
  id: string
  slug: string
}

export async function syncConfig(opts: { brandSlug?: string; dryRun?: boolean } = {}): Promise<SyncCounts> {
  const wanted = opts.brandSlug?.toLowerCase()
  const rules = allBrandRules().filter((r) => !wanted || r.slug === wanted)
  const sites = LOCAL_SITES.filter((s) => !wanted || s.brand_slug === wanted)

  if (rules.length === 0) {
    throw new Error(
      `no brand rules registered for "${opts.brandSlug}". ` +
        `Add src/config/brands/${wanted}.ts and register it in src/config/brands/index.ts.`,
    )
  }

  const counts: SyncCounts = {
    vocabulary: 0,
    brands: 0,
    sites: 0,
    productLines: 0,
    players: 0,
    generations: 0,
  }

  // ---------------------------------------------------------------------------
  // Vocabulary first: a brand's tier and shape words must exist as reference
  // rows before any model can point at them.
  // ---------------------------------------------------------------------------
  const tiers = new Set<string>(['unknown'])
  const shapes = new Set<string>(['unknown'])
  const styles = new Set<string>(['unknown', 'power', 'control', 'hybrid'])
  for (const r of rules) {
    for (const t of r.tierAliases) tiers.add(t.tier)
    for (const s of r.shapeAliases) shapes.add(s.shape)
  }
  counts.vocabulary = tiers.size + shapes.size + styles.size

  if (!opts.dryRun) {
    // ignoreDuplicates so a label edited in the database is not clobbered by the
    // generated title-case fallback below.
    await upsertVocab('skill_tiers', tiers)
    await upsertVocab('shapes', shapes)
    await upsertVocab('play_styles', styles)
  }

  // ---------------------------------------------------------------------------
  // Brands
  // ---------------------------------------------------------------------------
  counts.brands = rules.length
  if (opts.dryRun) {
    for (const r of rules) logPlan(r, sites.filter((s) => s.brand_slug === r.slug).length)
    counts.sites = sites.length
    counts.productLines = rules.reduce((n, r) => n + r.productLines.length, 0)
    counts.players = rules.reduce((n, r) => n + r.players.length, 0)
    counts.generations = rules.reduce((n, r) => n + r.generations.length, 0)
    return counts
  }

  const brandRows = await upsertReturning<{ slug: string; name: string }, BrandIdRow>(
    'brands',
    rules.map((r) => ({ slug: r.slug, name: r.name })),
    'slug',
    'id,slug',
  )
  const brandId = new Map(brandRows.map((b) => [b.slug, b.id]))

  // ---------------------------------------------------------------------------
  // Storefronts. Updating rather than ignoring on conflict is deliberate: the
  // assortment handle list is edited in code as shelves are discovered, and the
  // database should follow it.
  // ---------------------------------------------------------------------------
  const siteRows = sites
    .map((s) => {
      const id = brandId.get(s.brand_slug)
      if (!id) return null
      return {
        brand_id: id,
        country_code: s.country_code,
        base_url: s.base_url,
        platform: s.platform,
        currency: s.currency,
        locale: s.locale ?? 'en-US',
        assortment_handles: s.assortment_handles,
        crawl_delay_ms: s.crawl_delay_ms,
        review_platform: s.review_platform ?? null,
        review_config: s.review_config ?? {},
        notes: s.notes ?? null,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (siteRows.length > 0) {
    await upsertAll('sites', siteRows, 'brand_id,country_code,base_url')
    counts.sites = siteRows.length
  }

  // ---------------------------------------------------------------------------
  // Per-brand reference data. These are a head start, not a closed set — the
  // crawl still creates any line, player or generation it meets that is absent.
  // ---------------------------------------------------------------------------
  const lineRows: Array<{ brand_id: string; slug: string; name: string }> = []
  const playerRows: Array<{ brand_id: string; slug: string; name: string }> = []
  const genRows: Array<{ brand_id: string; slug: string; name: string; sequence: number | null }> = []

  for (const r of rules) {
    const id = brandId.get(r.slug)
    if (!id) continue
    for (const l of r.productLines) lineRows.push({ brand_id: id, slug: l.slug, name: l.name })
    for (const p of r.players) playerRows.push({ brand_id: id, slug: slugify(p), name: p })
    for (const g of r.generations) {
      genRows.push({ brand_id: id, slug: g.slug, name: g.name, sequence: g.sequence ?? null })
    }
  }

  if (lineRows.length > 0) {
    await upsertAll('product_lines', lineRows, 'brand_id,slug')
    counts.productLines = lineRows.length
  }
  if (playerRows.length > 0) {
    await upsertAll('players', playerRows, 'brand_id,slug')
    counts.players = playerRows.length
  }
  if (genRows.length > 0) {
    await upsertAll('generations', genRows, 'brand_id,slug')
    counts.generations = genRows.length
  }

  return counts
}

async function upsertVocab(table: string, codes: Set<string>): Promise<void> {
  const rows = [...codes].map((code) => ({ code, label: titleCase(code) }))
  const { error } = await db().from(table).upsert(rows, { onConflict: 'code', ignoreDuplicates: true })
  if (error) {
    if (isMissingTable(error.message)) {
      throw new Error(
        `${table} does not exist — migration 20260827000005 has not been applied. ` +
          `Paste supabase/migrations/20260827000005_vocabularies_and_play_style.sql ` +
          `into the Supabase SQL editor and run it once.`,
      )
    }
    throw new Error(`upsert ${table}: ${error.message}`)
  }
}

function isMissingTable(message: string): boolean {
  return /does not exist|schema cache|PGRST205/i.test(message)
}

function titleCase(code: string): string {
  return code
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function logPlan(rules: BrandRules, siteCount: number): void {
  log.info(
    `would sync ${rules.name}: ${siteCount} site(s), ${rules.productLines.length} lines, ` +
      `${rules.players.length} players, ${rules.generations.length} generations`,
  )
}
