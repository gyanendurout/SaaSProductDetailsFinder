import { getVariants, type VariantCurrent } from './queries.js'
import { selectAll } from './supabase.js'
import { median, tierOf, PRICE_TIERS, type PriceTierKey } from './price-tiers.js'

/** Per product, or per purchasable SKU. The two tell different stories. */
export type PriceBasis = 'product' | 'sku'

export interface BrandPriceBand {
  brand: string
  brandSlug: string
  /** Units carrying a usable price. */
  priced: number
  /** Units in the assortment with no price we could read. */
  unpriced: number
  low: number
  median: number
  high: number
  mean: number
  onSale: number
  tiers: Record<PriceTierKey, number>
}

export interface BrandPriceComparison {
  basis: PriceBasis
  bands: BrandPriceBand[]
  /** Shared axis for the range bars, so the brands are visually comparable. */
  floor: number
  ceiling: number
}

function usablePrice(variant: VariantCurrent): number | null {
  const value = Number(variant.price)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Where each brand actually sits on price.
 *
 * The basis matters more than it looks. One brand here carries 196 SKUs across
 * 30 products because it ships many colourways of the same paddle. Counting
 * SKUs lets colourway breadth masquerade as price range, and moves that brand's
 * median by more than a hundred dollars. Counting products treats a paddle as
 * one decision, which is how a buyer meets it. Neither is wrong, so the caller
 * picks and the page states which it used.
 */
export async function getBrandPriceComparison(
  basis: PriceBasis = 'product',
): Promise<BrandPriceComparison> {
  const [variants, brands] = await Promise.all([
    getVariants(),
    selectAll<{ slug: string; name: string }>('brands', 'slug,name'),
  ])

  const slugOf = new Map(brands.map((b) => [b.name, b.slug]))

  // Group to the unit of comparison first, so a product with twelve colourways
  // counts once when the basis is product.
  const units = new Map<string, { brand: string; prices: number[]; onSale: boolean }>()
  for (const variant of variants) {
    const key =
      basis === 'product'
        ? `${variant.brand}::${variant.product_id}`
        : `${variant.brand}::${variant.variant_id}`

    const unit = units.get(key) ?? { brand: variant.brand, prices: [], onSale: false }
    const price = usablePrice(variant)
    if (price !== null) unit.prices.push(price)
    if (variant.is_on_sale) unit.onSale = true
    units.set(key, unit)
  }

  const byBrand = new Map<string, Array<{ price: number | null; onSale: boolean }>>()
  for (const unit of units.values()) {
    const list = byBrand.get(unit.brand) ?? []
    // A product's price is the median of its SKUs: one limited colourway at
    // twice the price should not become the product's price.
    list.push({ price: unit.prices.length ? median(unit.prices) : null, onSale: unit.onSale })
    byBrand.set(unit.brand, list)
  }

  const bands: BrandPriceBand[] = []
  for (const [brand, list] of byBrand) {
    const prices = list.map((u) => u.price).filter((p): p is number => p !== null)
    if (prices.length === 0) continue

    const tiers: Record<PriceTierKey, number> = { value: 0, mid: 0, premium: 0 }
    for (const price of prices) tiers[tierOf(price)] += 1

    bands.push({
      brand,
      brandSlug: slugOf.get(brand) ?? brand.toLowerCase(),
      priced: prices.length,
      unpriced: list.length - prices.length,
      low: Math.min(...prices),
      median: median(prices),
      high: Math.max(...prices),
      mean: prices.reduce((total, price) => total + price, 0) / prices.length,
      onSale: list.filter((u) => u.onSale).length,
      tiers,
    })
  }

  // Highest median first: the question is who plays at the top of the market.
  bands.sort((a, b) => b.median - a.median)

  return {
    basis,
    bands,
    floor: bands.length ? Math.min(...bands.map((b) => b.low)) : 0,
    ceiling: bands.length ? Math.max(...bands.map((b) => b.high)) : 0,
  }
}

export { PRICE_TIERS, tierOf, type PriceTierKey } from './price-tiers.js'
