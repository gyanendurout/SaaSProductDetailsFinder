import { selectAll, upsertAll, upsertReturning } from '../../lib/supabase.js'
import { rulesFor, lineMap } from '../../config/brands/index.js'
import {
  attrSourceMap,
  extractVariantAttributes,
  overallConfidence,
} from '../../normalize/attributes.js'
import { classifyAssortment } from '../../normalize/assortment.js'
import { dedupeVariantsAcrossProducts } from '../../normalize/dedupe.js'
import { resolveModel } from '../../normalize/model-resolver.js'
import type { RawProduct } from '../../sources/types.js'
import type { RunContext } from '../context.js'
import { ReferenceRepo } from '../repo.js'

export interface CatalogResult {
  /** source_variant_id -> variant uuid, for the snapshot stage. */
  variantIds: Map<string, string>
  /** source_product_id -> product uuid, for the reviews stage. */
  productIds: Map<string, string>
  /** The raw feed, kept in memory so snapshot does not re-fetch. */
  products: RawProduct[]
}

/**
 * Stage 2 — products, SKUs and the canonical model layer.
 *
 * Order matters: models must exist before products can reference them, and
 * products before variants. Everything is upserted on its natural key so a
 * re-run converges rather than duplicating.
 */
export async function runCatalogStage(
  ctx: RunContext,
  categoryIds: Map<string, string>,
): Promise<CatalogResult> {
  const fetched = await ctx.adapter.fetchProducts(ctx.target)

  // One SKU can be listed on two product pages — an umbrella product carrying
  // every shape, plus a per-shape page repeating the same variant ids. Resolve
  // ownership before anything is written, or the variants upsert touches the
  // same row twice in one statement and Postgres rejects the batch.
  const deduped = dedupeVariantsAcrossProducts(fetched, rulesFor(ctx.site.brand_slug))
  if (deduped.movedVariants > 0) {
    ctx.log.info('duplicate listings resolved', {
      movedVariants: deduped.movedVariants,
      droppedProducts: deduped.droppedProducts,
    })
  }
  const products = deduped.products

  ctx.stats.products_found = products.length
  ctx.stats.variants_found = products.reduce((n, p) => n + p.variants.length, 0)
  ctx.log.info('catalog fetched', {
    products: products.length,
    variants: ctx.stats.variants_found,
  })

  if (ctx.dryRun) {
    logDryRunSummary(ctx, products)
    return { variantIds: new Map(), productIds: new Map(), products }
  }

  const rules = rulesFor(ctx.site.brand_slug)
  const repo = new ReferenceRepo(ctx.site.brand_id)
  await repo.load()

  const existingProductIds = new Set(
    (
      await selectAll<{ source_product_id: string }>('products', 'source_product_id', (q) =>
        q.eq('site_id', ctx.site.id),
      )
    ).map((r) => r.source_product_id),
  )
  const existingVariantIds = new Set(
    (
      await selectAll<{ source_variant_id: string }>('variants', 'source_variant_id', (q) =>
        q.eq('site_id', ctx.site.id),
      )
    ).map((r) => r.source_variant_id),
  )

  // ---- canonical layer -----------------------------------------------------
  const modelIdByProduct = new Map<string, string>()
  for (const product of products) {
    const resolved = resolveModel(product, rules, mergedLines(rules, repo.knownLines()))
    const lineId = resolved.productLineSlug
      ? await repo.getOrCreateLine(resolved.productLineSlug, resolved.productLineName!)
      : null
    const generationId = resolved.generationSlug
      ? await repo.getOrCreateGeneration(resolved.generationSlug, resolved.generationName!)
      : null
    const modelId = await repo.getOrCreateModel({
      slug: resolved.modelSlug,
      name: resolved.modelName,
      productLineId: lineId,
      generationId,
      subLine: resolved.subLine,
      skillTier: resolved.skillTier,
      shape: 'unknown',
      playStyle: resolved.playStyle,
    })
    modelIdByProduct.set(product.sourceProductId, modelId)
  }

  // ---- products ------------------------------------------------------------
  const now = new Date().toISOString()
  const productRows = products.map((p) => ({
    site_id: ctx.site.id,
    model_id: modelIdByProduct.get(p.sourceProductId) ?? null,
    source_product_id: p.sourceProductId,
    handle: p.handle,
    title: p.title,
    vendor: p.vendor ?? null,
    product_type: p.productType ?? null,
    tags: p.tags,
    body_html: p.bodyHtml ?? null,
    url: p.url,
    image_url: p.imageUrl ?? null,
    published_at: p.publishedAt ?? null,
    source_created_at: p.sourceCreatedAt ?? null,
    source_updated_at: p.sourceUpdatedAt ?? null,
    is_in_assortment: classifyAssortment(p).isInAssortment,
    last_seen_at: now,
    is_active: true,
  }))

  const storedProducts = await upsertReturning<
    (typeof productRows)[number],
    { id: string; source_product_id: string }
  >('products', productRows, 'site_id,source_product_id', 'id,source_product_id')
  const productIdBySource = new Map(storedProducts.map((r) => [r.source_product_id, r.id]))
  ctx.stats.products_new = products.filter(
    (p) => !existingProductIds.has(p.sourceProductId),
  ).length

  // ---- variants (with derived attributes) ----------------------------------
  const variantRows: Array<Record<string, unknown>> = []
  for (const product of products) {
    const productId = productIdBySource.get(product.sourceProductId)
    if (!productId) {
      ctx.log.warn('product id missing after upsert; skipping its variants', {
        handle: product.handle,
      })
      continue
    }
    for (const variant of product.variants) {
      const attrs = extractVariantAttributes(product, variant, rules)
      const playerId = attrs.endorsedPlayer
        ? await repo.getOrCreatePlayer(attrs.endorsedPlayer.value)
        : null
      variantRows.push({
        product_id: productId,
        site_id: ctx.site.id,
        source_variant_id: variant.sourceVariantId,
        sku: variant.sku ?? null,
        barcode: variant.barcode ?? null,
        title: variant.title ?? null,
        position: variant.position ?? null,
        image_url: variant.imageUrl ?? null,
        option1_name: variant.options[0]?.name ?? null,
        option1_value: variant.options[0]?.value ?? null,
        option2_name: variant.options[1]?.name ?? null,
        option2_value: variant.options[1]?.value ?? null,
        option3_name: variant.options[2]?.name ?? null,
        option3_value: variant.options[2]?.value ?? null,
        core_thickness_mm: attrs.coreThicknessMm?.value ?? null,
        colorway: attrs.colorway?.value ?? null,
        color_primary: attrs.colorPrimary,
        color_secondary: attrs.colorSecondary,
        endorsed_player_id: playerId,
        shape: attrs.shape?.value ?? 'unknown',
        weight_grams: attrs.weightGrams?.value ?? null,
        attr_source: attrSourceMap(attrs),
        attr_confidence: overallConfidence(attrs),
        last_seen_at: now,
        is_active: true,
      })
    }
  }

  const storedVariants = await upsertReturning<
    Record<string, unknown>,
    { id: string; source_variant_id: string }
  >('variants', variantRows, 'site_id,source_variant_id', 'id,source_variant_id')
  const variantIds = new Map(storedVariants.map((r) => [r.source_variant_id, r.id]))
  ctx.stats.variants_new = variantRows.filter(
    (r) => !existingVariantIds.has(String(r['source_variant_id'])),
  ).length

  // ---- category membership -------------------------------------------------
  const membershipRows: Array<Record<string, unknown>> = []
  for (const product of products) {
    const productId = productIdBySource.get(product.sourceProductId)
    if (!productId) continue
    for (const handle of product.categoryHandles) {
      const categoryId = categoryIds.get(handle)
      if (!categoryId) continue
      membershipRows.push({
        product_id: productId,
        category_id: categoryId,
        last_seen_at: now,
        is_active: true,
      })
    }
  }
  if (membershipRows.length > 0) {
    await upsertAll('product_categories', membershipRows, 'product_id,category_id')
  }

  ctx.log.info('catalog stored', {
    products: productRows.length,
    productsNew: ctx.stats.products_new,
    variants: variantRows.length,
    variantsNew: ctx.stats.variants_new,
    memberships: membershipRows.length,
  })

  return { variantIds, productIds: productIdBySource, products }
}

/**
 * Dry run prints what normalization resolved, so the rules can be checked
 * against the live site without a database. It uses the same seed reference data
 * a real run would load, otherwise the output would not be representative.
 */
function logDryRunSummary(ctx: RunContext, products: RawProduct[]): void {
  const lines = new Map<string, number>()
  const generations = new Map<string, number>()
  const tiers = new Map<string, number>()
  const thicknesses = new Map<string, number>()
  const styles = new Map<string, number>()
  const excluded: string[] = []
  const rules = rulesFor(ctx.site.brand_slug)
  const seedLines = lineMap(rules)

  for (const product of products) {
    const verdict = classifyAssortment(product)
    if (!verdict.isInAssortment) {
      excluded.push(`${product.title} (${verdict.reason})`)
      continue
    }
    const resolved = resolveModel(product, rules, seedLines)
    bump(lines, resolved.productLineName ?? (verdict.isBundle ? '(bundle)' : '(unresolved)'))
    bump(generations, resolved.generationName ?? '(unresolved)')
    bump(tiers, resolved.skillTier)
    bump(styles, resolved.playStyle)
    for (const variant of product.variants) {
      const attrs = extractVariantAttributes(product, variant, rules)
      bump(thicknesses, attrs.coreThicknessMm ? `${attrs.coreThicknessMm.value}mm` : '(none)')
    }
  }
  ctx.log.info('dry-run: product lines', Object.fromEntries(sorted(lines)))
  ctx.log.info('dry-run: generations', Object.fromEntries(sorted(generations)))
  ctx.log.info('dry-run: skill tiers', Object.fromEntries(sorted(tiers)))
  ctx.log.info('dry-run: play styles', Object.fromEntries(sorted(styles)))
  ctx.log.info('dry-run: thicknesses', Object.fromEntries(sorted(thicknesses)))
  ctx.log.info(`dry-run: excluded ${excluded.length} non-assortment products`)
  for (const item of excluded.slice(0, 12)) ctx.log.debug(`  excluded: ${item}`)
}

function sorted(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/**
 * Seed lines from the brand rules plus anything discovered on earlier crawls.
 * The rules are the head start; the database is the accumulated truth.
 */
function mergedLines(
  rules: ReturnType<typeof rulesFor>,
  discovered: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const merged = new Map(lineMap(rules))
  for (const [slug, name] of discovered) merged.set(slug, name)
  return merged
}
