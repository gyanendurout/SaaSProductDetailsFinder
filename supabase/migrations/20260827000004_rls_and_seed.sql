-- =============================================================================
-- 0004_rls_and_seed.sql — access control, then the JOOLA US seed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RLS. The ingest runs with the service_role key, which bypasses RLS entirely.
-- Everything else is denied unless a policy grants it. Enabling RLS without
-- adding a permissive policy is the deny-by-default posture we want here: the
-- anon key is safe to ship to a browser because it can read nothing.
--
-- When the dashboard needs direct browser reads, add read-only policies for the
-- `authenticated` role. Until then, the Next.js app should read through a
-- server-side route using the service key.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'brands','countries','sites','players','technologies',
    'product_lines','generations','models',
    'categories','products','variants','product_categories',
    'product_content','product_technologies',
    'crawl_runs','crawl_errors','variant_snapshots','variant_events'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Seed: countries
-- -----------------------------------------------------------------------------
insert into countries (code, name, currency) values
  ('US', 'United States', 'USD'),
  ('IN', 'India',         'INR'),
  ('AU', 'Australia',     'AUD'),
  ('VN', 'Vietnam',       'VND')
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Seed: JOOLA + its US storefront
--
-- assortment_handles are the collections verified to exist on joola.com and to
-- contain paddles. 'pickleball-paddles' is the parent; the rest are the skill
-- tiers, generations and series that give the taxonomy its shape.
-- -----------------------------------------------------------------------------
insert into brands (slug, name) values ('joola', 'JOOLA')
on conflict (slug) do nothing;

insert into sites (brand_id, country_code, base_url, platform, currency, locale,
                   assortment_handles, crawl_delay_ms, notes)
select
  b.id, 'US', 'https://joola.com', 'shopify', 'USD', 'en-US',
  array[
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
    'pickleball-sale'
  ],
  1200,
  'Shopify. Public /collections.json, /products.json and /products/<handle>.js verified open 2026-08-27. No market subpaths (/en-in/ returns 404), so other countries will be separate site rows with their own base_url.'
from brands b where b.slug = 'joola'
on conflict (brand_id, country_code, base_url) do nothing;

-- -----------------------------------------------------------------------------
-- Seed: generations, with sequence so "which version is newer" is orderable.
-- Observed on-site as collections: gen-1, pro-iv, pro-v, joola-3s.
-- -----------------------------------------------------------------------------
insert into generations (brand_id, slug, name, sequence)
select b.id, g.slug, g.name, g.sequence
from brands b
cross join (values
  ('gen-1',  'Gen 1',  1),
  ('gen-2',  'Gen 2',  2),
  ('gen-3',  'Gen 3',  3),
  ('pro-iv', 'Pro IV', 4),
  ('pro-v',  'Pro V',  5),
  ('3s',     '3S',     6)
) as g(slug, name, sequence)
where b.slug = 'joola'
on conflict (brand_id, slug) do nothing;

-- -----------------------------------------------------------------------------
-- Seed: product lines, from the `*-series` tags observed in the live catalogue.
-- The normalize stage will create any line it meets that is not listed here, so
-- this is a head start, not a closed set.
-- -----------------------------------------------------------------------------
insert into product_lines (brand_id, slug, name)
select b.id, l.slug, l.name
from brands b
cross join (values
  ('perseus',  'Perseus'),
  ('hyperion', 'Hyperion'),
  ('scorpeus', 'Scorpeus'),
  ('magnus',   'Magnus'),
  ('vision',   'Vision'),
  ('agassi',   'Agassi'),
  ('graf',     'Graf'),
  ('kosmos',   'Kosmos'),
  ('astro',    'Astro'),
  ('essentials','Essentials')
) as l(slug, name)
where b.slug = 'joola'
on conflict (brand_id, slug) do nothing;

-- -----------------------------------------------------------------------------
-- Seed: endorsing players seen in colourway names
-- ('Blaze Red (Ben Johns)', 'JOOLA Yellow (Anna Bright)', ...).
-- -----------------------------------------------------------------------------
insert into players (brand_id, slug, name)
select b.id, p.slug, p.name
from brands b
cross join (values
  ('ben-johns',          'Ben Johns'),
  ('collin-johns',       'Collin Johns'),
  ('anna-bright',        'Anna Bright'),
  ('tyson-mcguffin',     'Tyson McGuffin'),
  ('simone-jardim',      'Simone Jardim'),
  ('federico-staksrud',  'Federico Staksrud'),
  ('andre-agassi',       'Andre Agassi'),
  ('steffi-graf',        'Steffi Graf'),
  ('hugo-calderano',     'Hugo Calderano')
) as p(slug, name)
where b.slug = 'joola'
on conflict (brand_id, slug) do nothing;
