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
  {
    id: 'local-sixzero-us',
    brand_id: 'local-sixzero',
    brand_slug: 'sixzero',
    brand_name: 'Six Zero',
    country_code: 'US',
    // NOT www.sixzeropickleball.com. That is a separate Shopify store —
    // Bokarina, Queensland, AUD (verified via /meta.json, store id
    // 66773483824) — and crawling it would file Australian dollars as USD.
    // The US store is its own shop (id 86121185565, Oxnard California, USD),
    // reachable at us.sixzeropickleball.com; sixzeropickleball.us resolves to
    // the same store.
    base_url: 'https://us.sixzeropickleball.com',
    platform: 'shopify',
    currency: 'USD',
    crawl_delay_ms: 1500,
    notes:
      'Shopify, Oxnard CA, USD. Separate store from the AU parent — do not crawl the .com. ' +
      'Gemstone naming (Opal, Coral, Ruby, Sapphire, Quartz, Black Diamond); line names are ' +
      'multi-word and prefix-sensitive, so Double Black Diamond must match before Black Diamond. ' +
      'Shape is a real variant option, as on Selkirk. Thickness appears both in the title and as ' +
      'an option and the two disagree in places; the option wins. ' +
      'Reviews are Judge.me, but this shop answers the widget endpoint with the newer structured ' +
      'JSON ({reviews[], pagination}) rather than the rendered HTML that CRBN and Paddletek ' +
      'return. The adapter handles both.',
    review_platform: 'judgeme',
    review_config: { shopDomain: 'us.sixzeropickleball.com' },
    assortment_handles: [
      'paddles',
      'all-paddles-warranty-registration',
    ],
  },
  {
    id: 'local-paddletek-us',
    brand_id: 'local-paddletek',
    brand_slug: 'paddletek',
    brand_name: 'Paddletek',
    country_code: 'US',
    base_url: 'https://www.paddletek.com',
    platform: 'shopify',
    currency: 'USD',
    crawl_delay_ms: 1500,
    notes:
      'Shopify, Chicago IL, USD. The cleanest naming grammar of the six: line (Bantam, Phoenix, ' +
      'Tempest, Honeyfoam, The Reserve) plus a model code (TKO-C, EX-L Pro, Wave Pro-C). Suffix ' +
      'letters are construction, not version — -C is carbon — so they stay in the model name. ' +
      'Core thickness is a variant option published to one decimal (12.7mm / 14.3mm, being 1/2" ' +
      'and 9/16"); nothing else in this set uses decimal thicknesses. ' +
      'Reviews are Judge.me, legacy rendered-HTML widget response.',
    review_platform: 'judgeme',
    review_config: { shopDomain: 'www.paddletek.com' },
    assortment_handles: [
      'all-paddles',
      'paddles',
      'all-carbon-paddles',
      'custom-paddles',
    ],
  },
  {
    id: 'local-gamma-us',
    brand_id: 'local-gamma',
    brand_slug: 'gamma',
    brand_name: 'GAMMA',
    country_code: 'US',
    base_url: 'https://gammasports.com',
    platform: 'shopify',
    currency: 'USD',
    crawl_delay_ms: 1500,
    notes:
      'Shopify, Pittsburgh PA, USD. The only multi-sport store in this set: of 237 products just ' +
      '12 are pickleball paddles, the rest being tennis string, stringing machines, padel rackets ' +
      'and court equipment. The assortment gate is therefore load-bearing rather than a ' +
      'formality — product_type is exactly "Pickleball Paddle" on the twelve, and the collections ' +
      'below are paddle-only. Two of the twelve are bundles (Rainmaker Bundle, Airbender 16 ' +
      'Deluxe Box Set) rather than single paddles. ' +
      'The numeral in a title is core thickness in mm (Airbender 10/13/16/22) and is written ' +
      'bare, with no mm suffix, so the shared attribute parser will not read it. ' +
      'Reviews are Yotpo — a fourth platform, read through the public widget API. The appKey is ' +
      'public deployment config, printed on every page in the loader URL ' +
      '(cdn-widgetsrepository.yotpo.com/v1/loader/<appKey>), not a credential.',
    review_platform: 'yotpo',
    review_config: { appKey: 'inZs4rbtVunQxdMq27e7cEj537ojrO1e8NGMAurh' },
    assortment_handles: [
      'pickleball-paddles',
      'core-series',
      'airbender',
      'fusion',
      'all-court-paddles',
      'control-paddles',
      'best-sellers-paddles',
      'fusion-power-rainmaker-paddles',
      // sale shelves
      'blem-paddle-sale',
      '25-off-select-performance-paddles',
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
