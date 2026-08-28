/**
 * Validates a brand's review adapter against the live storefront, writing nothing
 * and touching no database.
 *
 *   npm run reviews:probe                    every configured brand
 *   npm run reviews:probe -- --brand joola
 *   npm run reviews:probe -- --brand selkirk --products 5 --show 3
 *
 * This is the tool for onboarding a brand's review platform, and the one that
 * settles the questions the HTML cannot: which of a page's three Okendo UUIDs is
 * the store subscriber, whether a Bazaarvoice displayCode is still current, and
 * whether replies actually come back on the chain we think they do.
 *
 * It reads the storefront catalogue directly rather than the products table, so
 * it works before any migration has been applied.
 */
import 'dotenv/config'
import { PoliteClient } from '../src/lib/http.js'
import { ShopifyAdapter } from '../src/sources/shopify/adapter.js'
import { buildReviewAdapter } from '../src/sources/reviews/index.js'
import { localSites } from '../src/config/sites.js'
import { createLogger } from '../src/lib/logger.js'

const log = createLogger('probe')

interface Options {
  brand?: string
  products: number
  show: number
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const sites = localSites(options.brand)
  if (sites.length === 0) throw new Error(`no site configured for brand "${options.brand}"`)

  for (const site of sites) {
    const line = '='.repeat(72)
    process.stdout.write(`\n${line}\n${site.brand_name} — ${site.base_url}\n${line}\n`)

    if (!site.review_platform) {
      process.stdout.write('  no review_platform configured; skipping\n')
      continue
    }

    const http = new PoliteClient(site.crawl_delay_ms)
    const reviewAdapter = buildReviewAdapter(site.review_platform, http)
    if (!reviewAdapter) continue
    process.stdout.write(`  platform: ${reviewAdapter.platform}\n`)

    // A short assortment slice is enough to prove the wiring; the goal is a
    // verdict in a minute, not a full crawl.
    const catalogue = new ShopifyAdapter(http)
    const products = (
      await catalogue.fetchProducts({
        siteId: site.id,
        baseUrl: site.base_url,
        currency: site.currency,
        assortmentHandles: site.assortment_handles.slice(0, 1),
      })
    ).slice(0, options.products)

    let grandTotal = 0
    let grandReplies = 0

    for (const product of products) {
      try {
        const result = await reviewAdapter.fetchProductReviews(
          { siteId: site.id, baseUrl: site.base_url, config: site.review_config ?? {} },
          product.sourceProductId,
          null,
        )
        const withText = result.reviews.filter((r) => !r.isRatingsOnly)
        const withReply = result.reviews.filter((r) => r.responses.length > 0)
        const rated = result.reviews.filter((r) => r.rating !== null)
        const avg =
          rated.length > 0
            ? (rated.reduce((n, r) => n + (r.rating ?? 0), 0) / rated.length).toFixed(2)
            : 'n/a'

        grandTotal += result.reviews.length
        grandReplies += withReply.length

        process.stdout.write(
          `\n  ${product.title}\n` +
            `    reported=${result.reportedTotal ?? '?'} fetched=${result.reviews.length}` +
            ` withText=${withText.length} ratingsOnly=${result.reviews.length - withText.length}` +
            ` withReply=${withReply.length} avg=${avg}\n`,
        )

        // Completeness check. This is the assertion that matters: a paginator
        // that silently stops early looks exactly like a product with fewer
        // reviews.
        if (result.reportedTotal !== null && result.reviews.length !== result.reportedTotal) {
          process.stdout.write(
            `    !! MISMATCH: fetched ${result.reviews.length} of ${result.reportedTotal}\n`,
          )
        }
        const ids = new Set(result.reviews.map((r) => r.sourceReviewId))
        if (ids.size !== result.reviews.length) {
          process.stdout.write(
            `    !! DUPLICATES: ${result.reviews.length - ids.size} repeated review ids\n`,
          )
        }

        for (const review of withText.slice(0, options.show)) {
          process.stdout.write(
            `\n      [${review.rating}/${review.ratingRange}] ${review.title ?? '(no title)'}` +
              ` — ${review.authorName ?? 'anonymous'}` +
              `${review.isVerifiedBuyer ? ' (verified)' : ''}` +
              `  ${review.submittedAt?.slice(0, 10) ?? '?'}\n` +
              `      ${truncate(review.body ?? '', 160)}\n`,
          )
          for (const response of review.responses) {
            process.stdout.write(
              `        REPLY${response.department ? ` from ${response.department}` : ''}` +
                `${response.respondedAt ? ` ${response.respondedAt.slice(0, 10)}` : ''}: ` +
                `${truncate(response.body, 140)}\n`,
            )
          }
          const context = Object.entries(review.contextData).filter(([k]) => !k.startsWith('_'))
          if (context.length > 0) {
            process.stdout.write(
              `        context: ${context.map(([k, v]) => `${k}=${String(v)}`).join(' ')}\n`,
            )
          }
        }
      } catch (err) {
        process.stdout.write(
          `\n  ${product.title}\n    FAILED: ${err instanceof Error ? err.message : String(err)}\n`,
        )
      }
    }

    process.stdout.write(
      `\n  TOTAL across ${products.length} product(s): ${grandTotal} reviews, ${grandReplies} with a brand reply\n`,
    )
  }
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}...` : flat
}

function parseArgs(args: string[]): Options {
  const options: Options = { products: 2, show: 2 }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--brand') options.brand = args[++i]
    else if (args[i] === '--products') options.products = Number(args[++i]) || 2
    else if (args[i] === '--show') options.show = Number(args[++i]) || 2
  }
  return options
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 2
})
