import { db, insertAll, selectAll } from '../../lib/supabase.js'
import type { RunContext } from '../context.js'

interface SnapshotRow {
  variant_id: string
  price: number | null
  compare_at_price: number | null
  is_on_sale: boolean | null
  discount_pct: number | null
  is_available: boolean | null
}

/**
 * Stage 4 — derive the change-log.
 *
 * Compares this run's snapshots against the previous SUCCESSFUL run for the same
 * site and writes one row per meaningful change. Everything here is recomputable
 * from variant_snapshots; it exists so "what changed this week" is an index scan
 * instead of a window function over the whole history.
 *
 * The previous run must be a completed one — diffing against a partial run would
 * report every variant it failed to reach as delisted.
 */
export async function runDiffStage(ctx: RunContext): Promise<void> {
  if (ctx.dryRun) {
    ctx.log.info('dry-run: diff skipped')
    return
  }

  const previousRunId = await findPreviousRunId(ctx)
  if (!previousRunId) {
    ctx.log.info('no previous successful run; treating this as the baseline')
    return
  }

  const [current, previous] = await Promise.all([
    loadSnapshots(ctx.runId),
    loadSnapshots(previousRunId),
  ])

  const currentByVariant = new Map(current.map((r) => [r.variant_id, r]))
  const previousByVariant = new Map(previous.map((r) => [r.variant_id, r]))

  const occurredAt = new Date().toISOString()
  const events: Array<Record<string, unknown>> = []

  const push = (
    variantId: string,
    eventType: string,
    fields: Partial<{
      old_value: string | null
      new_value: string | null
      delta_numeric: number | null
      delta_pct: number | null
    }> = {},
  ): void => {
    events.push({
      run_id: ctx.runId,
      variant_id: variantId,
      site_id: ctx.site.id,
      event_type: eventType,
      occurred_at: occurredAt,
      old_value: fields.old_value ?? null,
      new_value: fields.new_value ?? null,
      delta_numeric: fields.delta_numeric ?? null,
      delta_pct: fields.delta_pct ?? null,
    })
  }

  for (const [variantId, now] of currentByVariant) {
    const before = previousByVariant.get(variantId)

    if (!before) {
      push(variantId, 'listed', { new_value: formatPrice(now.price) })
      continue
    }

    // ---- price ----
    if (now.price !== null && before.price !== null && now.price !== before.price) {
      const delta = Number((now.price - before.price).toFixed(2))
      const pct = before.price > 0 ? Number(((delta / before.price) * 100).toFixed(2)) : null
      push(variantId, delta > 0 ? 'price_increase' : 'price_decrease', {
        old_value: formatPrice(before.price),
        new_value: formatPrice(now.price),
        delta_numeric: delta,
        delta_pct: pct,
      })
    }

    // ---- discount ----
    const wasOnSale = before.is_on_sale === true
    const isOnSale = now.is_on_sale === true
    const beforePct = Number(before.discount_pct ?? 0)
    const nowPct = Number(now.discount_pct ?? 0)

    if (!wasOnSale && isOnSale) {
      push(variantId, 'discount_started', {
        old_value: null,
        new_value: `${nowPct}%`,
        delta_pct: nowPct,
      })
    } else if (wasOnSale && !isOnSale) {
      push(variantId, 'discount_ended', {
        old_value: `${beforePct}%`,
        new_value: null,
        delta_pct: -beforePct,
      })
    } else if (wasOnSale && isOnSale && nowPct > beforePct) {
      push(variantId, 'discount_deepened', {
        old_value: `${beforePct}%`,
        new_value: `${nowPct}%`,
        delta_pct: Number((nowPct - beforePct).toFixed(2)),
      })
    }

    // ---- availability ----
    if (before.is_available === true && now.is_available === false) {
      push(variantId, 'went_oos', { old_value: 'in_stock', new_value: 'out_of_stock' })
    } else if (before.is_available === false && now.is_available === true) {
      push(variantId, 'back_in_stock', { old_value: 'out_of_stock', new_value: 'in_stock' })
    }
  }

  // Present last run, absent now — the listing is gone rather than merely OOS.
  for (const [variantId, before] of previousByVariant) {
    if (!currentByVariant.has(variantId)) {
      push(variantId, 'delisted', { old_value: formatPrice(before.price) })
    }
  }

  if (events.length > 0) await insertAll('variant_events', events)
  ctx.stats.events_written = events.length
  ctx.log.info('diff complete', {
    previousRunId,
    events: events.length,
    breakdown: countBy(events),
  })
}

async function findPreviousRunId(ctx: RunContext): Promise<string | null> {
  const { data, error } = await db()
    .from('crawl_runs')
    .select('id')
    .eq('site_id', ctx.site.id)
    .eq('status', 'done')
    .neq('id', ctx.runId)
    .order('started_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`find previous run: ${error.message}`)
  return (data as Array<{ id: string }> | null)?.[0]?.id ?? null
}

function loadSnapshots(runId: string): Promise<SnapshotRow[]> {
  return selectAll<SnapshotRow>(
    'variant_snapshots',
    'variant_id,price,compare_at_price,is_on_sale,discount_pct,is_available',
    (q) => q.eq('run_id', runId),
  )
}

function formatPrice(price: number | null): string | null {
  return price === null ? null : price.toFixed(2)
}

function countBy(events: Array<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of events) {
    const key = String(e['event_type'])
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}
