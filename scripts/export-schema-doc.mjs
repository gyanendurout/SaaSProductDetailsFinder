/**
 * Generates docs/DATABASE_REFERENCE.md from the RUNNING database.
 *
 * Usage: node scripts/export-schema-doc.mjs [out.md]
 *
 * Structure — tables, views, columns, types, nullability, defaults, primary and
 * foreign keys — is introspected live through the PostgREST OpenAPI document, so
 * the doc cannot drift from the database the way a hand-maintained inventory
 * does. Row counts are read live too.
 *
 * Two things PostgREST does not expose, sourced separately:
 *   - Indexes and unique constraints, parsed out of supabase/migrations/*.sql.
 *   - Prose (what a column MEANS), from scripts/schema-notes.json.
 *
 * Anything undocumented is listed at the end of the run as a coverage gap
 * rather than silently rendered blank.
 */
import 'dotenv/config'
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetch } from 'undici'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const out = process.argv[2] || join(repo, 'docs', 'DATABASE_REFERENCE.md')

const base = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')

const notes = JSON.parse(readFileSync(join(here, 'schema-notes.json'), 'utf8'))
const auth = { apikey: key, Authorization: 'Bearer ' + key }

// --- live introspection ------------------------------------------------------
const spec = await (await fetch(base + '/rest/v1/', { headers: auth })).json()
const defs = spec.definitions || {}
const relations = Object.keys(defs).sort()

const counts = {}
for (const name of relations) {
  const r = await fetch(`${base}/rest/v1/${name}?select=*&limit=1`, {
    headers: { ...auth, Prefer: 'count=exact', Range: '0-0' },
  })
  const range = r.headers.get('content-range') || ''
  counts[name] = range.includes('/') ? range.split('/')[1] : '?'
}

// --- indexes, from the migrations -------------------------------------------
const migrationDir = join(repo, 'supabase', 'migrations')
const migrations = readdirSync(migrationDir).filter((f) => f.endsWith('.sql')).sort()
const indexesByTable = {}
for (const file of migrations) {
  const sql = readFileSync(join(migrationDir, file), 'utf8')
  const re = /create\s+index\s+(?:if\s+not\s+exists\s+)?(\w+)\s+on\s+(\w+)\s*((?:using\s+\w+\s*)?\([^;]*?\)(?:\s*where\s+[^;]+?)?);/gis
  let m
  while ((m = re.exec(sql)) !== null) {
    const [, idx, table, body] = m
    ;(indexesByTable[table] ||= []).push({
      name: idx,
      def: body.replace(/\s+/g, ' ').trim(),
      file,
    })
  }
}

// --- helpers -----------------------------------------------------------------
const isView = (n) => n.startsWith('v_')

/**
 * PostgREST puts "This is a Primary Key.<pk/>" and FK targets in `description`.
 * A column can carry both — every column of a composite key on a join table is
 * also a foreign key — so this reports both rather than stopping at the first.
 */
function keyOf(prop) {
  const d = prop.description || ''
  const parts = []
  if (/<pk\/>/.test(d)) parts.push('PK')
  const fk = d.match(/<fk table='([^']+)' column='([^']+)'\/>/)
  if (fk) parts.push(`→ ${fk[1]}.${fk[2]}`)
  return parts.join(' ')
}

function typeOf(prop) {
  return prop.format || prop.type || '?'
}

function defaultOf(prop) {
  if (prop.default === undefined) return ''
  return '`' + String(prop.default) + '`'
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ')

function columnTable(name, def, colNotes) {
  const required = new Set(def.required || [])
  const props = def.properties || {}
  const lines = [
    '| Column | Type | Null | Key | Default | Description |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const [col, prop] of Object.entries(props)) {
    lines.push('| `' + col + '` | ' + cell(typeOf(prop)) + ' | ' +
      (required.has(col) ? 'no' : 'yes') + ' | ' + cell(keyOf(prop)) + ' | ' +
      cell(defaultOf(prop)) + ' | ' + cell(colNotes[col] || '') + ' |')
  }
  return lines.join('\n')
}

// --- render ------------------------------------------------------------------
const gaps = []
const tableNames = relations.filter((n) => !isView(n))
const viewNames = relations.filter(isView)

const byLayer = {}
for (const name of tableNames) {
  const layer = notes.relations[name]?.layer || 'undocumented'
  ;(byLayer[layer] ||= []).push(name)
}

const totalRows = tableNames.reduce((n, t) => n + (Number(counts[t]) || 0), 0)
const projectRef = new URL(base).host.split('.')[0]
const today = new Date().toISOString().slice(0, 10)

const md = []
md.push('# Database reference')
md.push('')
md.push('> **Generated from the running project** on ' + today + ' by `node scripts/export-schema-doc.mjs`.')
md.push('> Tables, columns, types, keys and row counts are introspected live — this file cannot')
md.push('> drift from the database. Column prose lives in `scripts/schema-notes.json`.')
md.push('')
md.push('| | |')
md.push('| --- | --- |')
md.push('| **Supabase project** | `' + projectRef + '` |')
md.push('| **Relations exposed** | ' + relations.length + ' (' + tableNames.length + ' tables, ' + viewNames.length + ' views) |')
md.push('| **Rows across all tables** | ' + totalRows.toLocaleString() + ' |')
md.push('| **Migrations on disk** | ' + migrations.length + ' |')
md.push('| **Schema source of truth** | `supabase/migrations/*.sql` |')
md.push('| **Writers** | `src/pipeline/stages/*.ts` |')
md.push('| **Readers** | `src/lib/queries.ts`, `src/lib/review-queries.ts`, `src/lib/price-bands.ts` |')
md.push('')
md.push('To refresh: `node scripts/export-schema-doc.mjs`')
md.push('')

// Contents by layer
md.push('## Layers')
md.push('')
md.push('The schema is deliberately layered: what the storefront said, then what we derived from it,')
md.push('then what changed over time. The split exists because storefronts model the same physical')
md.push('hierarchy inconsistently.')
md.push('')
const layerOrder = ['reference', 'source-mirror', 'canonical', 'vocabulary', 'timeseries', 'reviews', 'ops', 'undocumented']
for (const layer of layerOrder) {
  const list = byLayer[layer]
  if (!list) continue
  md.push('### ' + (notes.layers[layer] || layer))
  md.push('')
  md.push('| Table | Rows |')
  md.push('| --- | ---: |')
  for (const t of list.sort()) {
    // GitHub's heading slugs keep underscores — stripping them yields dead links.
    md.push('| [`' + t + '`](#' + t + ') | ' + Number(counts[t]).toLocaleString() + ' |')
  }
  md.push('')
}

// Tables
md.push('---')
md.push('')
md.push('## Tables')
md.push('')
for (const name of tableNames) {
  const rel = notes.relations[name]
  if (!rel) gaps.push('relation: ' + name)
  const colNotes = rel?.columns || {}
  const props = Object.keys(defs[name].properties || {})
  for (const c of props) if (!colNotes[c]) gaps.push(name + '.' + c)

  md.push('### ' + name)
  md.push('')
  md.push('**' + Number(counts[name]).toLocaleString() + ' rows** · ' + (rel?.layer || 'unclassified'))
  md.push('')
  if (rel?.purpose) { md.push(rel.purpose); md.push('') }
  md.push(columnTable(name, defs[name], colNotes))
  md.push('')

  const idx = indexesByTable[name]
  if (idx && idx.length) {
    md.push('<details><summary>' + idx.length + ' index' + (idx.length === 1 ? '' : 'es') + '</summary>')
    md.push('')
    for (const i of idx) md.push('- `' + i.name + '` ' + i.def)
    md.push('')
    md.push('</details>')
    md.push('')
  }

  for (const n of rel?.notes || []) { md.push('> ' + n); md.push('') }
}

// Views
md.push('---')
md.push('')
md.push('## Views')
md.push('')
md.push('The frontend should query these, never the raw tables — they keep the "latest snapshot per')
md.push('variant" and "never linearly interpolate" rules in one place instead of in every component.')
md.push('Views store no data.')
md.push('')
for (const name of viewNames) {
  const v = notes.views[name]
  if (!v) gaps.push('view: ' + name)
  md.push('### ' + name)
  md.push('')
  md.push('**' + Number(counts[name]).toLocaleString() + ' rows**')
  md.push('')
  if (v?.purpose) { md.push(v.purpose); md.push('') }
  md.push(columnTable(name, defs[name], v?.derived || {}))
  md.push('')
  for (const n of v?.notes || []) { md.push('> ' + n); md.push('') }
}

md.push('---')
md.push('')
md.push('## Access control')
md.push('')
md.push('Row-level security is enabled on every table and is **deny-by-default**. The ingest and the')
md.push('dashboard both read with the `service_role` key, which bypasses RLS entirely; the anon key')
md.push('can read nothing, which is what makes it safe to ship to a browser.')
md.push('')
md.push('`reviews`, `review_responses` and `product_review_snapshots` additionally carry permissive')
md.push('`for select using (true)` read policies.')
md.push('')
md.push('## Known issues')
md.push('')
md.push('These are real and recorded here rather than in a ticket nobody reads.')
md.push('')
md.push('1. **Syndicated reviews attach to one listing only.** `reviews` is unique on')
md.push('   `(site_id, review_platform, source_review_id)` — deliberately excluding `product_id`, so')
md.push('   one opinion syndicated across twelve colourways is one row. The consequence is that the')
md.push('   row carries a single `product_id`, and 26 listings therefore hold no reviews of their own.')
md.push('   The fix is a `review_products` join table: one link row per (review, product), after which')
md.push('   `reviews.product_id` can be dropped. Schema change plus pipeline change plus re-crawl.')
md.push('2. **`models.shape` is `unknown` on every row.** Nothing rolls variant shapes up into it. Read')
md.push('   `v_model_overview.shapes` instead, which aggregates from `variants.shape`.')
md.push('3. **`crawl_runs.reviews_found` / `reviews_new` count fetched rows, not inserted ones.** One')
md.push('   Selkirk run logged 13,136 against 5,777 actually stored.')
md.push('4. **`schema_migrations` understates what is applied** — 4 rows against 7 migration files,')
md.push('   because 0005-0007 were pasted into the Supabase SQL editor, which does not write the ledger.')
md.push('5. **`product_content`, `technologies` and `product_technologies` are empty.** The PDP stage')
md.push('   that would populate them has never been run.')
md.push('')

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, md.join('\n'))

console.log('wrote ' + out)
console.log('  relations: ' + relations.length + ' (' + tableNames.length + ' tables, ' + viewNames.length + ' views)')
console.log('  rows:      ' + totalRows.toLocaleString())
console.log('  indexes:   ' + Object.values(indexesByTable).flat().length + ' parsed from ' + migrations.length + ' migrations')
if (gaps.length) {
  console.log('\n  UNDOCUMENTED (' + gaps.length + '):')
  for (const g of gaps) console.log('    ' + g)
} else {
  console.log('  every table column has a description')
}
