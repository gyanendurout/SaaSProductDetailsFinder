import Link from 'next/link'
import { getModels, type ModelOverview,
  resolveBrand,
} from '../../lib/queries.js'
import { Badge, TierBadge } from '../../components/Badge'
import { fmtMoney } from '../../lib/format.js'

export const dynamic = 'force-dynamic'

interface SearchParams {
  brand?: string
  tier?: string
  generation?: string
  line?: string
  style?: string
}

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const brand = await resolveBrand(params.brand)
  const all = await getModels(brand?.slug)

  const tiers = unique(all.map((m) => m.skill_tier))
  const generations = unique(all.map((m) => m.generation).filter(Boolean) as string[])
  const lines = unique(all.map((m) => m.product_line).filter(Boolean) as string[]).sort()
  const styles = unique(all.map((m) => m.play_style).filter((s) => s && s !== 'unknown'))

  const models = all.filter(
    (m) =>
      (!params.tier || m.skill_tier === params.tier) &&
      (!params.generation || m.generation === params.generation) &&
      (!params.line || m.product_line === params.line) &&
      (!params.style || m.play_style === params.style),
  )

  const skus = models.reduce((n, m) => n + m.sku_count, 0)
  const multiBrand = !params.brand

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Catalogue{brand ? ` · ${brand.name}` : ''}</p>
        <h1>Every model, resolved</h1>
        <p className="lede">
          Storefronts model the same hierarchy differently — one lists a paddle as a
          single product with size and colour options, another ships a separate
          product per thickness and colourway. These are reconciled here so a model
          can be compared with a model.
        </p>
      </div>

      <div className="filters">
        <FilterGroup label="Tier" param="tier" values={tiers} active={params.tier} current={params} />
        {styles.length > 0 && (
          <FilterGroup
            label="Play style"
            param="style"
            values={styles}
            active={params.style}
            current={params}
          />
        )}
        {generations.length > 0 && (
          <FilterGroup
            label="Generation"
            param="generation"
            values={generations}
            active={params.generation}
            current={params}
          />
        )}
        <FilterGroup label="Line" param="line" values={lines} active={params.line} current={params} />
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        {models.length} model{models.length === 1 ? '' : 's'} · {skus} SKUs
      </p>

      {models.length === 0 ? (
        <div className="empty">No models match those filters.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {multiBrand && <th>Brand</th>}
                <th>Model</th>
                <th>Tier</th>
                {styles.length > 0 && <th>Style</th>}
                {generations.length > 0 && <th>Generation</th>}
                <th className="num">SKUs</th>
                <th>Thickness</th>
                <th>Shape</th>
                <th>Colourways</th>
                <th className="num">Price</th>
                <th className="num">Stock</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.model_id}>
                  {multiBrand && (
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
                    <TierBadge tier={m.skill_tier} />
                  </td>
                  {styles.length > 0 && (
                    <td>
                      {m.play_style && m.play_style !== 'unknown' ? (
                        <Badge tone="neutral">{m.play_style}</Badge>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                  )}
                  {generations.length > 0 && (
                    <td>
                      {m.generation ? (
                        <Badge tone="neutral">{m.generation}</Badge>
                      ) : (
                        <span
                          className="faint"
                          title="This line carries no generation designation"
                        >
                          —
                        </span>
                      )}
                    </td>
                  )}
                  <td className="num">{m.sku_count}</td>
                  <td className="mono">
                    {(m.thicknesses_mm ?? []).map((t) => `${t}mm`).join(' · ') || (
                      <span className="faint" title="Not published in the catalogue feed">
                        —
                      </span>
                    )}
                  </td>
                  <td className="muted">{listOrDash(m.shapes, 2)}</td>
                  <td className="muted">{listOrDash(m.colorways, 3)}</td>
                  <td className="num">
                    {priceRange(m)}
                    {m.skus_on_sale > 0 && (
                      <>
                        {' '}
                        <Badge tone="danger">
                          {Math.round(Number(m.best_discount_pct))}% off
                        </Badge>
                      </>
                    )}
                  </td>
                  <td className="num">
                    <span className={m.skus_in_stock === 0 ? 'faint' : undefined}>
                      {m.skus_in_stock}/{m.sku_count}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function FilterGroup({
  label,
  param,
  values,
  active,
  current,
}: {
  label: string
  param: keyof SearchParams
  values: string[]
  active?: string
  current: SearchParams
}) {
  const href = (value?: string) => {
    const next = { ...current, [param]: value }
    const qs = Object.entries(next)
      .filter(([, v]) => Boolean(v))
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&')
    return qs ? `/catalogue?${qs}` : '/catalogue'
  }
  return (
    <div className="filter-group">
      <span>{label}</span>
      <Link className="pill" href={href(undefined)} data-active={!active}>
        All
      </Link>
      {values.map((v) => (
        <Link key={v} className="pill" href={href(v)} data-active={active === v}>
          {v}
        </Link>
      ))}
    </div>
  )
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function listOrDash(values: string[] | null, max: number): string {
  if (!values || values.length === 0) return '—'
  const shown = values.slice(0, max).join(', ')
  return values.length > max ? `${shown} +${values.length - max}` : shown
}

function priceRange(m: ModelOverview): string {
  const lo = fmtMoney(m.price_min, m.currency)
  if (m.price_min === m.price_max) return lo
  return `${lo}–${fmtMoney(m.price_max, m.currency, 0)}`
}
