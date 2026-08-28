import Link from 'next/link'
import {
  getBrandPriceComparison,
  PRICE_TIERS,
  type BrandPriceBand,
  type PriceBasis,
} from '../../lib/price-bands.js'
import { fmtMoney } from '../../lib/format.js'

export const dynamic = 'force-dynamic'

interface SearchParams {
  basis?: string
  brand?: string
}

export default async function PricesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const basis: PriceBasis = params.basis === 'sku' ? 'sku' : 'product'
  const comparison = await getBrandPriceComparison(basis)

  const span = Math.max(1, comparison.ceiling - comparison.floor)
  const pct = (value: number) => ((value - comparison.floor) / span) * 100

  const href = (next: Partial<SearchParams>) => {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries({ ...params, ...next })) {
      if (value) qs.set(key, value)
    }
    const s = qs.toString()
    return s ? `/prices?${s}` : '/prices'
  }

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Price comparison</p>
        <h1>Where each brand plays</h1>
        <p className="lede">
          The band each brand occupies — its floor, its midpoint, its ceiling — and how its
          range divides across price tiers. Sorted by median, so the brand at the top of the
          market is at the top of the table.
        </p>
      </header>

      <div className="filters">
        <div className="filter-group">
          <span className="filter-label">Count by</span>
          <Link className="pill" href={href({ basis: 'product' })} data-active={basis === 'product'}>
            Product
          </Link>
          <Link className="pill" href={href({ basis: 'sku' })} data-active={basis === 'sku'}>
            SKU
          </Link>
        </div>
      </div>

      <p className="muted basis-note">
        {basis === 'product' ? (
          <>
            Counting <strong>products</strong>: every colourway and thickness of one paddle is a
            single row, priced at the median of its SKUs. This is how a buyer meets the range.
          </>
        ) : (
          <>
            Counting <strong>SKUs</strong>: every purchasable variant counts separately, so a
            brand that ships many colourways of one paddle weighs more heavily. Useful for shelf
            space, misleading for range.
          </>
        )}
      </p>

      <div className="table-wrap">
        <table className="price-table">
          <thead>
            <tr>
              <th>Brand</th>
              <th className="num">Priced</th>
              <th className="num">Low</th>
              <th className="num">Median</th>
              <th className="num">High</th>
              <th className="range-col">Range</th>
              <th>Tier mix</th>
            </tr>
          </thead>
          <tbody>
            {comparison.bands.map((band) => (
              <tr key={band.brandSlug} data-scoped={params.brand === band.brandSlug}>
                <td className="brand-cell">
                  <Link href={`/catalogue?brand=${band.brandSlug}`}>{band.brand}</Link>
                </td>
                <td className="num">
                  {band.priced.toLocaleString()}
                  {band.unpriced > 0 && (
                    <span className="faint"> (+{band.unpriced} n/a)</span>
                  )}
                </td>
                <td className="num">{fmtMoney(band.low, 'USD')}</td>
                <td className="num strong">{fmtMoney(band.median, 'USD')}</td>
                <td className="num">{fmtMoney(band.high, 'USD')}</td>
                <td className="range-col">
                  <RangeBar band={band} left={pct(band.low)} right={pct(band.high)} mid={pct(band.median)} />
                </td>
                <td>
                  <TierMix band={band} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {comparison.bands.length === 0 ? (
        <div className="empty">
          No priced items yet. Run a crawl with the catalogue stage to populate prices.
        </div>
      ) : (
        <p className="muted axis-note">
          Bars share one axis from {fmtMoney(comparison.floor, 'USD')} to{' '}
          {fmtMoney(comparison.ceiling, 'USD')}, so their widths are comparable. The notch is the
          median. Tiers are fixed at{' '}
          {PRICE_TIERS.map((t, i) => (
            <span key={t.key}>
              {i > 0 && ', '}
              <span className={`tier tier-${t.key}`}>{t.label}</span>{' '}
              {t.upperBound === Number.POSITIVE_INFINITY
                ? `${fmtMoney(PRICE_TIERS[i - 1]!.upperBound, 'USD')}+`
                : `under ${fmtMoney(t.upperBound, 'USD')}`}
            </span>
          ))}
          {' '}— fixed rather than derived, so a tier means the same thing next quarter.
        </p>
      )}
    </>
  )
}

function RangeBar({
  band,
  left,
  right,
  mid,
}: {
  band: BrandPriceBand
  left: number
  right: number
  mid: number
}) {
  // A single-priced brand would otherwise render as an invisible zero-width bar.
  const width = Math.max(right - left, 0.8)
  return (
    <div
      className="range-bar"
      role="img"
      aria-label={`${band.brand}: ${fmtMoney(band.low, 'USD')} to ${fmtMoney(band.high, 'USD')}, median ${fmtMoney(band.median, 'USD')}`}
    >
      <div className="range-track" />
      <div
        className={`range-fill range-${band.brandSlug}`}
        style={{ left: `${left}%`, width: `${width}%` }}
      />
      <div className="range-median" style={{ left: `${mid}%` }} />
    </div>
  )
}

function TierMix({ band }: { band: BrandPriceBand }) {
  return (
    <div className="tier-mix">
      {PRICE_TIERS.map((tier) => {
        const count = band.tiers[tier.key]
        if (count === 0) return null
        return (
          <span key={tier.key} className={`tier tier-${tier.key}`}>
            {tier.label} <b>{count}</b>
          </span>
        )
      })}
    </div>
  )
}
