import 'server-only'
import { db, selectAll } from './supabase.js'
import { withRetry } from './retry.js'

/**
 * Read layer for the dashboard.
 *
 * Everything here runs on the server with the service-role key. RLS is
 * deny-by-default, so the browser never talks to Supabase directly and the
 * secret key never leaves the server.
 *
 * These functions query the views from migration ...0003_views.sql, which is
 * where the "always filter is_in_assortment" and "latest snapshot per variant"
 * rules already live. Do not reach past them to the raw tables.
 */

export interface VariantCurrent {
  variant_id: string
  sku: string | null
  variant_title: string | null
  core_thickness_mm: number | null
  colorway: string | null
  weight_grams: number | null
  variant_shape: string | null
  endorsed_player: string | null
  attr_confidence: number | null
  product_id: string
  product_title: string
  product_url: string | null
  image_url: string | null
  is_in_assortment: boolean
  model_id: string | null
  model_name: string | null
  skill_tier: string | null
  product_line: string | null
  generation: string | null
  generation_sequence: number | null
  brand: string
  country_code: string
  observed_at: string | null
  price: number | null
  compare_at_price: number | null
  currency: string | null
  is_on_sale: boolean | null
  discount_pct: number | null
  is_available: boolean | null
}

export interface ModelOverview {
  model_id: string
  brand: string
  product_line: string | null
  generation: string | null
  generation_sequence: number | null
  model_name: string
  skill_tier: string
  shape: string
  play_style: string
  sku_count: number
  thicknesses_mm: number[] | null
  colorways: string[] | null
  shapes: string[] | null
  endorsed_players: string[] | null
  price_min: number | null
  price_max: number | null
  skus_in_stock: number
  skus_on_sale: number
  best_discount_pct: number | null
  currency: string | null
  country_code: string
}

export interface ChangeEvent {
  id: number
  event_type: string
  occurred_at: string
  old_value: string | null
  new_value: string | null
  delta_numeric: number | null
  delta_pct: number | null
  sku: string | null
  variant_title: string | null
  core_thickness_mm: number | null
  colorway: string | null
  product_title: string
  product_url: string | null
  model_name: string | null
  skill_tier: string | null
  brand: string
}

export interface CrawlRun {
  id: string
  status: string
  run_type: string
  started_at: string
  finished_at: string | null
  stages_done: string[]
  categories_found: number
  products_found: number
  variants_found: number
  snapshots_written: number
  events_written: number
  error_message: string | null
}

export interface DailyPoint {
  day: string
  price_close: number | null
  discount_pct_close: number | null
  was_on_sale: boolean
  was_available: boolean
}

const MODEL_COLUMNS =
  'model_id,brand,product_line,generation,generation_sequence,model_name,skill_tier,shape,play_style,' +
  'sku_count,thicknesses_mm,colorways,shapes,endorsed_players,price_min,price_max,' +
  'skus_in_stock,skus_on_sale,best_discount_pct,currency,country_code'

const VARIANT_COLUMNS =
  'variant_id,sku,variant_title,core_thickness_mm,colorway,weight_grams,variant_shape,endorsed_player,attr_confidence,' +
  'product_id,product_title,product_url,image_url,is_in_assortment,model_id,model_name,' +
  'skill_tier,product_line,generation,generation_sequence,brand,country_code,' +
  'observed_at,price,compare_at_price,currency,is_on_sale,discount_pct,is_available'

export async function getModels(brandSlug?: string): Promise<ModelOverview[]> {
  const rows = await selectAll<ModelOverview>('v_model_overview', MODEL_COLUMNS, (q) =>
    brandSlug ? q.eq('brand_slug', brandSlug) : q,
  )
  return rows.sort(
    (a, b) =>
      tierRank(a.skill_tier) - tierRank(b.skill_tier) ||
      (b.generation_sequence ?? -1) - (a.generation_sequence ?? -1) ||
      a.model_name.localeCompare(b.model_name),
  )
}

export async function getModel(modelId: string): Promise<ModelOverview | null> {
  return withRetry(async () => {
    const { data, error } = await db()
      .from('v_model_overview')
      .select(MODEL_COLUMNS)
      .eq('model_id', modelId)
      .limit(1)
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown as ModelOverview[])[0] ?? null
  }, 'getModel')
}

export async function getVariants(
  modelId?: string,
  brandSlug?: string,
): Promise<VariantCurrent[]> {
  const rows = await selectAll<VariantCurrent>('v_variant_current', VARIANT_COLUMNS, (q) => {
    let query = q
    if (modelId) query = query.eq('model_id', modelId)
    if (brandSlug) query = query.eq('brand_slug', brandSlug)
    return query
  })
  return rows
    .filter((v) => v.is_in_assortment)
    .sort(
      (a, b) =>
        (a.core_thickness_mm ?? 0) - (b.core_thickness_mm ?? 0) ||
        (a.colorway ?? '').localeCompare(b.colorway ?? ''),
    )
}

export async function getDiscounts(limit = 60, brandSlug?: string): Promise<VariantCurrent[]> {
  const rows = await selectAll<VariantCurrent>('v_variant_current', VARIANT_COLUMNS, (q) =>
    brandSlug ? q.eq('brand_slug', brandSlug) : q,
  )
  return rows
    .filter((v) => v.is_on_sale && v.is_in_assortment)
    .sort((a, b) => (b.discount_pct ?? 0) - (a.discount_pct ?? 0))
    .slice(0, limit)
}

export async function getChanges(limit = 100, brandSlug?: string): Promise<ChangeEvent[]> {
  return withRetry(async () => {
    let q = db()
      .from('v_recent_changes')
      .select(
        'id,event_type,occurred_at,old_value,new_value,delta_numeric,delta_pct,sku,variant_title,' +
          'core_thickness_mm,colorway,product_title,product_url,model_name,skill_tier,brand',
      )
      .limit(limit)
    if (brandSlug) q = q.eq('brand_slug', brandSlug)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as ChangeEvent[]
  }, 'getChanges')
}

export async function getRuns(limit = 25): Promise<CrawlRun[]> {
  return withRetry(async () => {
    const { data, error } = await db()
      .from('crawl_runs')
      .select(
        'id,status,run_type,started_at,finished_at,stages_done,categories_found,products_found,' +
          'variants_found,snapshots_written,events_written,error_message',
      )
      .order('started_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as CrawlRun[]
  }, 'getRuns')
}

export async function getPriceHistory(variantId: string): Promise<DailyPoint[]> {
  return withRetry(async () => {
    const { data, error } = await db()
      .from('v_variant_price_daily')
      .select('day,price_close,discount_pct_close,was_on_sale,was_available')
      .eq('variant_id', variantId)
      .order('day', { ascending: true })
      .limit(400)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as DailyPoint[]
  }, 'getPriceHistory')
}

export interface Overview {
  models: number
  skus: number
  inStock: number
  outOfStock: number
  onSale: number
  bestDiscount: number
  categories: number
  lastRun: CrawlRun | null
  observations: number
  firstObservedAt: string | null
}

export async function getOverview(brandSlug?: string): Promise<Overview> {
  const [variants, runs] = await Promise.all([getVariants(undefined, brandSlug), getRuns(1)])

  const [{ count: categories }, { count: observations }] = await Promise.all([
    db().from('categories').select('*', { count: 'exact', head: true }).eq('is_active', true),
    db().from('variant_snapshots').select('*', { count: 'exact', head: true }),
  ])

  const { data: earliest } = await db()
    .from('variant_snapshots')
    .select('observed_at')
    .order('observed_at', { ascending: true })
    .limit(1)

  const models = new Set(variants.map((v) => v.model_id).filter(Boolean))

  return {
    models: models.size,
    skus: variants.length,
    inStock: variants.filter((v) => v.is_available).length,
    outOfStock: variants.filter((v) => v.is_available === false).length,
    onSale: variants.filter((v) => v.is_on_sale).length,
    bestDiscount: variants.reduce((max, v) => Math.max(max, Number(v.discount_pct ?? 0)), 0),
    categories: categories ?? 0,
    lastRun: runs[0] ?? null,
    observations: observations ?? 0,
    firstObservedAt: (earliest as Array<{ observed_at: string }> | null)?.[0]?.observed_at ?? null,
  }
}

/** Pro first — it is what management asks about. */
const TIER_ORDER = ['pro', 'performance', 'premium', 'recreational', 'junior', 'unknown']

export function tierRank(tier: string | null): number {
  const idx = TIER_ORDER.indexOf(tier ?? 'unknown')
  return idx === -1 ? TIER_ORDER.length : idx
}

export interface BrandSummary {
  slug: string
  name: string
  models: number
  skus: number
  onSale: number
  outOfStock: number
  priceMin: number | null
  priceMax: number | null
}

/**
 * One row per brand for the switcher and the cross-brand comparison.
 *
 * Counts are computed here rather than in a view because they must respect the
 * same assortment filter the rest of the dashboard uses.
 */
export async function getBrandSummaries(): Promise<BrandSummary[]> {
  const [variants, brands] = await Promise.all([
    getVariants(),
    selectAll<{ slug: string; name: string }>('brands', 'slug,name'),
  ])

  return brands
    .map((b) => {
      const mine = variants.filter((v) => v.brand === b.name)
      const prices = mine.map((v) => Number(v.price)).filter((n) => Number.isFinite(n))
      return {
        slug: b.slug,
        name: b.name,
        models: new Set(mine.map((v) => v.model_id).filter(Boolean)).size,
        skus: mine.length,
        onSale: mine.filter((v) => v.is_on_sale).length,
        outOfStock: mine.filter((v) => v.is_available === false).length,
        priceMin: prices.length ? Math.min(...prices) : null,
        priceMax: prices.length ? Math.max(...prices) : null,
      }
    })
    .filter((b) => b.skus > 0)
    .sort((a, b) => b.skus - a.skus)
}

/**
 * Resolve whatever arrived in ?brand= to a real brand.
 *
 * The canonical form is the slug, and every link this app renders uses it. But
 * the switcher used to emit the display name, so links shared or bookmarked
 * before that change carry `?brand=Selkirk`. Matching the slug first and then
 * falling back to a case-insensitive name keeps those links working instead of
 * silently returning an empty page — which is the failure this whole change set
 * exists to remove.
 *
 * Returns null for an unknown brand so the caller can choose between showing
 * everything and showing a not-found.
 */
export async function resolveBrand(param?: string): Promise<{ slug: string; name: string } | null> {
  const wanted = param?.trim()
  if (!wanted) return null

  const brands = await selectAll<{ slug: string; name: string }>('brands', 'slug,name')
  const lower = wanted.toLowerCase()

  return (
    brands.find((b) => b.slug === wanted) ??
    brands.find((b) => b.slug.toLowerCase() === lower) ??
    brands.find((b) => b.name.toLowerCase() === lower) ??
    null
  )
}
