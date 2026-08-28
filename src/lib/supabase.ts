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
 */
export async function selectAll<T>(
  table: string,
  columns: string,
  apply: (q: QueryBuilder) => QueryBuilder = (q) => q,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const rows = await withRetry(async () => {
      const query = apply(db().from(table).select(columns)).range(from, from + pageSize - 1)
      const { data, error } = await query
      if (error) throw new Error(`select ${table}: ${error.message}`)
      return (data ?? []) as T[]
    }, `select ${table}`)
    out.push(...rows)
    if (rows.length < pageSize) return out
  }
}

/** Chunked upsert — PostgREST rejects very large payloads. */
export async function upsertAll<T extends object>(
  table: string,
  rows: T[],
  onConflict: string,
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await db().from(table).upsert(chunk, { onConflict })
    if (error) throw new Error(`upsert ${table}: ${error.message}`)
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
    const { data, error } = await db()
      .from(table)
      .upsert(chunk, { onConflict })
      .select(columns)
    if (error) throw new Error(`upsert ${table}: ${error.message}`)
    out.push(...((data ?? []) as R[]))
  }
  return out
}

/** Chunked insert for append-only tables. */
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
