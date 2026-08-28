import { NextResponse } from 'next/server'
import { crawl } from '../../../pipeline/run.js'

/**
 * On-demand crawl trigger for the Pipeline page.
 *
 * Runs the crawl to completion and returns its outcome — roughly 35 seconds for
 * JOOLA US, most of it the deliberate 1.2s politeness delay between requests.
 * Awaiting rather than backgrounding is intentional: serverless platforms kill
 * work that continues after the response is sent, which would silently lose the
 * run.
 *
 * The scheduled path is separate and unaffected — see .github/workflows/crawl.yml
 * and scripts/crawl.ps1.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request): Promise<NextResponse> {
  // If a token is configured, require it. Without one the endpoint is open to
  // anyone who can reach the site, which is fine locally and not fine deployed.
  const expected = process.env['CRAWL_TRIGGER_TOKEN']
  if (expected) {
    const provided =
      request.headers.get('x-crawl-token') ??
      new URL(request.url).searchParams.get('token')
    if (provided !== expected) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      brand?: string
      country?: string
    }

    const outcomes = await crawl({
      brandSlug: body.brand,
      countryCode: body.country,
      runType: 'manual',
    })

    const worst = outcomes.some((o) => o.status === 'error')
      ? 'error'
      : outcomes.some((o) => o.status === 'partial')
        ? 'partial'
        : 'done'

    return NextResponse.json({ status: worst, outcomes })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ status: 'error', error: message }, { status: 500 })
  }
}
