# Database reference

> **Generated from the running project** on 2026-09-12 by `node scripts/export-schema-doc.mjs`.
> Tables, columns, types, keys and row counts are introspected live — this file cannot
> drift from the database. Column prose lives in `scripts/schema-notes.json`.

| | |
| --- | --- |
| **Supabase project** | `vbyaqzkagzhatdqitfko` |
| **Relations exposed** | 36 (26 tables, 10 views) |
| **Rows across all tables** | 26,655 |
| **Migrations on disk** | 7 |
| **Schema source of truth** | `supabase/migrations/*.sql` |
| **Writers** | `src/pipeline/stages/*.ts` |
| **Readers** | `src/lib/queries.ts`, `src/lib/review-queries.ts`, `src/lib/price-bands.ts` |

To refresh: `node scripts/export-schema-doc.mjs`

## Layers

The schema is deliberately layered: what the storefront said, then what we derived from it,
then what changed over time. The split exists because storefronts model the same physical
hierarchy inconsistently.

### Layer 1 — reference. Slow-moving facts that everything else points at.

| Table | Rows |
| --- | ---: |
| [`brands`](#brands) | 6 |
| [`countries`](#countries) | 4 |
| [`players`](#players) | 10 |
| [`sites`](#sites) | 6 |
| [`technologies`](#technologies) | 0 |

### Layer 2 — source mirror. What the storefront literally says, stored before any interpretation.

| Table | Rows |
| --- | ---: |
| [`categories`](#categories) | 834 |
| [`product_categories`](#product_categories) | 841 |
| [`product_content`](#product_content) | 0 |
| [`product_technologies`](#product_technologies) | 0 |
| [`products`](#products) | 215 |
| [`variants`](#variants) | 631 |

### Layer 3 — canonical. What we derive: the paddle hierarchy reconciled across storefronts that model it differently.

| Table | Rows |
| --- | ---: |
| [`generations`](#generations) | 8 |
| [`models`](#models) | 131 |
| [`product_lines`](#product_lines) | 53 |

### Vocabulary. Controlled value lists, referenced by foreign key so adding a brand's new word is an INSERT rather than a migration.

| Table | Rows |
| --- | ---: |
| [`category_roles`](#category_roles) | 12 |
| [`play_styles`](#play_styles) | 4 |
| [`shapes`](#shapes) | 6 |
| [`skill_tiers`](#skill_tiers) | 6 |

### Time series. Append-only history. These are the only tables that accumulate; everything else is overwritten in place each crawl.

| Table | Rows |
| --- | ---: |
| [`variant_events`](#variant_events) | 354 |
| [`variant_snapshots`](#variant_snapshots) | 1,433 |

### Reviews. Customer text, brand replies, and the per-run aggregate that makes sentiment-over-time a range scan.

| Table | Rows |
| --- | ---: |
| [`product_review_snapshots`](#product_review_snapshots) | 520 |
| [`review_responses`](#review_responses) | 777 |
| [`reviews`](#reviews) | 20,771 |

### Operations. Crawl bookkeeping — which run wrote what, and what failed.

| Table | Rows |
| --- | ---: |
| [`crawl_errors`](#crawl_errors) | 7 |
| [`crawl_runs`](#crawl_runs) | 22 |
| [`schema_migrations`](#schema_migrations) | 4 |

---

## Tables

### brands

**6 rows** · reference

One row per brand. The top of the ownership chain: a site belongs to a brand, and everything else hangs off a site.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `slug` | text | no |  |  | URL-safe identifier, e.g. `joola`. Unique. This is what `?brand=` carries in the dashboard. |
| `name` | text | no |  |  | Display name as the brand writes it, e.g. `JOOLA`. |
| `created_at` | timestamp with time zone | no |  | `now()` | When the row was inserted. |

### categories

**834 rows** · source-mirror

Collections and menu nodes as published by the site. Self-referencing, so the mega-menu tree survives intact.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `site_id` | uuid | no | → sites.id |  | Storefront this collection belongs to. |
| `source_category_id` | text | no |  |  | The platform's own id, e.g. a Shopify collection id. Unique per site. |
| `handle` | text | no |  |  | URL slug, e.g. `professional-pickleball-paddles`. |
| `title` | text | no |  |  | Display title, e.g. `Pro`. |
| `description` | text | yes |  |  | Collection blurb where published. |
| `url` | text | yes |  |  | Canonical URL. |
| `parent_id` | uuid | yes | → categories.id |  | Parent collection, for the menu tree. |
| `depth` | integer | no |  | `0` | Depth in that tree; 0 is top level. |
| `nav_path` | text[] | no |  |  | Human breadcrumb, e.g. `{Pickleball,Paddles,Pro}`. |
| `category_role` | text | no | → category_roles.code | `other` | FK to `category_roles`. Derived: what this collection *means*, which drives the UI's facet grouping. |
| `position` | integer | yes |  |  | Sort position as published. |
| `in_main_nav` | boolean | no |  | `false` | Whether it appears in the primary navigation. |
| `product_count` | integer | no |  | `0` | Count the storefront claims for this collection. |
| `first_seen_at` | timestamp with time zone | no |  | `now()` | First crawl that saw it. |
| `last_seen_at` | timestamp with time zone | no |  | `now()` | Most recent crawl that saw it. |
| `is_active` | boolean | no |  | `true` | False once the collection stops appearing. |

<details><summary>2 indexes</summary>

- `categories_site_role_idx` (site_id, category_role)
- `categories_handle_idx` (site_id, handle)

</details>

### category_roles

**12 rows** · vocabulary

Controlled list behind `categories.category_role` — what a collection means, as opposed to what it is called.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `code` | text | no | PK |  | Stored value: `sport`, `assortment`, `skill_tier`, `generation`, `series`, `signature`, `play_style`, `shape`, `material`, `sale`, `accessory`, `other`. Primary key. |
| `label` | text | no |  |  | Display label. |
| `sort_order` | integer | no |  | `100` | Presentation order. |
| `notes` | text | yes |  |  | Free text. |

### countries

**4 rows** · reference

ISO country list with a default currency, so a storefront in a new market does not invent its own code.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `code` | text | no | PK |  | ISO-3166-1 alpha-2, e.g. `US`. Primary key. |
| `name` | text | no |  |  | Display name. |
| `currency` | text | no |  |  | ISO-4217 default for the market, e.g. `USD`. A site may override it. |

### crawl_errors

**7 rows** · ops

One row per failure inside a run, so a partial crawl can be explained without reading logs.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `run_id` | uuid | no | → crawl_runs.id |  | Run that failed. |
| `stage` | text | no |  |  | Pipeline stage that raised it. |
| `target` | text | yes |  |  | The URL or handle that failed. |
| `error_type` | text | no |  | `stage_error` | `http_error` \| `parse_error` \| `timeout` \| `stage_error` \| `normalize_error` \| `db_error`. |
| `error_message` | text | yes |  |  | Detail. |
| `status_code` | integer | yes |  |  | HTTP status where the failure was a response. |
| `created_at` | timestamp with time zone | no |  | `now()` | When it was recorded. |

<details><summary>1 index</summary>

- `crawl_errors_run_idx` (run_id)

</details>

### crawl_runs

**22 rows** · ops

One row per crawl. Everything a run writes carries its `run_id`, so a bad run can be identified, explained and excluded from charts.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Run id. Stamped onto every row the run writes. |
| `site_id` | uuid | no | → sites.id |  | Storefront crawled. |
| `run_type` | text | no |  | `scheduled` | `scheduled` \| `manual` \| `backfill`. |
| `status` | text | no |  | `pending` | `pending` \| `running` \| `done` \| `partial` \| `error`. A run stuck at `running` means `finaliseRun()` was rejected. |
| `stages_requested` | text[] | no |  |  | Stages asked for. |
| `stages_done` | text[] | no |  |  | Stages that completed. The gap between the two is the pipeline-health panel. |
| `categories_found` | integer | no |  | `0` | Collections discovered. |
| `products_found` | integer | no |  | `0` | Listings discovered. |
| `products_new` | integer | no |  | `0` | Listings seen for the first time. |
| `variants_found` | integer | no |  | `0` | SKUs discovered. |
| `variants_new` | integer | no |  | `0` | SKUs seen for the first time. |
| `snapshots_written` | integer | no |  | `0` | Rows appended to `variant_snapshots`. |
| `events_written` | integer | no |  | `0` | Rows appended to `variant_events`. |
| `stats` | jsonb | no |  |  | Whole `RunStats` object. Every stat also needs a column here or the finalising update is rejected. |
| `error_message` | text | yes |  |  | Failure detail where the run did not complete. |
| `started_at` | timestamp with time zone | no |  | `now()` | Run start. |
| `finished_at` | timestamp with time zone | yes |  |  | Run end. NULL while running, or if the run never finalised. |
| `created_at` | timestamp with time zone | no |  | `now()` | Row insert time. |
| `reviews_found` | integer | no |  | `0` | Reviews fetched this run. **Counts fetched rows, not inserted ones** — it overstates when a crawl re-reads reviews it already holds. |
| `reviews_new` | integer | no |  | `0` | Reviews seen for the first time. Subject to the same overcount. |
| `review_responses_new` | integer | no |  | `0` | Brand replies seen for the first time. |

<details><summary>2 indexes</summary>

- `crawl_runs_site_started_idx` (site_id, started_at desc)
- `crawl_runs_status_idx` (status)

</details>

> `reviews_found` / `reviews_new` count what was fetched rather than what was inserted. One Selkirk run logged 13,136 against 5,777 rows actually stored.

### generations

**8 rows** · canonical

A brand's version marker — `Gen 1`, `Pro IV`, `Pro V`, `3S`. Separated from the line so `Perseus Pro V` can be compared with `Perseus Pro IV`.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `brand_id` | uuid | no | → brands.id |  | Owning brand. |
| `slug` | text | no |  |  | URL-safe identifier, e.g. `pro-v`. |
| `name` | text | no |  |  | Display name, e.g. `Pro V`. |
| `sequence` | integer | yes |  |  | Ordering for "which version is newer": Gen 1 = 1, Pro IV = 4, Pro V = 5. NULL where the brand publishes no ordering. |
| `released_at` | date | yes |  |  | Release date where known. |
| `created_at` | timestamp with time zone | no |  | `now()` | When the row was inserted. |

### models

**131 rows** · canonical

The reconciled paddle: line x generation x optional sub-line. This is the unit a person means by "a paddle", and the level at which two brands can be compared.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `brand_id` | uuid | no | → brands.id |  | Owning brand. |
| `product_line_id` | uuid | yes | → product_lines.id |  | Line this model belongs to. NULL where the line could not be resolved. |
| `generation_id` | uuid | yes | → generations.id |  | Generation marker. NULL where the line carries no generation designation. |
| `sub_line` | text | yes |  |  | Variant of the line — `Dual`, `CFS`, or NULL. |
| `slug` | text | no |  |  | URL-safe identifier, e.g. `perseus-pro-v`. Unique within the brand. |
| `name` | text | no |  |  | Display name, e.g. `Perseus Pro V`. |
| `skill_tier` | text | no | → skill_tiers.code | `unknown` | FK to `skill_tiers`. `pro` \| `performance` \| `premium` \| `recreational` \| `junior` \| `unknown`. |
| `shape` | text | no | → shapes.code | `unknown` | FK to `shapes`. **Currently `unknown` on every row** — nothing rolls the variant shapes up into it. Read `v_model_overview.shapes` (aggregated from the variants) instead. |
| `created_at` | timestamp with time zone | no |  | `now()` | When the row was inserted. |
| `updated_at` | timestamp with time zone | no |  | `now()` | Maintained by the `models_touch` trigger on every update. |
| `play_style` | text | no | → play_styles.code | `unknown` | FK to `play_styles`. `power` \| `control` \| `hybrid` \| `unknown`. Selkirk merchandises this as a first-class dimension; JOOLA does not use it at all, which is why the default is `unknown`. |

<details><summary>4 indexes</summary>

- `models_line_idx` (product_line_id)
- `models_generation_idx` (generation_id)
- `models_skill_tier_idx` (skill_tier)
- `models_play_style_idx` (play_style)

</details>

> `shape` is dead weight today: all 80 rows say `unknown`, because the value is never derived from the variants that do carry a shape. The catalogue page reads the aggregated `shapes` array from `v_model_overview` instead.

### play_styles

**4 rows** · vocabulary

Controlled list behind `models.play_style`.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `code` | text | no | PK |  | Stored value: `power`, `control`, `hybrid`, `unknown`. Primary key. |
| `label` | text | no |  |  | Display label. |
| `sort_order` | integer | no |  | `100` | Presentation order. |
| `notes` | text | yes |  |  | Free text. |

### players

**10 rows** · reference

Endorsing athletes. Colourways on some brands are named after players (`Blaze Red (Ben Johns)`), which makes the player a real analytic dimension rather than a string in a title.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `brand_id` | uuid | yes | → brands.id |  | Brand the endorsement belongs to. |
| `name` | text | no |  |  | Display name. |
| `slug` | text | no |  |  | URL-safe identifier, unique within the brand. |
| `created_at` | timestamp with time zone | no |  | `now()` | When the row was inserted. |

### product_categories

**841 rows** · source-mirror

Which collections a product sits in, over time. Carries first/last seen rather than being a plain join table, because a product entering the `Sale` collection is a signal in its own right.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `product_id` | uuid | no | PK → products.id |  | Product. Half of the composite primary key. |
| `category_id` | uuid | no | PK → categories.id |  | Collection. Other half of the composite primary key. |
| `position` | integer | yes |  |  | Merchandising position within the collection. |
| `first_seen_at` | timestamp with time zone | no |  | `now()` | First crawl that saw this membership. |
| `last_seen_at` | timestamp with time zone | no |  | `now()` | Most recent crawl that saw it. |
| `is_active` | boolean | no |  | `true` | False once the product leaves the collection. |

<details><summary>1 index</summary>

- `product_categories_category_idx` (category_id)

</details>

### product_content

**0 rows** · source-mirror

PDP-derived copy and specs, versioned by content hash so a re-crawl that changed nothing writes no row. **Empty** — the stage that fills it has never been run.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `product_id` | uuid | no | → products.id |  | Parent listing. |
| `content_hash` | character varying | no |  |  | SHA-256 of the normalised payload. Unique per product, and the mechanism that suppresses no-op rows. |
| `description` | text | yes |  |  | Long-form description text. |
| `specs` | jsonb | no |  |  | Spec table as published, e.g. `{'Core':'16mm Polypropylene'}`. |
| `technologies` | text[] | no |  |  | Technology names named on the page. |
| `media` | jsonb | no |  |  | Images and video referenced by the PDP. |
| `breadcrumb` | text[] | no |  |  | On-page breadcrumb trail. |
| `captured_at` | timestamp with time zone | no |  | `now()` | When this version was captured. |

<details><summary>1 index</summary>

- `product_content_product_idx` (product_id, captured_at desc)

</details>

### product_lines

**53 rows** · canonical

A family of paddles carried across generations — `Perseus`, `VANGUARD`, `SLK`.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `brand_id` | uuid | no | → brands.id |  | Owning brand. |
| `slug` | text | no |  |  | URL-safe identifier, e.g. `perseus`. Unique within the brand. |
| `name` | text | no |  |  | Display name, e.g. `Perseus`. |
| `description` | text | yes |  |  | Optional blurb. |
| `created_at` | timestamp with time zone | no |  | `now()` | When the row was inserted. |

### product_review_snapshots

**520 rows** · reviews

Append-only, one row per product per run. The series that answers the question the feature exists for: how a product's reception changes over months. Deliberately denormalised into star buckets so a distribution chart is one row, not a group-by over every review ever written.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | bigint | no | PK |  | bigserial surrogate key. |
| `run_id` | uuid | no | → crawl_runs.id |  | Run that wrote it. |
| `product_id` | uuid | no | → products.id |  | Listing observed. |
| `site_id` | uuid | no | → sites.id |  | Storefront, denormalised. |
| `observed_at` | timestamp with time zone | no |  | `now()` | When we looked. |
| `reported_total` | integer | yes |  |  | What the platform itself claims its total is. Kept apart from our own count so a truncated crawl is visible rather than silent. |
| `review_count` | integer | no |  | `0` | Rows we actually hold for this listing. |
| `with_text_count` | integer | no |  | `0` | Of those, how many carry words. |
| `ratings_only_count` | integer | no |  | `0` | Of those, how many are stars alone. |
| `average_rating` | numeric | yes |  |  | Mean rating across held rows. |
| `rating_1_count` | integer | no |  | `0` | One-star bucket. |
| `rating_2_count` | integer | no |  | `0` | Two-star bucket. |
| `rating_3_count` | integer | no |  | `0` | Three-star bucket. |
| `rating_4_count` | integer | no |  | `0` | Four-star bucket. |
| `rating_5_count` | integer | no |  | `0` | Five-star bucket. |
| `recommended_count` | integer | no |  | `0` | Reviewers who recommend. |
| `not_recommended_count` | integer | no |  | `0` | Reviewers who do not. |
| `verified_count` | integer | no |  | `0` | Verified buyers. |
| `with_response_count` | integer | no |  | `0` | Reviews carrying a brand reply. |
| `new_review_count` | integer | no |  | `0` | Reviews whose `first_seen_run_id` is this run — the arrival rate, which leads the average. A drop to zero on a product that averaged ten a week is worth knowing well before the average moves. |

<details><summary>3 indexes</summary>

- `product_review_snapshots_product_time_idx` (product_id, observed_at desc)
- `product_review_snapshots_site_time_idx` (site_id, observed_at desc)
- `product_review_snapshots_observed_brin_idx` using brin(observed_at)

</details>

> Summing `review_count` across this table double-counts syndicated reviews: it records the platform's number for *every* listing a review appears under. It claims 24,911 placements over 14,840 actual reviews. Use `v_review_brand_counts` / `v_review_product_counts` for counts that match what clicking a filter returns.

### product_technologies

**0 rows** · source-mirror

Which technologies a product claims, over time. **Empty**, because `technologies` is empty.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `product_id` | uuid | no | PK → products.id |  | Product. Half of the composite primary key. |
| `technology_id` | uuid | no | PK → technologies.id |  | Technology. Other half. |
| `first_seen_at` | timestamp with time zone | no |  | `now()` | First crawl that saw the claim. |
| `last_seen_at` | timestamp with time zone | no |  | `now()` | Most recent crawl that saw it. |
| `is_active` | boolean | no |  | `true` | False once the claim disappears from the product. |

### products

**215 rows** · source-mirror

One row per product per site. The same physical paddle sold in two markets is two rows — that is intentional, because price, stock and reviews differ per market.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `site_id` | uuid | no | → sites.id |  | Storefront this listing belongs to. |
| `model_id` | uuid | yes | → models.id |  | Canonical model, resolved during the normalize stage. NULL until resolution succeeds. |
| `source_product_id` | text | no |  |  | The platform's own product id. Unique per site. |
| `handle` | text | no |  |  | URL slug. |
| `title` | text | no |  |  | Listing title as published. |
| `vendor` | text | yes |  |  | Vendor field from the platform. |
| `product_type` | text | yes |  |  | Product type field from the platform. |
| `tags` | text[] | no |  |  | Platform tags. GIN-indexed; a source of derived attributes. |
| `body_html` | text | yes |  |  | Raw description HTML. |
| `url` | text | yes |  |  | Canonical product URL. |
| `image_url` | text | yes |  |  | Primary image. |
| `published_at` | timestamp with time zone | yes |  |  | Publication timestamp from the platform. |
| `source_created_at` | timestamp with time zone | yes |  |  | Creation timestamp from the platform. |
| `source_updated_at` | timestamp with time zone | yes |  |  | Last-modified timestamp from the platform. |
| `is_in_assortment` | boolean | no |  | `true` | **The assortment gate.** Accessories and apparel slip into paddle collections; every analytic query filters on this. Note it is applied in application code, not inside the views. |
| `first_seen_at` | timestamp with time zone | no |  | `now()` | First crawl that saw the listing. |
| `last_seen_at` | timestamp with time zone | no |  | `now()` | Most recent crawl that saw it. |
| `is_active` | boolean | no |  | `true` | False once the listing stops appearing. |

<details><summary>5 indexes</summary>

- `products_site_idx` (site_id)
- `products_model_idx` (model_id)
- `products_handle_idx` (site_id, handle)
- `products_tags_idx` using gin(tags)
- `products_title_trgm_idx` using gin(title gin_trgm_ops)

</details>

### review_responses

**777 rows** · reviews

The brand reply chain. No platform guarantees a stable id for a reply, so the dedupe key is a hash of the body — replies are edited rarely, and an edited reply is genuinely a new thing to have seen.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `review_id` | uuid | no | → reviews.id |  | Review being replied to. |
| `site_id` | uuid | no | → sites.id |  | Storefront, denormalised. |
| `source_response_id` | text | yes |  |  | Platform's id where it provides one. Often NULL. |
| `response_hash` | text | no |  |  | SHA-256 of the normalised body. Unique per review, and the actual dedupe key. |
| `author_name` | text | yes |  |  | Who replied. |
| `department` | text | yes |  |  | Team label, e.g. `Team JOOLA`. |
| `response_source` | text | yes |  |  | Which endpoint it came from, e.g. `mc-api`. |
| `body` | text | no |  |  | Reply text. |
| `responded_at` | timestamp with time zone | yes |  |  | When the brand replied. |
| `first_seen_at` | timestamp with time zone | no |  | `now()` | When we first saw the reply. |
| `last_seen_at` | timestamp with time zone | no |  | `now()` | Most recent crawl that saw it. |
| `first_seen_run_id` | uuid | yes | → crawl_runs.id |  | Run that first stored it. |

<details><summary>2 indexes</summary>

- `review_responses_review_idx` (review_id)
- `review_responses_site_time_idx` (site_id, responded_at desc)

</details>

> All 744 rows belong to JOOLA and Selkirk. CRBN has zero — verified against the source: all 24 CRBN products render an empty `jdgm-rev__reply` container, so the brand writes no replies at all.

### reviews

**20,771 rows** · reviews

One row per customer review, ever. Upserted on its source id rather than re-inserted per run, because a review's text is written once — but the things around it (helpful counts, brand replies) do move.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `site_id` | uuid | no | → sites.id |  | Storefront the review was left on. |
| `product_id` | uuid | no | → products.id |  | The listing it is attached to. **Exactly one**, even for a review syndicated across a paddle's twelve colourway listings — see the known limitation below. |
| `review_platform` | text | no |  |  | `bazaarvoice` \| `okendo` \| `judgeme`. Part of the natural key, because source ids collide across platforms. |
| `source_review_id` | text | no |  |  | The platform's own id. Unique within `(site_id, review_platform)`. |
| `rating` | numeric | yes |  |  | Stars. numeric, not integer, because Okendo can emit halves. |
| `rating_range` | integer | no |  | `5` | Scale maximum, default 5. |
| `title` | text | yes |  |  | Review headline. Weighted above body in the search vector. |
| `body` | text | yes |  |  | Review text. |
| `pros` | text | yes |  |  | Structured pros where the platform collects them separately. |
| `cons` | text | yes |  |  | Structured cons. |
| `author_name` | text | yes |  |  | Display name only — whatever the storefront already shows in public. |
| `author_id` | text | yes |  |  | Platform's author id. |
| `author_location` | text | yes |  |  | Free-text location. Arrives as a nested object on Okendo and is flattened on ingest. |
| `is_verified_buyer` | boolean | yes |  |  | Platform confirmed a purchase. |
| `is_recommended` | boolean | yes |  |  | Reviewer recommends the product. |
| `is_incentivized` | boolean | yes |  |  | Review was given in exchange for something. |
| `is_syndicated` | boolean | yes |  |  | Platform marked it as syndicated from elsewhere. |
| `is_ratings_only` | boolean | no |  | `false` | A star with no words. These must count toward the average but must never surface as an empty card in a text search. |
| `helpful_count` | integer | no |  | `0` | Current helpful votes, refreshed each run. |
| `unhelpful_count` | integer | no |  | `0` | Current unhelpful votes. |
| `response_count` | integer | no |  | `0` | Number of brand replies. |
| `photo_count` | integer | no |  | `0` | Attached photos. |
| `video_count` | integer | no |  | `0` | Attached videos. |
| `variant_label` | text | yes |  |  | Which SKU the reviewer bought, as the platform labels it. |
| `source_variant_id` | text | yes |  |  | Platform's variant id where given. |
| `context_data` | jsonb | no |  |  | Platform-specific structured extras kept whole rather than flattened — Bazaarvoice Age / Gender / LengthOfOwnership, secondary ratings, badges. Raw material for later sentiment work. |
| `media` | jsonb | no |  |  | Attached media descriptors. |
| `submitted_at` | timestamp with time zone | yes |  |  | **When the customer wrote it.** |
| `source_updated_at` | timestamp with time zone | yes |  |  | Last edit timestamp from the platform. |
| `first_seen_at` | timestamp with time zone | no |  | `now()` | When we first saw it. The gap from `submitted_at` is our own collection lag. |
| `last_seen_at` | timestamp with time zone | no |  | `now()` | Most recent crawl that saw it. |
| `first_seen_run_id` | uuid | yes | → crawl_runs.id |  | Run that first stored it. Drives the arrival-rate metric. |
| `last_seen_run_id` | uuid | yes | → crawl_runs.id |  | Most recent run that saw it. |
| `language_code` | text | yes |  |  | Language where the platform reports one. |
| `search_tsv` | tsvector | yes |  |  | Generated, stored tsvector. Title weighted A, body B, pros/cons C, so `cracked` in a headline outranks it in a paragraph. GIN-indexed. |

<details><summary>10 indexes</summary>

- `reviews_product_idx` (product_id)
- `reviews_site_idx` (site_id)
- `reviews_submitted_idx` (submitted_at desc nulls last)
- `reviews_rating_idx` (rating)
- `reviews_first_seen_idx` (first_seen_at desc)
- `reviews_search_idx` using gin(search_tsv)
- `reviews_body_trgm_idx` using gin(body gin_trgm_ops)
- `reviews_low_rating_idx` (site_id, submitted_at desc) where rating <= 3
- `reviews_product_rating_idx` (product_id, rating)
- `reviews_site_verified_idx` (site_id, is_verified_buyer)

</details>

> Unique on `(site_id, review_platform, source_review_id)` — `product_id` is deliberately *not* in that key, because one customer's opinion syndicated across twelve colourway listings is one opinion, not twelve.

> The consequence is the known limitation: the row can carry only one `product_id`, so filtering by any other listing the review appears under finds nothing. 26 listings hold no reviews of their own for this reason.

> A partial index on `(site_id, submitted_at desc) where rating <= 3` backs the most expensive common query, "show me the complaints".

### schema_migrations

**4 rows** · ops

Migration ledger written by `scripts/migrate.ts`.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `version` | text | no | PK |  | Migration version string. |
| `name` | text | no |  |  | Migration filename. |
| `applied_at` | timestamp with time zone | no |  | `now()` | When it was applied. |

> Holds 4 rows against 7 migration files. Migrations 0005, 0006 and 0007 were applied by hand through the Supabase SQL editor, which does not write this ledger, so it understates what the database actually has.

### shapes

**6 rows** · vocabulary

Controlled list behind `variants.shape` and `models.shape`.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `code` | text | no | PK |  | Stored value, e.g. `elongated`. Primary key. |
| `label` | text | no |  |  | Display label. |
| `sort_order` | integer | no |  | `100` | Presentation order. |
| `notes` | text | yes |  |  | Free text. |

### sites

**6 rows** · reference

One row per (brand, country) storefront. This is the crawl target, and the unit that country expansion adds rows to — the same paddle sold in the US and Australia belongs to two sites.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `brand_id` | uuid | no | → brands.id |  | Owning brand. |
| `country_code` | text | no | → countries.code |  | Market this storefront serves. |
| `base_url` | text | no |  |  | Storefront root, e.g. `https://joola.com`. |
| `platform` | text | no |  |  | `shopify` \| `woocommerce` \| `custom`. Selects the catalogue adapter. |
| `currency` | text | no |  |  | Currency this storefront prices in. |
| `locale` | text | no |  | `en-US` | Content locale, default `en-US`. |
| `assortment_handles` | text[] | no |  |  | Which source collections make up the assortment we care about. Declared in `src/config/` and mirrored here so a query can explain why a product was crawled. |
| `is_active` | boolean | no |  | `true` | Excluded from scheduled crawls when false. |
| `crawl_delay_ms` | integer | no |  | `1200` | Politeness delay between requests. Raised where robots.txt asks for it. |
| `notes` | text | yes |  |  | Free text for whoever onboarded the site. |
| `created_at` | timestamp with time zone | no |  | `now()` | When the row was inserted. |
| `review_platform` | text | yes |  |  | `bazaarvoice` \| `okendo` \| `judgeme` \| null. Selects the review adapter. A NULL here is why a brand silently collects zero reviews. |
| `review_config` | jsonb | no |  |  | Credentials the review adapter needs — Bazaarvoice client and displayCode, Okendo subscriberId, Judge.me shop domain. Config, not schema, so brand #4 stays a config change. |

### skill_tiers

**6 rows** · vocabulary

Controlled list behind `models.skill_tier`. Replaced a CHECK constraint so a brand shipping an unfamiliar tier word is an INSERT over the REST API, not a migration a human has to paste into a dashboard.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `code` | text | no | PK |  | Stored value, e.g. `pro`. Primary key, referenced by FK. |
| `label` | text | no |  |  | Display label, e.g. `Pro`. |
| `sort_order` | integer | no |  | `100` | Presentation order. `unknown` sorts last at 900. |
| `notes` | text | yes |  |  | Free text. |

### technologies

**0 rows** · reference

Brand technology dictionary — `Carbon Friction Surface`, `Propulsion Core`. Currently empty: the PDP stage that would populate it has never run.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `brand_id` | uuid | no | → brands.id |  | Owning brand. |
| `name` | text | no |  |  | Marketing name as published. |
| `slug` | text | no |  |  | URL-safe identifier, unique within the brand. |
| `description` | text | yes |  |  | Long-form explanation where the brand publishes one. |
| `first_seen_at` | timestamp with time zone | no |  | `now()` | First crawl that saw this technology named. |

### variant_events

**354 rows** · timeseries

The derived change log, written by the diff stage by comparing a run against the previous successful one. Everything here is recomputable from `variant_snapshots`; it exists so "what changed" needs no window functions over the full history.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | bigint | no | PK |  | bigserial surrogate key. |
| `run_id` | uuid | no | → crawl_runs.id |  | Run that detected the change. |
| `variant_id` | uuid | no | → variants.id |  | SKU that changed. |
| `site_id` | uuid | no | → sites.id |  | Storefront, denormalised. |
| `event_type` | text | no |  |  | `listed`, `delisted`, `price_increase`, `price_decrease`, `discount_started`, `discount_deepened`, `discount_ended`, `went_oos`, `back_in_stock`, `category_added`, `category_removed`. |
| `occurred_at` | timestamp with time zone | no |  | `now()` | When the transition was observed. |
| `old_value` | text | yes |  |  | Prior value, as text. |
| `new_value` | text | yes |  |  | New value, as text. |
| `delta_numeric` | numeric | yes |  |  | Signed price delta where relevant. |
| `delta_pct` | numeric | yes |  |  | Percentage delta where relevant. |
| `context` | jsonb | no |  |  | Extra detail for the event type. |
| `created_at` | timestamp with time zone | no |  | `now()` | Row insert time. |

<details><summary>3 indexes</summary>

- `variant_events_variant_time_idx` (variant_id, occurred_at desc)
- `variant_events_site_time_idx` (site_id, occurred_at desc)
- `variant_events_type_time_idx` (event_type, occurred_at desc)

</details>

> Only 1 row exists: a change needs two observations to sit between, and the crawl has not run often enough to produce more.

### variant_snapshots

**1,433 rows** · timeseries

Append-only. One row per SKU per successful run — the table the whole project exists for. A failed run writes no snapshots, so a site outage can never be mistaken for a catalogue-wide stockout.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | bigint | no | PK |  | bigserial surrogate key. |
| `run_id` | uuid | no | → crawl_runs.id |  | Run that wrote it. |
| `variant_id` | uuid | no | → variants.id |  | SKU observed. |
| `site_id` | uuid | no | → sites.id |  | Storefront, denormalised so site-wide range scans need no join. |
| `observed_at` | timestamp with time zone | no |  | `now()` | **When we looked — not when the price changed.** Charts must step-interpolate between points, never linearly interpolate. |
| `price` | numeric | yes |  |  | Selling price at that moment. |
| `compare_at_price` | numeric | yes |  |  | Struck-through reference price, where the storefront publishes one. |
| `currency` | text | no |  |  | Currency of both prices. |
| `is_on_sale` | boolean | yes |  |  | Generated, stored: `compare_at_price > price`, both non-null. |
| `discount_pct` | numeric | yes |  |  | Generated, stored: percentage off, rounded to 2dp, else 0. Stored so "everything over 20% off on any past date" is an index scan rather than a scan plus arithmetic. |
| `is_available` | boolean | yes |  |  | In stock at that moment. NULL where the storefront does not say. |
| `inventory_quantity` | integer | yes |  |  | Units on hand. NULL when not exposed, which is most of the time. |
| `position_in_category` | integer | yes |  |  | Merchandising position within the primary collection. Movement here is an early signal of a push or a wind-down. |

<details><summary>4 indexes</summary>

- `variant_snapshots_variant_time_idx` (variant_id, observed_at desc)
- `variant_snapshots_site_time_idx` (site_id, observed_at desc)
- `variant_snapshots_observed_brin_idx` using brin(observed_at)
- `variant_snapshots_on_sale_idx` (observed_at desc) where is_on_sale

</details>

> Unique on `(run_id, variant_id)`, which guards against double-writing a SKU inside one run.

> Indexed with BRIN on `observed_at` — tiny, and the right shape for an append-only time-ordered column.

> Sizing note from the migration: at roughly 10M rows this should become a monthly-partitioned table. Only the pipeline and the views read it directly, so that stays a contained change.

### variants

**631 rows** · source-mirror

The SKU — the atomic unit of the price and stock time series. Raw option values are kept exactly as the source gave them, so a normalization bug is always recoverable without a re-crawl.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | uuid | no | PK | `gen_random_uuid()` | Surrogate key. |
| `product_id` | uuid | no | → products.id |  | Parent listing. |
| `site_id` | uuid | no | → sites.id |  | Storefront, denormalised so snapshots can filter without a join. |
| `source_variant_id` | text | no |  |  | The platform's own variant id. Unique per site. |
| `sku` | text | yes |  |  | Retailer SKU where published. |
| `barcode` | text | yes |  |  | Barcode where published. |
| `title` | text | yes |  |  | Variant title as published, e.g. `16mm / Blaze Red (Ben Johns)`. |
| `position` | integer | yes |  |  | Sort position within the product. |
| `image_url` | text | yes |  |  | Variant-specific image. |
| `option1_name` | text | yes |  |  | Raw option label as the source gave it, e.g. `Thickness`. |
| `option1_value` | text | yes |  |  | Raw option value, e.g. `16mm`. |
| `option2_name` | text | yes |  |  | Raw option label. |
| `option2_value` | text | yes |  |  | Raw option value. |
| `option3_name` | text | yes |  |  | Raw option label. |
| `option3_value` | text | yes |  |  | Raw option value. |
| `core_thickness_mm` | numeric | yes |  |  | Derived. Core thickness, e.g. 14.0 or 16.0. |
| `colorway` | text | yes |  |  | Derived. Colourway name, e.g. `Blaze Red`. |
| `color_primary` | text | yes |  |  | Derived. Primary colour where separable. |
| `color_secondary` | text | yes |  |  | Derived. Secondary colour where separable. |
| `endorsed_player_id` | uuid | yes | → players.id |  | Derived. FK to `players` when the colourway is named after an athlete. |
| `weight_grams` | numeric | yes |  |  | Derived. Published weight. |
| `grip_length_mm` | numeric | yes |  |  | Derived. Published grip length. |
| `paddle_length_mm` | numeric | yes |  |  | Derived. Published paddle length. |
| `paddle_width_mm` | numeric | yes |  |  | Derived. Published paddle width. |
| `shape` | text | yes | → shapes.code |  | Derived. FK to `shapes`. This is the field that actually carries shape data — the model-level column does not. |
| `attr_source` | jsonb | no |  |  | Which input won for each derived attribute, e.g. `{"core_thickness_mm":"title"}`. Candidates are option value, title, tag, collection, PDP, LLM or manual. |
| `attr_confidence` | numeric | yes |  |  | 0.00-1.00, the lowest confidence across the derived attributes on this row. |
| `attributes` | jsonb | no |  |  | Long-tail specs that do not deserve a column of their own. |
| `first_seen_at` | timestamp with time zone | no |  | `now()` | First crawl that saw the SKU. |
| `last_seen_at` | timestamp with time zone | no |  | `now()` | Most recent crawl that saw it. |
| `is_active` | boolean | no |  | `true` | False once the SKU stops appearing. |

<details><summary>5 indexes</summary>

- `variants_product_idx` (product_id)
- `variants_site_idx` (site_id)
- `variants_sku_idx` (sku)
- `variants_thickness_idx` (core_thickness_mm)
- `variants_player_idx` (endorsed_player_id)

</details>

---

## Views

The frontend should query these, never the raw tables — they keep the "latest snapshot per
variant" and "never linearly interpolate" rules in one place instead of in every component.
Views store no data.

### v_active_discounts

**154 rows**

Every in-assortment SKU currently on sale, deepest discount first.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `brand` | text | yes |  |  |  |
| `brand_slug` | text | yes |  |  |  |
| `country_code` | text | yes | → countries.code |  |  |
| `product_line` | text | yes |  |  |  |
| `generation` | text | yes |  |  |  |
| `model_name` | text | yes |  |  |  |
| `product_title` | text | yes |  |  |  |
| `variant_title` | text | yes |  |  |  |
| `sku` | text | yes |  |  |  |
| `core_thickness_mm` | numeric | yes |  |  |  |
| `colorway` | text | yes |  |  |  |
| `price` | numeric | yes |  |  |  |
| `compare_at_price` | numeric | yes |  |  |  |
| `discount_pct` | numeric | yes |  |  |  |
| `currency` | text | yes |  |  |  |
| `is_available` | boolean | yes |  |  |  |
| `product_url` | text | yes |  |  |  |
| `observed_at` | timestamp with time zone | yes |  |  |  |

> Filters on `is_on_sale and is_in_assortment`; ordered by `discount_pct desc`.

### v_category_tree

**834 rows**

The collection tree with parent titles and active product counts resolved.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `category_id` | uuid | yes | PK |  |  |
| `site_id` | uuid | yes | → sites.id |  |  |
| `brand` | text | yes |  |  |  |
| `country_code` | text | yes | → countries.code |  |  |
| `handle` | text | yes |  |  |  |
| `title` | text | yes |  |  |  |
| `category_role` | text | yes | → category_roles.code |  |  |
| `depth` | integer | yes |  |  |  |
| `nav_path` | text[] | yes |  |  |  |
| `in_main_nav` | boolean | yes |  |  |  |
| `parent_id` | uuid | yes | → categories.id |  |  |
| `parent_title` | text | yes |  |  |  |
| `active_products` | bigint | yes |  |  | Count of active `product_categories` rows for the collection. |
| `is_active` | boolean | yes |  |  |  |

### v_model_overview

**124 rows**

One row per model with its SKUs rolled up — the catalogue table's source.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `model_id` | uuid | yes | PK |  |  |
| `brand` | text | yes |  |  |  |
| `brand_slug` | text | yes |  |  |  |
| `product_line` | text | yes |  |  |  |
| `generation` | text | yes |  |  |  |
| `generation_sequence` | integer | yes |  |  |  |
| `model_name` | text | yes |  |  |  |
| `skill_tier` | text | yes | → skill_tiers.code |  |  |
| `play_style` | text | yes | → play_styles.code |  |  |
| `shape` | text | yes | → shapes.code |  |  |
| `sku_count` | bigint | yes |  |  | Distinct in-assortment SKUs. |
| `thicknesses_mm` | numeric[] | yes |  |  | Distinct non-null core thicknesses. |
| `colorways` | text[] | yes |  |  | Distinct non-null colourways. |
| `shapes` | text[] | yes |  |  | Distinct variant shapes excluding `unknown`. **This is the real shape data** — `models.shape` is `unknown` everywhere. |
| `endorsed_players` | text[] | yes |  |  | Distinct endorsing athletes. |
| `price_min` | numeric | yes |  |  | Lowest current price across the model's SKUs. |
| `price_max` | numeric | yes |  |  | Highest current price. |
| `skus_in_stock` | bigint | yes |  |  | SKUs currently available. |
| `skus_on_sale` | bigint | yes |  |  | SKUs currently discounted. |
| `best_discount_pct` | numeric | yes |  |  | Deepest current discount. |
| `currency` | text | yes |  |  |  |
| `country_code` | text | yes | → countries.code |  |  |

> Filters `where vc.is_in_assortment`, so it returns 76 of the 80 rows in `models`.

### v_product_reviews_current

**215 rows**

Latest review standing per product: the aggregate shown next to price on catalogue and model pages.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `product_id` | uuid | yes | PK |  |  |
| `product_title` | text | yes |  |  |  |
| `handle` | text | yes |  |  |  |
| `model_id` | uuid | yes | → models.id |  |  |
| `site_id` | uuid | yes | PK |  |  |
| `brand` | text | yes |  |  |  |
| `brand_slug` | text | yes |  |  |  |
| `observed_at` | timestamp with time zone | yes |  |  |  |
| `reported_total` | integer | yes |  |  |  |
| `review_count` | integer | yes |  |  |  |
| `with_text_count` | integer | yes |  |  |  |
| `average_rating` | numeric | yes |  |  |  |
| `rating_1_count` | integer | yes |  |  |  |
| `rating_2_count` | integer | yes |  |  |  |
| `rating_3_count` | integer | yes |  |  |  |
| `rating_4_count` | integer | yes |  |  |  |
| `rating_5_count` | integer | yes |  |  |  |
| `recommended_count` | integer | yes |  |  |  |
| `not_recommended_count` | integer | yes |  |  |  |
| `verified_count` | integer | yes |  |  |  |
| `with_response_count` | integer | yes |  |  |  |
| `new_review_count` | integer | yes |  |  |  |

> 142 rows — one per *product*, including the 42 that have no snapshot (LEFT JOIN LATERAL), so it is not a list of products that have reviews.

### v_recent_changes

**354 rows**

The change feed — `variant_events` joined to the names a reader needs, newest first. Carries `brand_slug` so the dashboard can scope without a join.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `id` | bigint | yes | PK |  |  |
| `event_type` | text | yes |  |  |  |
| `occurred_at` | timestamp with time zone | yes |  |  |  |
| `old_value` | text | yes |  |  |  |
| `new_value` | text | yes |  |  |  |
| `delta_numeric` | numeric | yes |  |  |  |
| `delta_pct` | numeric | yes |  |  |  |
| `sku` | text | yes |  |  |  |
| `variant_title` | text | yes |  |  |  |
| `core_thickness_mm` | numeric | yes |  |  |  |
| `colorway` | text | yes |  |  |  |
| `product_title` | text | yes |  |  |  |
| `product_url` | text | yes |  |  |  |
| `model_name` | text | yes |  |  |  |
| `skill_tier` | text | yes | → skill_tiers.code |  |  |
| `brand` | text | yes |  |  |  |
| `brand_slug` | text | yes |  |  |  |
| `country_code` | text | yes | → countries.code |  |  |

### v_review_brand_counts

**6 rows**

One row per brand, counting distinct stored reviews — the number behind each brand chip.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `brand` | text | yes |  |  |  |
| `brand_slug` | text | yes |  |  |  |
| `review_count` | bigint | yes |  |  |  |
| `with_text_count` | bigint | yes |  |  |  |
| `verified_count` | bigint | yes |  |  |  |
| `average_rating` | numeric | yes |  |  |  |

> CRBN 6,202 · Selkirk 6,161 · JOOLA 2,477, summing to the 14,840 rows in `reviews`.

### v_review_product_counts

**169 rows**

One row per product that genuinely has reviews stored against it. Counts the `reviews` table itself rather than the snapshots.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `product_id` | uuid | yes | → products.id |  |  |
| `product_title` | text | yes |  |  |  |
| `product_handle` | text | yes |  |  |  |
| `site_id` | uuid | yes | PK |  |  |
| `brand` | text | yes |  |  |  |
| `brand_slug` | text | yes |  |  |  |
| `review_count` | bigint | yes |  |  | Rows held for the product. |
| `with_text_count` | bigint | yes |  |  | Of those, not ratings-only. |
| `verified_count` | bigint | yes |  |  | Verified buyers. |
| `average_rating` | numeric | yes |  |  | Mean rating. |
| `latest_review_at` | timestamp with time zone | yes |  |  | Most recent `submitted_at`. |

> 100 rows, against 126 listings that the snapshots claimed had reviews. The 26 missing are the syndication casualties.

> Added by migration 0007 to make a filter chip's number and the result of clicking it the same number.

### v_review_search

**20,771 rows**

One row per review, pre-joined to everything the search page filters on, so the UI never fans out joins per row.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `review_id` | uuid | yes | PK |  |  |
| `review_platform` | text | yes |  |  |  |
| `source_review_id` | text | yes |  |  |  |
| `rating` | numeric | yes |  |  |  |
| `rating_range` | integer | yes |  |  |  |
| `title` | text | yes |  |  |  |
| `body` | text | yes |  |  |  |
| `pros` | text | yes |  |  |  |
| `cons` | text | yes |  |  |  |
| `author_name` | text | yes |  |  |  |
| `author_location` | text | yes |  |  |  |
| `is_verified_buyer` | boolean | yes |  |  |  |
| `is_recommended` | boolean | yes |  |  |  |
| `is_incentivized` | boolean | yes |  |  |  |
| `is_ratings_only` | boolean | yes |  |  |  |
| `helpful_count` | integer | yes |  |  |  |
| `unhelpful_count` | integer | yes |  |  |  |
| `response_count` | integer | yes |  |  |  |
| `photo_count` | integer | yes |  |  |  |
| `variant_label` | text | yes |  |  |  |
| `context_data` | jsonb | yes |  |  |  |
| `media` | jsonb | yes |  |  |  |
| `submitted_at` | timestamp with time zone | yes |  |  |  |
| `first_seen_at` | timestamp with time zone | yes |  |  |  |
| `last_seen_at` | timestamp with time zone | yes |  |  |  |
| `product_id` | uuid | yes | PK |  |  |
| `product_title` | text | yes |  |  |  |
| `product_handle` | text | yes |  |  |  |
| `product_url` | text | yes |  |  |  |
| `product_image_url` | text | yes |  |  |  |
| `is_in_assortment` | boolean | yes |  |  |  |
| `model_id` | uuid | yes | PK |  |  |
| `model_name` | text | yes |  |  |  |
| `skill_tier` | text | yes | → skill_tiers.code |  |  |
| `play_style` | text | yes | → play_styles.code |  |  |
| `product_line` | text | yes |  |  |  |
| `generation` | text | yes |  |  |  |
| `site_id` | uuid | yes | PK |  |  |
| `country_code` | text | yes | → countries.code |  |  |
| `brand` | text | yes |  |  |  |
| `brand_slug` | text | yes |  |  |  |

> 14,840 rows — one per review, no duplication.

### v_variant_current

**631 rows**

Current state of every SKU: the newest snapshot joined through to the canonical model. The workhorse for catalogue browsing.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `variant_id` | uuid | yes | PK |  |  |
| `sku` | text | yes |  |  |  |
| `variant_title` | text | yes |  |  |  |
| `core_thickness_mm` | numeric | yes |  |  |  |
| `colorway` | text | yes |  |  |  |
| `weight_grams` | numeric | yes |  |  |  |
| `variant_shape` | text | yes | → shapes.code |  |  |
| `attr_confidence` | numeric | yes |  |  |  |
| `endorsed_player` | text | yes |  |  |  |
| `product_id` | uuid | yes | PK |  |  |
| `product_title` | text | yes |  |  |  |
| `handle` | text | yes |  |  |  |
| `product_url` | text | yes |  |  |  |
| `image_url` | text | yes |  |  |  |
| `tags` | text[] | yes |  |  |  |
| `is_in_assortment` | boolean | yes |  |  |  |
| `model_id` | uuid | yes | PK |  |  |
| `model_name` | text | yes |  |  |  |
| `skill_tier` | text | yes | → skill_tiers.code |  |  |
| `play_style` | text | yes | → play_styles.code |  |  |
| `model_shape` | text | yes | → shapes.code |  |  |
| `product_line` | text | yes |  |  |  |
| `generation` | text | yes |  |  |  |
| `generation_sequence` | integer | yes |  |  |  |
| `site_id` | uuid | yes | PK |  |  |
| `brand` | text | yes |  |  |  |
| `brand_slug` | text | yes |  |  |  |
| `country_code` | text | yes | → countries.code |  |  |
| `observed_at` | timestamp with time zone | yes |  |  | From the newest `variant_snapshots` row for the SKU, via a LATERAL join. |
| `price` | numeric | yes |  |  | Newest snapshot price. |
| `compare_at_price` | numeric | yes |  |  |  |
| `currency` | text | yes |  |  |  |
| `is_on_sale` | boolean | yes |  |  | Newest snapshot's generated sale flag. |
| `discount_pct` | numeric | yes |  |  | Newest snapshot's generated discount. |
| `is_available` | boolean | yes |  |  |  |
| `inventory_quantity` | integer | yes |  |  |  |
| `is_active` | boolean | yes |  |  |  |

> Returns all 361 SKUs. It does **not** apply the `is_in_assortment` gate — application code does that ([queries.ts:161](../src/lib/queries.ts#L161)), which is why the dashboard shows 346.

### v_variant_price_daily

**975 rows**

Daily OHLC-style rollup of the price series, one row per SKU per UTC day.

| Column | Type | Null | Key | Default | Description |
| --- | --- | --- | --- | --- | --- |
| `variant_id` | uuid | yes | → variants.id |  |  |
| `site_id` | uuid | yes | → sites.id |  |  |
| `day` | date | yes |  |  | `observed_at` cast to a UTC date. |
| `price_min` | numeric | yes |  |  | Lowest price seen that day. |
| `price_max` | numeric | yes |  |  | Highest price seen that day. |
| `price_close` | numeric | yes |  |  | Last price observed that day. |
| `compare_at_close` | numeric | yes |  |  | Last compare-at price that day. |
| `discount_pct_close` | numeric | yes |  |  | Last discount that day. |
| `was_on_sale` | boolean | yes |  |  | True if on sale at any point that day. |
| `was_available` | boolean | yes |  |  | True if in stock at any point that day. |
| `was_always_available` | boolean | yes |  |  | True only if in stock at every observation that day. |
| `observations` | bigint | yes |  |  | How many times we looked that day. |
| `currency` | text | yes |  |  |  |

---

## Access control

Row-level security is enabled on every table and is **deny-by-default**. The ingest and the
dashboard both read with the `service_role` key, which bypasses RLS entirely; the anon key
can read nothing, which is what makes it safe to ship to a browser.

`reviews`, `review_responses` and `product_review_snapshots` additionally carry permissive
`for select using (true)` read policies.

## Known issues

These are real and recorded here rather than in a ticket nobody reads.

1. **Syndicated reviews attach to one listing only.** `reviews` is unique on
   `(site_id, review_platform, source_review_id)` — deliberately excluding `product_id`, so
   one opinion syndicated across twelve colourways is one row. The consequence is that the
   row carries a single `product_id`, and 26 listings therefore hold no reviews of their own.
   The fix is a `review_products` join table: one link row per (review, product), after which
   `reviews.product_id` can be dropped. Schema change plus pipeline change plus re-crawl.
2. **`models.shape` is `unknown` on every row.** Nothing rolls variant shapes up into it. Read
   `v_model_overview.shapes` instead, which aggregates from `variants.shape`.
3. **`crawl_runs.reviews_found` / `reviews_new` count fetched rows, not inserted ones.** One
   Selkirk run logged 13,136 against 5,777 actually stored.
4. **`schema_migrations` understates what is applied** — 4 rows against 7 migration files,
   because 0005-0007 were pasted into the Supabase SQL editor, which does not write the ledger.
5. **`product_content`, `technologies` and `product_technologies` are empty.** The PDP stage
   that would populate them has never been run.
