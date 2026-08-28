-- =============================================================================
-- 20260827000005 — the last migration that has to be pasted by hand.
--
-- Two jobs:
--
--   1. Add the play-style axis (power / control / hybrid). Selkirk merchandises
--      it as a first-class dimension with dedicated collections and tags; JOOLA
--      does not use it at all, which is why it defaults to 'unknown'.
--
--   2. Replace every brand-vocabulary CHECK constraint with a reference table.
--
-- Job 2 is the important one. CHECK constraints looked tidy while JOOLA was the
-- only brand, but they hardcode one brand's vocabulary into the schema: the
-- moment a brand ships a shape we have not seen, or a tier word we have not
-- met, the fix is a schema migration — DDL, which cannot be applied over the
-- REST API and therefore needs a human pasting SQL into a dashboard.
--
-- A reference table turns that same change into an INSERT. Inserts go over
-- PostgREST with the service key, which means `npm run sync` can do it. After
-- this migration, onboarding a brand touches no SQL at all.
--
-- Integrity is preserved, not traded away: the columns become foreign keys, so
-- an unknown value is still rejected — it just becomes a row we can add from
-- code rather than a constraint we must redeploy.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Vocabulary reference tables
-- -----------------------------------------------------------------------------
create table if not exists skill_tiers (
  code        text primary key,
  label       text not null,
  sort_order  integer not null default 100,
  notes       text
);

create table if not exists shapes (
  code        text primary key,
  label       text not null,
  sort_order  integer not null default 100,
  notes       text
);

create table if not exists play_styles (
  code        text primary key,
  label       text not null,
  sort_order  integer not null default 100,
  notes       text
);

create table if not exists category_roles (
  code        text primary key,
  label       text not null,
  sort_order  integer not null default 100,
  notes       text
);

-- Current vocabulary. `npm run sync` adds to these as brands introduce words;
-- seeding here only guarantees the foreign keys below can validate today's rows.
insert into skill_tiers (code, label, sort_order) values
  ('pro',          'Pro',           10),
  ('performance',  'Performance',   20),
  ('premium',      'Premium',       30),
  ('recreational', 'Recreational',  40),
  ('junior',       'Junior',        50),
  ('unknown',      'Unknown',      900)
on conflict (code) do nothing;

insert into shapes (code, label, sort_order) values
  ('elongated', 'Elongated',  10),
  ('hybrid',    'Hybrid',     20),
  ('standard',  'Standard',   30),
  ('widebody',  'Widebody',   40),
  ('unknown',   'Unknown',   900)
on conflict (code) do nothing;

insert into play_styles (code, label, sort_order) values
  ('power',   'Power',     10),
  ('control', 'Control',   20),
  ('hybrid',  'Hybrid',    30),
  ('unknown', 'Unknown',  900)
on conflict (code) do nothing;

insert into category_roles (code, label, sort_order) values
  ('sport',      'Sport',        10),
  ('assortment', 'Assortment',   20),
  ('skill_tier', 'Skill tier',   30),
  ('generation', 'Generation',   40),
  ('series',     'Series',       50),
  ('signature',  'Signature',    60),
  ('play_style', 'Play style',   70),
  ('shape',      'Shape',        80),
  ('material',   'Material',     90),
  ('sale',       'Sale',        100),
  ('accessory',  'Accessory',   110),
  ('other',      'Other',       900)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2. play_style on models
--
-- Added before the foreign keys so the new column is covered by them too.
-- -----------------------------------------------------------------------------
alter table models
  add column if not exists play_style text not null default 'unknown';

create index if not exists models_play_style_idx on models(play_style);

-- -----------------------------------------------------------------------------
-- 3. Swap CHECK constraints for foreign keys
--
-- Inline unnamed CHECKs get the name <table>_<column>_check, which is what the
-- drops below target. `if exists` makes this safe whether or not an earlier
-- draft of this migration was already applied.
-- -----------------------------------------------------------------------------
alter table models     drop constraint if exists models_skill_tier_check;
alter table models     drop constraint if exists models_shape_check;
alter table models     drop constraint if exists models_play_style_check;
alter table variants   drop constraint if exists variants_shape_check;
alter table categories drop constraint if exists categories_category_role_check;

-- Any row holding a value outside the seeded vocabulary would block the foreign
-- keys below. There should be none; this repairs rather than aborts if there is.
update models     set skill_tier    = 'unknown' where skill_tier    not in (select code from skill_tiers);
update models     set shape         = 'unknown' where shape         not in (select code from shapes);
update models     set play_style    = 'unknown' where play_style    not in (select code from play_styles);
update variants   set shape         = null      where shape is not null
                                                  and shape not in (select code from shapes);
update categories set category_role = 'other'   where category_role not in (select code from category_roles);

alter table models
  drop constraint if exists models_skill_tier_fkey,
  add constraint models_skill_tier_fkey
    foreign key (skill_tier) references skill_tiers(code) on update cascade;

alter table models
  drop constraint if exists models_shape_fkey,
  add constraint models_shape_fkey
    foreign key (shape) references shapes(code) on update cascade;

alter table models
  drop constraint if exists models_play_style_fkey,
  add constraint models_play_style_fkey
    foreign key (play_style) references play_styles(code) on update cascade;

alter table variants
  drop constraint if exists variants_shape_fkey,
  add constraint variants_shape_fkey
    foreign key (shape) references shapes(code) on update cascade;

alter table categories
  drop constraint if exists categories_category_role_fkey,
  add constraint categories_category_role_fkey
    foreign key (category_role) references category_roles(code) on update cascade;

-- -----------------------------------------------------------------------------
-- 4. Read access to the vocabularies
--
-- RLS is deny-by-default across this schema and the dashboard reads server-side
-- with the service key, so these need no policy to work today. Enabling RLS
-- keeps them consistent with every other table rather than silently readable if
-- an anon key is ever pointed at them.
-- -----------------------------------------------------------------------------
alter table skill_tiers    enable row level security;
alter table shapes         enable row level security;
alter table play_styles    enable row level security;
alter table category_roles enable row level security;

-- =============================================================================
-- 5. Views: surface play_style, weight_grams, shape and brand_slug.
--
-- Rebuilt rather than replaced because CREATE OR REPLACE VIEW cannot insert a
-- column into the middle of a select list. Dropping dependants first keeps the
-- order valid. Views hold no data — this is not a destructive operation, though
-- the SQL editor's guard will ask you to confirm it.
-- =============================================================================
drop view if exists v_active_discounts;
drop view if exists v_model_overview;
drop view if exists v_variant_current;

create view v_variant_current as
select
  v.id                    as variant_id,
  v.sku,
  v.title                 as variant_title,
  v.core_thickness_mm,
  v.colorway,
  v.weight_grams,
  v.shape                 as variant_shape,
  v.attr_confidence,
  pl_player.name          as endorsed_player,

  p.id                    as product_id,
  p.title                 as product_title,
  p.handle,
  p.url                   as product_url,
  p.image_url,
  p.tags,
  p.is_in_assortment,

  m.id                    as model_id,
  m.name                  as model_name,
  m.skill_tier,
  m.play_style,
  m.shape                 as model_shape,
  line.name               as product_line,
  gen.name                as generation,
  gen.sequence            as generation_sequence,

  s.id                    as site_id,
  b.name                  as brand,
  b.slug                  as brand_slug,
  s.country_code,

  snap.observed_at,
  snap.price,
  snap.compare_at_price,
  snap.currency,
  snap.is_on_sale,
  snap.discount_pct,
  snap.is_available,
  snap.inventory_quantity,

  v.is_active
from variants v
join products p        on p.id = v.product_id
join sites s           on s.id = v.site_id
join brands b          on b.id = s.brand_id
left join models m     on m.id = p.model_id
left join product_lines line on line.id = m.product_line_id
left join generations gen    on gen.id = m.generation_id
left join players pl_player  on pl_player.id = v.endorsed_player_id
left join lateral (
  select vs.observed_at, vs.price, vs.compare_at_price, vs.currency,
         vs.is_on_sale, vs.discount_pct, vs.is_available, vs.inventory_quantity
  from variant_snapshots vs
  where vs.variant_id = v.id
  order by vs.observed_at desc
  limit 1
) snap on true;

create view v_model_overview as
select
  m.id                as model_id,
  b.name              as brand,
  b.slug              as brand_slug,
  line.name           as product_line,
  gen.name            as generation,
  gen.sequence        as generation_sequence,
  m.name              as model_name,
  m.skill_tier,
  m.play_style,
  m.shape,
  count(distinct vc.variant_id)                              as sku_count,
  array_agg(distinct vc.core_thickness_mm)
    filter (where vc.core_thickness_mm is not null)          as thicknesses_mm,
  array_agg(distinct vc.colorway)
    filter (where vc.colorway is not null)                   as colorways,
  array_agg(distinct vc.variant_shape)
    filter (where vc.variant_shape is not null
            and vc.variant_shape <> 'unknown')               as shapes,
  array_agg(distinct vc.endorsed_player)
    filter (where vc.endorsed_player is not null)            as endorsed_players,
  min(vc.price)                                              as price_min,
  max(vc.price)                                              as price_max,
  count(*) filter (where vc.is_available)                    as skus_in_stock,
  count(*) filter (where vc.is_on_sale)                      as skus_on_sale,
  max(vc.discount_pct)                                       as best_discount_pct,
  vc.currency,
  vc.country_code
from models m
join brands b on b.id = m.brand_id
left join product_lines line on line.id = m.product_line_id
left join generations gen    on gen.id = m.generation_id
join v_variant_current vc    on vc.model_id = m.id
where vc.is_in_assortment
group by m.id, b.name, b.slug, line.name, gen.name, gen.sequence,
         m.name, m.skill_tier, m.play_style, m.shape, vc.currency, vc.country_code;

create view v_active_discounts as
select
  vc.brand, vc.brand_slug, vc.country_code, vc.product_line, vc.generation,
  vc.model_name, vc.product_title, vc.variant_title, vc.sku,
  vc.core_thickness_mm, vc.colorway,
  vc.price, vc.compare_at_price, vc.discount_pct, vc.currency,
  vc.is_available, vc.product_url, vc.observed_at
from v_variant_current vc
where vc.is_on_sale and vc.is_in_assortment
order by vc.discount_pct desc;

-- The change feed gains brand_slug so the dashboard can filter without a join.
--
-- Dropped first, like the three above. CREATE OR REPLACE VIEW can only append
-- columns to the end of the select list; brand_slug belongs next to brand, and
-- inserting it there is a rename as far as Postgres is concerned:
--   ERROR 42P16: cannot change name of view column "country_code" to "brand_slug"
drop view if exists v_recent_changes;

create view v_recent_changes as
select
  e.id, e.event_type, e.occurred_at, e.old_value, e.new_value,
  e.delta_numeric, e.delta_pct,
  v.sku, v.title as variant_title, v.core_thickness_mm, v.colorway,
  p.title as product_title, p.url as product_url,
  m.name as model_name, m.skill_tier,
  b.name as brand, b.slug as brand_slug, s.country_code
from variant_events e
join variants v on v.id = e.variant_id
join products p on p.id = v.product_id
join sites s    on s.id = e.site_id
join brands b   on b.id = s.brand_id
left join models m on m.id = p.model_id
order by e.occurred_at desc;

-- =============================================================================
-- Deliberately NOT here: the Selkirk brand, site and product lines.
--
-- Those are data, not schema. An earlier draft of this migration seeded them in
-- SQL, which is what made every new brand look like it needed a migration. They
-- now live in src/config/ and are pushed by `npm run sync`, so brand #3 is a
-- TypeScript file and a command — no dashboard, no paste.
-- =============================================================================
