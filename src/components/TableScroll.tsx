'use client'

import { useEffect } from 'react'

/**
 * Makes horizontally scrolling tables reachable from the keyboard.
 *
 * Every wide table on the site sits in a `.table-wrap`, which scrolls sideways
 * when the table is wider than the column. That scroll was mouse-only: the
 * container had no tabindex, so a keyboard user could tab through every link
 * inside the table and never reach the columns off the right-hand edge. On the
 * catalogue that hides price and stock; on the change log it hides the delta.
 *
 * Done here rather than by putting `tabIndex={0}` on each of the twenty-odd
 * wrappers, for a reason that is about correctness rather than tidiness: a
 * region that does not scroll must NOT be a tab stop. Hard-coding the attribute
 * makes every table a stop on a wide screen where none of them overflow, which
 * adds twenty empty stops to the tab order to fix a problem that is not there.
 * Overflow is a layout fact, so it can only be known after layout — which means
 * measuring, and re-measuring when the window changes.
 *
 * An existing aria-label is left alone. Several pages name their table better
 * than a generic rule could; the rest get the nearest heading above them, and
 * failing that a plain description.
 *
 * Mounted once, in the layout. It observes the document rather than taking
 * children, so a table added to any page is covered without being wired up.
 */
export function TableScroll() {
  useEffect(() => {
    const sync = () => {
      for (const el of document.querySelectorAll<HTMLElement>('.table-wrap')) {
        // A pixel of tolerance: sub-pixel layout rounding otherwise reports a
        // one-pixel overflow on tables that visibly fit.
        const overflows = el.scrollWidth - el.clientWidth > 1

        if (!overflows) {
          el.removeAttribute('tabindex')
          continue
        }

        el.setAttribute('tabindex', '0')
        if (!el.hasAttribute('role')) el.setAttribute('role', 'region')
        if (!el.hasAttribute('aria-label')) {
          el.setAttribute('aria-label', `${nameFor(el)} (scrolls sideways)`)
        }
      }
    }

    sync()

    // Both matter. A resize changes whether a table overflows; a mutation is
    // how a table arrives at all, since every page here renders on the server
    // and swaps in on navigation.
    const observer = new ResizeObserver(sync)
    observer.observe(document.body)
    const mutations = new MutationObserver(sync)
    mutations.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [])

  return null
}

/**
 * The nearest heading above this table, which is what the table is a table of.
 *
 * Climbs rather than taking the immediate parent: most of these tables sit in a
 * bare wrapper div with the <h2> a level or two further out, so asking only the
 * closest container found nothing and every table on the overview was announced
 * as "Table".
 *
 * previousElementSibling before parentElement, because a section can hold
 * several tables under several headings and the one above THIS table is the
 * right answer — the section's first heading is not.
 */
function nameFor(el: HTMLElement): string {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
      const heading = prev.matches('h1, h2, h3')
        ? prev
        : prev.querySelector('h1, h2, h3')
      const text = heading?.textContent?.trim()
      if (text && text.length <= 80) return text
    }
    if (node.tagName === 'MAIN') break
  }
  return 'Table'
}
