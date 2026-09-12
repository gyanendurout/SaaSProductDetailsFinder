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

/**
 * Every event type the pipeline writes, derived from the label map rather than
 * listed again beside it.
 *
 * The change log's summary chips need one count per type, and counting types by
 * reading the whole log defeats the point of paging it. Deriving the list from
 * the labels means a type added to one is in the other by construction — a
 * second hand-maintained list would eventually be missing an event that still
 * showed up in the table below it.
 */
export const CHANGE_EVENT_TYPES: readonly string[] = Object.keys(EVENT_LABELS)

/**
 * A change event's before/after value, in words a reader recognises.
 *
 * variant_events stores whatever the diff stage produced, and that is not a
 * display format: a price move is the bare string "179.99" with no currency on
 * it, and a stockout reads "in_stock" -> "out_of_stock" — column values leaking
 * into the interface. Both are formatted here rather than rewritten in the
 * table, because thousands of rows of history already hold the stored form.
 *
 * Currency is USD because every storefront in src/config is USD, and the view
 * does not expose the site's currency column. The day a non-USD store is added,
 * v_recent_changes needs `s.currency` and this needs it passed in — a migration,
 * so it is called out here rather than silently mislabelling euros as dollars.
 */
export function changeValue(eventType: string, value: string | null): string {
  if (value === null || value === '') return '—'

  switch (eventType) {
    case 'price_increase':
    case 'price_decrease':
    case 'listed':
    case 'delisted':
      return fmtMoney(value, 'USD')
    case 'went_oos':
    case 'back_in_stock':
      return STOCK_WORDS[value] ?? value
    default:
      // Discounts already carry their '%', and collection changes are names.
      return value
  }
}

const STOCK_WORDS: Record<string, string> = {
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
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

/**
 * A stored vocabulary code, in words.
 *
 * Codes reach the page exactly as Postgres holds them — 'widebody', 'all_court',
 * 'out_of_stock' — and reading a column value in an interface is a small but
 * constant reminder that nobody looked. The general rule (underscores to spaces,
 * sentence case) covers almost everything; OVERRIDES carries the handful that
 * are compound words rather than two words, which the general rule gets wrong.
 *
 * Deliberately not a lookup against the play_styles / shapes tables: those hold
 * a label column, but fetching one per badge would be a query per row, and the
 * codes are stable enough that a rename is a migration either way.
 */
export function vocabLabel(code: string | null | undefined): string {
  if (!code) return 'Unknown'
  const override = VOCAB_OVERRIDES[code]
  if (override) return override
  const words = code.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const VOCAB_OVERRIDES: Record<string, string> = {
  widebody: 'Wide body',
  all_court: 'All-court',
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
}

/**
 * The exact instant behind a relative timestamp.
 *
 * fmtWhen rounds — "14h ago", "3d ago" — and two pages rendered a minute apart
 * can legitimately round the same crawl to different strings. That reads as the
 * two pages disagreeing about when the last crawl ran, and there is no way to
 * check which is right because neither shows the instant. Pairing every relative
 * string with this as a tooltip makes them reconcilable.
 */
export function fmtExact(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`
}
