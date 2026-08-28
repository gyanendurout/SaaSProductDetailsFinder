import { createHash } from 'node:crypto'

/**
 * Stable sha256 over an arbitrary value. Object keys are sorted so that two
 * structurally identical payloads always hash the same, which is what lets
 * product_content skip writing a row when nothing actually changed.
 */
export function stableHash(value: unknown): string {
  return createHash('sha256').update(canonicalise(value)).digest('hex')
}

function canonicalise(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/** URL/DB-safe slug. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
