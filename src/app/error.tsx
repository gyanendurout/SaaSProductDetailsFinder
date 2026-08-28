'use client'

import { useEffect } from 'react'

/**
 * Page-level error boundary.
 *
 * Without this, one failed Supabase read renders Next's bare "Application error:
 * a server-side exception has occurred" — no context, no way forward, and a
 * digest the viewer cannot act on. Management should never see that.
 *
 * The retry button matters: the failures this catches in practice are transient
 * upstream ones that succeed immediately on a second attempt.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('page error', { message: error.message, digest: error.digest })
  }, [error])

  return (
    <div style={{ maxWidth: '58ch', margin: '4rem auto' }}>
      <p className="eyebrow">Something went wrong</p>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-display)',
          fontWeight: 400,
          letterSpacing: '-0.025em',
          margin: '0 0 var(--gap)',
          lineHeight: 1.05,
        }}
      >
        This page could not load
      </h1>
      <p className="muted">
        The data source did not respond as expected. This is usually momentary —
        try again before assuming anything is broken.
      </p>

      <div style={{ display: 'flex', gap: 'var(--gap-tight)', margin: 'var(--gap-loose) 0' }}>
        <button className="btn" onClick={reset}>
          Try again
        </button>
        <a className="btn" data-variant="ghost" href="/">
          Back to overview
        </a>
      </div>

      <details>
        <summary
          className="faint"
          style={{ cursor: 'pointer', fontSize: 'var(--text-sm)' }}
        >
          Technical detail
        </summary>
        <pre
          className="mono"
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: 'var(--surface-sunken)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--radius)',
            padding: 'var(--gap)',
            marginTop: 'var(--gap-tight)',
          }}
        >
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
      </details>
    </div>
  )
}
