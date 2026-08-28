/**
 * Applies supabase/migrations/*.sql over a direct Postgres connection.
 *
 * Exists because `supabase db push` requires the CLI to be logged in as an
 * account that owns the project, which is not always the account on the machine.
 * This path needs only the database URL, works identically in CI, and records
 * what it applied so re-running is safe.
 *
 *   npm run migrate           apply anything not yet applied
 *   npm run migrate -- --dry  list what would be applied
 */
import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createLogger } from '../src/lib/logger.js'

const log = createLogger('migrate')
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')

const LEDGER = `
create table if not exists schema_migrations (
  version     text primary key,
  name        text not null,
  applied_at  timestamptz not null default now()
)`

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry')
  const connectionString = process.env['SUPABASE_DB_URL']

  if (!connectionString) {
    throw new Error(
      'SUPABASE_DB_URL is not set.\n\n' +
        'Supabase dashboard > Project Settings > Database > Connection string > URI,\n' +
        'then put it in .env as:\n' +
        '  SUPABASE_DB_URL=postgresql://postgres:<PASSWORD>@db.<ref>.supabase.co:5432/postgres\n\n' +
        'If your password contains @ : / ? # or %, URL-encode it (@ becomes %40).',
    )
  }

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  if (files.length === 0) throw new Error(`No .sql files in ${MIGRATIONS_DIR}`)

  const client = new pg.Client({
    connectionString,
    // Supabase terminates TLS at its edge with a certificate chain node does not
    // ship a root for. The connection is still encrypted.
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120_000,
  })

  await client.connect()
  log.info('connected', { host: new URL(connectionString).host })

  try {
    await client.query(LEDGER)
    const { rows } = await client.query<{ version: string }>('select version from schema_migrations')
    const applied = new Set(rows.map((r) => r.version))

    const pending = files.filter((f) => !applied.has(version(f)))
    if (pending.length === 0) {
      log.info('nothing to apply; database is up to date', { applied: applied.size })
      return
    }
    log.info(`${pending.length} migration(s) pending`, { pending })
    if (dryRun) return

    for (const file of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
      log.info(`applying ${file}`)
      // Each migration is one transaction: a failure halfway leaves no partial
      // schema behind, so a fixed migration can simply be re-run.
      await client.query('begin')
      try {
        await client.query(sql)
        await client.query(
          'insert into schema_migrations (version, name) values ($1, $2) on conflict do nothing',
          [version(file), file],
        )
        await client.query('commit')
        log.info(`applied  ${file}`)
      } catch (err) {
        await client.query('rollback')
        const message = err instanceof Error ? err.message : String(err)
        const position = (err as { position?: string }).position
        throw new Error(
          `${file} failed and was rolled back: ${message}` +
            (position ? `\n  near character ${position}: ${excerpt(sql, Number(position))}` : ''),
        )
      }
    }
    log.info('all migrations applied')
  } finally {
    await client.end()
  }
}

function version(filename: string): string {
  return filename.split('_')[0] ?? filename
}

/** A little context around a syntax error, so the message is actionable. */
function excerpt(sql: string, position: number): string {
  const start = Math.max(0, position - 60)
  return `...${sql.slice(start, position + 60).replace(/\s+/g, ' ')}...`
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
