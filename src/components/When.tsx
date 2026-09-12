import { fmtExact, fmtWhen } from '../lib/format.js'

/**
 * A timestamp as "14h ago", carrying the exact instant behind it.
 *
 * The relative form is what a reader wants; the problem is that it rounds, so
 * the overview and the pipeline page could show the same crawl as "14h ago" and
 * "15h ago" purely because they rendered a minute either side of a boundary.
 * Both now render this, with the same ISO instant in the tooltip and in
 * dateTime, so the two can be reconciled instead of read as a contradiction.
 */
export function When({ iso, prefix }: { iso: string | null | undefined; prefix?: string }) {
  if (!iso) return <span className="faint">—</span>
  return (
    <time dateTime={iso} title={fmtExact(iso)}>
      {prefix}
      {fmtWhen(iso)}
    </time>
  )
}
