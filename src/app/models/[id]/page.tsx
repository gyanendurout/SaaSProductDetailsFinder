import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getModel,
  getVariants,
  getPriceHistory,
  type VariantCurrent,
} from '../../../lib/queries.js'
import { Badge, StockBadge, TierBadge } from '../../../components/Badge'
import { PriceChart } from '../../../components/PriceChart'
import { fmtMoney, fmtWhen } from '../../../lib/format.js'

export const dynamic = 'force-dynamic'

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [model, variants] = await Promise.all([getModel(id), getVariants(id)])
  if (!model) notFound()

  // Chart the SKU with the most history; ties break toward the cheapest, which
  // is usually the one on promotion and therefore the interesting one.
  const histories = await Promise.all(
    variants.slice(0, 12).map(async (v) => ({
      variant: v,
      points: await getPriceHistory(v.variant_id),
    })),
  )
  const featured =
    histories
      .slice()
      .sort(
        (a, b) =>
          b.points.length - a.points.length ||
          Number(a.variant.price ?? 0) - Number(b.variant.price ?? 0),
      )[0] ?? null

  const thicknesses = model.thicknesses_mm ?? []
  const colorways = model.colorways ?? []

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">
          <Link href="/catalogue">Catalogue</Link>
          {` · ${model.brand}`}
          {model.product_line ? ` · ${model.product_line}` : ''}
        </p>
        <h1>{model.model_name}</h1>
        <p className="lede">
          {model.sku_count} SKU{model.sku_count === 1 ? '' : 's'}
          {thicknesses.length > 0
            ? ` across ${thicknesses.length} thickness${thicknesses.length === 1 ? '' : 'es'}`
            : ''}
          {colorways.length > 0
            ? ` and ${colorways.length} colourway${colorways.length === 1 ? '' : 's'}`
            : ''}
          .
        </p>
        <p>
          <Link className="btn" href={`/reviews?model=${model.model_id}`}>
            Read reviews for this model →
          </Link>
        </p>
      </div>

      <div className="detail-grid">
        <div>
          <section className="section">
            <div className="section-head">
              <h2>Price history</h2>
              {featured && (
                <span className="faint" style={{ fontSize: 'var(--text-sm)' }}>
                  {variantLabel(featured.variant)} · {featured.points.length} observation
                  {featured.points.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {featured ? (
              <PriceChart points={featured.points} currency={featured.variant.currency} />
            ) : (
              <div className="chart-empty">No SKUs to chart.</div>
            )}
            <p className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--gap-tight)' }}>
              Steps, not slopes: the line holds flat until the next observation because
              a crawl records what the price <em>was when we looked</em>. Hollow points
              mark days the SKU was out of stock; red points mark days it was on sale.
            </p>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>SKUs</h2>
              <span className="faint" style={{ fontSize: 'var(--text-sm)' }}>
                {variants.filter((v) => v.is_available).length} of {variants.length} in stock
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Thickness</th>
                    <th>Colourway</th>
                    <th className="num">Weight</th>
                    <th>Athlete</th>
                    <th className="num">Price</th>
                    <th>Stock</th>
                    <th>Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => (
                    <tr key={v.variant_id}>
                      <td className="mono">{v.sku ?? '—'}</td>
                      <td className="num">
                        {v.core_thickness_mm ? `${v.core_thickness_mm}mm` : <span className="faint">—</span>}
                      </td>
                      <td>{v.colorway ?? <span className="faint">—</span>}</td>
                      <td className="num">
                        {v.weight_grams ? (
                          `${Math.round(Number(v.weight_grams))}g`
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td className="muted">{v.endorsed_player ?? '—'}</td>
                      <td className="num">
                        {v.is_on_sale && (
                          <span className="strike" style={{ marginRight: '.4em' }}>
                            {fmtMoney(v.compare_at_price, v.currency)}
                          </span>
                        )}
                        <strong>{fmtMoney(v.price, v.currency)}</strong>
                        {v.is_on_sale && (
                          <>
                            {' '}
                            <Badge tone="danger">{Math.round(Number(v.discount_pct))}%</Badge>
                          </>
                        )}
                      </td>
                      <td>
                        <StockBadge available={v.is_available} />
                      </td>
                      <td className="faint">{fmtWhen(v.observed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside>
          <div className="card">
            <dl className="spec-list">
              <div className="spec-row">
                <dt>Tier</dt>
                <dd>
                  <TierBadge tier={model.skill_tier} />
                </dd>
              </div>
              <div className="spec-row">
                <dt>Generation</dt>
                <dd>{model.generation ?? <span className="faint">none — this line has no generation</span>}</dd>
              </div>
              <div className="spec-row">
                <dt>Play style</dt>
                <dd>
                  {model.play_style && model.play_style !== 'unknown' ? (
                    <Badge tone="neutral">{model.play_style}</Badge>
                  ) : (
                    <span className="faint">not merchandised by this brand</span>
                  )}
                </dd>
              </div>
              <div className="spec-row">
                <dt>Line</dt>
                <dd>{model.product_line ?? '—'}</dd>
              </div>
              <div className="spec-row">
                <dt>Shape</dt>
                <dd className="chips">
                  {(model.shapes ?? []).length > 0 ? (
                    (model.shapes ?? []).map((sh) => <Badge key={sh}>{sh}</Badge>)
                  ) : (
                    <span className="faint">—</span>
                  )}
                </dd>
              </div>
              <div className="spec-row">
                <dt>Thickness</dt>
                <dd className="chips">
                  {thicknesses.length > 0 ? (
                    thicknesses.map((t) => <Badge key={t}>{t}mm</Badge>)
                  ) : (
                    <span className="faint">not published in the catalogue feed</span>
                  )}
                </dd>
              </div>
              <div className="spec-row">
                <dt>Colourways</dt>
                <dd className="chips">
                  {colorways.length > 0 ? (
                    colorways.map((c) => <Badge key={c}>{c}</Badge>)
                  ) : (
                    <span className="faint">single colourway</span>
                  )}
                </dd>
              </div>
              <div className="spec-row">
                <dt>Athletes</dt>
                <dd className="chips">
                  {(model.endorsed_players ?? []).length > 0 ? (
                    (model.endorsed_players ?? []).map((p) => (
                      <Badge key={p} tone="accent">
                        {p}
                      </Badge>
                    ))
                  ) : (
                    <span className="faint">—</span>
                  )}
                </dd>
              </div>
              <div className="spec-row">
                <dt>Price</dt>
                <dd>
                  {model.price_min === model.price_max
                    ? fmtMoney(model.price_min, model.currency)
                    : `${fmtMoney(model.price_min, model.currency)} – ${fmtMoney(model.price_max, model.currency)}`}
                </dd>
              </div>
              <div className="spec-row">
                <dt>Market</dt>
                <dd>
                  {model.brand} · {model.country_code}
                </dd>
              </div>
            </dl>
            {variants[0]?.product_url && (
              <p style={{ marginBottom: 0, marginTop: 'var(--gap)' }}>
                <a
                  className="strong-link"
                  href={variants[0].product_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on the store →
                </a>
              </p>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}

function variantLabel(v: VariantCurrent): string {
  return (
    [v.core_thickness_mm ? `${v.core_thickness_mm}mm` : null, v.colorway]
      .filter(Boolean)
      .join(' · ') ||
    v.sku ||
    'SKU'
  )
}
