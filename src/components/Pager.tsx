'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import {
  REVIEW_PAGE_SIZES,
  pageAfterResize,
  pageWindow,
  type PageToken,
} from '../lib/pagination.js'

interface PagerProps {
  page: number
  lastPage: number
  pageSize: number
}

/**
 * Page navigation for a list that is far too long to enumerate.
 *
 * Reads the current filters straight out of the URL rather than taking them as
 * props, for the same reason BrandSwitcher does: the caller would otherwise
 * have to build and pass a href per page, and at a thousand pages that is a
 * thousand strings serialised into the payload to render seven of them.
 */
export function Pager({ page, lastPage, pageSize }: PagerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [jump, setJump] = useState('')

  // The box holds a half-typed page number. Leaving it filled after navigating
  // makes the control look like it still has a pending destination.
  useEffect(() => setJump(''), [page, pageSize])

  const hrefFor = (target: number) => {
    const next = new URLSearchParams(searchParams.toString())
    // Page 1 is the default, so it stays out of the URL and links share cleanly.
    if (target <= 1) next.delete('page')
    else next.set('page', String(target))
    const qs = next.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  const onResize = (raw: string) => {
    const size = Number(raw)
    if (!(REVIEW_PAGE_SIZES as readonly number[]).includes(size)) return
    const next = new URLSearchParams(searchParams.toString())
    next.set('size', String(size))
    const target = pageAfterResize(page, pageSize, size)
    if (target <= 1) next.delete('page')
    else next.set('page', String(target))
    const qs = next.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const onJump = (event: FormEvent) => {
    event.preventDefault()
    const target = Number(jump)
    if (!Number.isInteger(target) || target < 1 || target > lastPage) return
    router.push(hrefFor(target))
  }

  const jumpIsValid = jump === '' || isReachable(jump, lastPage)

  return (
    <nav className="pager" aria-label="Review pages">
      {lastPage > 1 && (
        <div className="pager-pages">
          <PagerLink href={hrefFor(page - 1)} disabled={page === 1} label="Previous page">
            ←
          </PagerLink>

          {pageWindow(page, lastPage).map((token, i) => (
            <PageNumber
              key={tokenKey(token, i)}
              token={token}
              current={page}
              hrefFor={hrefFor}
            />
          ))}

          <PagerLink href={hrefFor(page + 1)} disabled={page === lastPage} label="Next page">
            →
          </PagerLink>
        </div>
      )}

      <div className="pager-tools">
        <label className="pager-size">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => onResize(e.target.value)}
            aria-label="Reviews per page"
          >
            {REVIEW_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        {lastPage > 1 && (
          <form className="pager-jump" onSubmit={onJump}>
            <label htmlFor="pager-jump-input">Go to page</label>
            <input
              id="pager-jump-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={lastPage}
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              placeholder={String(page)}
              aria-invalid={!jumpIsValid}
              aria-describedby="pager-jump-range"
            />
            <span id="pager-jump-range" className="muted">
              of {lastPage.toLocaleString()}
            </span>
            <button className="btn" type="submit" disabled={!isReachable(jump, lastPage)}>
              Go
            </button>
          </form>
        )}
      </div>
    </nav>
  )
}

/** Whether the typed value names a page that exists. */
function isReachable(raw: string, lastPage: number): boolean {
  const n = Number(raw)
  return raw.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= lastPage
}

/** Gaps repeat, so they are keyed by position; page numbers are unique. */
function tokenKey(token: PageToken, index: number): string {
  return token === 'gap' ? `gap-${index}` : `p-${token}`
}

function PageNumber({
  token,
  current,
  hrefFor,
}: {
  token: PageToken
  current: number
  hrefFor: (page: number) => string
}) {
  if (token === 'gap') {
    return (
      <span className="pager-gap" aria-hidden="true">
        …
      </span>
    )
  }
  const isCurrent = token === current
  return (
    <Link
      className="pill pager-page"
      href={hrefFor(token)}
      data-active={isCurrent}
      aria-label={`Page ${token}`}
      {...(isCurrent ? { 'aria-current': 'page' as const } : {})}
    >
      {token.toLocaleString()}
    </Link>
  )
}

function PagerLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  if (disabled) {
    return (
      <span className="pill pager-step" data-disabled="true" aria-hidden="true">
        {children}
      </span>
    )
  }
  return (
    <Link className="pill pager-step" href={href} aria-label={label}>
      {children}
    </Link>
  )
}
