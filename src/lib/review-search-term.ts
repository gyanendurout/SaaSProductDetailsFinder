/**
 * Turning a user's search box input into a filter value.
 *
 * Pure and free of 'server-only' so the escaping can be tested directly. It
 * shipped wrong once, in both directions at the same time, and the tests beside
 * it are the record of what wrong looked like.
 */

/**
 * Turns a user's search term into a PostgREST ilike value that matches it
 * LITERALLY.
 *
 * The previous version stripped `, ( ) * \ %` to spaces, which was wrong in two
 * different directions and produced silently incorrect results:
 *
 *   - Searching `100%` dropped the `%`, so it returned the 110 reviews matching
 *     `100` rather than the 58 containing a literal `100%`.
 *   - Searching `%` on its own became an EMPTY term, which meant "no search
 *     filter" and returned all 20,771 reviews — the opposite of no matches.
 *   - `_` was never stripped at all, so `add_on` matched `add on` as a LIKE
 *     single-character wildcard, and `g_ip` returned all 1,221 hits for `grip`.
 *
 * Two layers of escaping are required, and they were verified against the live
 * API rather than assumed:
 *
 *   1. Postgres LIKE treats `\` as its escape character by default, so a literal
 *      `%`, `_` or `\` must be prefixed with one.
 *   2. PostgREST then parses the filter value itself. Inside a double-quoted
 *      value it consumes one level of backslash, so every backslash from step 1
 *      has to be doubled to survive. Quoting is what makes commas, parentheses
 *      and spaces safe, which is why the characters no longer need stripping.
 *
 * Measured: `"*100\\%*"` returns 58 (correct) where `*100%*` returns 110, and
 * `"*add\\_on*"` returns 0 (correct) where `*add_on*` returns 5.
 *
 * `*` is the one character still removed. PostgREST rewrites it to `%` AFTER
 * this value is parsed, so there is no escape that survives to mean a literal
 * asterisk — and an asterisk is not something a paddle review is searched by.
 */
export function sanitiseTerm(input: string | undefined): string | null {
  const term = input?.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim()
  return term ? term : null
}

/** Step 1 then step 2 of the escaping described above. */
export function toIlikeValue(term: string): string {
  const forLike = term.replace(/[\\%_]/g, (c) => `\\${c}`)
  const forPostgrest = forLike.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"*${forPostgrest}*"`
}
