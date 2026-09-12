import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetch as undiciFetch } from 'undici'
import { requireSupabase } from './env.js'
import { withRetry } from './retry.js'

let client: SupabaseClient | null = null

/**
 * Service-role client. Bypasses RLS by design — this is the ingest identity.
 * Never expose this key to a browser; the dashboard reads through a server route.
 */
export function db(): SupabaseClient {
  if (client) return client
  const { url, serviceRoleKey } = requireSupabase()
  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Deliberately undici's fetch, NOT the global one.
      //
      // Next.js replaces globalThis.fetch with its own caching/instrumenting
      // wrapper. Under that wrapper the first Supabase request after a cold
      // start fails with "JWT issued at future" and keeps failing for about two
      // seconds — long enough to exhaust retries and 500 the page — then works
      // indefinitely.
      //
      // The same client and query in a plain Node process succeeded 5 times out
      // of 5 with no delay, which located the fault in the wrapper rather than
      // in Supabase or the clock (measured skew here is under a second).
      // Talking to undici directly removes the wrapper from the path, and also
      // means this live dashboard can never be served a cached row.
      fetch: undiciFetch as unknown as typeof fetch,
    },
  })
  return client
}

type QueryBuilder = ReturnType<ReturnType<SupabaseClient['from']>['select']>

/**
 * PostgREST caps every response at 1000 rows and does so SILENTLY — a
 * .limit(5000) returns exactly 1000 with no error and no warning. Any aggregate
 * built from a single request is wrong the moment a table passes 1000 rows.
 * Always page. This helper is the only sanctioned way to read a whole table.
 *
 * Every page is ordered, and that is not decoration.
 *
 * LIMIT/OFFSET without ORDER BY does not guarantee a stable row order between
 * requests: Postgres is free to return the rows of page 3 in a different
 * arrangement than it assumed when it served page 2, so paging a table this way
 * both repeats rows and skips others. Measured on v_review_search before this
 * was added: three separate reads each returned 20,771 rows of which only
 * 20,352 were distinct — 419 reviews duplicated and 419 different ones missing,
 * every single time. Every aggregate built on top was quietly wrong by that
 * margin, which is why the reviews page and the analysis page disagreed about
 * how many reviews each brand had.
 *
 * The order column must be UNIQUE for the guarantee to hold; a non-unique one
 * leaves ties free to reshuffle across pages and reintroduces the same bug.
 * Defaults to `id`, which every table here has. Views expose theirs under a
 * different name, so they pass it explicitly.
 */
export async function selectAll<T>(
  table: string,
  columns: string,
  apply: (q: QueryBuilder) => QueryBuilder = (q) => q,
  options: { orderBy?: string; pageSize?: number } = {},
): Promise<T[]> {
  const { orderBy = 'id', pageSize = 1000 } = options
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const rows = await withRetry(async () => {
      const query = apply(db().from(table).select(columns))
        .order(orderBy, { ascending: true })
        .range(from, from + pageSize - 1)
      const { data, error } = await query
      if (error) throw new Error(`select ${table}: ${error.message}`)
      return (data ?? []) as T[]
    }, `select ${table}`)
    out.push(...rows)
    if (rows.length < pageSize) return out
  }
}

/**
 * Chunked upsert — PostgREST rejects very large payloads.
 *
 * Retried, for the same reason reads are. Measured over one six-brand crawl,
 * every failure of any kind was a Supabase `Gateway Timeout`: the three that
 * landed on a select were retried and recovered silently, while the three that
 * landed on this upsert were fatal and cost four products their reviews. The
 * difference was not the failure — it was that only one side of the client
 * retried.
 *
 * Retrying a write is safe here specifically because these are upserts: they
 * carry an `onConflict` key and are therefore idempotent by construction, so a
 * request that actually succeeded before the gateway gave up is re-applied to
 * the same rows rather than duplicated.
 */
export async function upsertAll<T extends object>(
  table: string,
  rows: T[],
  onConflict: string,
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    await withRetry(async () => {
      const { error } = await db().from(table).upsert(chunk, { onConflict })
      if (error) throw new Error(`upsert ${table}: ${error.message}`)
    }, `upsert ${table}`)
  }
}

/**
 * Chunked upsert that returns the stored rows, so callers can map a natural key
 * back to the generated uuid without a second round trip.
 */
export async function upsertReturning<T extends object, R>(
  table: string,
  rows: T[],
  onConflict: string,
  columns: string,
  chunkSize = 500,
): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    // Idempotent for the same reason upsertAll is: an onConflict key means a
    // retry updates the same rows rather than adding more.
    const rowsBack = await withRetry(async () => {
      const { data, error } = await db()
        .from(table)
        .upsert(chunk, { onConflict })
        .select(columns)
      if (error) throw new Error(`upsert ${table}: ${error.message}`)
      return (data ?? []) as R[]
    }, `upsert ${table}`)
    out.push(...rowsBack)
  }
  return out
}

/** Chunked insert for append-only tables. */
/**
 * Chunked plain insert.
 *
 * Deliberately NOT retried, unlike the upserts above. A plain insert is not
 * idempotent: a chunk that reached the database and then timed out on the way
 * back would be written twice by a retry.
 *
 * Two of the three tables this writes could tolerate that — `variant_snapshots`
 * is unique on (run_id, variant_id) and `product_review_snapshots` on
 * (run_id, product_id), so a re-applied chunk would raise a duplicate-key error
 * rather than duplicate data. `variant_events` has no such key, and silently
 * doubling a price-change event is worse than failing a run: the change log is
 * what the dashboard and any alerting read, and a duplicated 'discount_started'
 * is indistinguishable from two real ones.
 *
 * If write timeouts start costing whole runs here, the fix is a natural key on
 * variant_events, not a retry around an unguarded insert.
 */
export async function insertAll<T extends object>(
  table: string,
  rows: T[],
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await db().from(table).insert(rows.slice(i, i + chunkSize))
    if (error) throw new Error(`insert ${table}: ${error.message}`)
  }
}
