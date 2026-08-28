import { db, selectAll } from '../lib/supabase.js'
import { slugify } from '../lib/hash.js'

/**
 * Reference-data access with get-or-create semantics.
 *
 * Product lines, generations, players and models are discovered during a crawl,
 * not known in advance. Each cache is loaded once per run and written through on
 * a miss, so a new series appearing on the site becomes a first-class row rather
 * than an unmatched string.
 */
export class ReferenceRepo {
  private lines = new Map<string, string>() // slug -> id
  private lineNames = new Map<string, string>() // slug -> display name
  private generations = new Map<string, string>()
  private players = new Map<string, string>() // slug -> id
  private playerNames = new Map<string, string>() // slug -> display name
  private models = new Map<string, string>()

  constructor(private readonly brandId: string) {}

  async load(): Promise<void> {
    const [lines, generations, players, models] = await Promise.all([
      selectAll<{ id: string; slug: string; name: string }>('product_lines', 'id,slug,name', (q) =>
        q.eq('brand_id', this.brandId),
      ),
      selectAll<{ id: string; slug: string }>('generations', 'id,slug', (q) =>
        q.eq('brand_id', this.brandId),
      ),
      selectAll<{ id: string; slug: string; name: string }>('players', 'id,slug,name', (q) =>
        q.eq('brand_id', this.brandId),
      ),
      selectAll<{ id: string; slug: string }>('models', 'id,slug', (q) =>
        q.eq('brand_id', this.brandId),
      ),
    ])
    for (const l of lines) {
      this.lines.set(l.slug, l.id)
      this.lineNames.set(l.slug, l.name)
    }
    for (const g of generations) this.generations.set(g.slug, g.id)
    for (const p of players) {
      this.players.set(p.slug, p.id)
      this.playerNames.set(p.slug, p.name)
    }
    for (const m of models) this.models.set(m.slug, m.id)
  }

  /** slug -> display name, for the model resolver's line matching. */
  knownLines(): ReadonlyMap<string, string> {
    return this.lineNames
  }

  /** Seed names for the attribute extractor's signature-tag matching. */
  knownPlayerNames(): string[] {
    return [...this.playerNames.values()]
  }

  async getOrCreateLine(slug: string, name: string): Promise<string> {
    const hit = this.lines.get(slug)
    if (hit) return hit
    const id = await this.insertOne('product_lines', { brand_id: this.brandId, slug, name }, 'brand_id,slug')
    this.lines.set(slug, id)
    this.lineNames.set(slug, name)
    return id
  }

  async getOrCreateGeneration(slug: string, name: string): Promise<string> {
    const hit = this.generations.get(slug)
    if (hit) return hit
    const id = await this.insertOne('generations', { brand_id: this.brandId, slug, name }, 'brand_id,slug')
    this.generations.set(slug, id)
    return id
  }

  async getOrCreatePlayer(name: string): Promise<string> {
    const slug = slugify(name)
    const hit = this.players.get(slug)
    if (hit) return hit
    const id = await this.insertOne('players', { brand_id: this.brandId, slug, name }, 'brand_id,slug')
    this.players.set(slug, id)
    this.playerNames.set(slug, name)
    return id
  }

  async getOrCreateModel(input: {
    slug: string
    name: string
    productLineId: string | null
    generationId: string | null
    subLine: string | null
    skillTier: string
    shape: string
    playStyle?: string
  }): Promise<string> {
    const hit = this.models.get(input.slug)
    if (hit) return hit
    const id = await this.insertOne(
      'models',
      {
        brand_id: this.brandId,
        slug: input.slug,
        name: input.name,
        product_line_id: input.productLineId,
        generation_id: input.generationId,
        sub_line: input.subLine,
        skill_tier: input.skillTier,
        shape: input.shape,
        play_style: input.playStyle ?? 'unknown',
      },
      'brand_id,slug',
    )
    this.models.set(input.slug, id)
    return id
  }

  /**
   * Upsert-and-return-id. `ignoreDuplicates: false` makes a concurrent insert
   * resolve to the existing row instead of throwing, which matters when two
   * products in the same batch discover the same new line.
   */
  private async insertOne(
    table: string,
    row: Record<string, unknown>,
    onConflict: string,
  ): Promise<string> {
    const { data, error } = await db()
      .from(table)
      .upsert(row, { onConflict, ignoreDuplicates: false })
      .select('id')
      .single()
    if (error) throw new Error(`upsert ${table}: ${error.message}`)
    return (data as { id: string }).id
  }
}
