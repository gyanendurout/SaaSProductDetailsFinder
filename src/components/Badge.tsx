import { vocabLabel } from '../lib/format.js'

type Tone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger'

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: Tone
}) {
  return (
    <span className="badge" data-tone={tone}>
      {children}
    </span>
  )
}

/** Stock state, coloured semantically rather than decoratively. */
export function StockBadge({ available }: { available: boolean | null }) {
  if (available === null) return <Badge tone="neutral">Unknown</Badge>
  return available ? (
    <Badge tone="positive">In stock</Badge>
  ) : (
    <Badge tone="danger">Out of stock</Badge>
  )
}

export function TierBadge({ tier }: { tier: string | null }) {
  const tone: Tone =
    tier === 'pro' ? 'accent' : tier === 'performance' ? 'warning' : 'neutral'
  return <Badge tone={tone}>{vocabLabel(tier)}</Badge>
}

/** A stored vocabulary code — play style, shape — rendered in words. */
export function VocabBadge({ code }: { code: string | null }) {
  return <Badge tone="neutral">{vocabLabel(code)}</Badge>
}
