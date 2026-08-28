# Product Finder — Design & Decision Record

**Status:** Phase 1 design locked · 2026-08-27
**Scope of phase 1:** JOOLA · United States · pickleball paddles — catalog, taxonomy,
models/versions/sizes/colours, SKUs, specs, and daily price / discount / stock history.

---

## 1. Understanding Summary

- **What:** a multi-brand, multi-country product intelligence system. Given a brand and a
  product assortment, it crawls that brand's storefront and reconstructs the *complete*
  product hierarchy — categories, model families, generations, thicknesses, colourways,
  SKUs, specs and technologies — then re-crawls on a schedule so price, discount and
  stock movements accumulate into a trend history.
- **Why:** a point-in-time scrape answers "what does JOOLA sell today". The value is in
  the *delta*: which SKU dropped 20% on which date, what went out of stock before a
  tournament, when Pro V replaced Pro IV on the Pro shelf. That only exists if you start
  recording now.
- **Who:** internal brand/market analysts. Not a public site.
- **First target:** `joola.com` (US). Verified Shopify with open JSON endpoints.
- **Brands tracked (all US, USD):** JOOLA, Selkirk (`selkirk.com`) and CRBN
  (`crbnpickleball.com`). Each was added without a schema change — see the
  multi-brand decisions in §3 and the onboarding steps in the README.
- **Non-goals (phase 1):** reviews/ratings ingest, retailer sources (Amazon, Dick's,
  Pickleball Central), non-US countries, non-paddle assortments. All are *designed for*
  but not built.

## 2. Assumptions

| # | Assumption | Risk if wrong |
|---|---|---|
| A1 | Other countries are **separate domains** (no `/en-in/` market paths — verified 404) | Low. `sites` keys on (brand, country, base_url); a market-path site is just a different base_url |
| A2 | Public Shopify JSON endpoints stay open and unauthenticated | Medium. The adapter seam lets a Playwright fallback replace the transport with no schema change |
| A3 | Daily cadence is enough to see the trends that matter | Low. Cadence is config, not code |
| A4 | Prices are stored in the site's native currency, never converted | Low, and deliberate — FX conversion at read time keeps history honest |
| A5 | "Product assortment" = a set of source collections, declared per site in config | Low |

## 3. Decision Log

| Decision | Alternatives considered | Why |
|---|---|---|
| **New repo + brand-new Supabase project** | Extend `SaaS_Joola_pulse`; share its Supabase | User choice. Zero risk to the running 22k-review pipeline. Cost: cross-DB joins to reviews need an export in phase 2 |
| **TypeScript ingest** | Python (matches the existing backend) | One language with the Next.js frontend; types generated from Postgres; trivial GitHub Actions and Vercel deploy |
| **Shopify JSON first, Playwright second** | Playwright for everything | JSON gives exact SKUs, prices, `compare_at_price` and `available` with no DOM fragility. Playwright is reserved for what JSON genuinely lacks: the mega-menu tree and PDP spec/technology blocks |
| **Variant (SKU) is the atomic unit of time series** | Snapshot at product level | Price and stock differ per SKU. 16mm Ben Johns can be out of stock while 14mm is not. Product-level history averages the signal away |
| **Append-only `variant_snapshots`, one row per variant per run** | Change-only rows (SCD-2) | 116 variants/day is about 42k rows/year. Simplicity wins overwhelmingly at this size. Change-only saves ~90% of rows and costs correctness bugs at every read. Revisit past ~10M rows (monthly partitioning noted in the migration) |
| **Derived `variant_events` change-log alongside snapshots** | Window functions at read time | Alerts and "what changed this week" are the primary UI. Precomputing at write time makes those queries trivial and lets the diff logic be tested once |
| **Normalization layer separate from source tables** | Trust Shopify's structure | *The core insight.* Shopify models the same physical hierarchy two different ways on this one site: Pro V uses variant options (`Size`, `Color`), Pro IV uses one product per thickness+colourway with the values in the title. A schema that trusts the source cannot compare a Pro IV 16mm to a Pro V 16mm. So `products`/`variants` mirror the source faithfully, and `models`/`product_lines`/`generations` form the canonical layer the UI queries |
| **Rules first, LLM fallback** | LLM for all attribute extraction | Rules are deterministic, free and testable, and JOOLA's naming is regular enough that rules cover most of it. The LLM handles the residue, and every extraction records `attr_source` so you can always see which produced a value |
| **`sites` keyed on (brand, country)** | One row per brand | Country expansion is the stated roadmap. Prices, assortment and availability are all per-country |

### Decisions from multi-brand expansion (Selkirk, CRBN)

| Decision | Alternatives considered | Why |
|---|---|---|
| **Brand vocabulary in reference tables, not CHECK constraints** | Keep CHECKs and widen them per brand | A CHECK hardcodes one brand's vocabulary into the schema, so a brand shipping an unseen shape needs DDL — which cannot travel over PostgREST and therefore needs a human pasting SQL into a dashboard. Reference tables plus foreign keys keep the same integrity but make adding a value an `INSERT`. CRBN's `square` proved it: a new shape, no migration. Migration `20260827000005` |
| **`src/config/` is the source of truth for brands and sites; `npm run sync` pushes it** | Seed brands in migrations | A brand is data, not schema. Seeding it in SQL is what made every new brand *look* like it needed a migration. Sync upserts on natural keys and runs before every crawl, so the files and the database cannot drift. Onboarding is now: a rules file, a site entry, one command |
| **Brand knowledge as `BrandRules` data; the resolver stays generic** | Branch on brand inside the resolver | Three brands, three grammars: JOOLA numbers generations, Selkirk names shapes after models, CRBN numbers shapes. Nothing generalises except the shape of the rules themselves |
| **One SKU listed twice belongs to the umbrella product** | Widen the unique key to `(product_id, source_variant_id)` | Selkirk publishes each family twice — an umbrella carrying every shape, plus per-shape pages repeating the same variant ids. Widening the key stores the range twice and inflates every SKU count and stock percentage. Assigning to the umbrella yields one model with a shapes array, matching how JOOLA's Pro V already behaves. `src/normalize/dedupe.ts` |
| **Model name = the title with noise removed, in the title's own order** | Assemble from line + sub-line + generation slots | Slot assembly discards anything the title says beyond those slots. It suited JOOLA, whose titles *are* `JOOLA <line> <generation>`, and collapsed SLK Latitude, Nexus and Atlas into one row called "SLK Max" — Max being a shape they share. It also reordered words. Line, sub-line and generation remain separate structured fields for filtering |
| **Blank `Accept-Language` on every request** | Send `en-US`; send nothing | Node's fetch sends `Accept-Language: *` by default. Shopify reads it to select a market and returns another market's prices **in that market's currency, with no currency field in the JSON**. On crbnpickleball.com a $223.99 paddle came back as `21800.00`. Any value triggers it, `en-US` included; only a blank header matches curl and yields the primary market. `src/lib/http.ts` |
| **A run whose median price moves >5× writes nothing** | Log a warning and store anyway | A snapshot cannot be corrected later. A gap in the series is visible; a silent change of units is not, and it corrupts every trend drawn through it. The band is deliberately wide so a 60% markdown passes. `src/pipeline/price-guard.ts` |
| **Collection membership is an assortment signal, below the non-paddle title check** | Tags and title only | Selkirk's `SLK OMEGA Hybrid Air` has no tags and no "paddle" in its title; only its shelf says what it is. Four real paddles were being dropped. Placed *below* the title check because sale shelves (`paddle-markdowns`) match the paddle pattern while containing bags |
| **Merchandise title beats a paddle tag** | Trust the tags | `JOOLA 3s Keychain` carries `pickleball-paddles` and was counted as six paddle SKUs |
| **Fold typography before any pattern reads a title** | Match superscripts directly | CRBN writes shapes as superscripts (`CRBN¹`..`CRBN⁴`, U+00B9–U+2074). `/\d/` does not match them and `slugify` deletes them, so all four shapes collided on one model key. `src/normalize/text.ts` |
| **A control character in source fails the test suite** | Careful review | The same escape bug reached this codebase three times: a regex `\b` written through a script that processes escapes becomes U+0008. It compiles, tests pass, and the regex can never match. Each occurrence cost real debugging. `test/source-hygiene.test.ts`, written with numeric char codes so the guard cannot be corrupted the same way |

## 4. Architecture

```
        ┌──────────── ingest (TypeScript · runs local or in CI) ─────────────┐
        │                                                                    │
joola ─►│  1 nav        Playwright  → mega-menu tree                         │
  .com  │  2 catalog    JSON        → collections, products, variants        │
        │  3 pdp        JSON + PW   → specs, technologies, media             │
        │  4 normalize  rules+LLM   → product_line / generation / model      │
        │  5 snapshot               → variant_snapshots  (append-only)       │
        │  6 diff                   → variant_events     (price/stock deltas)│
        └────────────────────────────────┬───────────────────────────────────┘
                                         ▼
                                 Supabase (Postgres)
                                         ▼
                             Next.js dashboard (phase 1b)
```

Each stage is independently retryable and idempotent. A stage failure is recorded in
`crawl_errors`, the run ends `partial`, and later stages that can still run, do.

### Source adapter seam

`SourceAdapter` is the extension point for brand #2. Adding Selkirk (also Shopify) is a
config row. Adding a non-Shopify brand means one new adapter implementing the same
interface — no schema change, no pipeline change.

## 5. Data Model

Three layers, deliberately separated:

**Layer 1 — Reference:** `brands`, `countries`, `sites`, `technologies`, `players`

**Layer 2 — Source mirror** (what the site literally says, per site):
`categories`, `products`, `variants`, `product_categories`, `product_content`

**Layer 3 — Canonical** (what we derive, brand-wide and country-agnostic):
`product_lines`, `generations`, `models`, plus the derived attribute columns on
`variants` (`core_thickness_mm`, `colorway`, `shape`, `skill_tier`, `endorsed_player_id`).

**Time series:** `crawl_runs`, `crawl_errors`, `variant_snapshots`, `variant_events`.

Full column reference: [DATA_MODEL.md](DATA_MODEL.md).

### Why the canonical layer earns its place

A question asked directly in the brief — *"inside the pro paddle, how many versions are
there, what sizes, what colours"* — is not answerable from Shopify's own structure:

```
Perseus Pro V   → 1 product,  4 variants   (Size × Color options)
Perseus Pro IV  → 6 products, 1 variant each (thickness + colour live in the title)
```

Both are "Perseus". After normalization both resolve to `product_line = Perseus`, and
"what thicknesses exist for Perseus?" becomes one query instead of a title-parsing
exercise repeated in every frontend component.

## 6. Time-Series Semantics

- `variant_snapshots.observed_at` is when *we looked*, not when the price changed. Charts
  use it as the x-axis; step interpolation between points is correct, linear is not.
- A variant missing from a run is recorded as a `delisted` event rather than a gap, so
  "out of stock" and "we didn't crawl" stay distinguishable.
- A failed run writes **no** snapshots, precisely so that a site outage never looks like a
  catalogue-wide stockout.
- `discount_pct` is a stored generated column, so "everything over 20% off on any past
  date" is an index scan rather than a table scan with arithmetic.

## 7. Politeness & Legal Posture

Only public, unauthenticated endpoints are used. `robots.txt` is fetched and honoured,
requests are throttled and serialised per host behind a descriptive User-Agent, and no
login, paywall or access control is bypassed. This mirrors the posture already established
in the Joola Pulse pipeline.

## 8. Open Questions (not blocking phase 1)

1. Which domains serve India / Vietnam / Australia? Needed before country #2.
2. Should retailer prices (Pickleball Central, Amazon) enter *this* system, or stay in
   Joola Pulse? Affects whether `sites` grows a `retailer` role.
3. Review trends per SKU — export from the existing Supabase, or re-ingest here?
