import { db } from '../lib/supabase.js'
import { createLogger, type Logger } from '../lib/logger.js'
import type { SourceAdapter, SiteTarget } from '../sources/types.js'

export interface SiteRow {
  id: string
  brand_id: string
  country_code: string
  base_url: string
  platform: string
  currency: string
  assortment_handles: string[]
  crawl_delay_ms: number
  brand_slug: string
  brand_name: string
  /** Config-only; carried into the `sites` row by `npm run sync`. */
  locale?: string
  notes?: string
  /**
   * Which review app this storefront runs. Independent of `platform` — all
   * three brands here are Shopify, and all three run a different review app.
   */
  review_platform?: string | null
  /** Per-platform addressing the review adapter needs. See src/sources/reviews. */
  review_config?: Record<string, string>
}

export type StageName = 'categories' | 'catalog' | 'pdp' | 'snapshot' | 'diff' | 'reviews'

export interface RunStats {
  categories_found: number
  products_found: number
  products_new: number
  variants_found: number
  variants_new: number
  snapshots_written: number
  events_written: number
  reviews_found: number
  reviews_new: number
  review_responses_new: number
}

/**
 * Everything a stage needs, plus the bookkeeping that makes a partial failure
 * legible: per-stage error capture, a stages_done list, and the run row that
 * every written record points back to.
 */
export class RunContext {
  readonly log: Logger
  readonly stats: RunStats = {
    categories_found: 0,
    products_found: 0,
    products_new: 0,
    variants_found: 0,
    variants_new: 0,
    snapshots_written: 0,
    events_written: 0,
    reviews_found: 0,
    reviews_new: 0,
    review_responses_new: 0,
  }
  private readonly stagesDone: StageName[] = []
  private failed = false

  constructor(
    readonly runId: string,
    readonly site: SiteRow,
    readonly adapter: SourceAdapter,
    readonly dryRun: boolean,
  ) {
    this.log = createLogger(`run:${site.brand_slug}-${site.country_code}`)
  }

  get target(): SiteTarget {
    return {
      siteId: this.site.id,
      baseUrl: this.site.base_url,
      currency: this.site.currency,
      assortmentHandles: this.site.assortment_handles,
    }
  }

  get hasFailure(): boolean {
    return this.failed
  }

  markStageDone(stage: StageName): void {
    if (!this.stagesDone.includes(stage)) this.stagesDone.push(stage)
  }

  completedStages(): StageName[] {
    return [...this.stagesDone]
  }

  /**
   * Records a failure without aborting the run. The run finishes `partial` and
   * the reason is queryable, rather than the whole crawl dying because one
   * collection was renamed.
   */
  async recordError(
    stage: StageName,
    error: unknown,
    errorType:
      | 'http_error'
      | 'parse_error'
      | 'timeout'
      | 'stage_error'
      | 'normalize_error'
      | 'db_error' = 'stage_error',
  ): Promise<void> {
    this.failed = true
    const target = (error as { target?: string }).target ?? null
    const message = error instanceof Error ? error.message : String(error)
    this.log.error(`stage ${stage} failed`, { target, message })
    if (this.dryRun) return
    const { error: dbError } = await db().from('crawl_errors').insert({
      run_id: this.runId,
      stage,
      target,
      error_type: errorType,
      error_message: message.slice(0, 500),
      status_code: (error as { status?: number }).status ?? null,
    })
    if (dbError) this.log.error('could not record crawl error', { message: dbError.message })
  }
}
