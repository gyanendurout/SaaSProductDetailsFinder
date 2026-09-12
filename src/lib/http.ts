import { env } from './env.js'
import { createLogger } from './logger.js'

const log = createLogger('http')

export class HttpError extends Error {
  readonly fatal: boolean
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    fatal = false,
  ) {
    super(message)
    this.name = 'HttpError'
    this.fatal = fatal
  }
}

interface RobotsRules {
  disallows: string[]
  allows: string[]
  crawlDelayMs?: number
}

/**
 * Per-host polite fetcher: one request at a time per host, a configurable delay
 * between them, capped retries with exponential backoff, and robots.txt honoured
 * before the first request to a host.
 *
 * Only public unauthenticated endpoints are ever requested. Nothing here
 * bypasses a login, paywall or access control.
 */
export class PoliteClient {
  private lastRequestAt = new Map<string, number>()
  private chain = new Map<string, Promise<void>>()
  private robots = new Map<string, RobotsRules>()
  private effectiveDelay = new Map<string, number>()

  constructor(
    private readonly delayMs = env().CRAWL_DELAY_MS,
    private readonly maxRetries = env().CRAWL_MAX_RETRIES,
    private readonly userAgent = env().CRAWL_USER_AGENT,
  ) {}

  async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.get(url, { Accept: 'application/json', ...headers })
    return (await res.json()) as T
  }

  async getText(url: string, headers: Record<string, string> = {}): Promise<string> {
    const res = await this.get(url, {
      Accept: 'text/html,application/xhtml+xml',
      ...headers,
    })
    return await res.text()
  }

  /** Serialised per host so we never open parallel connections to one site. */
  async get(url: string, headers: Record<string, string> = {}): Promise<Response> {
    const host = new URL(url).host
    const prior = this.chain.get(host) ?? Promise.resolve()
    const result = prior.then(() => this.execute(url, headers))
    // Keep the chain alive even when a link rejects, so one failure cannot
    // wedge every later request to the same host.
    this.chain.set(
      host,
      result.then(
        () => undefined,
        () => undefined,
      ),
    )
    return result
  }

  private async execute(url: string, headers: Record<string, string>): Promise<Response> {
    await this.assertAllowed(url)
    const host = new URL(url).host

    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.throttle(host)
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': this.userAgent,
            // Blank, deliberately, and load-bearing.
            //
            // Node's fetch sends `Accept-Language: *` by default. Shopify reads
            // it to pick a market, and on a multi-market store that silently
            // returns another market's prices in that market's currency, with
            // no currency field anywhere in the JSON to give it away. On
            // crbnpickleball.com a $223.99 paddle came back as 21800.00 —
            // plausible-looking numbers that would have been stored as USD.
            //
            // Any value triggers it, 'en-US' included; only a blank header
            // matches what curl sends and yields the store's primary market.
            'Accept-Language': '',
            ...headers,
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(45_000),
        })
        this.lastRequestAt.set(host, Date.now())

        // 429 and 5xx are worth retrying; other 4xx will not improve.
        if (res.status === 429 || res.status >= 500) {
          throw new HttpError(`HTTP ${res.status}`, res.status, url, false)
        }
        if (!res.ok) {
          throw new HttpError(`HTTP ${res.status}`, res.status, url, true)
        }
        return res
      } catch (err) {
        lastError = err
        this.lastRequestAt.set(host, Date.now())
        if (err instanceof HttpError && err.fatal) break
        if (attempt === this.maxRetries) break
        const backoff = this.delayMs * 2 ** attempt
        log.warn(`retry ${attempt + 1}/${this.maxRetries} in ${backoff}ms`, { url })
        await sleep(backoff)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private async throttle(host: string): Promise<void> {
    const last = this.lastRequestAt.get(host)
    if (last === undefined) return
    const delay = this.effectiveDelay.get(host) ?? this.delayMs
    const wait = delay - (Date.now() - last)
    if (wait > 0) await sleep(wait)
  }

  /** Fetches and caches robots.txt per host, then enforces its Disallow rules. */
  private async assertAllowed(url: string): Promise<void> {
    const { origin, pathname, host } = new URL(url)
    let rules = this.robots.get(host)
    if (!rules) {
      rules = await this.loadRobots(origin)
      this.robots.set(host, rules)
      const requested = rules.crawlDelayMs ?? 0
      // Honour a longer crawl-delay than ours; never a shorter one.
      this.effectiveDelay.set(host, Math.max(this.delayMs, requested))
      if (requested > this.delayMs) {
        log.info('robots.txt requests a longer delay; honouring it', {
          host,
          crawlDelayMs: requested,
        })
      }
    }
    if (!isAllowedByRobots(pathname, rules)) {
      throw new HttpError(`Blocked by robots.txt: ${url}`, 0, url, true)
    }
  }

  private async loadRobots(origin: string): Promise<RobotsRules> {
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return { disallows: [], allows: [] }
      return parseRobots(await res.text())
    } catch {
      // A missing or unreachable robots.txt is not permission to hammer; the
      // per-host delay still applies.
      return { disallows: [], allows: [] }
    }
  }
}

/**
 * Robots parser: the wildcard group only, which is the group binding us.
 *
 * `Allow` is parsed as well as `Disallow`, because ignoring it is not the safe
 * simplification it looks like. Yotpo publishes:
 *
 *     Disallow: /
 *     Allow: /v1/widget/*
 *
 * — a deny-by-default policy that then names the public widget endpoints as
 * open. Reading only the Disallow line turns "everything except these" into
 * "everything", which blocked all 15 of GAMMA's products on a path the host
 * explicitly permits.
 */
export function parseRobots(text: string): RobotsRules {
  const disallows: string[] = []
  const allows: string[] = []
  let crawlDelayMs: number | undefined
  let inWildcardGroup = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0]?.trim() ?? ''
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()

    if (key === 'user-agent') {
      inWildcardGroup = value === '*'
    } else if (inWildcardGroup && key === 'disallow' && value) {
      disallows.push(value)
    } else if (inWildcardGroup && key === 'allow' && value) {
      allows.push(value)
    } else if (inWildcardGroup && key === 'crawl-delay') {
      const secs = Number(value)
      if (Number.isFinite(secs)) crawlDelayMs = secs * 1000
    }
  }
  return crawlDelayMs === undefined ? { disallows, allows } : { disallows, allows, crawlDelayMs }
}

/**
 * RFC 9309 matching: the most specific rule wins, and Allow wins a tie.
 *
 * Specificity is the length of the pattern that matched, so `/v1/widget/*` (12
 * characters) beats `/` (1). A path matched by no rule is allowed.
 */
export function isAllowedByRobots(pathname: string, rules: RobotsRules): boolean {
  const longest = (patterns: string[]): number =>
    patterns.reduce((best, p) => (matchesRobotsPattern(pathname, p) ? Math.max(best, p.length) : best), -1)

  const deny = longest(rules.disallows)
  if (deny === -1) return true
  return longest(rules.allows) >= deny
}

/** `*` matches any run of characters; a trailing `$` anchors the end. */
export function matchesRobotsPattern(pathname: string, pattern: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const source =
    body
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*') + (anchored ? '$' : '')
  return new RegExp('^' + source).test(pathname)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
