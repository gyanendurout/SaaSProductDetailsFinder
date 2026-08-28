import type { SiteRow } from '../pipeline/context.js'

/**
 * Storefront definitions — the single source of truth for which sites exist.
 *
 * `npm run sync` upserts these into the `sites` table over the REST API, and a
 * crawl syncs before it starts, so this file and the database cannot drift.
 * They are also what `--dry-run` uses, which is how a new brand's normalization
 * can be validated against the live site before anything is written.
 *
 * Adding a brand: a rules file in ./brands, an entry here, then
 * `npm run crawl -- --brand <slug>`. No migration, no SQL.
 */
export const LOCAL_SITES: SiteRow[] = [
  {
    id: 'local-joola-us',
    brand_id: 'local-joola',
    brand_slug: 'joola',
    brand_name: 'JOOLA',
    country_code: 'US',
    base_url: 'https://joola.com',
    platform: 'shopify',
    currency: 'USD',
    crawl_delay_ms: 1200,
    notes:
      'Shopify. Public /collections.json and /collections/<handle>/products.json verified open. ' +
      'Strong generation vocabulary (Gen 1 -> Pro IV -> Pro V -> 3S). Pro V uses variant options ' +
      'while Pro IV ships one product per thickness and colourway. ' +
      'Reviews are Bazaarvoice, NOT Klaviyo: the page mentions Klaviyo, Yotpo, Okendo and Loox ' +
      'only because the Klaviyo onsite script probes every review app in turn and finds them all null.',
    review_platform: 'bazaarvoice',
    // displayCode is public deployment config, published in
    // apps.bazaarvoice.com/deployments/joola/shopify/production/en_US/api-config.js
    // and repeated in the widget's own query string. Not a credential.
    review_config: {
      client: 'JOOLA',
      displayCode: '21461_3_0',
      deploymentZone: 'shopify',
      locale: 'en_US',
    },
    assortment_handles: [
      'pickleball-paddles',
      'professional-pickleball-paddles',
      'pickleball-paddles-performance',
      'recreational-pickleball-paddles',
      'pickleball-paddles-premium',
      'junior-paddles',
      'individual-paddles',
      'joola-3s',
      'gen-1',
      'pro-iv',
      'pro-v',
      'perseus-3s',
      'ben-johns-paddles',
      'outlet-paddles',
      'pickleball-sale',
    ],
  },
  {
    id: 'local-selkirk-us',
    brand_id: 'local-selkirk',
    brand_slug: 'selkirk',
    brand_name: 'Selkirk',
    country_code: 'US',
    base_url: 'https://www.selkirk.com',
    platform: 'shopify',
    currency: 'USD',
    crawl_delay_ms: 1200,
    notes:
      'Shopify. Public JSON endpoints verified open. Shape, Color and Weight are real variant ' +
      'options here, unlike JOOLA. No generation vocabulary — versions are named lines ' +
      '(VANGUARD, LUXX, AMPED, SLK). Core thickness is not published in the catalogue feed. ' +
      'Reviews are Okendo.',
    review_platform: 'okendo',
    // Public store id, printed in the PDP HTML. The page carries three Okendo
    // UUIDs; the other two belong to other widgets and return an empty body.
    review_config: { subscriberId: '51eb4f5f-5c6e-4e06-9280-1145c4fb7894' },
    assortment_handles: [
      'pickleball-paddles',
      // skill tiers, in Selkirk's own vocabulary
      'beginner-paddles',
      'intermediate-paddles',
      'advanced-paddles',
      // play style — a dimension JOOLA does not merchandise
      'control',
      'advanced-pro-control-pickleball-paddles',
      'advanced-pro-power-pickleball-paddles',
      'advanced-pro-hybrid-pickleball-paddles',
      'intermediate-control-pickleball-paddles',
      'intermediate-power-pickleball-paddles',
      'intermediate-hybrid-pickleball-paddles',
      'control-pickleball-paddles-for-beginners',
      'pickleball-power-paddles-for-beginners',
      'hybrid-paddles-for-beginners',
      // lines and editions
      'amped',
      'amped-control',
      'amped-pro-air',
      'luxx-control',
      'luxx-control-air',
      'power-air',
      'epic-paddles',
      'invikta-paddles',
      'max-paddles',
      'new-slk-paddles',
      'project-boomstik',
      'everglade-paddles',
      // shape
      'elongated-pickleball-paddles',
      'edgeless-pickleball-paddles',
      'long-handle-pickleball-paddles',
      // sale shelves
      'paddle-markdowns',
      'pickleball-paddle-deals',
      'pickleball-paddles-under-100',
    ],
  },
  {
    id: 'local-crbn-us',
    brand_id: 'local-crbn',
    brand_slug: 'crbn',
    brand_name: 'CRBN',
    country_code: 'US',
    base_url: 'https://crbnpickleball.com',
    platform: 'shopify',
    currency: 'USD',
    crawl_delay_ms: 1500,
    notes:
      'Shopify, Costa Mesa CA, primary market USD (confirmed via /meta.json). ' +
      'Shapes are numbered in superscript (CRBN¹..CRBN⁴) and are the shape, not a ' +
      'version; series are TruFoam / X Series / Classic. Publishes no skill tier and ' +
      'no play style. Thickness IS published, as a 12/14/16MM option. ' +
      'Multi-market store: any Accept-Language header returns another market’s ' +
      'currency, which is why the crawler sends a blank one. ' +
      'Reviews are Judge.me, read as rendered HTML rather than JSON.',
    review_platform: 'judgeme',
    review_config: { shopDomain: 'crbnpickleball.com' },
    assortment_handles: [
      'crbn-best-pickleball-paddles',
      'pickleball-paddles',
      // series
      'crbn-trufoam-foam-pickleball-paddles',
      'crbn-power-series-pickleball-paddles',
      'crbn-original-series-pickleball-paddles',
      // shape shelves — these are how CRBN merchandises, and how the numbered
      // shapes are confirmed independently of the title
      'crbn-1-shape',
      'crbn-2-shape',
      'crbn-3-shape',
      'crbn-4-shape',
      'elongated-paddles',
      'hybrid-paddles',
      'square-paddles',
      'paddles-with-long-handles',
      'aerocurve',
      // discounts. 'new-pickleball-paddles-and-gear' is deliberately absent:
      // it is half apparel, and the assortment gate would carry the cost of
      // rejecting it on every run for no paddle we do not already have.
      'sale',
    ],
  },
]

export function localSites(brandSlug?: string, countryCode?: string): SiteRow[] {
  return LOCAL_SITES.filter(
    (s) =>
      (!brandSlug || s.brand_slug === brandSlug.toLowerCase()) &&
      (!countryCode || s.country_code === countryCode.toUpperCase()),
  )
}
