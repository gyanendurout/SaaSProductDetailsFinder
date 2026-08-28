import { getChanges,
  resolveBrand,
} from '../../lib/queries.js'
import { Badge } from '../../components/Badge'
import { eventLabel, eventTone, fmtWhen } from '../../lib/format.js'

export const dynamic = 'force-dynamic'

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>
}) {
  const { brand } = await searchParams
  const scope = await resolveBrand(brand)
  const changes = await getChanges(250, scope?.slug)

  const byType = changes.reduce<Record<string, number>>((acc, c) => {
    acc[c.event_type] = (acc[c.event_type] ?? 0) + 1
    return acc
  }, {})

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

      {changes.length === 0 ? (
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
          <div className="chips" style={{ marginBottom: 'var(--gap-loose)' }}>
            {Object.entries(byType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <Badge key={type} tone={eventTone(type)}>
                  {eventLabel(type)} · {count}
                </Badge>
              ))}
          </div>

          <div className="table-wrap">
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
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td className="faint">{fmtWhen(c.occurred_at)}</td>
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
                    <td className="num faint">{c.old_value ?? '—'}</td>
                    <td className="num">{c.new_value ?? '—'}</td>
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
        </>
      )}
    </>
  )
}
