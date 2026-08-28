import { db, selectAll, upsertAll } from '../../lib/supabase.js'
import { classifyCategory } from '../../normalize/taxonomy.js'
import type { RunContext } from '../context.js'

/**
 * Stage 1 — capture the site's published taxonomy.
 *
 * Every collection is stored, not just the assortment ones, because a paddle
 * appearing in 'Outlet Paddles' or leaving 'Pro' is itself a signal. Each is
 * classified by role so the UI can group 234 collections into something a human
 * can read (see normalize/taxonomy.ts).
 */
export async function runCategoriesStage(ctx: RunContext): Promise<Map<string, string>> {
  const raw = await ctx.adapter.fetchCategories(ctx.target)
  ctx.stats.categories_found = raw.length

  const now = new Date().toISOString()
  const rows = raw.map((c) => ({
    site_id: ctx.site.id,
    source_category_id: c.sourceCategoryId,
    handle: c.handle,
    title: c.title,
    description: c.description ?? null,
    url: c.url ?? null,
    category_role: classifyCategory(c),
    position: c.position ?? null,
    nav_path: c.navPath ?? [],
    in_main_nav: c.inMainNav ?? false,
    product_count: c.productCount ?? 0,
    last_seen_at: now,
    is_active: true,
  }))

  if (ctx.dryRun) {
    ctx.log.info('dry-run: categories not written', { count: rows.length })
    return new Map()
  }

  await upsertAll('categories', rows, 'site_id,source_category_id')

  // Anything not seen this run is no longer published. Marked inactive rather
  // than deleted, so history and first_seen_at survive a temporary delisting.
  const seenIds = raw.map((c) => c.sourceCategoryId)
  await deactivateUnseen(ctx.site.id, seenIds)

  // handle -> category uuid, for the catalog stage's membership writes.
  const stored = await selectAll<{ id: string; handle: string }>(
    'categories',
    'id,handle',
    (q) => q.eq('site_id', ctx.site.id),
  )
  ctx.log.info('categories stored', { count: rows.length })
  return new Map(stored.map((c) => [c.handle, c.id]))
}

/**
 * Deactivates in chunks: a `not.in` filter with thousands of ids blows past
 * PostgREST's URL length limit, so the sweep runs as "activate what we saw,
 * then deactivate anything whose last_seen_at predates this run".
 */
async function deactivateUnseen(siteId: string, seenIds: string[]): Promise<void> {
  if (seenIds.length === 0) return
  const cutoff = new Date(Date.now() - 60_000).toISOString()
  const { error } = await db()
    .from('categories')
    .update({ is_active: false })
    .eq('site_id', siteId)
    .lt('last_seen_at', cutoff)
  if (error) throw new Error(`deactivate categories: ${error.message}`)
}
