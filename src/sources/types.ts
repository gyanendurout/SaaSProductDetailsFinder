/**
 * The extension seam for brand #2 and platform #2.
 *
 * A source adapter's only job is to turn a storefront into these three plain
 * shapes. It performs no normalization and no database work — that keeps the
 * pipeline, the schema and the normalizer identical across platforms, so adding
 * a WooCommerce brand is one new file rather than a fork of the pipeline.
 */

export interface RawCategory {
  sourceCategoryId: string
  handle: string
  title: string
  description?: string | null
  url?: string | null
  position?: number | null
  productCount?: number | null
  /** Parent handle, when the source exposes a hierarchy. Resolved to ids later. */
  parentHandle?: string | null
  navPath?: string[]
  inMainNav?: boolean
}

export interface RawVariant {
  sourceVariantId: string
  sku?: string | null
  barcode?: string | null
  title?: string | null
  position?: number | null
  imageUrl?: string | null
  /** Option names/values exactly as published, no interpretation. */
  options: Array<{ name: string; value: string }>
  price: number | null
  compareAtPrice: number | null
  currency: string
  isAvailable: boolean | null
  inventoryQuantity?: number | null
}

export interface RawProduct {
  sourceProductId: string
  handle: string
  title: string
  vendor?: string | null
  productType?: string | null
  tags: string[]
  bodyHtml?: string | null
  url: string
  imageUrl?: string | null
  publishedAt?: string | null
  sourceCreatedAt?: string | null
  sourceUpdatedAt?: string | null
  variants: RawVariant[]
  /** Handles of the collections this product was found in. */
  categoryHandles: string[]
}

/** PDP detail that the catalogue feed does not carry. */
export interface RawProductContent {
  sourceProductId: string
  description?: string | null
  specs: Record<string, string>
  technologies: string[]
  media: Array<{ type: string; url: string; alt?: string | null }>
  breadcrumb: string[]
}

export interface SiteTarget {
  siteId: string
  baseUrl: string
  currency: string
  assortmentHandles: string[]
}

export interface SourceAdapter {
  readonly platform: string
  /** Every collection the storefront publishes. */
  fetchCategories(site: SiteTarget): Promise<RawCategory[]>
  /**
   * Products for the declared assortment. Implementations must de-duplicate
   * across collections and merge the categoryHandles of each occurrence.
   */
  fetchProducts(site: SiteTarget): Promise<RawProduct[]>
  /** Optional PDP enrichment. Omit when the platform has nothing extra to give. */
  fetchProductContent?(site: SiteTarget, handles: string[]): Promise<RawProductContent[]>
}
