import type { Metadata } from 'next'
import { getChangePage, getChangeTypeCounts, resolveBrand } from '../../lib/queries.js'
import { Badge } from '../../components/Badge'
import { Pager } from '../../components/Pager'
import { clampPageSize, lastPageOf } from '../../lib/pagination.js'
import { changeValue, eventLabel, eventTone } from '../../lib/format.js'
import { When } from '../../components/When'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Changes',
  description:
    'Price moves, promotions, stockouts and range changes, derived by comparing each crawl against the previous one.',
}

interface SearchParams {
  brand?: string
  page?: string
  size?: string
}

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const scope = await resolveBrand(params.brand)

  // The chips are counted over the whole log, the table over one page of it.
  // They used to come from the same 250-row read, which made every chip a
  // statement about the page size: "sale started · 31" meant 31 of the 250 rows
  // that happened to be loaded, not 31 events in the catalogue.
  const [changes, byType] = await Promise.all([
    getChangePage(
      Math.max(1, Math.floor(Number(params.page)) || 1),
      clampPageSize(params.size),
      scope?.slug,
    ),
    getChangeTypeCounts(scope?.slug),
  ])

  const lastPage = lastPageOf(changes.total, changes.pageSize)
  const first = (changes.page - 1) * changes.pageSize + 1
  const last = Math.min(changes.page * changes.pageSize, changes.total)

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Change log{scope ? ` · ${scope.name}` : ''}</p>
        <h1>What moved</h1>
        <p className="lede">
          Derived by comparing each crawl against the previous successful one. Price
          moves, promotions starting and ending, stockouts, and products entering or
          leaving the range.
        </p>
      </div>

      {changes.total === 0 ? (
        <div className="empty">
          <p style={{ marginTop: 0 }}>
            <strong>No changes recorded yet.</strong>
          </p>
          <p style={{ marginBottom: 0 }}>
            The first crawl establishes the baseline — there is nothing to compare it
            against. Events appear as soon as a later crawl finds something different.
          </p>
        </div>
      ) : (
        <>
          <div className="chips" style={{ marginBottom: 'var(--gap-tight)' }}>
            {byType.map(({ type, count }) => (
              <Badge key={type} tone={eventTone(type)}>
                {eventLabel(type)} · {count.toLocaleString()}
              </Badge>
            ))}
          </div>

          <p className="muted review-count-line">
            Showing {first.toLocaleString()}–{last.toLocaleString()} of{' '}
            {changes.total.toLocaleString()} events
            {scope ? ` for ${scope.name}` : ''}. Counts above are for the whole log, not
            this page.
          </p>

          <div className="table-wrap" role="region" aria-label="Change log">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Change</th>
                  <th>Product</th>
                  <th>Variant</th>
                  <th className="num">From</th>
                  <th className="num">To</th>
                  <th className="num">Delta</th>
                </tr>
              </thead>
              <tbody>
                {changes.rows.map((c) => (
                  <tr key={c.id}>
                    <td className="faint">
                      <When iso={c.occurred_at} />
                    </td>
                    <td>
                      <Badge tone={eventTone(c.event_type)}>{eventLabel(c.event_type)}</Badge>
                    </td>
                    <td>
                      {c.product_url ? (
                        <a
                          className="strong-link"
                          href={c.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {c.product_title}
                        </a>
                      ) : (
                        c.product_title
                      )}
                    </td>
                    <td className="muted">
                      {[c.core_thickness_mm ? `${c.core_thickness_mm}mm` : null, c.colorway]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                    <td className="num faint">{changeValue(c.event_type, c.old_value)}</td>
                    <td className="num">{changeValue(c.event_type, c.new_value)}</td>
                    <td className="num">
                      {c.delta_pct !== null ? (
                        <span
                          style={{
                            color:
                              Number(c.delta_pct) < 0 ? 'var(--positive)' : 'var(--warning)',
                          }}
                        >
                          {Number(c.delta_pct) > 0 ? '+' : ''}
                          {Number(c.delta_pct).toFixed(1)}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {changes.rows.length > 0 && (
            <Pager page={changes.page} lastPage={lastPage} pageSize={changes.pageSize} />
          )}
        </>
      )}
    </>
  )
}
