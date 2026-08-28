-- =============================================================================
-- 0006_reviews.sql — customer reviews, brand replies, and their time series
--
-- Three layers, mirroring the rest of the schema:
--
--   reviews                   what a customer wrote      (upserted, carries seen-dates)
--   review_responses          what the brand wrote back  (upserted, the reply chain)
--   product_review_snapshots  what the shelf looked like (append-only, one row per run)
--
-- Why a review needs BOTH an upsert table and a snapshot table:
--
-- A review is not a price. Its text is written once and rarely changes, so
-- re-inserting it every run would multiply one customer's opinion by the number
-- of times we happened to look. But the things *around* it do move — helpful
-- counts climb, the brand replies a week later, and the product's average drifts
-- as new reviews land. So the review itself is upserted on its source id and
-- carries first_seen_at / last_seen_at, while the aggregate that actually moves
-- is snapshotted per run. That is what makes "how did sentiment move over the
-- last six months" a range scan rather than an archaeology project.
--
-- Every brand runs a different review platform (Bazaarvoice / Okendo /
-- Judge.me), so review_platform is carried on the row and the source id is only
-- unique within it. See docs/REVIEWS_RESEARCH.md.
-- =============================================================================

-- Which review platform a storefront runs, and what the adapter needs to reach
-- it (Bazaarvoice client + displayCode, Okendo subscriberId, Judge.me shop
-- domain). Config, not schema — so brand #4 stays a config change.
alter table sites add column if not exists review_platform text;
alter table sites add column if not exists review_config jsonb not null default '{}'::jsonb;

-- Run counters for the reviews stage. finaliseRun() writes the whole RunStats
-- object onto the run row, so every stat needs a column here or the update is
-- rejected and the run never leaves 'running'.
alter table crawl_runs add column if not exists reviews_found integer not null default 0;
alter table crawl_runs add column if not exists reviews_new integer not null default 0;
alter table crawl_runs add column if not exists review_responses_new integer not null default 0;

-- product_technologies was the one scraped table carrying no date at all, so a
-- technology claim appearing on or disappearing from a product was invisible.
-- Brought in line with product_categories, which models the same kind of
-- membership-over-time relationship.
alter table product_technologies add column if not exists first_seen_at timestamptz not null default now();
alter table product_technologies add column if not exists last_seen_at  timestamptz not null default now();
alter table product_technologies add column if not exists is_active     boolean not null default true;

-- =============================================================================
-- reviews — one row per customer review, ever.
-- =============================================================================
create table if not exists reviews (
  id                  uuid primary key default gen_random_uuid(),
  site_id             uuid not null references sites(id) on delete cascade,
  product_id          uuid not null references products(id) on delete cascade,

  -- Provenance. Source ids collide across platforms, so the platform is part
  -- of the natural key rather than an attribute hanging off it.
  review_platform     text not null,                 -- bazaarvoice | okendo | judgeme
  source_review_id    text not null,

  -- Content.
  rating              numeric(3,2),                  -- numeric: Okendo can emit halves
  rating_range        integer not null default 5,
  title               text,
  body                text,
  pros                text,
  cons                text,

  -- Author. Display name only — whatever the storefront already shows in public.
  author_name         text,
  author_id           text,
  author_location     text,

  -- Flags a reader filters on.
  is_verified_buyer   boolean,
  is_recommended      boolean,
  is_incentivized     boolean,
  is_syndicated       boolean,
  -- A star with no words. 84 of JOOLA's first 120 are these; they must count
  -- toward the average but must never surface as an empty card in a text search.
  is_ratings_only     boolean not null default false,

  -- Engagement. Current values, refreshed each run.
  helpful_count       integer not null default 0,
  unhelpful_count     integer not null default 0,
  response_count      integer not null default 0,
  photo_count         integer not null default 0,
  video_count         integer not null default 0,

  -- Which SKU the reviewer actually bought, when the platform says so.
  variant_label       text,
  source_variant_id   text,

  -- Platform-specific structured extras, kept whole rather than flattened:
  -- Bazaarvoice Age / Gender / LengthOfOwnership, secondary ratings, badges.
  -- This is the raw material for the sentiment and complaint analysis that will
  -- sit on top of this table later.
  context_data        jsonb not null default '{}'::jsonb,
  media               jsonb not null default '[]'::jsonb,

  -- === Time ==================================================================
  -- submitted_at is when the CUSTOMER wrote it.
  submitted_at        timestamptz,
  source_updated_at   timestamptz,
  -- first_seen_at / last_seen_at are when WE looked. The gap between
  -- submitted_at and first_seen_at is our own collection lag, and keeping both
  -- is what lets a weekly cadence still plot reviews on the day they were left.
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  first_seen_run_id   uuid references crawl_runs(id) on delete set null,
  last_seen_run_id    uuid references crawl_runs(id) on delete set null,

  language_code       text,

  -- Full-text search vector. Generated and stored so the /reviews search is an
  -- index scan rather than a scan-and-tokenise over every row. Title is weighted
  -- above body so "cracked" in a headline outranks it in a paragraph.
  search_tsv          tsvector generated always as (
                        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(body,  '')), 'B') ||
                        setweight(to_tsvector('english', coalesce(pros,  '')), 'C') ||
                        setweight(to_tsvector('english', coalesce(cons,  '')), 'C')
                      ) stored,

  unique (site_id, review_platform, source_review_id)
);

create index if not exists reviews_product_idx    on reviews(product_id);
create index if not exists reviews_site_idx       on reviews(site_id);
-- The default sort of the reviews page.
create index if not exists reviews_submitted_idx  on reviews(submitted_at desc nulls last);
create index if not exists reviews_rating_idx     on reviews(rating);
create index if not exists reviews_first_seen_idx on reviews(first_seen_at desc);
create index if not exists reviews_search_idx     on reviews using gin(search_tsv);
-- Trigram index backs the substring fallback for queries full-text stems away —
-- a model number, a part name, a two-letter brand.
create index if not exists reviews_body_trgm_idx  on reviews using gin(body gin_trgm_ops);
-- Partial index: "show me the complaints" is the most expensive common query.
create index if not exists reviews_low_rating_idx
  on reviews(site_id, submitted_at desc) where rating <= 3;

-- =============================================================================
-- review_responses — the reply chain.
--
-- Bazaarvoice returns these as ClientResponses[] with no stable id, Judge.me as
-- an inline reply block, Okendo as a comment. None of them guarantee an id, so
-- the dedupe key is a hash of the response body: replies are edited rarely, and
-- an edited reply is genuinely a new thing to have seen.
-- =============================================================================
create table if not exists review_responses (
  id                  uuid primary key default gen_random_uuid(),
  review_id           uuid not null references reviews(id) on delete cascade,
  site_id             uuid not null references sites(id) on delete cascade,

  source_response_id  text,
  response_hash       text not null,                 -- sha256 of the normalised body

  author_name         text,
  department          text,                          -- 'Team JOOLA'
  response_source     text,                          -- 'mc-api'
  body                text not null,

  responded_at        timestamptz,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  first_seen_run_id   uuid references crawl_runs(id) on delete set null,

  unique (review_id, response_hash)
);

create index if not exists review_responses_review_idx on review_responses(review_id);
create index if not exists review_responses_site_time_idx
  on review_responses(site_id, responded_at desc);

-- =============================================================================
-- product_review_snapshots — append-only, one row per product per run.
--
-- This is the series that answers the question the feature exists for: how is a
-- product's reception changing over months and years. Deliberately denormalised
-- into star buckets so a distribution chart is one row, not a group-by over
-- every review ever written.
-- =============================================================================
create table if not exists product_review_snapshots (
  id                    bigserial primary key,
  run_id                uuid not null references crawl_runs(id) on delete cascade,
  product_id            uuid not null references products(id) on delete cascade,
  site_id               uuid not null references sites(id) on delete cascade,
  observed_at           timestamptz not null default now(),

  -- What the platform itself claims its total is, when it exposes one. Kept
  -- apart from our own count so a truncated crawl is visible rather than silent.
  reported_total        integer,

  review_count          integer not null default 0,  -- rows we hold for this product
  with_text_count       integer not null default 0,
  ratings_only_count    integer not null default 0,
  average_rating        numeric(4,3),

  rating_1_count        integer not null default 0,
  rating_2_count        integer not null default 0,
  rating_3_count        integer not null default 0,
  rating_4_count        integer not null default 0,
  rating_5_count        integer not null default 0,

  recommended_count     integer not null default 0,
  not_recommended_count integer not null default 0,
  verified_count        integer not null default 0,
  with_response_count   integer not null default 0,

  -- Reviews whose first_seen_run_id is this run: the arrival rate, which leads
  -- the average. A drop to zero on a product that averaged ten a week is worth
  -- knowing well before the average itself moves.
  new_review_count      integer not null default 0,

  unique (run_id, product_id)
);

create index if not exists product_review_snapshots_product_time_idx
  on product_review_snapshots(product_id, observed_at desc);
create index if not exists product_review_snapshots_site_time_idx
  on product_review_snapshots(site_id, observed_at desc);
create index if not exists product_review_snapshots_observed_brin_idx
  on product_review_snapshots using brin(observed_at);

-- =============================================================================
-- Views
-- =============================================================================
drop view if exists v_review_search;
drop view if exists v_product_reviews_current;

-- One row per review, pre-joined to everything the search page filters on, so
-- the UI never fans out joins per row.
create view v_review_search as
select
  r.id                as review_id,
  r.review_platform,
  r.source_review_id,
  r.rating,
  r.rating_range,
  r.title,
  r.body,
  r.pros,
  r.cons,
  r.author_name,
  r.author_location,
  r.is_verified_buyer,
  r.is_recommended,
  r.is_incentivized,
  r.is_ratings_only,
  r.helpful_count,
  r.unhelpful_count,
  r.response_count,
  r.photo_count,
  r.variant_label,
  r.context_data,
  r.media,
  r.submitted_at,
  r.first_seen_at,
  r.last_seen_at,

  p.id                as product_id,
  p.title             as product_title,
  p.handle            as product_handle,
  p.url               as product_url,
  p.image_url         as product_image_url,
  p.is_in_assortment,

  m.id                as model_id,
  m.name              as model_name,
  m.skill_tier,
  m.play_style,
  line.name           as product_line,
  gen.name            as generation,

  s.id                as site_id,
  s.country_code,
  b.name              as brand,
  b.slug              as brand_slug
from reviews r
join products p on p.id = r.product_id
join sites s    on s.id = r.site_id
join brands b   on b.id = s.brand_id
left join models m           on m.id = p.model_id
left join product_lines line on line.id = m.product_line_id
left join generations gen    on gen.id = m.generation_id;

-- Latest review standing per product — the aggregate the catalogue and model
-- pages show next to price.
create view v_product_reviews_current as
select
  p.id                as product_id,
  p.title             as product_title,
  p.handle,
  p.model_id,
  s.id                as site_id,
  b.name              as brand,
  b.slug              as brand_slug,
  snap.observed_at,
  snap.reported_total,
  snap.review_count,
  snap.with_text_count,
  snap.average_rating,
  snap.rating_1_count,
  snap.rating_2_count,
  snap.rating_3_count,
  snap.rating_4_count,
  snap.rating_5_count,
  snap.recommended_count,
  snap.not_recommended_count,
  snap.verified_count,
  snap.with_response_count,
  snap.new_review_count
from products p
join sites s  on s.id = p.site_id
join brands b on b.id = s.brand_id
left join lateral (
  select *
  from product_review_snapshots prs
  where prs.product_id = p.id
  order by prs.observed_at desc
  limit 1
) snap on true;

-- =============================================================================
-- RLS. Same posture as the rest of the schema: service_role writes, anon reads.
-- =============================================================================
alter table reviews                  enable row level security;
alter table review_responses         enable row level security;
alter table product_review_snapshots enable row level security;

drop policy if exists reviews_read                  on reviews;
drop policy if exists review_responses_read         on review_responses;
drop policy if exists product_review_snapshots_read on product_review_snapshots;

create policy reviews_read                  on reviews                  for select using (true);
create policy review_responses_read         on review_responses         for select using (true);
create policy product_review_snapshots_read on product_review_snapshots for select using (true);
