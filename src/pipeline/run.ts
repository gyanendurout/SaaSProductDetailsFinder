import { db } from '../lib/supabase.js'
import { createLogger } from '../lib/logger.js'
import { PoliteClient } from '../lib/http.js'
import { ShopifyAdapter } from '../sources/shopify/adapter.js'
import type { SourceAdapter } from '../sources/types.js'
import { localSites } from '../config/sites.js'
import { RunContext, type SiteRow, type StageName } from './context.js'
import { runCategoriesStage } from './stages/categories.js'
import { runCatalogStage, type CatalogResult } from './stages/catalog.js'
import { runSnapshotStage } from './stages/snapshot.js'
import { runDiffStage } from './stages/diff.js'
import { runReviewsStage } from './stages/reviews.js'

const log = createLogger('pipeline')

const ALL_STAGES: StageName[] = ['categories', 'catalog', 'snapshot', 'diff', 'reviews']

export interface CrawlOptions {
  brandSlug?: string
  countryCode?: string
  stages?: StageName[]
  dryRun?: boolean
  runType?: 'scheduled' | 'manual' | 'backfill'
  /** Re-read every review page instead of stopping at the per-product watermark. */
  fullReviews?: boolean
}

export interface CrawlOutcome {
  siteId: string
  runId: string | null
  status: 'done' | 'partial' | 'error'
}

/** Crawls every active site matching the filter. */
export async function crawl(options: CrawlOptions = {}): Promise<CrawlOutcome[]> {
  // A dry run falls back to the static site list — both when Supabase is not
  // configured at all, and when it is configured but does not yet know about the
  // brand. That second case is the normal state while adding a new brand: the
  // rules can be validated against the live site before any migration is applied.
  // A run that WRITES always requires a real site row.
  const dryRun = Boolean(options.dryRun)
  let sites: SiteRow[] = []

  if (dryRun && !process.env['SUPABASE_URL']) {
    log.warn('SUPABASE_URL not set — dry run using static config from src/config/sites.ts')
    sites = localSites(options.brandSlug, options.countryCode)
  } else {
    sites = await loadSites(options.brandSlug, options.countryCode)
    if (sites.length === 0 && dryRun) {
      sites = localSites(options.brandSlug, options.countryCode)
      if (sites.length > 0) {
        log.warn('no matching site in the database — dry run using src/config/sites.ts', {
          brand: options.brandSlug ?? 'all',
        })
      }
    }
  }

  if (sites.length === 0) {
    throw new Error(
      'No active sites matched. Apply the migrations in supabase/migrations and check --brand/--country.',
    )
  }
  const outcomes: CrawlOutcome[] = []
  // Sites run sequentially: they may share a host, and politeness beats speed.
  for (const site of sites) {
    outcomes.push(await crawlSite(site, options))
  }
  return outcomes
}

async function crawlSite(site: SiteRow, options: CrawlOptions): Promise<CrawlOutcome> {
  const stages = options.stages ?? ALL_STAGES
  const dryRun = options.dryRun ?? false
  const adapter = buildAdapter(site)

  const runId = dryRun
    ? 'dry-run'
    : await createRun(site.id, options.runType ?? 'manual', stages)

  const ctx = new RunContext(runId, site, adapter, dryRun)
  ctx.log.info('crawl started', {
    baseUrl: site.base_url,
    platform: site.platform,
    stages,
    dryRun,
  })

  let categoryIds = new Map<string, string>()
  let catalog: CatalogResult = { variantIds: new Map(), productIds: new Map(), products: [] }

  if (stages.includes('categories')) {
    try {
      categoryIds = await runCategoriesStage(ctx)
      ctx.markStageDone('categories')
    } catch (err) {
      await ctx.recordError('categories', err)
    }
  }

  if (stages.includes('catalog')) {
    try {
      catalog = await runCatalogStage(ctx, categoryIds)
      ctx.markStageDone('catalog')
    } catch (err) {
      await ctx.recordError('catalog', err)
    }
  }

  // A snapshot taken from a failed catalog fetch would look like a catalogue-wide
  // stockout. Better a gap in the series than a lie in it.
  const catalogOk = ctx.completedStages().includes('catalog')
  if (stages.includes('snapshot')) {
    if (!catalogOk) {
      ctx.log.warn('skipping snapshot: catalog stage did not complete')
    } else {
      try {
        await runSnapshotStage(ctx, catalog)
        ctx.markStageDone('snapshot')
      } catch (err) {
        await ctx.recordError('snapshot', err, 'db_error')
      }
    }
  }

  if (stages.includes('diff')) {
    if (!ctx.completedStages().includes('snapshot')) {
      ctx.log.warn('skipping diff: no snapshot written this run')
    } else {
      try {
        await runDiffStage(ctx)
        ctx.markStageDone('diff')
      } catch (err) {
        await ctx.recordError('diff', err)
      }
    }
  }

  // Reviews last: it is by far the longest stage, and nothing else depends on
  // it, so a failure here still leaves a complete price/stock run behind it.
  if (stages.includes('reviews')) {
    if (!catalogOk) {
      ctx.log.warn('skipping reviews: catalog stage did not complete')
    } else {
      try {
        await runReviewsStage(ctx, catalog, { full: options.fullReviews ?? false })
        ctx.markStageDone('reviews')
      } catch (err) {
        await ctx.recordError('reviews', err)
      }
    }
  }

  const status: 'done' | 'partial' | 'error' = !ctx.hasFailure
    ? 'done'
    : ctx.completedStages().length === 0
      ? 'error'
      : 'partial'

  if (!dryRun) await finaliseRun(ctx, status)
  ctx.log.info(`crawl ${status}`, ctx.stats)
  return { siteId: site.id, runId: dryRun ? null : runId, status }
}

function buildAdapter(site: SiteRow): SourceAdapter {
  const client = new PoliteClient(site.crawl_delay_ms)
  switch (site.platform) {
    case 'shopify':
      return new ShopifyAdapter(client)
    default:
      throw new Error(
        `No adapter for platform "${site.platform}". Implement SourceAdapter in src/sources/.`,
      )
  }
}

export async function loadSites(
  brandSlug?: string,
  countryCode?: string,
): Promise<SiteRow[]> {
  let query = db()
    .from('sites')
    .select(
      'id,brand_id,country_code,base_url,platform,currency,assortment_handles,crawl_delay_ms,review_platform,review_config,brands(slug,name)',
    )
    .eq('is_active', true)
  if (countryCode) query = query.eq('country_code', countryCode.toUpperCase())

  const { data, error } = await query
  if (error) throw new Error(`load sites: ${error.message}`)

  type BrandRef = { slug: string; name: string }
  // PostgREST returns an embedded to-one relation as an object, but the client
  // types it as an array. Accept either shape rather than assert one.
  type Row = Omit<SiteRow, 'brand_slug' | 'brand_name'> & {
    brands: BrandRef | BrandRef[] | null
  }

  return ((data ?? []) as unknown as Row[])
    .map((r) => {
      const brand = Array.isArray(r.brands) ? r.brands[0] : r.brands
      return {
        id: r.id,
        brand_id: r.brand_id,
        country_code: r.country_code,
        base_url: r.base_url,
        platform: r.platform,
        currency: r.currency,
        assortment_handles: r.assortment_handles ?? [],
        crawl_delay_ms: r.crawl_delay_ms,
        review_platform: r.review_platform ?? null,
        review_config: r.review_config ?? {},
        brand_slug: brand?.slug ?? 'unknown',
        brand_name: brand?.name ?? 'Unknown',
      }
    })
    .filter((s) => !brandSlug || s.brand_slug === brandSlug.toLowerCase())
}

async function createRun(
  siteId: string,
  runType: string,
  stages: StageName[],
): Promise<string> {
  const { data, error } = await db()
    .from('crawl_runs')
    .insert({
      site_id: siteId,
      run_type: runType,
      status: 'running',
      stages_requested: stages,
    })
    .select('id')
    .single()
  if (error) throw new Error(`create run: ${error.message}`)
  return (data as { id: string }).id
}

async function finaliseRun(ctx: RunContext, status: string): Promise<void> {
  const { error } = await db()
    .from('crawl_runs')
    .update({
      status,
      stages_done: ctx.completedStages(),
      finished_at: new Date().toISOString(),
      ...ctx.stats,
    })
    .eq('id', ctx.runId)
  if (error) log.error('could not finalise run', { message: error.message })
}
