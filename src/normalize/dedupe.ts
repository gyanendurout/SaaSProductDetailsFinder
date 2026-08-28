import type { RawProduct } from '../sources/types.js'
import type { BrandRules } from '../config/brands/types.js'

/**
 * Resolves one physical SKU being listed on more than one product page.
 *
 * Selkirk publishes each paddle family twice: an umbrella product carrying
 * every shape as a variant option, and a per-shape product repeating the same
 * Shopify variant ids.
 *
 *   /amped-control          30 variants  [Shape|Color|Weight]
 *   /amped-control-epic     10 variants  — the same 10 ids as the umbrella's Epic
 *   /amped-control-invikta  10 variants  — likewise
 *   /amped-control-s2       10 variants  — likewise
 *
 * That is not a scraping artefact: both pages are live, and the variant ids are
 * identical because it is one saleable SKU presented two ways. `variants` is
 * unique on (site_id, source_variant_id) — correctly, since a SKU exists once
 * per storefront — so the duplicates collide, and Postgres rejects an upsert
 * whose batch touches the same row twice:
 *
 *   ON CONFLICT DO UPDATE command cannot affect row a second time
 *
 * The fix is to decide which product owns the SKU rather than to relax the
 * constraint. Relaxing it to (product_id, source_variant_id) would store the
 * AMPED Control range twice and inflate every SKU count and stock percentage.
 *
 * The umbrella wins. It is the listing that groups the family, its Shape option
 * is what `variants.shape` is populated from, and keeping it produces one
 * "AMPED Control" model with a shapes array — the same structure JOOLA's Pro V
 * produces — rather than three fragments that cannot be compared with anything.
 * No attribute is lost in the trade: within a cluster both pages carry the same
 * option dimensions.
 *
 * A product left with no variants is dropped, but its collection memberships
 * are merged into the winner first. Those handles are how skill tier and play
 * style are resolved, so discarding them would quietly degrade classification.
 */

export interface DedupeResult {
  products: RawProduct[]
  /** Variants reassigned from a duplicate listing to the owning one. */
  movedVariants: number
  /** Products that held nothing but duplicates and were folded into the owner. */
  droppedProducts: number
}

export function dedupeVariantsAcrossProducts(
  products: RawProduct[],
  rules: BrandRules,
): DedupeResult {
  const owners = new Map<string, RawProduct[]>()
  for (const p of products) {
    for (const v of p.variants) {
      const list = owners.get(v.sourceVariantId)
      if (list) list.push(p)
      else owners.set(v.sourceVariantId, [p])
    }
  }

  // Nothing contested — the common case, and JOOLA's case.
  const contested = [...owners.values()].filter((ps) => ps.length > 1)
  if (contested.length === 0) {
    return { products, movedVariants: 0, droppedProducts: 0 }
  }

  const ownerOf = new Map<string, string>() // variant id -> winning product id
  for (const [variantId, candidates] of owners) {
    if (candidates.length < 2) continue
    ownerOf.set(variantId, pickOwner(candidates, rules).sourceProductId)
  }

  let movedVariants = 0
  const kept: RawProduct[] = []
  const extraHandles = new Map<string, Set<string>>() // winner id -> handles to inherit

  for (const p of products) {
    const mine = p.variants.filter((v) => {
      const winner = ownerOf.get(v.sourceVariantId)
      return winner === undefined || winner === p.sourceProductId
    })
    if (mine.length === p.variants.length) {
      kept.push(p)
      continue
    }
    movedVariants += p.variants.length - mine.length

    if (mine.length === 0) {
      // Fold this listing's shelves into whichever product took its SKUs.
      for (const v of p.variants) {
        const winner = ownerOf.get(v.sourceVariantId)
        if (!winner) continue
        const set = extraHandles.get(winner) ?? new Set<string>()
        for (const h of p.categoryHandles) set.add(h)
        extraHandles.set(winner, set)
      }
      continue
    }
    kept.push({ ...p, variants: mine })
  }

  const droppedProducts = products.length - kept.length

  const merged = kept.map((p) => {
    const extra = extraHandles.get(p.sourceProductId)
    if (!extra) return p
    return { ...p, categoryHandles: [...new Set([...p.categoryHandles, ...extra])] }
  })

  return { products: merged, movedVariants, droppedProducts }
}

/**
 * The consolidated listing, decided in order:
 *
 *   1. most variants — the umbrella carries the whole family
 *   2. not named after a shape — "VANGUARD Power Air" over "vanguard-air-s2",
 *      which is the tie-break when a family has exactly one shape sub-page
 *   3. shortest handle, then id — arbitrary but stable, so a re-run agrees
 */
function pickOwner(candidates: RawProduct[], rules: BrandRules): RawProduct {
  return [...candidates].sort((a, b) => {
    if (a.variants.length !== b.variants.length) return b.variants.length - a.variants.length
    const aShape = isShapeNamed(a, rules)
    const bShape = isShapeNamed(b, rules)
    if (aShape !== bShape) return aShape ? 1 : -1
    if (a.handle.length !== b.handle.length) return a.handle.length - b.handle.length
    return a.sourceProductId.localeCompare(b.sourceProductId)
  })[0]!
}

/**
 * Does the handle's trailing segment name a shape? Only the tail counts:
 * "amped-control-epic" is a shape sub-page, while a family genuinely called
 * "Epic Something" would carry the word up front.
 */
function isShapeNamed(product: RawProduct, rules: BrandRules): boolean {
  const tail = product.handle.split('-').slice(-1)[0] ?? ''
  if (!tail) return false
  return rules.shapeAliases.some((a) => new RegExp(`^${a.pattern.source}$`, 'i').test(tail))
}
