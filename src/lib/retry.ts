import { createLogger } from './logger.js'

const log = createLogger('retry')

/**
 * Transient-failure retry for Supabase reads.
 *
 * Observed in production: an occasional `JWT issued at future` from the
 * Supabase gateway. It is rare (0 in 40 direct REST calls) and clock skew here
 * measures under a second, which points at brief skew between Supabase's own
 * edge and PostgREST nodes rather than anything this code does.
 *
 * The root cause is not ours to fix, but the symptom was: one unlucky request
 * took down a whole page. These errors succeed on an immediate retry, so the
 * data layer absorbs them instead of propagating a 500.
 *
 * Deliberately narrow — a genuine error (bad column, missing table, RLS denial)
 * must fail fast and loudly rather than being retried three times and hidden.
 */
const TRANSIENT_PATTERNS = [
  /jwt/i, // 'JWT issued at future' — gateway/PostgREST clock skew
  /fetch failed/i,
  /network|socket hang up|econnreset|econnrefused|etimedout|enotfound/i,
  /timeout/i,
  /\b(502|503|504)\b/,
  /upstream|gateway|temporarily unavailable/i,
]

export function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return TRANSIENT_PATTERNS.some((re) => re.test(message))
}

/**
 * Backoff is exponential and starts at 300ms rather than a few tens of
 * milliseconds: the failure this exists for shows up on a cold start, and a
 * Supabase project waking from idle needs more than a moment. Retrying three
 * times inside 400ms just fails three times.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  label: string,
  attempts = 4,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isTransient(error) || attempt === attempts) break
      const backoff = 300 * 2 ** (attempt - 1) // 300ms, 600ms, 1.2s
      log.warn(`transient failure, retry ${attempt}/${attempts - 1} in ${backoff}ms`, {
        label,
        error: error instanceof Error ? error.message : String(error),
      })
      await new Promise((resolve) => setTimeout(resolve, backoff))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
