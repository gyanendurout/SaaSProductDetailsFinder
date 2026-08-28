-- =============================================================================
-- 0001_core_schema.sql — reference, source-mirror and canonical layers
--
-- Layer 1 (reference)     brands, countries, sites, players, technologies
-- Layer 2 (source mirror) categories, products, variants, product_categories,
--                         product_content  — what the site literally says
-- Layer 3 (canonical)     product_lines, generations, models — what we derive
--
-- The split exists because storefronts model the same physical hierarchy
-- inconsistently. See docs/DESIGN.md §5.
-- =============================================================================

create extension if not exists "pgcrypto";     -- gen_random_uuid()
create extension if not exists "pg_trgm";      -- fuzzy name matching in normalize

-- =============================================================================
-- Enumerated domains. Kept as CHECK constraints rather than PG enums so that
-- adding a value is a migration, not an ALTER TYPE that locks readers.
-- =============================================================================

-- skill_tier      pro | performance | recreational | premium | junior | unknown
-- paddle_shape    elongated | hybrid | standard | widebody | unknown
-- attr_source     source_option | title | tag | collection | pdp | llm | manual
-- category_role   sport | assortment | skill_tier | generation | series
--                 | signature | sale | accessory | other

-- =============================================================================
-- Layer 1 — reference
-- =============================================================================

create table brands (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,               -- 'joola'
  name          text not null,                      -- 'JOOLA'
  created_at    timestamptz not null default now()
);

create table countries (
  code          text primary key,                   -- ISO-3166-1 alpha-2, 'US'
  name          text not null,
  currency      text not null                       -- ISO-4217 default, 'USD'
);

-- One row per (brand, country) storefront. This is the crawl target and the
-- unit that country expansion adds rows to.
create table sites (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references brands(id) on delete cascade,
  country_code      text not null references countries(code),
  base_url          text not null,                  -- 'https://joola.com'
  platform          text not null,                  -- 'shopify' | 'woocommerce' | 'custom'
  currency          text not null,
  locale            text not null default 'en-US',
  -- Which source collections make up the assortment we care about. Declared in
  -- config and mirrored here so a query can explain why a product was crawled.
  assortment_handles text[] not null default '{}',
  is_active         boolean not null default true,
  crawl_delay_ms    integer not null default 1200,  -- politeness; robots may raise it
  notes             text,
  created_at        timestamptz not null default now(),
  unique (brand_id, country_code, base_url)
);

-- Endorsing athletes. Colourways on this brand are named after players
-- ('Blaze Red (Ben Johns)'), which makes the player a real analytic dimension.
create table players (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid references brands(id) on delete cascade,
  name          text not null,
  slug          text not null,
  created_at    timestamptz not null default now(),
  unique (brand_id, slug)
);

-- Brand technology dictionary ('Carbon Friction Surface', 'Propulsion Core').
create table technologies (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  name          text not null,
  slug          text not null,
  description   text,
  first_seen_at timestamptz not null default now(),
  unique (brand_id, slug)
);

-- =============================================================================
-- Layer 3 — canonical hierarchy (declared before layer 2 so products can FK to it)
--
--   product_line  Perseus
--   generation    Pro V
--   model         Perseus Pro V   (line × generation × optional sub-line 'Dual')
-- =============================================================================

create table product_lines (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  slug          text not null,                      -- 'perseus'
  name          text not null,                      -- 'Perseus'
  description   text,
  created_at    timestamptz not null default now(),
  unique (brand_id, slug)
);

create table generations (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  slug          text not null,                      -- 'pro-v'
  name          text not null,                      -- 'Pro V'
  -- Ordering for "which version is newer". Gen 1 = 1, Pro IV = 4, Pro V = 5.
  sequence      integer,
  released_at   date,
  created_at    timestamptz not null default now(),
  unique (brand_id, slug)
);

create table models (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references brands(id) on delete cascade,
  product_line_id   uuid references product_lines(id) on delete set null,
  generation_id     uuid references generations(id) on delete set null,
  sub_line          text,                           -- 'Dual', 'CFS', NULL
  slug              text not null,                  -- 'perseus-pro-v'
  name              text not null,                  -- 'Perseus Pro V'
  skill_tier        text not null default 'unknown'
                    check (skill_tier in ('pro','performance','recreational',
                                          'premium','junior','unknown')),
  shape             text not null default 'unknown'
                    check (shape in ('elongated','hybrid','standard',
                                     'widebody','unknown')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (brand_id, slug)
);

create index models_line_idx on models(product_line_id);
create index models_generation_idx on models(generation_id);
create index models_skill_tier_idx on models(skill_tier);

-- =============================================================================
-- Layer 2 — source mirror
-- =============================================================================

-- Collections / menu nodes as published by the site. Self-referencing so the
-- mega-menu tree survives intact; `nav_path` carries the human breadcrumb.
create table categories (
  id                  uuid primary key default gen_random_uuid(),
  site_id             uuid not null references sites(id) on delete cascade,
  source_category_id  text not null,                -- Shopify collection id
  handle              text not null,                -- 'professional-pickleball-paddles'
  title               text not null,                -- 'Pro'
  description         text,
  url                 text,
  parent_id           uuid references categories(id) on delete set null,
  depth               integer not null default 0,
  nav_path            text[] not null default '{}', -- {'Pickleball','Paddles','Pro'}
  -- Derived: what this collection *means*. Drives the UI's facet grouping.
  category_role       text not null default 'other'
                      check (category_role in ('sport','assortment','skill_tier',
                             'generation','series','signature','sale','accessory','other')),
  position            integer,
  in_main_nav         boolean not null default false,
  product_count       integer not null default 0,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  is_active           boolean not null default true,
  unique (site_id, source_category_id)
);

create index categories_site_role_idx on categories(site_id, category_role);
create index categories_handle_idx on categories(site_id, handle);

-- One row per product per site. The same physical paddle sold in the US and in
-- Australia is two rows; that is intentional.
create table products (
  id                  uuid primary key default gen_random_uuid(),
  site_id             uuid not null references sites(id) on delete cascade,
  model_id            uuid references models(id) on delete set null,  -- resolved in normalize
  source_product_id   text not null,
  handle              text not null,
  title               text not null,
  vendor              text,
  product_type        text,
  tags                text[] not null default '{}',
  body_html           text,
  url                 text,
  image_url           text,
  published_at        timestamptz,
  source_created_at   timestamptz,
  source_updated_at   timestamptz,
  -- Assortment gate. Accessories and apparel slip into collections; this is the
  -- flag every analytic query filters on.
  is_in_assortment    boolean not null default true,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  is_active           boolean not null default true,
  unique (site_id, source_product_id)
);

create index products_site_idx on products(site_id);
create index products_model_idx on products(model_id);
create index products_handle_idx on products(site_id, handle);
create index products_tags_idx on products using gin(tags);
create index products_title_trgm_idx on products using gin(title gin_trgm_ops);

-- Membership changes over time — a product entering the 'Sale' collection is a
-- signal in its own right, so this carries first/last seen rather than being a
-- plain join table.
create table product_categories (
  product_id      uuid not null references products(id) on delete cascade,
  category_id     uuid not null references categories(id) on delete cascade,
  position        integer,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  is_active       boolean not null default true,
  primary key (product_id, category_id)
);

create index product_categories_category_idx on product_categories(category_id);

-- The SKU. Atomic unit of price/stock time series.
create table variants (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references products(id) on delete cascade,
  site_id             uuid not null references sites(id) on delete cascade,
  source_variant_id   text not null,
  sku                 text,
  barcode             text,
  title               text,                         -- '16mm / Blaze Red (Ben Johns)'
  position            integer,
  image_url           text,

  -- Raw option values exactly as the source gave them, so a normalization bug
  -- is always recoverable without a re-crawl.
  option1_name        text,
  option1_value       text,
  option2_name        text,
  option2_value       text,
  option3_name        text,
  option3_value       text,

  -- ---- derived attributes (normalize stage) --------------------------------
  -- These are the answer to "what sizes / colours / versions exist". They are
  -- populated from option values, product title, tags, collections or the PDP,
  -- whichever wins; attr_source records which, per docs/DESIGN.md §3.
  core_thickness_mm   numeric(4,1),                 -- 14.0 | 16.0
  colorway            text,                         -- 'Blaze Red'
  color_primary       text,
  color_secondary     text,
  endorsed_player_id  uuid references players(id) on delete set null,
  weight_grams        numeric(6,2),
  grip_length_mm      numeric(5,1),
  paddle_length_mm    numeric(5,1),
  paddle_width_mm     numeric(5,1),
  shape               text check (shape in ('elongated','hybrid','standard',
                                            'widebody','unknown')),
  attr_source         jsonb not null default '{}'::jsonb,  -- {"core_thickness_mm":"title"}
  attr_confidence     numeric(3,2),                 -- 0.00–1.00, lowest across attrs

  -- Long-tail specs that do not deserve a column.
  attributes          jsonb not null default '{}'::jsonb,

  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  is_active           boolean not null default true,
  unique (site_id, source_variant_id)
);

create index variants_product_idx on variants(product_id);
create index variants_site_idx on variants(site_id);
create index variants_sku_idx on variants(sku);
create index variants_thickness_idx on variants(core_thickness_mm);
create index variants_player_idx on variants(endorsed_player_id);

-- PDP-derived content. Versioned by content_hash so re-crawls that changed
-- nothing do not create rows, but a genuine copy/spec change is preserved.
create table product_content (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  content_hash    varchar(64) not null,             -- sha256 of the normalised payload
  description     text,
  specs           jsonb not null default '{}'::jsonb,   -- {'Core':'16mm Polypropylene'}
  technologies    text[] not null default '{}',
  media           jsonb not null default '[]'::jsonb,
  breadcrumb      text[] not null default '{}',
  captured_at     timestamptz not null default now(),
  unique (product_id, content_hash)
);

create index product_content_product_idx on product_content(product_id, captured_at desc);

create table product_technologies (
  product_id      uuid not null references products(id) on delete cascade,
  technology_id   uuid not null references technologies(id) on delete cascade,
  primary key (product_id, technology_id)
);

-- =============================================================================
-- updated_at maintenance
-- =============================================================================

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger models_touch before update on models
  for each row execute function touch_updated_at();
