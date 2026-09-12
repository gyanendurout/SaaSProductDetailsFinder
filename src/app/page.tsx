import Link from 'next/link'
import {
  getOverview,
  getDiscounts,
  getChanges,
  getModels,
  getBrandSummaries,
  resolveBrand,
} from '../lib/queries.js'
import { Badge, StockBadge } from '../components/Badge'
import { When } from '../components/When'
import { fmtMoney, fmtWhen, eventLabel, eventTone } from '../lib/format.js'

export const dynamic = 'force-dynamic'

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>
}) {
  const { brand: brandParam } = await searchParams
  const scope = await resolveBrand(brandParam)
  const brand = scope?.slug

  const [overview, discounts, changes, models, brands] = await Promise.all([
    getOverview(brand),
    getDiscounts(8, brand),
    getChanges(10, brand),
    getModels(brand),
    getBrandSummaries(),
  ])

  const trackedSince = overview.firstObservedAt
    ? Math.max(
        1,
        Math.round((Date.now() - new Date(overview.firstObservedAt).getTime()) / 86_400_000),
      )
    : 0

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">
          {scope?.name ?? brands.map((b) => b.name).join(' · ')}{' '}
          · United States · Pickleball paddles
        </p>
        <h1>Assortment &amp; price intelligence</h1>
        <p className="lede">
          Every paddle SKU on the tracked storefronts, resolved into model families,
          generations, thicknesses and colourways — with price, discount and stock
          movement recorded on every crawl.
        </p>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Models</div>
          <div className="stat-value">{overview.models}</div>
          <div className="stat-note">across {countTiers(models)} skill tiers</div>
        </div>
        <div className="stat">
          <div className="stat-label">SKUs tracked</div>
          <div className="stat-value">{overview.skus}</div>
          <div className="stat-note">{overview.categories} live collections</div>
        </div>
        <div className="stat" data-tone="accent">
          <div className="stat-label">On sale now</div>
          <div className="stat-value">{overview.onSale}</div>
          <div className="stat-note">deepest {Math.round(overview.bestDiscount)}% off</div>
        </div>
        <div className="stat" data-tone="danger">
          <div className="stat-label">Out of stock</div>
          <div className="stat-value">{overview.outOfStock}</div>
          <div className="stat-note">{pct(overview.outOfStock, overview.skus)} of the range</div>
        </div>
        <div className="stat">
          <div className="stat-label">Observations</div>
          <div className="stat-value">{overview.observations.toLocaleString()}</div>
          <div className="stat-note">
            {trackedSince > 0
              ? `over ${trackedSince} day${trackedSince === 1 ? '' : 's'}`
              : 'baseline'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Last crawl</div>
          <div className="stat-value" style={{ fontSize: '1.1rem', paddingTop: '.5rem' }}>
            {/* Same instant, same rounding and the same tooltip as Pipeline's
                "Last run" — the two used to be separately formatted and could
                round either side of an hour boundary, which read as the pages
                disagreeing about when the crawl ran. */}
            <When iso={overview.lastRun?.started_at} />
          </div>
          <div className="stat-note">
            {overview.lastRun ? (
              <Badge tone={overview.lastRun.status === 'done' ? 'positive' : 'warning'}>
                {overview.lastRun.status}
              </Badge>
            ) : (
              'never run'
            )}
          </div>
        </div>
      </div>

      {overview.observations > 0 && trackedSince <= 1 && (
        <p className="notice" style={{ marginBottom: 'var(--gap-section)' }}>
          <strong>Baseline period.</strong> Trend charts need at least two crawls on
          different days to show movement. Price history becomes meaningful after
          about a week of daily collection.
        </p>
      )}

      {!brand && brands.length > 1 && (
        <section className="section">
          <div className="section-head">
            <h2>Brands side by side</h2>
            <span className="faint" style={{ fontSize: 'var(--text-sm)' }}>
              same metric, same day, same method
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Brand</th>
                  <th className="num">Models</th>
                  <th className="num">SKUs</th>
                  <th className="num">On sale</th>
                  <th className="num">Out of stock</th>
                  <th className="num">Price range</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.slug}>
                    <td>
                      <Link className="strong-link" href={`/catalogue?brand=${encodeURIComponent(b.name)}`}>
                        {b.name}
                      </Link>
                    </td>
                    <td className="num">{b.models}</td>
                    <td className="num">{b.skus}</td>
                    <td className="num">
                      {b.onSale > 0 ? (
                        <Badge tone="danger">{b.onSale}</Badge>
                      ) : (
                        <span className="faint">0</span>
                      )}
                    </td>
                    <td className="num">
                      {b.outOfStock > 0 ? (
                        <span>
                          {b.outOfStock}{' '}
                          <span className="faint">({pct(b.outOfStock, b.skus)})</span>
                        </span>
                      ) : (
                        <span className="faint">0</span>
                      )}
                    </td>
                    <td className="num">
                      {fmtMoney(b.priceMin, 'USD', 0)} – {fmtMoney(b.priceMax, 'USD', 0)}
                    </td>
                    <td className="num">
                      <Link className="strong-link" href={`/catalogue?brand=${encodeURIComponent(b.name)}`}>
                        Browse →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--gap-tight)' }}>
            SKU counts are not a like-for-like measure of range size: brands model
            variants differently. Selkirk sells shape, colour and weight as options on
            one product, while JOOLA often ships a separate product per thickness and
            colourway. Compare models for breadth, SKUs for depth.
          </p>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Deepest discounts</h2>
          <Link className="more" href={withBrand('/discounts', brand)}>
            All discounts →
          </Link>
        </div>
        {discounts.length === 0 ? (
          <div className="empty">Nothing discounted at the last crawl.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {!brand && <th>Brand</th>}
                  <th>Model</th>
                  <th>Variant</th>
                  <th className="num">Was</th>
                  <th className="num">Now</th>
                  <th className="num">Off</th>
                  <th>Stock</th>
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
                    <td className="muted">{variantLabel(d)}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Recent movement</h2>
          <Link className="more" href={withBrand('/changes', brand)}>
            Full change log →
          </Link>
        </div>
        {changes.length === 0 ? (
          <div className="empty">
            No changes recorded yet — the first crawl of a site is its baseline.
            Movement appears once a second crawl finds something different.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Change</th>
                  <th>Product</th>
                  <th className="num">From</th>
                  <th className="num">To</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td className="faint">{fmtWhen(c.occurred_at)}</td>
                    <td>
                      <Badge tone={eventTone(c.event_type)}>{eventLabel(c.event_type)}</Badge>
                    </td>
                    <td>{c.product_title}</td>
                    <td className="num faint">{c.old_value ?? '—'}</td>
                    <td className="num">{c.new_value ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Top of the range</h2>
          <Link className="more" href={withBrand('/catalogue', brand)}>
            Browse catalogue →
          </Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {!brand && <th>Brand</th>}
                <th>Model</th>
                <th>Generation</th>
                <th className="num">SKUs</th>
                <th>Thickness</th>
                <th>Colourways</th>
                <th className="num">Price</th>
              </tr>
            </thead>
            <tbody>
              {models
                .filter((m) => m.skill_tier === 'pro')
                .slice(0, 14)
                .map((m) => (
                  <tr key={m.model_id}>
                    {!brand && (
                      <td>
                        <span className="brand-mark">{m.brand}</span>
                      </td>
                    )}
                    <td>
                      <Link className="strong-link" href={`/models/${m.model_id}`}>
                        {m.model_name}
                      </Link>
                    </td>
                    <td>
                      {m.generation ? (
                        <Badge tone="neutral">{m.generation}</Badge>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td className="num">{m.sku_count}</td>
                    <td className="mono">
                      {(m.thicknesses_mm ?? []).map((t) => `${t}mm`).join(' · ') || '—'}
                    </td>
                    <td className="muted">
                      {(m.colorways ?? []).length > 0
                        ? `${(m.colorways ?? []).length} — ${(m.colorways ?? [])
                            .slice(0, 2)
                            .join(', ')}${(m.colorways ?? []).length > 2 ? '…' : ''}`
                        : '—'}
                    </td>
                    <td className="num">{fmtMoney(m.price_min, m.currency)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function withBrand(path: string, brand?: string): string {
  return brand ? `${path}?brand=${encodeURIComponent(brand)}` : path
}

function variantLabel(v: { core_thickness_mm: number | null; colorway: string | null }): string {
  return (
    [v.core_thickness_mm ? `${v.core_thickness_mm}mm` : null, v.colorway]
      .filter(Boolean)
      .join(' · ') || '—'
  )
}

function countTiers(models: Array<{ skill_tier: string }>): number {
  return new Set(models.map((m) => m.skill_tier)).size
}

function pct(part: number, whole: number): string {
  if (!whole) return '0%'
  return `${Math.round((part / whole) * 100)}%`
}
