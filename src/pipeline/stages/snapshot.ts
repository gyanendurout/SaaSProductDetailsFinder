import { insertAll } from '../../lib/supabase.js'
import type { RunContext } from '../context.js'
import type { CatalogResult } from './catalog.js'
import { comparePrices, previousPrices } from '../price-guard.js'

/**
 * Stage 3 — the time series.
 *
 * One row per variant per successful run. This is the only stage whose output
 * cannot be reconstructed later: miss a day and that day is gone forever, which
 * is why it is deliberately the simplest code in the pipeline.
 *
 * `observed_at` is a single timestamp for the whole run, not per row, so every
 * SKU in one crawl shares an x-axis value and daily rollups group cleanly.
 */
export async function runSnapshotStage(
  ctx: RunContext,
  catalog: CatalogResult,
): Promise<void> {
  if (ctx.dryRun) {
    ctx.log.info('dry-run: snapshots not written')
    return
  }

  const observedAt = new Date().toISOString()
  const rows: Array<Record<string, unknown>> = []

  for (const product of catalog.products) {
    for (const variant of product.variants) {
      const variantId = catalog.variantIds.get(variant.sourceVariantId)
      if (!variantId) continue
      rows.push({
        run_id: ctx.runId,
        variant_id: variantId,
        site_id: ctx.site.id,
        observed_at: observedAt,
        price: variant.price,
        // Shopify repeats the price in compare_at_price when nothing is on
        // sale. Storing that as-is would make is_on_sale false but leave a
        // misleading "was" price in the UI, so equal values become null.
        compare_at_price:
          variant.compareAtPrice !== null &&
          variant.price !== null &&
          variant.compareAtPrice <= variant.price
            ? null
            : variant.compareAtPrice,
        currency: variant.currency,
        is_available: variant.isAvailable,
        inventory_quantity: variant.inventoryQuantity ?? null,
        position_in_category: variant.position ?? null,
      })
    }
  }

  // Nothing written until the prices are the same kind of number as last time.
  // A snapshot cannot be corrected later — a bad row is in the series forever.
  const verdict = comparePrices(
    rows.map((r) => Number(r['price'])).filter((n) => Number.isFinite(n)),
    await previousPrices(ctx.site.id),
  )
  if (!verdict.ok) {
    ctx.log.error('refusing to write snapshots', { reason: verdict.reason })
    throw new Error(`price guard: ${verdict.reason}`)
  }

  await insertAll('variant_snapshots', rows)
  ctx.stats.snapshots_written = rows.length
  ctx.log.info('snapshots written', {
    count: rows.length,
    observedAt,
    medianPrice: verdict.median,
  })
}
