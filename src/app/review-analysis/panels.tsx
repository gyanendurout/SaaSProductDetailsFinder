import Link from 'next/link'
import type { ProductCoverage } from '../../lib/review-analysis.js'
import type { EnrichedFact, ReviewFact } from '../../lib/review-stats.js'
import { averageOf } from '../../lib/review-stats.js'
import {
  bucketize,
  growthRatio,
  recentSplit,
  trajectory,
  type DatedPoint,
} from '../../lib/review-trends.js'
import { DEFECT_TERMS, PADDLE_BRANDS } from '../../lib/review-text.js'
import { ownershipRank } from '../../lib/review-context.js'

const pct = (f: number) => `${Math.round(f * 100)}%`
const signed = (f: number) => `${f > 0 ? '+' : ''}${Math.round(f * 100)}%`

function dated(facts: ReviewFact[]): DatedPoint[] {
  return facts
    .filter((f): f is ReviewFact & { submittedAt: string } => f.submittedAt !== null)
    .map((f) => ({ submittedAt: f.submittedAt, rating: f.rating }))
}

/* ---------------------------------------------------------------------------
 * Shared marks
 * ------------------------------------------------------------------------ */

/** A volume sparkline. Bars, not a line: these are counts, not a continuum. */
function Spark({ values, title }: { values: number[]; title: string }) {
  if (values.length === 0) return <span className="muted">—</span>
  const max = Math.max(...values, 1)
  const w = 2
  const gap = 1
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${values.length * (w + gap)} 20`}
      preserveAspectRatio="none"
      role="img"
      aria-label={title}
    >
      {values.map((v, i) => (
        <rect
          key={i}
          x={i * (w + gap)}
          y={20 - Math.max(1, (v / max) * 20)}
          width={w}
          height={Math.max(1, (v / max) * 20)}
        />
      ))}
    </svg>
  )
}

/**
 * The rating trajectory as a line, drawn on a 3.5-5.0 axis.
 *
 * Not zero-based on purpose: every paddle here averages above 4, so a 0-5 axis
 * compresses the entire signal into the top eighth of the box and every model
 * looks identical. The axis bounds are stated in the caption so the
 * exaggeration is declared rather than hidden.
 */
function RatingLine({ points, title }: { points: Array<number | null>; title: string }) {
  const known = points.filter((p): p is number => p !== null)
  if (known.length < 2) return <span className="muted">too few rated</span>
  const LO = 3.5
  const HI = 5
  const y = (v: number) => 20 - ((Math.min(HI, Math.max(LO, v)) - LO) / (HI - LO)) * 20
  const step = 60 / Math.max(1, points.length - 1)
  const d = points
    .map((p, i) => (p === null ? null : `${i * step},${y(p)}`))
    .filter((s): s is string => s !== null)
    .join(' L ')
  return (
    <svg className="spark spark-line" viewBox="0 0 60 20" role="img" aria-label={title}>
      <path d={`M ${d}`} fill="none" />
    </svg>
  )
}

/* ---------------------------------------------------------------------------
 * 1 + 2 — Momentum: review velocity and rating trajectory
 * ------------------------------------------------------------------------ */

export function MomentumPanel({
  facts,
  coverage,
  windowDays = 90,
}: {
  facts: ReviewFact[]
  coverage: ProductCoverage[]
  windowDays?: number
}) {
  const byModel = new Map<string, { name: string; brand: string; rows: ReviewFact[] }>()
  for (const f of facts) {
    if (!f.modelId || !f.modelName) continue
    const g = byModel.get(f.modelId) ?? { name: f.modelName, brand: f.brand, rows: [] }
    g.rows.push(f)
    byModel.set(f.modelId, g)
  }

  const rows = [...byModel]
    .map(([id, g]) => {
      const points = dated(g.rows)
      const { recent, prior } = recentSplit(points, windowDays)
      const months = bucketize(points, 'month')
      const traj = trajectory(months)
      const recentRated = recent.filter((p) => p.rating !== null)
      const priorRated = prior.filter((p) => p.rating !== null)
      const mean = (xs: DatedPoint[]) =>
        xs.length === 0 ? null : xs.reduce((n, x) => n + (x.rating ?? 0), 0) / xs.length
      return {
        id,
        name: g.name,
        brand: g.brand,
        total: g.rows.length,
        recent: recent.length,
        prior: prior.length,
        growth: growthRatio(recent.length, prior.length),
        months,
        traj,
        recentAvg: mean(recentRated),
        priorAvg: mean(priorRated),
      }
    })
    .filter((r) => r.total >= 20)
    .sort((a, b) => b.recent - a.recent || b.total - a.total)
    .slice(0, 25)

  const truncated = coverage
    .filter((c) => c.reported !== null && c.reported > c.stored * 1.05)
    .sort((a, b) => (b.reported! - b.stored) - (a.reported! - a.stored))

  return (
    <>
      {truncated.length > 0 && (
        <div className="notice" data-tone="danger">
          <strong>
            {truncated.length} listing{truncated.length === 1 ? '' : 's'} hold fewer reviews than
            the platform reports
          </strong>
          , so the history below is incomplete for them. Judge.me&apos;s widget stops serving new
          rows after 100 pages and then repeats the last one, which truncates a listing to its{' '}
          <em>most recent</em> slice — the worst part to lose when reading a trend, because what
          survives is the tail and what goes missing is the beginning.
          <ul className="gap-list">
            {truncated.slice(0, 6).map((c) => (
              <li key={c.productId}>
                {c.brand} — {c.productTitle}: <strong>{c.stored.toLocaleString()}</strong> held of{' '}
                {c.reported?.toLocaleString()} reported
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="section-head">
        <h2>Momentum — reviews per month, and where the rating is heading</h2>
      </div>
      <p className="analysis-note">
        Review volume is a demand proxy <strong>within a brand over time</strong>, never across
        brands: JOOLA and CRBN run different review-request programmes, so comparing their
        volumes measures email campaigns as much as paddles. Rating lines are a 4-month trailing
        mean drawn on a <strong>3.5–5.0</strong> axis, because everything here scores above 4 and
        a 0–5 axis would flatten every model into the same line.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Monthly volume</th>
              <th scope="col" className="num">Last {windowDays}d</th>
              <th scope="col" className="num">Prior {windowDays}d</th>
              <th scope="col" className="num">Change</th>
              <th scope="col">Rating trend</th>
              <th scope="col" className="num">Then → now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  <Link href={`/reviews?model=${r.id}`}>{r.name}</Link>
                  <span className="muted"> · {r.brand}</span>
                </th>
                <td>
                  <Spark values={r.months.map((m) => m.count)} title={`${r.name} monthly volume`} />
                </td>
                <td className="num">{r.recent.toLocaleString()}</td>
                <td className="num">{r.prior.toLocaleString()}</td>
                <td className="num" data-tone={toneOf(r.growth)}>
                  {r.growth === null ? 'new' : signed(r.growth)}
                </td>
                <td>
                  <RatingLine points={r.traj.map((t) => t.trailing)} title={`${r.name} rating`} />
                </td>
                <td className="num">
                  {r.priorAvg === null || r.recentAvg === null ? (
                    '—'
                  ) : (
                    <span data-tone={toneOf(r.recentAvg - r.priorAvg, 0.15)}>
                      {r.priorAvg.toFixed(2)} → {r.recentAvg.toFixed(2)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="analysis-note">
        Models with fewer than 20 reviews are left out — a 200% swing on three reviews is noise,
        not momentum. &quot;new&quot; means the prior window held nothing to compare against.
      </p>
    </>
  )
}

function toneOf(delta: number | null, threshold = 0.1): string | undefined {
  if (delta === null) return undefined
  if (delta > threshold) return 'positive'
  if (delta < -threshold) return 'danger'
  return undefined
}

/* ---------------------------------------------------------------------------
 * 3 — Perception: what the structured questions say
 * ------------------------------------------------------------------------ */

export function PerceptionPanel({ facts }: { facts: EnrichedFact[] }) {
  const withPerception = facts.filter((f) => f.perception !== null)
  const withOwnership = facts.filter((f) => f.ownership !== null)
  const withReturning = facts.filter((f) => f.returningBuyer !== null)

  // Claimed vs perceived, per model. Only where the brand actually claims one.
  const claims = new Map<
    string,
    { name: string; claimed: string; power: number; hybrid: number; control: number }
  >()
  for (const f of withPerception) {
    if (!f.modelId || !f.modelName || !f.playStyle) continue
    const c =
      claims.get(f.modelId) ??
      { name: f.modelName, claimed: f.playStyle, power: 0, hybrid: 0, control: 0 }
    c[f.perception!] += 1
    claims.set(f.modelId, c)
  }
  const claimRows = [...claims]
    .map(([id, c]) => {
      const total = c.power + c.hybrid + c.control
      const top = (['power', 'hybrid', 'control'] as const).reduce((a, b) =>
        c[a] >= c[b] ? a : b,
      )
      return { id, ...c, total, top, agrees: top === c.claimed }
    })
    .filter((r) => r.total >= 15)
    .sort((a, b) => Number(a.agrees) - Number(b.agrees) || b.total - a.total)

  // Loyalty vs conquest.
  const loyalty = new Map<string, { name: string; returning: number; total: number }>()
  for (const f of withReturning) {
    if (!f.modelId || !f.modelName) continue
    const l = loyalty.get(f.modelId) ?? { name: f.modelName, returning: 0, total: 0 }
    l.total++
    if (f.returningBuyer) l.returning++
    loyalty.set(f.modelId, l)
  }
  const loyaltyRows = [...loyalty]
    .map(([id, l]) => ({ id, ...l, rate: l.returning / l.total }))
    .filter((l) => l.total >= 15)
    .sort((a, b) => b.rate - a.rate)

  // Durability: rating by how long they had owned it.
  const own = new Map<string, { n: number; sum: number; rated: number }>()
  for (const f of withOwnership) {
    const o = own.get(f.ownership!) ?? { n: 0, sum: 0, rated: 0 }
    o.n++
    if (f.rating !== null) {
      o.rated++
      o.sum += f.rating
    }
    own.set(f.ownership!, o)
  }
  const ownRows = [...own]
    .map(([bucket, o]) => ({ bucket, ...o, avg: o.rated ? o.sum / o.rated : null }))
    .sort((a, b) => ownershipRank(a.bucket) - ownershipRank(b.bucket))

  if (withPerception.length === 0 && withOwnership.length === 0 && withReturning.length === 0) {
    return (
      <div className="empty">
        No structured answers in this scope. Only two platforms collect them — Okendo asks
        Selkirk&apos;s buyers to place the paddle on a power-to-control scale and name their
        previous brand, and Bazaarvoice asks JOOLA&apos;s how long they have owned it. Judge.me
        and Yotpo store neither, so CRBN, Six Zero, Paddletek and GAMMA have nothing here.
      </div>
    )
  }

  return (
    <>
      <p className="analysis-note">
        Every platform asks different questions, so <strong>none of this compares across
        brands</strong> — it would be comparing questionnaires. Each table below covers only the
        brands whose review form asks that question.
      </p>

      {claimRows.length > 0 && (
        <section className="card">
          <div className="section-head">
            <h2>Claimed play style vs what buyers call it</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Brand claims</th>
                  <th scope="col">Buyers say</th>
                  <th scope="col" className="num">Power</th>
                  <th scope="col" className="num">Hybrid</th>
                  <th scope="col" className="num">Control</th>
                  <th scope="col" className="num">Answers</th>
                </tr>
              </thead>
              <tbody>
                {claimRows.map((r) => (
                  <tr key={r.id} data-active={!r.agrees}>
                    <th scope="row">
                      <Link href={`/reviews?model=${r.id}`}>{r.name}</Link>
                    </th>
                    <td>{r.claimed}</td>
                    <td data-tone={r.agrees ? undefined : 'danger'}>
                      {r.top}
                      {r.agrees ? '' : ' ✕'}
                    </td>
                    <td className="num">{pct(r.power / r.total)}</td>
                    <td className="num">{pct(r.hybrid / r.total)}</td>
                    <td className="num">{pct(r.control / r.total)}</td>
                    <td className="num">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="analysis-note">
            A row marked ✕ is one where the plurality of buyers put the paddle in a different
            bucket than the brand merchandises it in. That is a positioning gap, and it is
            measurable rather than anecdotal. Models with fewer than 15 answers are excluded.
          </p>
        </section>
      )}

      <div className="split-grid">
        {loyaltyRows.length > 0 && (
          <section className="card">
            <div className="section-head">
              <h2>Loyalty vs conquest</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col" className="num">Already owned the brand</th>
                    <th scope="col" className="num">Answers</th>
                  </tr>
                </thead>
                <tbody>
                  {loyaltyRows.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">
                        <Link href={`/reviews?model=${r.id}`}>{r.name}</Link>
                      </th>
                      <td className="num">{pct(r.rate)}</td>
                      <td className="num">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="analysis-note">
              A high figure is a paddle that sells to the existing base; a low one is a paddle
              that recruits. Neither is better — but a line-up where every model is high is a
              brand that has stopped growing.
            </p>
          </section>
        )}

        {ownRows.length > 0 && (
          <section className="card">
            <div className="section-head">
              <h2>Rating by how long they had owned it</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Owned for</th>
                    <th scope="col" className="num">Reviews</th>
                    <th scope="col" className="num">Avg rating</th>
                  </tr>
                </thead>
                <tbody>
                  {ownRows.map((r) => (
                    <tr key={r.bucket}>
                      <th scope="row">{r.bucket}</th>
                      <td className="num">{r.n.toLocaleString()}</td>
                      <td className="num">{r.avg === null ? '—' : r.avg.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="analysis-note">
              The closest thing to a durability measure this data holds. A paddle that scores
              well on arrival and worse after a season is wearing out; the gap between the first
              and last row is that story in one number. Note the survivor effect — people who
              stopped using a paddle often never come back to review it, so this reads
              optimistic.
            </p>
          </section>
        )}
      </div>
    </>
  )
}

/* ---------------------------------------------------------------------------
 * 8 — Quality signals: defect language over time
 * ------------------------------------------------------------------------ */

export function QualityPanel({ facts }: { facts: EnrichedFact[] }) {
  const withDefect = facts.filter((f) => f.defects.length > 0)

  const byType = DEFECT_TERMS.map((t) => {
    const rows = withDefect.filter((f) => f.defects.includes(t.code))
    const rated = rows.filter((r) => r.rating !== null)
    return {
      ...t,
      count: rows.length,
      avg: rated.length ? rated.reduce((n, r) => n + (r.rating ?? 0), 0) / rated.length : null,
    }
  })
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count)

  const byModel = new Map<string, { name: string; brand: string; hits: number; total: number }>()
  for (const f of facts) {
    if (!f.modelId || !f.modelName) continue
    const m = byModel.get(f.modelId) ?? { name: f.modelName, brand: f.brand, hits: 0, total: 0 }
    m.total++
    if (f.defects.length > 0) m.hits++
    byModel.set(f.modelId, m)
  }
  const modelRows = [...byModel]
    .map(([id, m]) => ({ id, ...m, rate: m.hits / m.total }))
    .filter((m) => m.total >= 50 && m.hits > 0)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 20)

  const months = bucketize(dated(withDefect), 'month')
  const allMonths = bucketize(dated(facts), 'month')
  const rateByMonth = allMonths.map((m) => {
    const hits = months.find((d) => d.start === m.start)?.count ?? 0
    return { start: m.start, rate: m.count === 0 ? 0 : hits / m.count, hits, total: m.count }
  })

  return (
    <>
      <div className="section-head">
        <h2>Quality signals — failure language in the prose</h2>
      </div>
      <p className="analysis-note">
        {withDefect.length.toLocaleString()} of {facts.length.toLocaleString()} reviews in scope (
        {pct(withDefect.length / Math.max(1, facts.length))}) use language describing a physical
        failure. This is a <strong>keyword</strong> signal, not a verified fault rate: it catches
        &quot;started to delaminate&quot; and misses a fault described without the vocabulary, and
        it cannot tell a complaint from a reviewer saying a paddle did <em>not</em> delaminate.
        Read the direction and the relative ordering, not the absolute number.
      </p>

      <div className="split-grid">
        <section className="card">
          <div className="section-head">
            <h2>By failure mode</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Mode</th>
                  <th scope="col" className="num">Reviews</th>
                  <th scope="col" className="num">Their avg rating</th>
                </tr>
              </thead>
              <tbody>
                {byType.map((t) => (
                  <tr key={t.code}>
                    <th scope="row">{t.label}</th>
                    <td className="num">{t.count.toLocaleString()}</td>
                    <td className="num">{t.avg === null ? '—' : t.avg.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="analysis-note">
            Where a failure mode&apos;s average rating is still high, the mentions are largely
            reassurance (&quot;no delamination after six months&quot;) rather than complaints —
            which is exactly the limit of keyword matching.
          </p>
        </section>

        <section className="card">
          <div className="section-head">
            <h2>Mention rate by month</h2>
          </div>
          <Spark
            values={rateByMonth.map((m) => m.rate * 1000)}
            title="defect mention rate by month"
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="num">Flagged</th>
                  <th scope="col" className="num">Reviews</th>
                  <th scope="col" className="num">Rate</th>
                </tr>
              </thead>
              <tbody>
                {rateByMonth.slice(-8).reverse().map((m) => (
                  <tr key={m.start}>
                    <th scope="row">{m.start.slice(0, 7)}</th>
                    <td className="num">{m.hits}</td>
                    <td className="num">{m.total.toLocaleString()}</td>
                    <td className="num">{m.total === 0 ? '—' : pct(m.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="analysis-note">
            A rising rate is the thing to watch — it means failures are growing faster than
            reviews, which a raw count would hide during a period of growth.
          </p>
        </section>
      </div>

      {modelRows.length > 0 && (
        <section className="card">
          <div className="section-head">
            <h2>Highest mention rate by model</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col" className="num">Flagged</th>
                  <th scope="col" className="num">Reviews</th>
                  <th scope="col" className="num">Rate</th>
                </tr>
              </thead>
              <tbody>
                {modelRows.map((m) => (
                  <tr key={m.id}>
                    <th scope="row">
                      <Link href={`/reviews?model=${m.id}`}>{m.name}</Link>
                      <span className="muted"> · {m.brand}</span>
                    </th>
                    <td className="num">{m.hits}</td>
                    <td className="num">{m.total.toLocaleString()}</td>
                    <td className="num">{pct(m.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="analysis-note">
            Models with fewer than 50 reviews are excluded, because one flagged review out of ten
            is a 10% &quot;failure rate&quot; that means nothing.
          </p>
        </section>
      )}
    </>
  )
}

/* ---------------------------------------------------------------------------
 * 11 — Competitive: who reviewers name
 * ------------------------------------------------------------------------ */

export function CompetitivePanel({ facts }: { facts: EnrichedFact[] }) {
  const label = new Map(PADDLE_BRANDS.map((b) => [b.slug, b.label]))
  const withMention = facts.filter((f) => f.mentions.length > 0)

  // Who does each brand's reviewer base name?
  const outbound = new Map<string, Map<string, number>>()
  const switches = new Map<string, Map<string, number>>()
  const brandTotals = new Map<string, number>()
  for (const f of facts) {
    brandTotals.set(f.brand, (brandTotals.get(f.brand) ?? 0) + 1)
    for (const m of f.mentions) {
      const row = outbound.get(f.brand) ?? new Map<string, number>()
      row.set(m, (row.get(m) ?? 0) + 1)
      outbound.set(f.brand, row)
      if (f.readsAsSwitch) {
        const s = switches.get(f.brand) ?? new Map<string, number>()
        s.set(m, (s.get(m) ?? 0) + 1)
        switches.set(f.brand, s)
      }
    }
  }

  const rows = [...outbound]
    .map(([brand, named]) => ({
      brand,
      total: brandTotals.get(brand) ?? 0,
      mentions: [...named].sort((a, b) => b[1] - a[1]),
      switchTotal: [...(switches.get(brand)?.values() ?? [])].reduce((n, v) => n + v, 0),
      mentionTotal: [...named.values()].reduce((n, v) => n + v, 0),
    }))
    .sort((a, b) => b.mentionTotal - a.mentionTotal)

  return (
    <>
      <div className="section-head">
        <h2>Competitive — who reviewers bring up</h2>
      </div>
      <p className="analysis-note">
        {withMention.length.toLocaleString()} reviews (
        {pct(withMention.length / Math.max(1, facts.length))}) name a paddle brand other than the
        one being reviewed. A brand is never counted as its own competitor, so &quot;my third
        Selkirk&quot; is loyalty rather than a mention. Head, Legacy, Prince and Vulcan are real
        brands and ordinary English words, so they are deliberately excluded — under-counting a
        few real mentions beats a chart listing brands nobody named.
      </p>

      <div className="board-grid">
        {rows.map((r) => (
          <article className="card board" key={r.brand}>
            <header className="board-head">
              <h3>{r.brand} reviewers name…</h3>
              <span className="muted">
                {r.mentionTotal.toLocaleString()} of {r.total.toLocaleString()}
              </span>
            </header>
            <ol className="rank">
              {r.mentions.slice(0, 8).map(([slug, n], i) => (
                <li className="rank-row" key={slug} data-leader={i === 0}>
                  <span className="rank-name">{label.get(slug) ?? slug}</span>
                  <div className="rank-bar" aria-hidden="true">
                    <span style={{ width: `${(n / (r.mentions[0]?.[1] ?? 1)) * 100}%` }} />
                  </div>
                  <span className="rank-count">{n.toLocaleString()}</span>
                  <span className="rank-meta muted">
                    {pct(n / r.total)} of this brand&apos;s reviews
                  </span>
                </li>
              ))}
            </ol>
            <p className="board-foot muted">
              {r.switchTotal.toLocaleString()} of those read as an actual switch — the reviewer
              says they came from that paddle, rather than just comparing to it.
            </p>
          </article>
        ))}
      </div>
      <p className="analysis-note">
        Read these as direction, not share. A brand can only be named by reviewers of brands we
        collect, so a rival with no storefront in this catalogue shows up in the columns but
        never has a column of its own.
      </p>
    </>
  )
}
