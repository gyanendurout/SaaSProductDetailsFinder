# Review-source research — verified live 2026-08-28

Each brand runs a different review platform. All three expose a public,
unauthenticated read endpoint that the storefront's own front-end calls. No
login, paywall or access control is bypassed; `PoliteClient` still applies
robots.txt, per-host serialisation and the configured crawl delay.

## JOOLA — Bazaarvoice

The page fingerprint is misleading: `klaviyo`, `yotpo`, `okendo` and `loox` all
appear in the HTML because Klaviyo's onsite script probes for every review app
in turn (`MetafieldYotpoRating = null`, `okendoProduct = null`, ...). The widget
that actually renders is Bazaarvoice:

    <div data-bv-show="reviews" product-id="OTIzODQ2ODkxOTUxMA==">   # base64 of the Shopify product id

Data comes from the BFD proxy, which needs no passkey — only a header that is
derivable from public config:

    GET https://apps.bazaarvoice.com/bfd/v1/clients/JOOLA/api-products/cv2/resources/data/reviews.json
        ?resource=reviews&action=REVIEWS_N_STATS
        &filter=productid:eq:<shopifyProductId>
        &include=authors,products,comments
        &filteredstats=reviews&Stats=Reviews
        &limit=20&offset=<n>&limit_comments=10
        &sort=submissiontime:desc&apiversion=5.5&displaycode=<displayCode>-en_us
    Header: bv-bfd-token: <displayCode>,<deploymentZone>,<locale>    # e.g. 21461_3_0,shopify,en_US

- Without the header: HTTP 400 `'Bv-Bfd-Token' is not sent or invalid`.
- `limit` is capped at 20 — larger values return `ERROR_PARAM_INVALID_LIMIT`.
- The payload is nested one level under `response`.
- `displayCode` is published in `.../deployments/joola/shopify/production/en_US/api-config.js`
  and in the widget's own query string.

Brand replies arrive as `ClientResponses[]` on the review:

    {"Department":"Team JOOLA","Response":"...","Date":"2026-08-24T20:34:43Z","SourceClientName":"JOOLA"}

`CommentIds` exists but was empty across the 120 reviews sampled — on this
deployment the reply chain is `ClientResponses`, not comments. Both are read.

Measured: 345 reviews on the Perseus Pro V, of which 121 carry a brand reply.

Useful extras: `ContextDataValues` carries Age / Gender / LengthOfOwnership,
`Badges.verifiedPurchaser`, `IsRatingsOnly` (star with no text — 84 of the first
120), `Photos`, `Videos`, `SecondaryRatings`.

Volume check: `TotalResults` = 345 for the Perseus Pro V alone.

## Selkirk — Okendo

    GET https://api.okendo.io/v1/stores/<subscriberId>/products/shopify-<shopifyProductId>/reviews?limit=20

No auth. `subscriberId` is in the PDP HTML (`51eb4f5f-5c6e-4e06-9280-1145c4fb7894`
for Selkirk; two other UUIDs on the page belong to other Okendo widgets and
return an empty body). Response carries `reviews[]` plus `nextUrl` for cursor
pagination.

Fields: `reviewId, rating, title, body, dateCreated, dateUpdated, reviewer.displayName,
isRecommended, isIncentivized, helpfulCount, unhelpfulCount, status, productVariantName,
variantId, media, productAttributes, attributesWithRating`.

**Pagination trap.** `nextUrl` is version-relative but root-anchored:

    /stores/<id>/products/<id>/reviews?limit=20&lastEvaluated=%7B...%7D

Both obvious readings fail quietly. Requiring an absolute URL drops the cursor,
so every product reports exactly 20 reviews — data-shaped, not error-shaped.
Resolving with `new URL(nextUrl, 'https://api.okendo.io/v1/')` anchors a
leading-slash path to the ORIGIN and discards `/v1`, and that URL answers 403.
The `/v1` prefix has to be prepended explicitly. Once fixed, one Selkirk product
paged to 2,640 reviews.

**No replies.** This endpoint returns no reply field under any name — the full
field set is above. `withReply=0` for Selkirk is the correct answer, not a
parser fault. The adapter still checks `reply` / `replies` / `comments` so a
store that enables merchant responses starts collecting without a code change.

**Structured questionnaire.** Selkirk collects graded attributes alongside the
prose, and these are the most directly useful signal on the record:

    productAttributes      "Did this paddle help improve your game" -> "Yes"
                           "What kind of player would you recommend this to?" -> ["Control or touch player"]
    attributesWithRating   "Right amount of power/pop", type 'centered-range',
                           signed value with minLabel/midLabel/maxLabel poles

Both are flattened into `reviews.context_data`. Slider values are meaningless
without their pole labels, so the labels are stored with the value.

## CRBN — Judge.me

    GET https://judge.me/reviews/reviews_for_widget
        ?url=<shopDomain>&shop_domain=<shopDomain>&platform=shopify
        &page=<n>&per_page=10&product_id=<shopifyProductId>

No auth. Returns `{html, total_count, page}` — the reviews are HTML that must be
parsed. Markers: `data-review-id`, `data-verified-buyer`, `jdgm-rev__rating[data-score]`,
`jdgm-rev__author`, `jdgm-rev__timestamp`, `jdgm-rev__title`, `jdgm-rev__body`,
and `jdgm-rev__reply` for the shop's reply.

**`per_page` is a lie above ~23.** It is accepted without error, but measured
against crbnpickleball.com both `per_page=50` and `per_page=100` rendered 23
reviews. Trusting it would silently drop 27 of every 50. The adapter uses 10 —
the widget's own value, which returns exactly 10. Verified end to end: paging at
10 across a 188-review product yielded 188 unique ids and zero duplicates.

**Empty reply containers.** `jdgm-rev__reply` is rendered on every review whether
or not the shop replied; on CRBN every one observed was empty. Reading the
container's presence as a reply would report 100% response coverage. The adapter
reduces the container to text and treats empty as no reply.

robots.txt note: judge.me disallows `/api/*`, but `/reviews/reviews_for_widget`
is not under that path and is not otherwise disallowed. bazaarvoice and okendo
serve no robots.txt.

## Verified end to end

`npm run reviews:probe` against each live site, 2026-08-28:

| Brand   | Platform     | Product sampled            | Reported | Fetched | With reply |
|---------|--------------|----------------------------|---------:|--------:|-----------:|
| JOOLA   | Bazaarvoice  | Perseus Pro V              |      345 |     345 |        121 |
| Selkirk | Okendo       | OMNI                       |        — |     384 |          0 |
| Selkirk | Okendo       | LABS Project Boomstik      |        — |   2,640 |          0 |
| CRBN    | Judge.me     | CRBN4 TruFoam Barrage      |      188 |     188 |          0 |

Okendo exposes no total, so completeness there is established by the cursor
terminating rather than by matching a reported count.
