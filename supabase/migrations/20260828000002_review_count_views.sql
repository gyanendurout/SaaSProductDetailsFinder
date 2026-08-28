-- =============================================================================
-- 0007_review_count_views.sql — count reviews by what is actually stored.
--
-- The "Filter by product" list and the brand chips were both built from
-- product_review_snapshots via v_product_reviews_current. That was wrong, and
-- visibly so: the chips advertised 126 products and 13,520 Selkirk reviews,
-- but 26 of those products returned "no reviews match" when clicked, and
-- Selkirk actually returns 6,161. Measured per product: 100 listings carry
-- reviews, 26 do not, and the snapshots claim 24,911 placements over 14,840
-- actual reviews.
--
-- The cause is syndication. A review is unique on
-- (site_id, review_platform, source_review_id) — product_id is deliberately not
-- in that key, because one customer's opinion syndicated across every colourway
-- of a paddle is one opinion, not twelve. But that means the row can only carry
-- ONE product_id, while the snapshot table faithfully records the count the
-- platform reports for EVERY listing it appears under. Summing snapshots
-- therefore counts the same review once per listing, and filtering by any
-- listing other than the one that won the upsert finds nothing.
--
-- These two views count what the reviews table actually holds, so a chip's
-- number and the result of clicking it are the same number. They do not fix
-- the underlying single-product attachment — see the note at the bottom.
-- =============================================================================

drop view if exists v_review_product_counts;
drop view if exists v_review_brand_counts;

-- One row per product that genuinely has reviews stored against it.
create view v_review_product_counts as
select
  r.product_id,
  p.title                                          as product_title,
  p.handle                                         as product_handle,
  s.id                                             as site_id,
  b.name                                           as brand,
  b.slug                                           as brand_slug,
  count(*)                                         as review_count,
  count(*) filter (where r.is_ratings_only is false) as with_text_count,
  count(*) filter (where r.is_verified_buyer)      as verified_count,
  avg(r.rating)                                    as average_rating,
  max(r.submitted_at)                              as latest_review_at
from reviews r
join products p on p.id = r.product_id
join sites s    on s.id = r.site_id
join brands b   on b.id = s.brand_id
group by r.product_id, p.title, p.handle, s.id, b.name, b.slug;

-- One row per brand, counting distinct stored reviews.
create view v_review_brand_counts as
select
  b.name                                           as brand,
  b.slug                                           as brand_slug,
  count(*)                                         as review_count,
  count(*) filter (where r.is_ratings_only is false) as with_text_count,
  count(*) filter (where r.is_verified_buyer)      as verified_count,
  avg(r.rating)                                    as average_rating
from reviews r
join sites s  on s.id = r.site_id
join brands b on b.id = s.brand_id
group by b.name, b.slug;

-- Counting 14,840 rows per page load is cheap now and will not stay cheap.
create index if not exists reviews_product_rating_idx on reviews(product_id, rating);
create index if not exists reviews_site_verified_idx  on reviews(site_id, is_verified_buyer);

-- =============================================================================
-- KNOWN LIMITATION, recorded here rather than in a ticket nobody reads.
--
-- These views make the UI honest, not complete. A syndicated review is still
-- attached to exactly one product_id — whichever listing the upsert happened to
-- write first — so "reviews for the LABS Project Boomstik® Demos listing" is
-- still unanswerable, and v_review_product_counts simply will not list that
-- product.
--
-- The real fix is a review_products join table: keep reviews deduplicated on
-- their source id, and record one link row per (review, product) the review
-- appears under. Filtering by product then joins through it, snapshots keep
-- their per-listing counts honestly, and reviews.product_id can be dropped.
-- That is a schema change plus a pipeline change plus a re-crawl, so it is
-- deliberately not bundled into this migration.
-- =============================================================================
