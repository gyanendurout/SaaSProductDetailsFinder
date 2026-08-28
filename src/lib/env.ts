import 'dotenv/config'
import { z } from 'zod'

/**
 * Supabase credentials are optional at parse time so that `--dry-run` works
 * before a project exists — the scraper and normalization rules can be validated
 * against the live site first. `requireSupabase()` enforces them at the point of
 * first database use, which is where a missing key actually matters.
 */
const schema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-sonnet-5'),
  CRAWL_USER_AGENT: z
    .string()
    .default('ProductFinderBot/0.1 (+internal catalogue research)'),
  CRAWL_DELAY_MS: z.coerce.number().int().positive().default(1200),
  CRAWL_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

/** Validated process env. Fails fast with a readable message on first access. */
export function env(): Env {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(
      `Invalid environment.\n${detail}\n\nCopy .env.example to .env and fill it in.`,
    )
  }
  cached = parsed.data
  return cached
}

export interface SupabaseCredentials {
  url: string
  serviceRoleKey: string
}

export function requireSupabase(): SupabaseCredentials {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env()
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for this command.\n' +
        'Create a Supabase project, apply supabase/migrations, then copy .env.example to .env.\n' +
        'To test the scraper without a database, use: npm run crawl:dry',
    )
  }
  return { url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY }
}

/** LLM fallback is optional; the pipeline runs rules-only without it. */
export function hasLlm(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY)
}
