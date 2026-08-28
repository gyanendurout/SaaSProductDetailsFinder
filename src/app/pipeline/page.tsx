import { getRuns } from '../../lib/queries.js'
import { db } from '../../lib/supabase.js'
import { Badge } from '../../components/Badge'
import { RunCrawlButton } from '../../components/RunCrawlButton'
import { fmtWhen } from '../../lib/format.js'

export const dynamic = 'force-dynamic'

interface CrawlErrorRow {
  id: string
  run_id: string
  stage: string
  target: string | null
  error_type: string
  error_message: string | null
  created_at: string
}

export default async function PipelinePage() {
  const runs = await getRuns(30)

  const { data: errorRows } = await db()
    .from('crawl_errors')
    .select('id,run_id,stage,target,error_type,error_message,created_at')
    .order('created_at', { ascending: false })
    .limit(30)
  const errors = (errorRows ?? []) as CrawlErrorRow[]

  const done = runs.filter((r) => r.status === 'done').length

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Pipeline</p>
        <h1>Collection health</h1>
        <p className="lede">
          Each crawl reads the storefront, resolves the catalogue and writes one
          price/stock observation per SKU. History only exists for days a crawl
          actually ran, so gaps here are gaps in every chart.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 'var(--gap-section)' }}>
        <RunCrawlButton />
        <p className="faint" style={{ fontSize: 'var(--text-xs)', margin: 'var(--gap) 0 0' }}>
          A manual run is safe to repeat — writes are idempotent, and a second run on
          the same day adds another observation rather than duplicating the
          catalogue. For unattended collection use the scheduled task or the GitHub
          Actions workflow.
        </p>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Runs recorded</div>
          <div className="stat-value">{runs.length}</div>
          <div className="stat-note">{done} completed cleanly</div>
        </div>
        <div className="stat">
          <div className="stat-label">Last run</div>
          <div className="stat-value" style={{ fontSize: '1.1rem', paddingTop: '.5rem' }}>
            {runs[0] ? fmtWhen(runs[0].started_at) : '—'}
          </div>
          <div className="stat-note">
            {runs[0] ? (
              <Badge tone={statusTone(runs[0].status)}>{runs[0].status}</Badge>
            ) : (
              'never'
            )}
          </div>
        </div>
        <div className="stat" data-tone={errors.length ? 'danger' : undefined}>
          <div className="stat-label">Recent errors</div>
          <div className="stat-value">{errors.length}</div>
          <div className="stat-note">across the last 30 runs</div>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Run history</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Type</th>
                <th>Status</th>
                <th>Stages</th>
                <th className="num">Products</th>
                <th className="num">SKUs</th>
                <th className="num">Snapshots</th>
                <th className="num">Events</th>
                <th className="num">Took</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="faint">{fmtWhen(r.started_at)}</td>
                  <td className="muted">{r.run_type}</td>
                  <td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="mono">{(r.stages_done ?? []).join(' → ') || '—'}</td>
                  <td className="num">{r.products_found}</td>
                  <td className="num">{r.variants_found}</td>
                  <td className="num">{r.snapshots_written}</td>
                  <td className="num">
                    {r.events_written > 0 ? (
                      <strong>{r.events_written}</strong>
                    ) : (
                      <span className="faint">0</span>
                    )}
                  </td>
                  <td className="num faint">{duration(r.started_at, r.finished_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {errors.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Errors</h2>
            <span className="faint" style={{ fontSize: 'var(--text-sm)' }}>
              A failed stage ends the run as <em>partial</em> — the other stages still
              complete
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Stage</th>
                  <th>Type</th>
                  <th>Target</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.id}>
                    <td className="faint">{fmtWhen(e.created_at)}</td>
                    <td className="mono">{e.stage}</td>
                    <td>
                      <Badge tone="danger">{e.error_type}</Badge>
                    </td>
                    <td className="mono">{e.target ?? '—'}</td>
                    <td className="muted">{e.error_message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

function statusTone(status: string): 'positive' | 'warning' | 'danger' | 'neutral' {
  if (status === 'done') return 'positive'
  if (status === 'partial') return 'warning'
  if (status === 'error') return 'danger'
  return 'neutral'
}

function duration(start: string, end: string | null): string {
  if (!end) return '—'
  const secs = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}
