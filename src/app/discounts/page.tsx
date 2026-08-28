import Link from 'next/link'
import { getDiscounts,
  resolveBrand,
} from '../../lib/queries.js'
import { Badge, StockBadge } from '../../components/Badge'
import { fmtMoney, fmtWhen } from '../../lib/format.js'

export const dynamic = 'force-dynamic'

export default async function DiscountsPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>
}) {
  const { brand } = await searchParams
  const scope = await resolveBrand(brand)
  const discounts = await getDiscounts(200, scope?.slug)
  const totalSaving = discounts.reduce(
    (sum, d) => sum + (Number(d.compare_at_price ?? 0) - Number(d.price ?? 0)),
    0,
  )
  const oos = discounts.filter((d) => d.is_available === false).length

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Discounts{scope ? ` · ${scope.name}` : ''}</p>
        <h1>What is on promotion</h1>
        <p className="lede">
          Every SKU where the storefront shows a compare-at price above the selling
          price, deepest first, as of the most recent crawl.
        </p>
      </div>

      <div className="stats">
        <div className="stat" data-tone="accent">
          <div className="stat-label">SKUs on sale</div>
          <div className="stat-value">{discounts.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Deepest cut</div>
          <div className="stat-value">
            {discounts.length ? `${Math.round(Number(discounts[0]!.discount_pct))}%` : '—'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Total markdown</div>
          <div className="stat-value">{fmtMoney(totalSaving, 'USD', 0)}</div>
          <div className="stat-note">summed across listed SKUs</div>
        </div>
        <div className="stat" data-tone="danger">
          <div className="stat-label">Discounted but OOS</div>
          <div className="stat-value">{oos}</div>
          <div className="stat-note">promoted, not buyable</div>
        </div>
      </div>

      {discounts.length === 0 ? (
        <div className="empty">Nothing was discounted at the last crawl.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {!brand && <th>Brand</th>}
                <th>Model</th>
                <th>Variant</th>
                <th>SKU</th>
                <th className="num">Was</th>
                <th className="num">Now</th>
                <th className="num">Off</th>
                <th>Stock</th>
                <th>Seen</th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.variant_id}>
                  {!brand && (
                    <td>
                      <span className="brand-mark">{d.brand}</span>
                    </td>
                  )}
                  <td>
                    {d.model_id ? (
                      <Link className="strong-link" href={`/models/${d.model_id}`}>
                        {d.model_name}
                      </Link>
                    ) : (
                      d.product_title
                    )}
                  </td>
                  <td className="muted">
                    {[d.core_thickness_mm ? `${d.core_thickness_mm}mm` : null, d.colorway]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  <td className="mono">{d.sku ?? '—'}</td>
                  <td className="num strike">{fmtMoney(d.compare_at_price, d.currency)}</td>
                  <td className="num">
                    <strong>{fmtMoney(d.price, d.currency)}</strong>
                  </td>
                  <td className="num">
                    <Badge tone="danger">{Math.round(Number(d.discount_pct))}%</Badge>
                  </td>
                  <td>
                    <StockBadge available={d.is_available} />
                  </td>
                  <td className="faint">{fmtWhen(d.observed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
