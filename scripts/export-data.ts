/**
 * Dumps everything the dashboard can show into one JSON payload, for the
 * self-contained HTML snapshot (scripts/build-static.mjs).
 *
 * Reviews are emitted as arrays-of-values against a field list rather than as
 * objects. At 14k rows the repeated key names cost more than the data.
 */
import { writeFileSync } from 'node:fs'
import { selectAll } from '../src/lib/supabase.js'
import {
  getOverview, getBrandSummaries, getModels, getVariants, getChanges, getRuns,
} from '../src/lib/queries.js'
import { getBrandPriceComparison } from '../src/lib/price-bands.js'
import { getReviewBrandCounts, getReviewedProducts } from '../src/lib/review-queries.js'

const out = process.argv[2]
if (!out) throw new Error('usage: tsx scripts/export-data.ts <out.json>')

const REVIEW_FIELDS = [
  'product_id', 'platform', 'rating', 'rating_range', 'title', 'body', 'pros', 'cons',
  'author_name', 'author_location', 'verified', 'recommended', 'incentivized',
  'ratings_only', 'helpful', 'responses', 'photos', 'variant_label', 'submitted_at',
] as const

interface RawReview {
  product_id: string
  review_platform: string
  rating: number | null
  rating_range: number
  title: string | null
  body: string | null
  pros: string | null
  cons: string | null
  author_name: string | null
  author_location: string | null
  is_verified_buyer: boolean | null
  is_recommended: boolean | null
  is_incentivized: boolean | null
  is_ratings_only: boolean
  helpful_count: number
  unhelpful_count: number
  response_count: number
  photo_count: number
  variant_label: string | null
  submitted_at: string | null
}

const [overview, brands, models, variants, changes, runs, priceProduct, priceSku, reviewCounts, reviewProducts, reviews] =
  await Promise.all([
    getOverview(),
    getBrandSummaries(),
    getModels(),
    getVariants(),
    getChanges(5000),
    getRuns(50),
    getBrandPriceComparison('product'),
    getBrandPriceComparison('sku'),
    getReviewBrandCounts(),
    getReviewedProducts(),
    selectAll<RawReview>(
      'reviews',
      'product_id,review_platform,rating,rating_range,title,body,pros,cons,author_name,' +
        'author_location,is_verified_buyer,is_recommended,is_incentivized,is_ratings_only,' +
        'helpful_count,unhelpful_count,response_count,photo_count,variant_label,submitted_at',
    ),
  ])

// Reviews carry a product_id but no brand; the products they hang off do.
const brandOfProduct = new Map(variants.map((v) => [v.product_id, v.brand]))
const titleOfProduct = new Map(variants.map((v) => [v.product_id, v.product_title]))
for (const p of reviewProducts) {
  if (!brandOfProduct.has(p.product_id)) brandOfProduct.set(p.product_id, p.brand)
  if (!titleOfProduct.has(p.product_id)) titleOfProduct.set(p.product_id, p.product_title)
}

const rows = reviews.map((r) => [
  r.product_id, r.review_platform, r.rating === null ? null : Number(r.rating), r.rating_range,
  r.title, r.body, r.pros, r.cons, r.author_name, r.author_location,
  r.is_verified_buyer ? 1 : 0, r.is_recommended ? 1 : 0, r.is_incentivized ? 1 : 0,
  r.is_ratings_only ? 1 : 0, r.helpful_count, r.response_count, r.photo_count,
  r.variant_label, r.submitted_at,
])

const payload = {
  generatedAt: new Date().toISOString(),
  overview,
  brands,
  models,
  variants,
  changes,
  runs,
  prices: { product: priceProduct, sku: priceSku },
  reviewCounts,
  reviewProducts: reviewProducts.map((p) => ({
    ...p,
    brand: p.brand ?? brandOfProduct.get(p.product_id) ?? 'Unknown',
    product_title: p.product_title ?? titleOfProduct.get(p.product_id) ?? p.product_id,
  })),
  reviewFields: REVIEW_FIELDS,
  reviews: rows,
  productBrand: Object.fromEntries(brandOfProduct),
  productTitle: Object.fromEntries(titleOfProduct),
}

writeFileSync(out, JSON.stringify(payload))
const mb = (JSON.stringify(payload).length / 1e6).toFixed(2)
console.log(
  `wrote ${out}  ${mb} MB\n` +
    `  brands ${brands.length} | models ${models.length} | skus ${variants.length}\n` +
    `  reviews ${rows.length} | changes ${changes.length} | runs ${runs.length}\n` +
    `  reviewed products ${reviewProducts.length}`,
)
