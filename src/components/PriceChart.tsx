import type { DailyPoint } from '../lib/queries.js'

/**
 * Price history, drawn as a STEP chart.
 *
 * This is deliberately hand-rolled rather than pulled from a charting library.
 * Every general-purpose line chart interpolates linearly between points, which
 * would draw a smooth slide from $299.95 to $149.95 across the days between two
 * observations — implying prices that never existed. `observed_at` is when we
 * looked, not when the price changed, so the only honest render is a flat line
 * until the next observation, then a vertical step.
 *
 * Days when the SKU was out of stock are marked, because a price is not an
 * offer if you cannot buy it.
 */
export function PriceChart({
  points,
  currency = 'USD',
  height = 200,
}: {
  points: DailyPoint[]
  currency?: string | null
  height?: number
}) {
  const priced = points.filter((p) => p.price_close !== null)

  if (priced.length === 0) {
    return <div className="chart-empty">No price observations recorded yet.</div>
  }
  if (priced.length === 1) {
    const only = priced[0]!
    return (
      <div className="chart-empty">
        One observation so far — {fmtMoney(only.price_close, currency)} on{' '}
        {only.day}. The trend line appears from the second crawl onward.
      </div>
    )
  }

  const W = 720
  const H = height
  const PAD = { top: 16, right: 56, bottom: 26, left: 8 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const prices = priced.map((p) => Number(p.price_close))
  const rawMin = Math.min(...prices)
  const rawMax = Math.max(...prices)
  // Give a flat series a visible band instead of collapsing it onto one line.
  const pad = rawMax === rawMin ? Math.max(rawMax * 0.08, 1) : (rawMax - rawMin) * 0.18
  const yMin = Math.max(0, rawMin - pad)
  const yMax = rawMax + pad

  const t0 = new Date(priced[0]!.day).getTime()
  const t1 = new Date(priced[priced.length - 1]!.day).getTime()
  const span = t1 - t0 || 1

  const x = (day: string) => PAD.left + ((new Date(day).getTime() - t0) / span) * plotW
  const y = (price: number) => PAD.top + (1 - (price - yMin) / (yMax - yMin)) * plotH

  // Step path: horizontal to the next observation's x, then vertical to its y.
  const segments: string[] = []
  priced.forEach((point, i) => {
    const px = x(point.day)
    const py = y(Number(point.price_close))
    if (i === 0) {
      segments.push(`M ${px.toFixed(1)} ${py.toFixed(1)}`)
      return
    }
    segments.push(`L ${px.toFixed(1)} ${(y(Number(priced[i - 1]!.price_close))).toFixed(1)}`)
    segments.push(`L ${px.toFixed(1)} ${py.toFixed(1)}`)
  })
  // Carry the last known price to the right edge — it is still in force.
  segments.push(`L ${(PAD.left + plotW).toFixed(1)} ${y(Number(priced[priced.length - 1]!.price_close)).toFixed(1)}`)
  const path = segments.join(' ')

  const gridValues = [yMax, (yMax + yMin) / 2, yMin]

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Price history: ${fmtMoney(rawMin, currency)} to ${fmtMoney(rawMax, currency)} across ${priced.length} observations`}
      preserveAspectRatio="xMidYMid meet"
    >
      {gridValues.map((value, i) => (
        <g key={i}>
          <line
            x1={PAD.left}
            x2={PAD.left + plotW}
            y1={y(value)}
            y2={y(value)}
            stroke="var(--rule)"
            strokeWidth="1"
            strokeDasharray={i === gridValues.length - 1 ? undefined : '2 4'}
          />
          <text
            x={PAD.left + plotW + 8}
            y={y(value) + 4}
            fontSize="11"
            fill="var(--ink-faint)"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {fmtMoney(value, currency, 0)}
          </text>
        </g>
      ))}

      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />

      {priced.map((point, i) => {
        const onSale = point.was_on_sale
        const oos = point.was_available === false
        return (
          <circle
            key={i}
            cx={x(point.day)}
            cy={y(Number(point.price_close))}
            r={onSale || oos ? 4 : 2.5}
            fill={oos ? 'var(--paper)' : onSale ? 'var(--danger)' : 'var(--accent)'}
            stroke={oos ? 'var(--ink-faint)' : 'none'}
            strokeWidth="1.5"
          >
            <title>
              {point.day} — {fmtMoney(point.price_close, currency)}
              {onSale ? ` (${point.discount_pct_close}% off)` : ''}
              {oos ? ' — out of stock' : ''}
            </title>
          </circle>
        )
      })}

      <text x={PAD.left} y={H - 6} fontSize="11" fill="var(--ink-faint)">
        {priced[0]!.day}
      </text>
      <text x={PAD.left + plotW} y={H - 6} fontSize="11" fill="var(--ink-faint)" textAnchor="end">
        {priced[priced.length - 1]!.day}
      </text>
    </svg>
  )
}

function fmtMoney(value: number | null, currency?: string | null, digits = 2): string {
  if (value === null) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value)
  } catch {
    return `${value.toFixed(digits)}`
  }
}
