/**
 * Pagination arithmetic, kept out of review-queries.ts on purpose.
 *
 * That module imports 'server-only', so anything it exports is unreachable from
 * a client component. The pager control is necessarily a client component — a
 * <select> that navigates on change needs an event handler — and it has to agree
 * with the server on exactly which page sizes are legal, or the dropdown offers
 * a value the query then silently rejects.
 *
 * Nothing here touches the database, so both sides can import it.
 */

/** The sizes the pager offers. The server validates against this same list. */
export const REVIEW_PAGE_SIZES = [20, 50, 100] as const

export const DEFAULT_REVIEW_PAGE_SIZE = 20

/**
 * A page size from the URL is attacker-controlled and typo-prone, so anything
 * not on the list falls back to the default rather than being clamped into
 * range: ?size=99 is a mistake, not a request for 99 rows, and honouring it
 * would put the dropdown in a state none of its options match.
 */
export function clampPageSize(raw: string | number | undefined | null): number {
  const n = Number(raw)
  return (REVIEW_PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_REVIEW_PAGE_SIZE
}

export type PageToken = number | 'gap'

/**
 * The page numbers to render: always the first and last, plus a window around
 * the current page, with 'gap' standing in for the runs between them.
 *
 * Every page cannot be listed. At 20 rows the review set is already past a
 * thousand pages, and a thousand anchors is both a wall of numbers and a real
 * payload. First/last plus a window keeps the ends reachable in one click and
 * the neighbours in easy reach; the jump box beside it covers everything else.
 */
export function pageWindow(current: number, last: number, span = 2): PageToken[] {
  const wanted = new Set<number>([1, last])
  for (let p = current - span; p <= current + span; p++) {
    if (p >= 1 && p <= last) wanted.add(p)
  }

  const out: PageToken[] = []
  let prev = 0
  for (const p of [...wanted].sort((a, b) => a - b)) {
    // A gap hiding exactly one page is a worse trade than showing it: the
    // ellipsis takes the same width as the number it replaced, and costs a
    // click.
    if (prev && p - prev === 2) out.push(prev + 1)
    else if (prev && p - prev > 2) out.push('gap')
    out.push(p)
    prev = p
  }
  return out
}

/**
 * Where to land after the page size changes.
 *
 * Resetting to page 1 is the common implementation and it is annoying: someone
 * on page 40 asking for bigger pages wants more of what they are reading, not
 * to be thrown back to the newest review. This keeps the first row currently on
 * screen on screen.
 */
export function pageAfterResize(page: number, oldSize: number, newSize: number): number {
  const firstRow = (page - 1) * oldSize
  return Math.floor(firstRow / newSize) + 1
}

/** Total pages for a result set; always at least 1, so an empty set is page 1 of 1. */
export function lastPageOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}
