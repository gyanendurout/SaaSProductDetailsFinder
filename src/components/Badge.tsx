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
  if (available === null) return <Badge tone="neutral">unknown</Badge>
  return available ? (
    <Badge tone="positive">in stock</Badge>
  ) : (
    <Badge tone="danger">out of stock</Badge>
  )
}

export function TierBadge({ tier }: { tier: string | null }) {
  const tone: Tone =
    tier === 'pro' ? 'accent' : tier === 'performance' ? 'warning' : 'neutral'
  return <Badge tone={tone}>{tier ?? 'unknown'}</Badge>
}
