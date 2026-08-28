import { PoliteClient } from '../../lib/http.js'
import { createLogger } from '../../lib/logger.js'
import type {
  RawCategory,
  RawProduct,
  RawVariant,
  SiteTarget,
  SourceAdapter,
} from '../types.js'

const log = createLogger('shopify')

/** Shopify caps these endpoints at 250 per page. */
const PAGE_SIZE = 250
/** Refuse to page forever if a store misbehaves. */
const MAX_PAGES = 40

interface ShopifyVariant {
  id: number
  title: string | null
  sku: string | null
  barcode?: string | null
  position?: number | null
  option1: string | null
  option2: string | null
  option3: string | null
  price: string | null
  compare_at_price: string | null
  available?: boolean | null
  featured_image?: { src?: string | null } | null
}

interface ShopifyProduct {
  id: number
  title: string
  handle: string
  vendor?: string | null
  product_type?: string | null
  tags?: string[] | string | null
  body_html?: string | null
  published_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  options?: Array<{ name: string; values: string[] }> | null
  variants: ShopifyVariant[]
  images?: Array<{ src?: string | null }> | null
}

interface ShopifyCollection {
  id: number
  handle: string
  title: string
  description?: string | null
  products_count?: number | null
  published_at?: string | null
}

/**
 * Reads a Shopify storefront through its public, unauthenticated JSON endpoints:
 *
 *   /collections.json                        every published collection
 *   /collections/<handle>/products.json      products in one collection
 *
 * These carry exact SKUs, prices, compare_at_price and availability, which is
 * why they are preferred over rendering the DOM. Verified open on joola.com
 * 2026-08-27.
 */
export class ShopifyAdapter implements SourceAdapter {
  readonly platform = 'shopify'

  constructor(private readonly http: PoliteClient = new PoliteClient()) {}

  async fetchCategories(site: SiteTarget): Promise<RawCategory[]> {
    const out: RawCategory[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${site.baseUrl}/collections.json?limit=${PAGE_SIZE}&page=${page}`
      const body = await this.http.getJson<{ collections?: ShopifyCollection[] }>(url)
      const batch = body.collections ?? []
      for (const c of batch) {
        out.push({
          sourceCategoryId: String(c.id),
          handle: c.handle,
          title: c.title,
          description: stripHtml(c.description ?? null),
          url: `${site.baseUrl}/collections/${c.handle}`,
          productCount: c.products_count ?? null,
        })
      }
      if (batch.length < PAGE_SIZE) break
    }
    log.info('collections fetched', { count: out.length })
    return out
  }

  async fetchProducts(site: SiteTarget): Promise<RawProduct[]> {
    // Keyed by source product id so a product appearing in several collections
    // becomes one row carrying every collection it was found in.
    const merged = new Map<string, RawProduct>()

    for (const handle of site.assortmentHandles) {
      let found = 0
      try {
        for (let page = 1; page <= MAX_PAGES; page++) {
          const url = `${site.baseUrl}/collections/${handle}/products.json?limit=${PAGE_SIZE}&page=${page}`
          const body = await this.http.getJson<{ products?: ShopifyProduct[] }>(url)
          const batch = body.products ?? []
          for (const p of batch) {
            const id = String(p.id)
            const existing = merged.get(id)
            if (existing) {
              if (!existing.categoryHandles.includes(handle)) {
                existing.categoryHandles.push(handle)
              }
            } else {
              merged.set(id, this.toRawProduct(p, site, [handle]))
            }
          }
          found += batch.length
          if (batch.length < PAGE_SIZE) break
        }
        log.info('collection scanned', { handle, found })
      } catch (err) {
        // One missing or renamed collection must not abort the whole crawl —
        // the pipeline records it and carries on with the rest.
        log.warn('collection failed', { handle, error: String(err) })
        throw Object.assign(new Error(`collection ${handle}: ${String(err)}`), {
          target: handle,
        })
      }
    }
    return [...merged.values()]
  }

  private toRawProduct(p: ShopifyProduct, site: SiteTarget, handles: string[]): RawProduct {
    const optionNames = (p.options ?? []).map((o) => o.name)
    return {
      sourceProductId: String(p.id),
      handle: p.handle,
      title: p.title,
      vendor: p.vendor ?? null,
      productType: p.product_type ?? null,
      tags: normaliseTags(p.tags),
      bodyHtml: p.body_html ?? null,
      url: `${site.baseUrl}/products/${p.handle}`,
      imageUrl: p.images?.[0]?.src ?? null,
      publishedAt: p.published_at ?? null,
      sourceCreatedAt: p.created_at ?? null,
      sourceUpdatedAt: p.updated_at ?? null,
      categoryHandles: [...handles],
      variants: p.variants.map((v) => this.toRawVariant(v, optionNames, site.currency)),
    }
  }

  private toRawVariant(
    v: ShopifyVariant,
    optionNames: string[],
    currency: string,
  ): RawVariant {
    const options: Array<{ name: string; value: string }> = []
    for (const [i, value] of [v.option1, v.option2, v.option3].entries()) {
      // Shopify pads single-variant products with the placeholder
      // 'Title: Default Title'. It carries no information; drop it so the
      // normalizer is not tempted to read meaning into it.
      if (!value) continue
      const name = optionNames[i] ?? `option${i + 1}`
      if (name === 'Title' && value === 'Default Title') continue
      options.push({ name, value })
    }
    return {
      sourceVariantId: String(v.id),
      sku: v.sku || null,
      barcode: v.barcode ?? null,
      title: v.title ?? null,
      position: v.position ?? null,
      imageUrl: v.featured_image?.src ?? null,
      options,
      price: toNumber(v.price),
      compareAtPrice: toNumber(v.compare_at_price),
      currency,
      isAvailable: v.available ?? null,
    }
  }
}

function toNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Shopify returns tags as an array on some endpoints and a CSV string on others. */
function normaliseTags(tags: string[] | string | null | undefined): string[] {
  if (!tags) return []
  const list = Array.isArray(tags) ? tags : tags.split(',')
  return list.map((t) => t.trim()).filter(Boolean)
}

export function stripHtml(html: string | null): string | null {
  if (!html) return null
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
