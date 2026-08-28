# Product Finder

Crawls a brand's storefront, reconstructs its full product hierarchy — categories,
model families, generations, thicknesses, colourways, SKUs — and records price,
discount and stock **history** so trends accumulate over time.

Phase 1 target: **JOOLA · United States · pickleball paddles**.
Built to add countries (India, Vietnam, Australia) and brands as config, not code.

**Verified against joola.com:** 234 collections · 85 paddle products · 129 SKUs.

---

## Quick start

### 1. Try the scraper with no database

Works immediately — no Supabase needed. Fetches the live catalogue and prints
what the normalizer resolved.

```bash
npm install
npm run crawl:dry
```

Expected output:

```
dry-run: product lines  {"Perseus":19,"Hyperion":18,"Scorpeus":14,"Agassi":13,...}
dry-run: generations    {"Pro IV":36,"(unresolved)":22,"Pro V":12,"3S":12,"Gen 1":2}
dry-run: skill tiers    {"pro":58,"recreational":10,"performance":9,"unknown":7}
dry-run: thicknesses    {"16mm":63,"14mm":36,"10mm":12,"(none)":8,"12mm":4}
```

`(unresolved)` generations are correct — Vision, Edge, Champion, Dash and Beacon
are genuinely generation-less lines.

### 2. Create the database

Create a Supabase project, then apply the schema by **one** of these routes.

**A — script (no CLI login needed).** Put the direct connection URI in `.env` as
`SUPABASE_DB_URL` (Settings → Database → Connection string → URI), then:

```bash
npm run migrate:dry   # list what would be applied
npm run migrate       # apply; records each version in schema_migrations
```

Each migration runs in its own transaction, so a failure rolls back cleanly and
re-running is safe.

**B — Supabase CLI.** Requires being logged in as an account that owns the project:

```bash
supabase login
supabase link --project-ref <your-ref>
supabase db push
```

**C — dashboard.** Paste `supabase/schema.sql` (all migrations concatenated, in
order) into the SQL editor and run once.

Then set the API credentials in `.env`:

```bash
cp .env.example .env
# SUPABASE_URL                = https://<ref>.supabase.co
# SUPABASE_SERVICE_ROLE_KEY   = the SECRET key (sb_secret_... or legacy service_role)
```

> The **publishable**/anon key will not work for ingest. RLS is enabled
> deny-by-default in `..._rls_and_seed.sql`, so only the service-role identity can
> read or write. Keep the secret key out of git — `.env` is already ignored.

Confirm the seed landed:

```bash
npm run sites
# JOOLA      US  https://joola.com  shopify  15 collections
```

### 3. First real crawl

```bash
npm run crawl
npm run report
```

The first run is the baseline — it writes snapshots but no change events,
because there is nothing to compare against. From the second run onward,
`variant_events` fills with price moves, discounts and stock changes.

### 4. Schedule it

The history only exists if this runs regularly. A missed day is a permanent hole.

**Local (Windows Task Scheduler)** — registration block is in the script header:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\crawl.ps1
```

**CI (GitHub Actions)** — `.github/workflows/crawl.yml` runs daily at 09:00 UTC.
Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as repository secrets.
Preferred once the repo is pushed: it does not depend on your PC being on.

---

## The dashboard

```bash
npm run dev      # http://localhost:3000
npm run build && npm run start
```

| Page | Shows |
|---|---|
| `/` | KPIs, deepest discounts, recent movement, Pro tier by generation |
| `/catalogue` | Every model, filterable by tier / generation / line |
| `/models/[id]` | Versions, thicknesses, colourways, athletes, SKU table, price history |
| `/reviews` | **Every review, searchable** — full text, star filter, complaints-only, verified-only, brand-replied-only, with the reply chain inline |
| `/discounts` | Everything on promotion, deepest first |
| `/changes` | The derived change log |
| `/pipeline` | Run history, errors, and a **Run crawl now** button |

Pages are server components reading Supabase with the service-role key. The
browser never talks to Supabase directly, so RLS stays deny-by-default and the
secret key never reaches the client.

The price chart is hand-rolled SVG on purpose. Charting libraries interpolate
linearly, which would draw a smooth slide between two observations and imply
prices that never existed. `observed_at` is when we looked, so the only honest
render is a step.

### Before management sees it

- **The site has no authentication.** Anyone with the URL sees your pricing
  intelligence. Put it behind Vercel password protection, Cloudflare Access, or
  an auth layer before sharing the link outside the team.
- **Set `CRAWL_TRIGGER_TOKEN`** once deployed, or `POST /api/crawl` is open to
  anyone who finds it.
- The crawl button awaits the full run (~35s, mostly the polite request delay).
  On a serverless host raise the function timeout, or rely on the scheduled path
  and treat the button as a local convenience.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dashboard |
| `npm run crawl` | Crawl every active site |
| `npm run crawl -- --brand joola --country US` | One site |
| `npm run crawl:dry` | Fetch and normalize, write nothing |
| `npm run crawl -- --stages catalog,snapshot` | Selected stages |
| `npm run reviews` | Reviews only, incremental |
| `npm run reviews:full` | Reviews only, re-reading every page |
| `npm run reviews:probe` | Validate a brand's review adapter against the live site — writes nothing, needs no database |
| `npm run sites` | List configured sites |
| `npm run sync` | Push `src/config/` brands + storefronts into the database |
| `npm run sync:dry` | Show what sync would write |
| `npm run schema` | Regenerate `supabase/schema.sql` from `supabase/migrations/` |
| `npm run report` | Last runs, model overview, recent changes |
| `npm test` | Normalizer unit tests |
| `npm run typecheck` | `tsc --noEmit` |

Exit codes: `0` clean · `1` partial (some stages failed, data written) · `2` error.

---

## How it works

```
1 categories   /collections.json          → taxonomy, classified by role
2 catalog      /collections/<h>/products.json → products, SKUs, canonical models
3 snapshot                                 → variant_snapshots (append-only)
4 diff         vs previous done run        → variant_events
5 reviews      each brand's review API     → reviews, review_responses,
                                             product_review_snapshots
```

Stages are independently retryable. A failure is recorded in `crawl_errors`, the
run ends `partial`, and later stages that can still run, do.

Snapshot is skipped if catalog failed — a snapshot built from a failed fetch
would read as a catalogue-wide stockout, and better a gap in the series than a
lie in it. Reviews runs last because it is the longest stage and nothing depends
on it.

### The hard part

joola.com models the same physical hierarchy two different ways:

```
Perseus Pro V   1 product,  4 variants    options: Size=[16mm,14mm], Color=[...]
Perseus Pro IV  6 products, 1 variant     thickness + colour live in the TITLE
```

So "what thicknesses does Perseus come in" cannot be answered from the source
structure. `src/normalize/` resolves every SKU's attributes from whichever
evidence exists — option value, then title, then tag, then collection, then PDP
prose — and records which one won in `variants.attr_source`. The canonical
`models` / `product_lines` / `generations` tables are what the UI queries.

---

## Known issue, fixed: "JWT issued at future"

The dashboard used to 500 on the first request after a cold start, then work fine.
Worth recording, because the cause was not where it looked:

- Not the clock — measured skew against Supabase is under a second.
- Not Supabase — 40 direct REST calls and 5 cold Node processes running the same
  client and query all succeeded.
- It reproduced **only under Next.js**, and only for roughly the first two
  seconds, which was long enough to exhaust retries.

Next replaces `globalThis.fetch` with its own caching wrapper. `src/lib/supabase.ts`
now hands the Supabase client undici's `fetch` directly, taking that wrapper out
of the path. Five consecutive cold starts and a 60-request soak came back clean
with no retries needed.

Two defences remain in place regardless, since the next flaky dependency will not
announce itself either:

- `src/lib/retry.ts` retries genuinely transient failures with exponential
  backoff, and deliberately does **not** retry real errors like a bad column or an
  RLS denial — those should fail loudly.
- `src/app/error.tsx` catches whatever still gets through, so a viewer sees a
  page with a retry button instead of Next's bare "Application error".

## Layout

```
docs/DESIGN.md              understanding lock, decision log, architecture
docs/DATA_MODEL.md          column reference + query traps  ← read before writing SQL
supabase/migrations/        schema, in order
src/sources/                SourceAdapter seam; shopify/ is the first implementation
src/normalize/              attributes, taxonomy, model resolution, assortment gate
src/pipeline/               orchestrator + stages
test/                       normalizer unit tests
```

## Adding a brand or country

**No SQL.** Four steps, all in TypeScript:

1. `src/config/brands/<slug>.ts` — the brand's vocabulary: product lines,
   athletes, generation rules, and how its own tier/shape/play-style words map
   onto the shared ones. Selkirk says "advanced" where JOOLA says
   "professional"; both resolve to the `pro` tier, which is what makes
   cross-brand comparison honest.
2. Register it in `src/config/brands/index.ts`.
3. Add the storefront to `src/config/sites.ts` — `base_url`, platform, currency
   and the collection handles to crawl.
4. `npm run crawl -- --brand <slug>`.

Step 4 syncs the config into the database before it crawls, so the `brands`,
`sites`, `product_lines`, `players` and `generations` rows are created for you.
Every write is an upsert on a natural key, which is why the config files and the
database cannot drift: the files win, every run.

Validate the normalization before writing anything with
`npm run crawl:dry -- --brand <slug>` — it reads the live site and prints what
each rule resolved.

Different platform? Implement `SourceAdapter` in `src/sources/` and register it
in `buildAdapter()`. No schema or pipeline change.

### Why this needed a migration once

Vocabulary used to live in `CHECK` constraints, so a brand shipping an unseen
shape meant a schema change — DDL, which cannot travel over the REST API and
therefore needs a human pasting SQL into the dashboard. Migration
`20260827000005` replaced those constraints with reference tables
(`skill_tiers`, `shapes`, `play_styles`, `category_roles`) and foreign keys.
Integrity is unchanged — an unknown value is still rejected — but adding one is
now an `INSERT`, which `sync` does on its own. That was the last migration
brand onboarding will need.

Prices are stored in each site's native currency and never converted, so history
stays honest — convert at read time if you need a cross-country comparison.

## Reviews

Every review each storefront publishes: the star, the text, the author, the
demographics the platform attaches, and **the brand's reply**.

The three brands run three different review apps, which is why this is a second
adapter seam rather than part of the Shopify adapter:

| Brand | Platform | Reached by | Replies |
|---|---|---|---|
| JOOLA | Bazaarvoice | passkey-free BFD proxy plus a derivable `bv-bfd-token` header | `ClientResponses[]` — 121 of 345 on one product |
| Selkirk | Okendo | public store API, cursor pagination | none on this endpoint |
| CRBN | Judge.me | public widget endpoint, returns HTML | inline reply block |

> JOOLA's pages mention Klaviyo, Yotpo, Okendo and Loox. None of them serve its
> reviews — that is Klaviyo's onsite script probing every review app in turn and
> finding them all null. The widget that actually renders is Bazaarvoice.

`docs/REVIEWS_RESEARCH.md` records each endpoint, the trap in each (Okendo's
`nextUrl` is version-relative but root-anchored; Judge.me silently caps
`per_page` at ~23), and the measured verification.

### Onboarding a fourth brand's reviews

```bash
# 1. find the platform: load a PDP and look for the widget, not the script tags
# 2. add review_platform + review_config to the site in src/config/sites.ts
# 3. prove it against the live site before writing anything:
npm run reviews:probe -- --brand <slug> --products 3 --show 2
```

The probe prints `reported` vs `fetched` per product and flags any mismatch or
repeated ids — the check that matters, since a paginator that stops early looks
exactly like a product with fewer reviews.

### Cost and cadence

Reviews are by far the largest stage: one JOOLA product alone has 345, one
Selkirk product has 2,640, and the APIs cap a page at 20 (Bazaarvoice, Okendo)
or 10 (Judge.me). The first full collection is measured in hours at the
configured politeness delay.

Every run after that is incremental. Each adapter sorts newest-first, so a run
stops paging a product once it reaches reviews it already holds — less a 14-day
overlap window, deliberately re-read because brand replies arrive days after the
review and stopping at the newest known review would never collect them.

The reviews stage runs **last** and nothing depends on it, so if it fails, the
price and stock series for that run is already safely written.

## Politeness

Only public, unauthenticated endpoints. `robots.txt` is fetched and honoured
(including a longer `Crawl-delay` than ours), requests are serialised per host
behind a descriptive User-Agent, and no login, paywall or access control is
bypassed.

## Not built yet

- PDP stage — spec tables and technology extraction (schema is in place:
  `product_content`, `technologies`)
- Next.js dashboard
- Reviews / ratings — currently live in the separate Joola Pulse Supabase
- Countries beyond US — needs the India / Vietnam / Australia domains
