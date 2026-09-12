import Link from 'next/link'
import { resolveBrand } from '../../lib/queries.js'
import { loadReviewFacts } from '../../lib/review-analysis.js'
import { ProductFilter } from '../../components/ProductFilter'
import { Stars } from '../../components/Stars'
import { SHAPES, formatShape, formatThickness, type Shape } from '../../lib/review-dimensions.js'
import {
  averageOf,
  byProduct,
  byShape,
  byThickness,
  coverage,
  leaderboardsByBrand,
  matchesFilter,
  shapesPresent,
  thicknessesPresent,
  type AnalysisFilter,
  type RankedEntry,
} from '../../lib/review-stats.js'

export const dynamic = 'force-dynamic'

interface SearchParams {
  brand?: string
  product?: string
  stars?: string
  shape?: string
  thickness?: string
}

/** Named rating filters, because "4 and up" is the question people actually ask. */
const STAR_FILTERS: Array<{ value: string; label: string; ratings: number[] }> = [
  { value: '5', label: '5 star', ratings: [5] },
  { value: '4', label: '4 star', ratings: [4] },
  { value: '45', label: '4 & 5 star', ratings: [4, 5] },
  { value: 'low', label: '3 star & below', ratings: [1, 2, 3] },
]

export default async function ReviewAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const scope = await resolveBrand(params.brand)
  const all = await loadReviewFacts()

  const filter = toFilter(params, scope?.slug)
  const facts = all.filter((f) => matchesFilter(f, filter))

  // Option lists come from the brand scope rather than from the filtered set,
  // so choosing 16mm does not make every other thickness vanish from the row
  // and strand the reader with no way back.
  const inBrand = all.filter((f) => matchesFilter(f, { brandSlug: filter.brandSlug }))

  const href = (overrides: Partial<SearchParams>) => buildHref(params, overrides)
  const boards = leaderboardsByBrand(facts)
  const rated = facts.filter((f) => f.rating !== null)
  const average =
    rated.length === 0 ? null : rated.reduce((n, f) => n + (f.rating ?? 0), 0) / rated.length

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Review analysis</p>
        <h1>Which paddle people actually talk about</h1>
        <p className="lede">
          The same {all.length.toLocaleString()} reviews as the Reviews page, counted rather
          than read: which model each brand&apos;s buyers write about most, and how that splits
          by star rating, paddle shape and core thickness.
        </p>
      </div>

      <div className="filters">
        <FilterGroup label="Rating">
          <Chip href={href({ stars: undefined })} active={!params.stars}>
            All
          </Chip>
          {STAR_FILTERS.map((s) => (
            <Chip key={s.value} href={href({ stars: s.value })} active={params.stars === s.value}>
              {s.label}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Shape">
          <Chip href={href({ shape: undefined })} active={!params.shape}>
            All
          </Chip>
          {shapesPresent(inBrand).map((s) => (
            <Chip key={s} href={href({ shape: s })} active={params.shape === s}>
              {formatShape(s)}
            </Chip>
          ))}
          <Chip href={href({ shape: 'none' })} active={params.shape === 'none'}>
            Not recorded
          </Chip>
        </FilterGroup>

        <FilterGroup label="Core thickness">
          <Chip href={href({ thickness: undefined })} active={!params.thickness}>
            All
          </Chip>
          {thicknessesPresent(inBrand).map((mm) => (
            <Chip
              key={mm}
              href={href({ thickness: String(mm) })}
              active={params.thickness === String(mm)}
            >
              {formatThickness(mm)}
            </Chip>
          ))}
          <Chip href={href({ thickness: 'none' })} active={params.thickness === 'none'}>
            Not recorded
          </Chip>
        </FilterGroup>
      </div>

      <ProductFilter
        products={byProduct(inBrand).map((p) => ({
          id: p.key,
          title: p.label,
          count: p.count,
          href: href({ product: p.key }),
        }))}
        allHref={href({ product: undefined })}
        {...(params.product ? { activeId: params.product } : {})}
      />

      <section className="stats">
        <Stat label="Reviews in scope" value={facts.length.toLocaleString()} />
        <Stat
          label="Average rating"
          value={average === null ? '—' : average.toFixed(2)}
          note={average === null ? undefined : <Stars rating={average} />}
        />
        <Stat
          label="Shape known"
          value={pct(coverage(facts, 'shape'))}
          note={<span className="muted">of these reviews</span>}
        />
        <Stat
          label="Thickness known"
          value={pct(coverage(facts, 'thickness'))}
          note={<span className="muted">of these reviews</span>}
        />
      </section>

      {facts.length === 0 ? (
        <div className="empty">
          No review matches those filters.{' '}
          <Link
            href={href({
              stars: undefined,
              shape: undefined,
              thickness: undefined,
              product: undefined,
            })}
          >
            Clear them
          </Link>
          .
        </div>
      ) : (
        <>
          <div className="section-head">
            <h2>Most-reviewed paddle by brand</h2>
          </div>
          <div className="board-grid">
            {boards.map((board) => (
              <article className="card board" key={board.brandSlug}>
                <header className="board-head">
                  <h3>{board.brand}</h3>
                  <span className="muted">
                    {board.total.toLocaleString()} review{board.total === 1 ? '' : 's'}
                  </span>
                </header>

                {board.models.length === 0 ? (
                  <p className="muted">No review here resolved to a model.</p>
                ) : (
                  <ol className="rank">
                    {board.models.slice(0, scope ? 15 : 5).map((entry, i) => (
                      <RankRow
                        key={entry.key}
                        entry={entry}
                        leader={i === 0}
                        top={board.models[0]?.count ?? 1}
                        href={`/reviews?model=${entry.key}&brand=${board.brandSlug}`}
                      />
                    ))}
                  </ol>
                )}

                {board.unmatched > 0 && (
                  <p className="board-foot muted">
                    {board.unmatched.toLocaleString()} review
                    {board.unmatched === 1 ? '' : 's'} on a listing that never resolved to a
                    model, so {board.unmatched === 1 ? 'it is' : 'they are'} not ranked above.
                  </p>
                )}
              </article>
            ))}
          </div>

          <div className="split-grid">
            <Breakdown
              title="By paddle shape"
              rows={byShape(facts)}
              total={facts.length}
              hrefFor={(key) => href({ shape: key })}
              activeKey={params.shape}
              note={
                <>
                  A review carries no shape of its own. It is taken from the reviewer&apos;s own
                  variant label where the platform recorded one, otherwise from the listing —
                  and only where every SKU under that listing is the same shape. Anything else
                  is <strong>Not recorded</strong> rather than a guess.
                </>
              }
            />
            <Breakdown
              title="By core thickness"
              rows={byThickness(facts)}
              total={facts.length}
              hrefFor={(key) => href({ thickness: key })}
              activeKey={params.thickness}
              note={
                <>
                  Resolved the same way, and covering far less: 14mm and 16mm are usually two
                  options under <em>one</em> listing, so most reviews cannot be tied to the one
                  the reviewer bought. Read the recorded rows as a sample, not as the whole
                  market.
                </>
              }
            />
          </div>
        </>
      )}
    </>
  )
}

function toFilter(params: SearchParams, brandSlug: string | undefined): AnalysisFilter {
  const stars = STAR_FILTERS.find((s) => s.value === params.stars)
  const shape = SHAPES.find((s) => s === params.shape)
  const thickness = Number(params.thickness)
  return {
    brandSlug,
    productId: params.product,
    ratings: stars?.ratings,
    shape: params.shape === 'none' ? 'none' : (shape as Shape | undefined),
    thicknessMm:
      params.thickness === 'none'
        ? 'none'
        : params.thickness && Number.isFinite(thickness)
          ? thickness
          : undefined,
  }
}

function buildHref(current: SearchParams, overrides: Partial<SearchParams>): string {
  const next = new URLSearchParams()
  const merged: Record<string, string | undefined> = { ...current, ...overrides }
  for (const [key, value] of Object.entries(merged)) {
    if (value) next.set(key, value)
  }
  const qs = next.toString()
  return qs ? `/review-analysis?${qs}` : '/review-analysis'
}

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`

function RankRow({
  entry,
  leader,
  top,
  href,
}: {
  entry: RankedEntry
  leader: boolean
  top: number
  href: string
}) {
  const average = averageOf(entry)
  return (
    <li className="rank-row" data-leader={leader}>
      <Link className="rank-name" href={href}>
        {entry.label}
      </Link>
      <div className="rank-bar" aria-hidden="true">
        <span style={{ width: `${top === 0 ? 0 : (entry.count / top) * 100}%` }} />
      </div>
      <span className="rank-count">{entry.count.toLocaleString()}</span>
      <span className="rank-meta muted">
        {pct(entry.share)} · {average === null ? '—' : average.toFixed(2)}★ ·{' '}
        {entry.five.toLocaleString()} five · {entry.four.toLocaleString()} four
      </span>
    </li>
  )
}

function Breakdown({
  title,
  rows,
  total,
  hrefFor,
  activeKey,
  note,
}: {
  title: string
  rows: RankedEntry[]
  total: number
  hrefFor: (key: string) => string
  activeKey?: string | undefined
  note: React.ReactNode
}) {
  return (
    <section className="card">
      <div className="section-head">
        <h2>{title}</h2>
      </div>
      <div className="table-wrap">
        <table>
        <thead>
          <tr>
            <th scope="col">Value</th>
            <th scope="col" className="num">
              Reviews
            </th>
            <th scope="col" className="num">
              Share
            </th>
            <th scope="col" className="num">
              Avg
            </th>
            <th scope="col" className="num">
              5★
            </th>
            <th scope="col" className="num">
              4★
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const average = averageOf(row)
            return (
              <tr key={row.key} data-active={activeKey === row.key} data-muted={row.key === 'none'}>
                <th scope="row">
                  {row.count === 0 ? row.label : <Link href={hrefFor(row.key)}>{row.label}</Link>}
                </th>
                <td className="num">{row.count.toLocaleString()}</td>
                <td className="num">{total === 0 ? '—' : pct(row.count / total)}</td>
                <td className="num">{average === null ? '—' : average.toFixed(2)}</td>
                <td className="num">{row.five.toLocaleString()}</td>
                <td className="num">{row.four.toLocaleString()}</td>
              </tr>
            )
          })}
        </tbody>
        </table>
      </div>
      <p className="analysis-note">{note}</p>
    </section>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="filter-group">
      <span>{label}</span>
      {children}
    </div>
  )
}

function Chip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link className="pill" href={href} data-active={active}>
      {children}
    </Link>
  )
}
