# Data Model Reference

Companion to [DESIGN.md](DESIGN.md). Describes what each table holds and, more
importantly, the traps in querying it.

---

## Read this first — six things that will bite you

1. **PostgREST silently caps every response at 1000 rows.** `.limit(20000)`
   returns exactly 1000, with no error and no warning. Any aggregate built from
   one request is wrong the moment a table passes 1000 rows.
   `variant_snapshots` passes it within a fortnight. Use `selectAll()` from
   `src/lib/supabase.ts`, or query a view.
2. **Always filter `products.is_in_assortment = true`.** Broad collections leak:
   `pickleball-sale` returns bags and apparel alongside paddles. Every view in
   `0003_views.sql` already applies this — the raw tables do not.
3. **`observed_at` is when we looked, not when the price changed.** Step-fill
   between points. Linear interpolation invents prices that never existed.
4. **A gap in the series is not a stockout.** A failed run writes no snapshots at
   all, precisely so an outage cannot be misread as a catalogue-wide stockout.
   To distinguish them, join `crawl_runs` — a day with no `done` run is a day we
   did not observe.
5. **Never trust `variants.core_thickness_mm` without checking `attr_source`.**
   It is derived. `source_option` means the site stated it; `pdp` means we read
   it out of marketing prose at 0.6 confidence.
6. **One SKU can be listed on two product pages.** Selkirk publishes each family
   twice — an umbrella product carrying every shape, and a per-shape page
   repeating the same Shopify variant ids. `variants` is unique on
   `(site_id, source_variant_id)`, so the duplicates collide and an upsert whose
   batch touches one row twice is rejected outright:
   `ON CONFLICT DO UPDATE command cannot affect row a second time`.
   `src/normalize/dedupe.ts` assigns each SKU to the umbrella before any write.
   Do not "fix" this by widening the key to `(product_id, source_variant_id)` —
   that stores the AMPED Control range twice and inflates every SKU count and
   stock percentage.

---

## Layer 1 — Reference

| Table | Grain | Notes |
|---|---|---|
| `brands` | one per brand | `slug` is the CLI's `--brand` value |
| `countries` | ISO-3166-1 alpha-2 | `currency` is the default, overridable per site |
| `sites` | **(brand, country, base_url)** | The crawl target. `assortment_handles` declares which collections make up the assortment |
| `players` | one per endorsing athlete | Discovered from colourways like `Blaze Red (Ben Johns)` |
| `technologies` | brand tech dictionary | Populated by the PDP stage (phase 1b) |

## Layer 2 — Source mirror

Faithful to what the storefront publishes. Never edited by hand.

### `categories`
One row per collection **per site**. All 234 are stored, not just the assortment
ones, because a paddle entering `outlet-paddles` is itself a signal.

| Column | Notes |
|---|---|
| `category_role` | Derived. `skill_tier` \| `generation` \| `series` \| `signature` \| `sale` \| `accessory` \| `assortment` \| `sport` \| `other` |
| `nav_path` | Breadcrumb from the mega-menu, e.g. `{Pickleball,Paddles,Pro}` |
| `is_active` | False once a collection stops being published. Rows are never deleted — `first_seen_at` is history |

**The distinction that matters:** `Pro` (handle `professional-pickleball-paddles`)
is a **skill tier**. `Pro IV` (handle `pro-iv`) is a **generation**. They look
alike and mean entirely different things. `classifyCategory()` tests generation
patterns first for exactly this reason.

### `products`
One row per product **per site**. The same paddle sold in the US and Australia is
two rows — prices, availability and assortment differ per country.

| Column | Notes |
|---|---|
| `model_id` | FK to the canonical layer. Nullable: an unrecognised product is still stored |
| `is_in_assortment` | The gate. See trap #2 |
| `tags` | GIN-indexed. The richest signal this brand publishes |
| `last_seen_at` | Updated every crawl — use it to detect delisting |

**Unique key:** `(site_id, source_product_id)` — the upsert idempotency key.

### `variants`
The SKU, and the atomic unit of the time series.

Raw option values (`option1_name`/`option1_value`…) are stored verbatim so a
normalization bug is always recoverable without a re-crawl. The derived columns
beside them are the answer to "what sizes and colours exist":

| Column | Resolved from |
|---|---|
| `core_thickness_mm` | `Size`/`Thickness` option → variant title → product title → tag → PDP prose |
| `colorway`, `color_primary`, `color_secondary` | `Color` option, or the segment after ` - ` in the product title |
| `endorsed_player_id` | The parenthetical in `Blaze Red (Ben Johns)` |
| `attr_source` | jsonb map of column → which evidence won |
| `attr_confidence` | Lowest confidence across resolved attributes |

**Unique key:** `(site_id, source_variant_id)`.

## Layer 3 — Canonical

`product_lines` → `generations` → `models`. This layer exists because the source
models the same hierarchy two ways (see DESIGN.md §5) and cross-generation
questions are unanswerable without it.

`generations.sequence` orders versions: Gen 1 = 1 … Pro IV = 4, Pro V = 5, 3S = 6.
Use it for "newer than", never string comparison.

**A null `generation_id` is correct, not a failure.** Vision, Edge, Champion,
Dash and Beacon are genuinely generation-less lines. 22 of 85 products have no
generation and that is the right answer.

## Time series

### `crawl_runs`
One row per crawl. `status` is `done` \| `partial` \| `error`; **`partial` means
some stages failed but data was still written**. The diff stage only ever
compares against a `done` run, because diffing against a partial one would report
everything it failed to reach as delisted.

### `variant_snapshots`
Append-only, one row per variant per successful run. `unique (run_id, variant_id)`.

`is_on_sale` and `discount_pct` are **stored generated columns**, so
"everything over 20% off on any past date" is an index scan.

Note `compare_at_price` is nulled at write time when it equals or undercuts
`price` — Shopify repeats the price there when nothing is on sale, and storing
that verbatim would leave a misleading "was" price in the UI.

### `variant_events`
The derived change log: `listed`, `delisted`, `price_increase`, `price_decrease`,
`discount_started`, `discount_deepened`, `discount_ended`, `went_oos`,
`back_in_stock`.

Fully recomputable from `variant_snapshots`. It exists so "what changed this
week" is an index scan rather than a window function over the whole history.

---

## Reviews

Three brands, three review platforms (Bazaarvoice / Okendo / Judge.me). The
platform is carried on every row and is part of the natural key, because source
review ids collide across platforms. See `docs/REVIEWS_RESEARCH.md` for how each
API is reached.

### `reviews`
One row per customer review, ever. Upserted on
`(site_id, review_platform, source_review_id)`.

**Why upserted and not appended.** A review is not a price. Its text is written
once and rarely changes, so re-inserting it every run would multiply one
customer's opinion by the number of times we happened to look at it. The things
that *do* move — helpful counts, a brand reply arriving a week later, the
product's average — are captured elsewhere.

Four dates, and the difference matters:

| Column | Means |
|---|---|
| `submitted_at` | when the **customer** wrote it |
| `source_updated_at` | when the platform last modified it |
| `first_seen_at` | when **we** first collected it |
| `last_seen_at` | when we last confirmed it is still published |

`submitted_at` is what you plot a review-volume chart against.
`first_seen_at` is our own collection lag, and is what tells you a review
disappeared (`last_seen_at` stops advancing). Keeping both is what lets a weekly
crawl still place reviews on the day they were actually left.

`is_ratings_only` marks a star with no words — 84 of JOOLA's first 120. They
must count toward the average and must never appear as an empty card in a text
search, so every text-facing query filters on it.

`context_data` is jsonb and platform-shaped: Bazaarvoice puts Age / Gender /
LengthOfOwnership there, Okendo puts a graded questionnaire ("Right amount of
power/pop" on a labelled slider). It is deliberately not flattened into columns —
it is the raw material for sentiment and complaint analysis, and each brand asks
different questions.

`search_tsv` is a stored generated tsvector (title weighted above body) with a
GIN index, alongside a trigram index on `body`.

### `review_responses`
The reply chain. Upserted on `(review_id, response_hash)`.

Bazaarvoice returns replies as `ClientResponses[]` with **no stable id**,
Judge.me as an inline block, Okendo not at all on the endpoint we read. Since no
platform guarantees an id, the dedupe key is a sha256 of the normalised body: a
reply is edited rarely, and an edited reply is genuinely a new thing to have seen.

### `product_review_snapshots`
Append-only, one row per product per run. `unique (run_id, product_id)`.

**This is the series that answers "how is this changing over months and years."**
Star buckets are denormalised into `rating_1_count`..`rating_5_count` so a
distribution chart is one row rather than a group-by over every review ever
written.

`reported_total` is what the platform claims; `review_count` is what we hold.
They are kept apart on purpose — a truncated crawl shows up as a divergence
instead of quietly dragging the average.

`new_review_count` counts reviews whose `first_seen_run_id` is this run: the
arrival rate. It leads the average, and a product that averaged ten reviews a
week going to zero is worth knowing long before the mean moves.

### Collection strategy
Incremental by default. The first run of a product reads every page; later runs
stop once a whole page predates what we already hold, since every adapter sorts
newest-first. A **14-day overlap window** is deliberately re-read on every run,
because brand replies land days after the review (JOOLA's observed replies come
1–5 days later) and stopping dead at the newest known review would never collect
them. `npm run reviews:full` ignores the watermark entirely.

---

## Views — query these, not the tables

| View | Answers |
|---|---|
| `v_variant_current` | Current price/stock for every SKU, joined to its model. The workhorse |
| `v_model_overview` | **"How many versions, which sizes, which colours"** — one row per model with `thicknesses_mm`, `colorways`, `endorsed_players`, price band, sale count |
| `v_variant_price_daily` | Daily min/max/close per SKU. The charting source |
| `v_active_discounts` | Everything on sale now, deepest first |
| `v_category_tree` | The captured menu structure with active product counts |
| `v_recent_changes` | Change feed, newest first |
| `v_review_search` | Every review pre-joined to product, model, line, generation and brand. What `/reviews` filters and pages over |
| `v_product_reviews_current` | Latest review standing per product — count, average, star distribution, reply coverage |

### Example: the question from the brief

```sql
-- Pro paddles: versions, thicknesses, colourways, price band
select model_name, generation, thicknesses_mm, colorways,
       sku_count, price_min, price_max, skus_on_sale
from v_model_overview
where skill_tier = 'pro'
order by generation_sequence desc nulls last, model_name;
```

```sql
-- 90-day price history for one SKU
select day, price_close, discount_pct_close, was_available
from v_variant_price_daily
where variant_id = $1 and day > current_date - 90
order by day;
```

```sql
-- Every discount deeper than 20% in the last quarter
select occurred_at, product_title, variant_title, old_value, new_value, delta_pct
from v_recent_changes
where event_type in ('discount_started','discount_deepened')
  and delta_pct >= 20
  and occurred_at > now() - interval '90 days'
order by occurred_at desc;
```

```sql
-- Complaints about a specific fault, newest first, across every brand
select brand, model_name, rating, submitted_at, title, body
from v_review_search
where rating <= 3
  and body ilike '%crack%'
order by submitted_at desc;

-- Has a product's reception drifted over the last six months?
select date_trunc('week', observed_at) as week,
       max(review_count)   as reviews,
       max(average_rating) as avg_rating,
       sum(new_review_count) as arrived
from product_review_snapshots
where product_id = '<uuid>'
  and observed_at > now() - interval '6 months'
group by 1
order by 1;
```
