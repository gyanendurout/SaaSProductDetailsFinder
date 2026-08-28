'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type State =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; status: string }
  | { kind: 'error'; message: string }

/**
 * Triggers a crawl and waits for it. The run takes roughly half a minute, almost
 * all of it the polite delay between storefront requests, so the button reports
 * that up front rather than looking hung.
 */
export function RunCrawlButton() {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const run = async () => {
    setState({ kind: 'running' })
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = (await res.json()) as { status?: string; error?: string }
      if (!res.ok) {
        setState({ kind: 'error', message: payload.error ?? `HTTP ${res.status}` })
        return
      }
      setState({ kind: 'done', status: payload.status ?? 'done' })
      // Pull the new rows into the server-rendered tables.
      startTransition(() => router.refresh())
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const busy = state.kind === 'running' || isPending

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap)', flexWrap: 'wrap' }}>
      <button className="btn" onClick={run} disabled={busy}>
        {state.kind === 'running' ? 'Crawling…' : 'Run crawl now'}
      </button>

      {state.kind === 'running' && (
        <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
          Fetching 15 collections at a polite 1.2s interval — about 35 seconds.
        </span>
      )}
      {state.kind === 'done' && (
        <span
          className="notice"
          data-tone={state.status === 'done' ? 'positive' : undefined}
        >
          Crawl finished: <strong>{state.status}</strong>
          {state.status === 'partial' && ' — see the errors below'}
        </span>
      )}
      {state.kind === 'error' && (
        <span className="notice" data-tone="danger">
          {state.message}
        </span>
      )}
    </div>
  )
}
