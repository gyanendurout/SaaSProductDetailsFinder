import { NextResponse, type NextRequest } from 'next/server'
import { getFacetCounts } from '../../../lib/review-queries.js'
import { parseReviewFilter, type RawReviewParams } from '../../../lib/review-facets.js'
import { createLogger } from '../../../lib/logger.js'

export const dynamic = 'force-dynamic'

const log = createLogger('api/review-brand-counts')

/**
 * What each brand in the rail would return under the filters that are on.
 *
 * This exists because of where the rail lives. Brand scope is part of the shell,
 * rendered by the root layout — and a layout in the App Router is not given the
 * page's search params, by design: it does not re-render when they change. So
 * the count beside each brand was whatever the whole corpus held, and stayed
 * there while someone filtered to one-star reviews of one paddle.
 *
 * The rail is already a client component (it reads the URL to know what is
 * selected), so it asks here instead, and shows no number at all until the
 * answer arrives. A missing number is honest for the half-second it is missing.
 * A stale one is not — it reads as a promise about what clicking will do.
 *
 * Brand is deliberately NOT part of the answer's scope: switching brand replaces
 * it, so each brand is counted as if it were the selected one.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = Object.fromEntries(request.nextUrl.searchParams) as RawReviewParams
  const filter = parseReviewFilter(params, undefined)

  try {
    const counts = await getFacetCounts(filter)
    // Null means nothing narrowing is applied, so the rail's own totals are
    // already correct and it should keep them.
    if (!counts) return NextResponse.json({ scoped: false, counts: {} })

    return NextResponse.json({
      scoped: true,
      counts: Object.fromEntries(counts.byBrand),
    })
  } catch (error) {
    log.warn('brand facet counts failed', {
      message: error instanceof Error ? error.message.slice(0, 160) : String(error),
    })
    // 200 with scoped:false, not a 5xx. The rail treats this as "keep the
    // unscoped totals", which is the same thing it does before any filter is
    // applied — a failed side query must not put an error state in the shell.
    return NextResponse.json({ scoped: false, counts: {} })
  }
}
