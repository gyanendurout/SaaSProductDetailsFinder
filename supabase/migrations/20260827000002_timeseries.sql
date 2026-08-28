-- =============================================================================
-- 0002_timeseries.sql — crawl runs and the price / discount / stock history
--
-- This is the reason the project exists. A catalogue scrape tells you what is
-- sold today; these tables tell you what changed and when.
--
-- Sizing: 116 variants/day for JOOLA US is ~42k snapshot rows/year. At 20
-- brands x 4 countries x 500 variants it is ~15M/year — the point at which
-- monthly partitioning of variant_snapshots becomes worthwhile. See §"scaling"
-- at the bottom.
-- =============================================================================

-- One row per crawl. Everything written by a run carries its run_id so a bad
-- run can be identified, explained, and excluded from charts.
create table crawl_runs (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid not null references sites(id) on delete cascade,
  run_type          text not null default 'scheduled'
                    check (run_type in ('scheduled','manual','backfill')),
  status            text not null default 'pending'
                    check (status in ('pending','running','done','partial','error')),
  -- Which stages were requested vs completed, for the pipeline-health panel.
  stages_requested  text[] not null default '{}',
  stages_done       text[] not null default '{}',
  categories_found  integer not null default 0,
  products_found    integer not null default 0,
  products_new      integer not null default 0,
  variants_found    integer not null default 0,
  variants_new      integer not null default 0,
  snapshots_written integer not null default 0,
  events_written    integer not null default 0,
  stats             jsonb not null default '{}'::jsonb,
  error_message     text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index crawl_runs_site_started_idx on crawl_runs(site_id, started_at desc);
create index crawl_runs_status_idx on crawl_runs(status);

create table crawl_errors (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references crawl_runs(id) on delete cascade,
  stage           text not null,
  target          text,                              -- the URL/handle that failed
  error_type      text not null default 'stage_error'
                  check (error_type in ('http_error','parse_error','timeout',
                                        'stage_error','normalize_error','db_error')),
  error_message   text,
  status_code     integer,
  created_at      timestamptz not null default now()
);

create index crawl_errors_run_idx on crawl_errors(run_id);

-- =============================================================================
-- variant_snapshots — append-only. One row per variant per successful run.
--
-- observed_at is when WE LOOKED, not when the price changed. Charts must step-
-- interpolate between points, never linearly interpolate.
--
-- A failed run writes NO snapshots, so a site outage can never be mistaken for
-- a catalogue-wide stockout.
-- =============================================================================
create table variant_snapshots (
  id                  bigserial primary key,
  run_id              uuid not null references crawl_runs(id) on delete cascade,
  variant_id          uuid not null references variants(id) on delete cascade,
  site_id             uuid not null references sites(id) on delete cascade,
  observed_at         timestamptz not null default now(),

  price               numeric(12,2),
  compare_at_price    numeric(12,2),
  currency            text not null,

  -- Stored generated columns: "everything over 20% off on any past date"
  -- becomes an index scan instead of a scan-plus-arithmetic.
  is_on_sale          boolean generated always as (
                        compare_at_price is not null
                        and price is not null
                        and compare_at_price > price
                      ) stored,
  discount_pct        numeric(5,2) generated always as (
                        case
                          when compare_at_price is not null
                           and price is not null
                           and compare_at_price > 0
                           and compare_at_price > price
                          then round(((compare_at_price - price) / compare_at_price) * 100, 2)
                          else 0
                        end
                      ) stored,

  is_available        boolean,
  inventory_quantity  integer,                       -- null when not exposed
  -- Merchandising position within its primary collection. Movement here is an
  -- early signal of a push or a wind-down.
  position_in_category integer,

  -- Guards against double-writing a variant within one run.
  unique (run_id, variant_id)
);

create index variant_snapshots_variant_time_idx
  on variant_snapshots(variant_id, observed_at desc);
create index variant_snapshots_site_time_idx
  on variant_snapshots(site_id, observed_at desc);
-- BRIN is the right index for an append-only, time-ordered column: tiny, and
-- effective for the range scans that every trend chart issues.
create index variant_snapshots_observed_brin_idx
  on variant_snapshots using brin(observed_at);
create index variant_snapshots_on_sale_idx
  on variant_snapshots(observed_at desc) where is_on_sale;

-- =============================================================================
-- variant_events — the derived change-log.
--
-- Written by the diff stage by comparing a run against the previous successful
-- run. Everything here is recomputable from variant_snapshots; it exists so the
-- dashboard and any alerting can answer "what changed" without window functions
-- over the full history.
-- =============================================================================
create table variant_events (
  id              bigserial primary key,
  run_id          uuid not null references crawl_runs(id) on delete cascade,
  variant_id      uuid not null references variants(id) on delete cascade,
  site_id         uuid not null references sites(id) on delete cascade,
  event_type      text not null check (event_type in (
                    'listed','delisted',
                    'price_increase','price_decrease',
                    'discount_started','discount_deepened','discount_ended',
                    'went_oos','back_in_stock',
                    'category_added','category_removed'
                  )),
  occurred_at     timestamptz not null default now(),
  old_value       text,
  new_value       text,
  delta_numeric   numeric(12,2),                     -- signed price delta where relevant
  delta_pct       numeric(6,2),
  context         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index variant_events_variant_time_idx on variant_events(variant_id, occurred_at desc);
create index variant_events_site_time_idx on variant_events(site_id, occurred_at desc);
create index variant_events_type_time_idx on variant_events(event_type, occurred_at desc);

-- =============================================================================
-- Scaling note (deliberately not implemented yet — YAGNI)
--
-- At roughly 10M rows, convert variant_snapshots to a monthly-partitioned table:
--
--   create table variant_snapshots (...) partition by range (observed_at);
--   create table variant_snapshots_2026_08
--     partition of variant_snapshots
--     for values from ('2026-08-01') to ('2026-09-01');
--
-- Nothing in the application reads variant_snapshots directly except the
-- pipeline and the views in 0003, so this stays a contained change.
-- =============================================================================
