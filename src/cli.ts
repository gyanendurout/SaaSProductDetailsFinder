import { createLogger } from './lib/logger.js'
import { db } from './lib/supabase.js'
import { crawl, loadSites } from './pipeline/run.js'
import { syncConfig } from './pipeline/sync.js'
import type { StageName } from './pipeline/context.js'

const log = createLogger('cli')

const USAGE = `
Product Finder

  npm run crawl                      crawl every active site
  npm run crawl -- --brand joola --country US
  npm run crawl:dry                  fetch + normalize, write nothing
  npm run crawl -- --stages catalog,snapshot
  npm run reviews                    crawl reviews only (incremental)
  npm run reviews:full               re-read every review page, not just new ones
  npm run sites                      list configured sites
  npm run sync                       push src/config brands + sites into the database
  npm run report                     last run + current catalogue summary

Options
  --brand <slug>       restrict to one brand (e.g. joola)
  --country <code>     restrict to one country (e.g. US)
  --stages <list>      categories,catalog,snapshot,diff,reviews
  --full-reviews       re-read every review page instead of stopping at the
                       per-product watermark. Slow; use after a schema change or
                       to backfill edits and late brand replies.
  --dry-run            no database writes; prints what normalization resolved
  --scheduled          mark the run as scheduled rather than manual
  --no-sync            skip the config sync that normally precedes a crawl

Adding a brand
  1. src/config/brands/<slug>.ts   vocabulary, lines, players, generations
  2. register it in src/config/brands/index.ts
  3. add its storefront to src/config/sites.ts
  4. npm run crawl -- --brand <slug>
  No SQL: sync runs first and upserts everything over the REST API.
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = argv[0] ?? 'help'
  const flags = parseFlags(argv.slice(1))

  switch (command) {
    case 'crawl':
      return await cmdCrawl(flags)
    case 'sites':
      return await cmdSites()
    case 'sync':
      return await cmdSync(flags)
    case 'report':
      return await cmdReport(flags)
    default:
      process.stdout.write(USAGE)
  }
}

async function cmdCrawl(flags: Flags): Promise<void> {
  // Config -> database first, so a brand added in src/config/ is crawlable
  // without a separate step. Every write is an upsert on a natural key, so this
  // is cheap and safe to repeat.
  if (!flags.dryRun && !flags.noSync) {
    const counts = await syncConfig({ brandSlug: flags.brand })
    log.info('config synced', counts as unknown as Record<string, unknown>)
  }

  const stages = flags.stages
    ? (flags.stages.split(',').map((s) => s.trim()) as StageName[])
    : undefined

  const outcomes = await crawl({
    brandSlug: flags.brand,
    countryCode: flags.country,
    stages,
    dryRun: flags.dryRun,
    runType: flags.scheduled ? 'scheduled' : 'manual',
    fullReviews: flags.fullReviews,
  })

  for (const o of outcomes) {
    log.info(`site ${o.siteId}: ${o.status}`, { runId: o.runId })
  }

  // Exit codes mirror the existing Joola Pulse convention so a scheduler can
  // distinguish "nothing to see" from "look at this".
  const worst = outcomes.some((o) => o.status === 'error')
    ? 2
    : outcomes.some((o) => o.status === 'partial')
      ? 1
      : 0
  process.exitCode = worst
}

async function cmdSync(flags: Flags): Promise<void> {
  const counts = await syncConfig({ brandSlug: flags.brand, dryRun: flags.dryRun })
  log.info(
    `sync ${flags.dryRun ? '(dry run) ' : ''}complete`,
    counts as unknown as Record<string, unknown>,
  )
}

async function cmdSites(): Promise<void> {
  const sites = await loadSites()
  if (sites.length === 0) {
    log.warn('no active sites — have the migrations been applied?')
    return
  }
  for (const s of sites) {
    process.stdout.write(
      `${s.brand_name.padEnd(10)} ${s.country_code}  ${s.base_url.padEnd(28)} ` +
        `${s.platform.padEnd(10)} ${s.assortment_handles.length} collections\n`,
    )
  }
}

async function cmdReport(flags: Flags): Promise<void> {
  const { data: runs, error: runError } = await db()
    .from('crawl_runs')
    // One literal, not a concatenation: the Supabase client infers the row type
    // from the literal text, and a `+` turns it into plain `string`, which
    // degrades the result type to GenericStringError[].
    .select(
      'id,status,started_at,finished_at,products_found,variants_found,snapshots_written,events_written,reviews_found,reviews_new,review_responses_new',
    )
    .order('started_at', { ascending: false })
    .limit(5)
  if (runError) throw new Error(runError.message)

  process.stdout.write('\nRecent runs\n-----------\n')
  for (const r of (runs ?? []) as Array<Record<string, unknown>>) {
    process.stdout.write(
      `${String(r['started_at']).slice(0, 19)}  ${String(r['status']).padEnd(8)}` +
        ` products=${r['products_found']} variants=${r['variants_found']}` +
        ` snapshots=${r['snapshots_written']} events=${r['events_written']}` +
        ` reviews=${r['reviews_found']} new=${r['reviews_new']}` +
        ` replies=${r['review_responses_new']}\n`,
    )
  }

  const { data: models, error: modelError } = await db()
    .from('v_model_overview')
    .select('model_name,skill_tier,generation,sku_count,thicknesses_mm,price_min,price_max,skus_on_sale')
    .order('skill_tier')
    .limit(flags.limit ? Number(flags.limit) : 40)
  if (modelError) throw new Error(modelError.message)

  process.stdout.write('\nModels\n------\n')
  for (const m of (models ?? []) as Array<Record<string, unknown>>) {
    const thickness = Array.isArray(m['thicknesses_mm'])
      ? (m['thicknesses_mm'] as unknown[]).join('/')
      : '-'
    process.stdout.write(
      `${String(m['model_name']).padEnd(28)} ${String(m['skill_tier']).padEnd(14)}` +
        ` skus=${String(m['sku_count']).padStart(3)} ${thickness.padEnd(10)}` +
        ` $${m['price_min']}-${m['price_max']}` +
        (Number(m['skus_on_sale']) > 0 ? `  ON SALE x${m['skus_on_sale']}` : '') +
        '\n',
    )
  }

  const { data: changes } = await db()
    .from('v_recent_changes')
    .select('occurred_at,event_type,product_title,variant_title,old_value,new_value')
    .limit(15)

  const rows = (changes ?? []) as Array<Record<string, unknown>>
  if (rows.length > 0) {
    process.stdout.write('\nRecent changes\n--------------\n')
    for (const c of rows) {
      process.stdout.write(
        `${String(c['occurred_at']).slice(0, 10)} ${String(c['event_type']).padEnd(18)}` +
          ` ${String(c['product_title']).slice(0, 44).padEnd(44)}` +
          ` ${c['old_value'] ?? '-'} -> ${c['new_value'] ?? '-'}\n`,
      )
    }
  }
}

interface Flags {
  brand?: string
  country?: string
  stages?: string
  limit?: string
  dryRun: boolean
  scheduled: boolean
  noSync: boolean
  fullReviews: boolean
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { dryRun: false, scheduled: false, noSync: false, fullReviews: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--dry-run':
        flags.dryRun = true
        break
      case '--scheduled':
        flags.scheduled = true
        break
      case '--no-sync':
        flags.noSync = true
        break
      case '--full-reviews':
        flags.fullReviews = true
        break
      case '--brand':
        flags.brand = args[++i]
        break
      case '--country':
        flags.country = args[++i]
        break
      case '--stages':
        flags.stages = args[++i]
        break
      case '--limit':
        flags.limit = args[++i]
        break
      default:
        break
    }
  }
  return flags
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 2
})
