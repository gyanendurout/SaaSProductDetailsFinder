-- =============================================================================
-- 0003_views.sql — the read surface.
--
-- The frontend should query these, never the raw tables. That keeps the
-- "never linearly interpolate", "always filter is_in_assortment" and "latest
-- snapshot per variant" rules in one place instead of in every component.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Current state of every SKU: newest snapshot, joined through to the canonical
-- model. This is the workhorse for catalogue browsing.
-- -----------------------------------------------------------------------------
create or replace view v_variant_current as
select
  v.id                    as variant_id,
  v.sku,
  v.title                 as variant_title,
  v.core_thickness_mm,
  v.colorway,
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
  m.shape                 as model_shape,
  line.name               as product_line,
  gen.name                as generation,
  gen.sequence            as generation_sequence,

  s.id                    as site_id,
  b.name                  as brand,
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
-- Newest snapshot per variant. LATERAL keeps this an index seek per variant
-- rather than a sort over the whole history.
left join lateral (
  select vs.observed_at, vs.price, vs.compare_at_price, vs.currency,
         vs.is_on_sale, vs.discount_pct, vs.is_available, vs.inventory_quantity
  from variant_snapshots vs
  where vs.variant_id = v.id
  order by vs.observed_at desc
  limit 1
) snap on true;

-- -----------------------------------------------------------------------------
-- The direct answer to the brief: for each model, how many versions, which
-- thicknesses, which colourways, what price band.
-- -----------------------------------------------------------------------------
create or replace view v_model_overview as
select
  m.id                as model_id,
  b.name              as brand,
  line.name           as product_line,
  gen.name            as generation,
  gen.sequence        as generation_sequence,
  m.name              as model_name,
  m.skill_tier,
  m.shape,
  count(distinct vc.variant_id)                              as sku_count,
  array_agg(distinct vc.core_thickness_mm)
    filter (where vc.core_thickness_mm is not null)          as thicknesses_mm,
  array_agg(distinct vc.colorway)
    filter (where vc.colorway is not null)                   as colorways,
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
group by m.id, b.name, line.name, gen.name, gen.sequence,
         m.name, m.skill_tier, m.shape, vc.currency, vc.country_code;

-- -----------------------------------------------------------------------------
-- Daily price series. One row per variant per day; where a day has several
-- observations, the last one wins as the close and min/max show the intraday
-- band. Days with no crawl are simply absent — the caller must step-fill, not
-- interpolate (docs/DESIGN.md §6).
-- -----------------------------------------------------------------------------
create or replace view v_variant_price_daily as
select
  vs.variant_id,
  vs.site_id,
  (vs.observed_at at time zone 'UTC')::date          as day,
  min(vs.price)                                      as price_min,
  max(vs.price)                                      as price_max,
  (array_agg(vs.price order by vs.observed_at desc))[1]            as price_close,
  (array_agg(vs.compare_at_price order by vs.observed_at desc))[1] as compare_at_close,
  (array_agg(vs.discount_pct order by vs.observed_at desc))[1]     as discount_pct_close,
  bool_or(vs.is_on_sale)                             as was_on_sale,
  bool_or(vs.is_available)                           as was_available,
  bool_and(vs.is_available)                          as was_always_available,
  count(*)                                           as observations,
  max(vs.currency)                                   as currency
from variant_snapshots vs
group by vs.variant_id, vs.site_id, (vs.observed_at at time zone 'UTC')::date;

-- -----------------------------------------------------------------------------
-- Everything currently discounted, deepest first.
-- -----------------------------------------------------------------------------
create or replace view v_active_discounts as
select
  vc.brand, vc.country_code, vc.product_line, vc.generation, vc.model_name,
  vc.product_title, vc.variant_title, vc.sku, vc.core_thickness_mm, vc.colorway,
  vc.price, vc.compare_at_price, vc.discount_pct, vc.currency,
  vc.is_available, vc.product_url, vc.observed_at
from v_variant_current vc
where vc.is_on_sale and vc.is_in_assortment
order by vc.discount_pct desc;

-- -----------------------------------------------------------------------------
-- Site taxonomy as a breadcrumb list — the captured menu structure.
-- -----------------------------------------------------------------------------
create or replace view v_category_tree as
select
  c.id as category_id, c.site_id, b.name as brand, s.country_code,
  c.handle, c.title, c.category_role, c.depth, c.nav_path, c.in_main_nav,
  c.parent_id, parent.title as parent_title,
  count(pc.product_id) filter (where pc.is_active) as active_products,
  c.is_active
from categories c
join sites s  on s.id = c.site_id
join brands b on b.id = s.brand_id
left join categories parent on parent.id = c.parent_id
left join product_categories pc on pc.category_id = c.id
group by c.id, b.name, s.country_code, parent.title;

-- -----------------------------------------------------------------------------
-- Recent changes feed — what moved, newest first.
-- -----------------------------------------------------------------------------
create or replace view v_recent_changes as
select
  e.id, e.event_type, e.occurred_at, e.old_value, e.new_value,
  e.delta_numeric, e.delta_pct,
  v.sku, v.title as variant_title, v.core_thickness_mm, v.colorway,
  p.title as product_title, p.url as product_url,
  m.name as model_name, m.skill_tier,
  b.name as brand, s.country_code
from variant_events e
join variants v on v.id = e.variant_id
join products p on p.id = v.product_id
join sites s    on s.id = e.site_id
join brands b   on b.id = s.brand_id
left join models m on m.id = p.model_id
order by e.occurred_at desc;
