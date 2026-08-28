/** Presentation helpers shared by the dashboard pages. */

export function fmtMoney(
  value: number | string | null,
  currency?: string | null,
  digits = 2,
): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n)
  } catch {
    return n.toFixed(digits)
  }
}

/** Relative for the last week, absolute date beyond that. */
export function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  const mins = Math.round((Date.now() - then) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return `${days}d ago`
  return new Date(iso).toISOString().slice(0, 10)
}

const EVENT_LABELS: Record<string, string> = {
  listed: 'listed',
  delisted: 'delisted',
  price_increase: 'price up',
  price_decrease: 'price down',
  discount_started: 'sale started',
  discount_deepened: 'sale deepened',
  discount_ended: 'sale ended',
  went_oos: 'out of stock',
  back_in_stock: 'back in stock',
  category_added: 'added to collection',
  category_removed: 'left collection',
}

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type
}

type Tone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger'

/**
 * Colour by commercial meaning, not by direction. A price cut and a stockout are
 * both "notable", but only one of them is good news for the buyer.
 */
export function eventTone(type: string): Tone {
  switch (type) {
    case 'price_decrease':
    case 'discount_started':
    case 'discount_deepened':
      return 'danger'
    case 'price_increase':
    case 'discount_ended':
      return 'warning'
    case 'back_in_stock':
    case 'listed':
      return 'positive'
    case 'went_oos':
    case 'delisted':
      return 'neutral'
    default:
      return 'neutral'
  }
}
