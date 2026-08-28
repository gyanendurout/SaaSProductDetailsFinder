import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards against a bug that reached this codebase three times.
 *
 * Writing source through a script whose own string literals process escapes
 * turns a regex `\b` into U+0008, the backspace character. The file still
 * compiles, the suite still passes, and the regex silently never matches:
 *
 *   /(\d{2,3})\s*g\b/i     becomes     /(\d{2,3})\s*g<U+0008>/i
 *
 * The first occurrence made gram weights unparseable. The second appended every
 * generation twice ('Perseus Pro IV Pro IV'). The third let keychains count as
 * paddle SKUs. None was visible when reading the file — only a byte dump showed
 * it, and each cost real time to find.
 *
 * Control characters have no legitimate place in this source tree, so the cheap
 * fix is to refuse them outright. Deliberately expressed with character codes
 * rather than escape sequences: a guard written in the notation it is guarding
 * against can be corrupted the same way, which happened while writing this.
 */

const ROOTS = ['src', 'test', 'scripts']
const SOURCE_FILE = /\.(ts|tsx|sql|json)$/
const SKIP_DIRS = new Set(['node_modules', '.next', '.git'])

const TAB = 9
const LINE_FEED = 10
const CARRIAGE_RETURN = 13
const FIRST_PRINTABLE = 32

function isForbidden(code: number): boolean {
  if (code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN) return false
  return code < FIRST_PRINTABLE || code === 127
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (SOURCE_FILE.test(entry)) out.push(full)
  }
  return out
}

function sourceFiles(): string[] {
  return ROOTS.flatMap((r) => {
    try {
      return walk(r)
    } catch {
      return []
    }
  })
}

test('no source file contains a control character', () => {
  const offenders: string[] = []

  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (!isForbidden(code)) continue
      const line = text.slice(0, i).split('\n').length
      const hex = code.toString(16).toUpperCase().padStart(4, '0')
      offenders.push(`${file}:${line} contains U+${hex}`)
      break // one report per file is enough to fail and locate it
    }
  }

  assert.deepEqual(offenders, [], `control characters found:\n  ${offenders.join('\n  ')}`)
})

test('scanner actually detects a backspace', () => {
  // Without this, a broken scanner would report a clean tree forever.
  assert.equal(isForbidden(8), true, 'U+0008 must be rejected')
  assert.equal(isForbidden(TAB), false, 'tabs are legitimate')
  assert.equal(isForbidden(LINE_FEED), false, 'newlines are legitimate')
  assert.equal(isForbidden('a'.charCodeAt(0)), false, 'letters are legitimate')
})
