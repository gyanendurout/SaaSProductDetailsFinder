/**
 * Typographic folding, applied before any pattern reads a title.
 *
 * CRBN writes its shapes as superscripts — CRBN¹, CRBN², CRBN³, CRBN⁴ — using
 * U+00B9, U+00B2, U+00B3 and U+2074 rather than ASCII digits. They look like
 * numbers and read like numbers, but:
 *
 *   /\d/.test('CRBN¹')        === false
 *   slugify('CRBN¹')          === 'crbn'      (the digit vanishes)
 *   'CRBN¹' === 'CRBN1'       === false
 *
 * so four different paddles slug to the same value and collide on the model's
 * unique key. Folding to ASCII first makes the superscript an ordinary digit
 * and every downstream rule work unchanged.
 *
 * The trademark and registered marks go the same way: 'Project Boomstik®' and
 * 'Project Boomstik' must be one model, not two.
 */

const SUPERSCRIPTS: Record<string, string> = {
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁰': '0',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
}

const SUBSCRIPTS: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
}

/** Curly quotes and dashes, so 'Ed Ju’s' and "Ed Ju's" match one another. */
const PUNCTUATION: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
}

const MARKS = /[®™©]/g

export function foldTypography(text: string): string {
  let out = ''
  for (const ch of text) {
    out += SUPERSCRIPTS[ch] ?? SUBSCRIPTS[ch] ?? PUNCTUATION[ch] ?? ch
  }
  return out.replace(MARKS, '').replace(/\s+/g, ' ').trim()
}
