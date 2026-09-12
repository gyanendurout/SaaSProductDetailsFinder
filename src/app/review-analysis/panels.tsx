import Link from 'next/link'
import { materialGaps, type ModelCoverage } from '../../lib/review-analysis.js'
import type { EnrichedFact, ReviewFact } from '../../lib/review-stats.js'
import { averageOf } from '../../lib/review-stats.js'
import {
  bucketize,
  growthRatio,
  rollingWindows,
  trajectory,
  type DatedPoint,
} from '../../lib/review-trends.js'
import { DEFECT_TERMS, PADDLE_BRANDS } from '../../lib/review-text.js'
import { ownershipLabel, ownershipRank } from '../../lib/review-context.js'
import { vocabLabel } from '../../lib/format.js'

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

/**
 * A plain-language explainer attached to a section heading.
 *
 * Not the native `title` attribute: that needs a mouse, waits a second, cannot
 * be styled, and is invisible to touch. This opens on hover AND on keyboard
 * focus, so it is reachable by tab as well as by pointer.
 *
 * Every one carries a worked example. "Share of the brand's reviews" is
 * abstract; "38% means 38 of every 100 CRBN reviews are about this paddle" is
 * not, and the example is what makes a column readable by someone who did not
 * build the table.
 */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="infotip" tabIndex={0} role="note" aria-label={`What ${label} means`}>
      <span className="infotip-mark" aria-hidden="true">
        ?
      </span>
      <span className="infotip-body">{children}</span>
    </span>
  )
}

/** A worked example line inside a tooltip. */
export function Eg({ children }: { children: React.ReactNode }) {
  return (
    <span className="infotip-eg">
      <strong>Example:</strong> {children}
    </span>
  )
}

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

/**
 * Four 90-day windows rather than two.
 *
 * Two windows answer "up or down since last quarter", which cannot tell a blip
 * from the fourth quarter of a slide. Four cover a rolling year, so the shape
 * of a rise or a fall is visible in the row itself.
 */
const WINDOW_COUNT = 4

export function MomentumPanel({
  facts,
  coverage,
  windowDays = 90,
}: {
  facts: ReviewFact[]
  coverage: ModelCoverage[]
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
      const windows = rollingWindows(points, windowDays, WINDOW_COUNT)
      const months = bucketize(points, 'month')
      return {
        id,
        name: g.name,
        brand: g.brand,
        total: g.rows.length,
        windows,
        recent: windows[0]?.points.length ?? 0,
        growth: growthRatio(windows[0]?.points.length ?? 0, windows[1]?.points.length ?? 0),
        months,
        traj: trajectory(months),
        // Oldest window holding a rating against the newest that does — the
        // widest honest "then vs now" this row can support.
        oldestAvg: [...windows].reverse().find((w) => w.average !== null)?.average ?? null,
        newestAvg: windows.find((w) => w.average !== null)?.average ?? null,
      }
    })
    .filter((r) => r.total >= 20)
    .sort((a, b) => b.recent - a.recent || b.total - a.total)
    .slice(0, 25)

  const gaps = materialGaps(coverage)

  return (
    <>
      {gaps.length > 0 && (
        <div className="notice" data-tone="danger">
          <strong>
            {gaps.length} model{gaps.length === 1 ? '' : 's'} hold fewer reviews than their
            storefront reports
          </strong>
          , so the history below starts later than it should for them.
          <ul className="gap-list">
            {gaps.slice(0, 8).map((c) => (
              <li key={c.modelId}>
                {c.brand} — {c.modelName}: <strong>{c.stored.toLocaleString()}</strong> held of{' '}
                {c.reported.toLocaleString()} reported
                {c.listings > 1 ? ` (across ${c.listings} listings)` : ''}
              </li>
            ))}
          </ul>
          <p className="gap-why">
            The large gaps are a hard limit at the source: Judge.me&apos;s widget stops serving
            new rows after 100 pages and then repeats the last one, capping a listing at 1,000
            reviews. What survives is the <em>most recent</em> slice, which is the worst part to
            keep when reading a trend — the beginning is what goes missing. Smaller gaps may
            instead be an accounting difference, because some platforms report a figure that rolls
            a review up across every listing of a paddle while we store each review once.
          </p>
        </div>
      )}

      <div className="section-head">
        <h2>
          Momentum — reviews per month, and where the rating is heading
          <InfoTip label="Momentum">
            How much people are still talking about each paddle, and whether they are getting
            happier or less happy with it. Each row is one paddle model. The four number columns
            cut the last year into four 90-day blocks, newest first, so you see the shape of a
            rise or a fall rather than just its direction.
            <Eg>
              A row reading <strong>131 · 206 · 254 · 190</strong>, then <strong>−36%</strong> and{' '}
              <strong>4.67 → 4.34</strong>, means 131 reviews arrived in the last 90 days, 206 in
              the 90 days before that, 254 before that and 190 before that — interest peaked and
              is now falling, down 36% against the previous block — while the average score
              slipped from 4.67 to 4.34 out of 5.
            </Eg>
          </InfoTip>
        </h2>
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
              <th scope="col" className="num">Last {windowDays} days</th>
              <th scope="col" className="num">
                {windowDays}–{windowDays * 2} days ago
              </th>
              <th scope="col" className="num">
                {windowDays * 2}–{windowDays * 3} days ago
              </th>
              <th scope="col" className="num">
                {windowDays * 3}–{windowDays * 4} days ago
              </th>
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
                {r.windows.map((w) => (
                  <td className="num" key={w.index}>
                    {w.points.length.toLocaleString()}
                  </td>
                ))}
                <td className="num" data-tone={toneOf(r.growth)}>
                  {r.growth === null ? 'new' : signed(r.growth)}
                </td>
                <td>
                  <RatingLine points={r.traj.map((t) => t.trailing)} title={`${r.name} rating`} />
                </td>
                <td className="num">
                  {r.oldestAvg === null || r.newestAvg === null ? (
                    '—'
                  ) : (
                    <span data-tone={toneOf(r.newestAvg - r.oldestAvg, 0.15)}>
                      {r.oldestAvg.toFixed(2)} → {r.newestAvg.toFixed(2)}
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
        not momentum. &quot;Change&quot; compares the last {windowDays} days against the{' '}
        {windowDays} before it, and &quot;new&quot; means that earlier block held nothing to
        compare against. &quot;Then → now&quot; spans the oldest and newest of the four blocks
        that had any rated reviews.
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
    // Rank first, then the bucket itself. A tie on rank means two values the
    // ordering does not recognise, and leaving those in arrival order is what
    // made this table read as a volume sort.
    .sort(
      (a, b) =>
        ownershipRank(a.bucket) - ownershipRank(b.bucket) || a.bucket.localeCompare(b.bucket),
    )

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
            <h2>
              Claimed play style vs what buyers call it
              <InfoTip label="claimed play style">
                Paddles are sold as &quot;power&quot;, &quot;control&quot; or a blend. When buyers
                review one, some storefronts ask them to place it on that same scale. This table
                puts the brand&apos;s label next to the buyers&apos; verdict, so you can see where
                the marketing and the experience disagree. A ✕ marks a paddle most buyers put in a
                different box than the brand does.
                <Eg>
                  <strong>SLK ERA Power · power · hybrid ✕ · 26% / 54% / 20% · 148</strong> means
                  Selkirk sells it as a power paddle, but of 148 buyers asked, only 26% called it
                  power, 54% called it a hybrid and 20% called it control — so the plurality
                  disagrees with the label.
                </Eg>
              </InfoTip>
            </h2>
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
                    <td>{vocabLabel(r.claimed)}</td>
                    <td data-tone={r.agrees ? undefined : 'danger'}>
                      {vocabLabel(r.top)}
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
              <h2>
                Loyalty vs conquest
                <InfoTip label="loyalty vs conquest">
                  Some storefronts ask a reviewer whether their previous paddle was the same brand.
                  A high number means the paddle mostly sells to people who already owned the
                  brand; a low number means it is winning customers away from rivals. Neither is
                  automatically better, but a whole line-up scoring high is a brand selling only to
                  itself.
                  <Eg>
                    <strong>OMNI · 62% · 210</strong> means 210 buyers answered the question, and
                    62% of them were already brand customers — so roughly 4 in 10 were new to the
                    brand.
                  </Eg>
                </InfoTip>
              </h2>
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
              <h2>
                Rating by how long they had owned it
                <InfoTip label="rating by ownership length">
                  The nearest thing here to a durability test. Reviewers say how long they had the
                  paddle before writing, so you can compare the score people give on arrival with
                  the score they give after a season of play. A paddle that starts high and drops
                  as ownership lengthens is wearing out.
                  <Eg>
                    <strong>Less than a month · 412 · 4.81</strong> next to{' '}
                    <strong>More than a year · 96 · 4.42</strong> means new owners scored it 4.81
                    out of 5 while long-term owners scored it 4.42 — a paddle people like less the
                    longer they use it.
                  </Eg>
                </InfoTip>
              </h2>
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
                      <th scope="row">{ownershipLabel(r.bucket)}</th>
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
        <h2>
          Quality signals — failure language in the prose
          <InfoTip label="quality signals">
            We read the written part of every review looking for words people use when a paddle
            physically breaks — delaminated, dead spot, cracked, edge guard came off. This is a
            word search, not a verified fault rate: it will catch a reviewer saying a paddle did
            NOT delaminate, and it will miss a fault described in words we did not think of. Use
            it to spot which problems are growing, not to quote a failure percentage.
            <Eg>
              <strong>Delamination · 83 · 3.94</strong> means 83 reviews in the current filter used
              delamination wording, and those 83 reviews average 3.94 out of 5 — well below the
              site-wide 4.76, which is what tells you they are genuine complaints rather than
              someone saying it held up fine.
            </Eg>
          </InfoTip>
        </h2>
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
            <h2>
              By failure mode
              <InfoTip label="failure modes">
                The same flagged reviews grouped by the kind of problem described, most common
                first, each with the average score those reviewers gave. A low average means real
                complaints. An average close to the site-wide 4.76 means the wording is mostly
                reassurance — people saying the thing did not happen.
                <Eg>
                  <strong>Grip / handle fault · 41 · 4.51</strong> is a row to treat with caution:
                  41 mentions, but a 4.51 average suggests many of them are happy reviews that
                  merely mention the grip.
                </Eg>
              </InfoTip>
            </h2>
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
            <h2>
              Mention rate by month
              <InfoTip label="mention rate by month">
                Flagged reviews as a share of all reviews that month, rather than a raw count. The
                share is what matters: during a month when a brand collects twice as many reviews,
                twice as many complaints is the same rate, not a new problem. A rising share is the
                thing worth acting on.
                <Eg>
                  <strong>2026-07 · 14 · 980 · 1%</strong> means 14 of that month&apos;s 980
                  reviews used failure wording — about 1 in 70. If the next month reads 3%, faults
                  are growing faster than reviews.
                </Eg>
              </InfoTip>
            </h2>
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
            <h2>
              Highest mention rate by model
              <InfoTip label="mention rate by model">
                Which paddles attract the most failure talk, as a share of their own reviews so a
                popular paddle is not penalised for being popular. Models with fewer than 50
                reviews are excluded, because 1 flagged review out of 10 is a 10% rate that means
                nothing.
                <Eg>
                  <strong>Perseus Pro IV · 12 · 347 · 3%</strong> means 12 of this model&apos;s 347
                  reviews mention a physical failure — roughly 1 in 29. Compare it against the
                  other rows rather than reading 3% as a true fault rate.
                </Eg>
              </InfoTip>
            </h2>
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
        <h2>
          Competitive — who reviewers bring up
          <InfoTip label="competitive">
            When someone reviews a paddle, they often name another brand they played before or
            compared against. Each card takes one brand&apos;s reviewers and counts which rivals
            they mention. A brand is never counted against itself, so &quot;my third Selkirk&quot;
            is loyalty rather than a competitor mention.
            <Eg>
              On the CRBN card, <strong>JOOLA · 132 · 2% of this brand&apos;s reviews</strong>{' '}
              means 132 CRBN reviewers brought up JOOLA — about 2 in every 100 CRBN reviews. The
              line underneath says how many of those read as an actual switch (&quot;I moved from
              my JOOLA&quot;) rather than a passing comparison (&quot;plays like a JOOLA&quot;).
            </Eg>
          </InfoTip>
        </h2>
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
