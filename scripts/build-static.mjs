/**
 * Injects the exported dataset into the snapshot template.
 *
 * Usage: node scripts/build-static.mjs <data.json> <out.html>
 *
 * The payload rides in a <script type="application/json"> block rather than as
 * a JS literal, so the only character that can break out of it is `<`. Escaping
 * it as < is valid JSON and valid inside the tag, which means a review
 * whose body contains "</script>" cannot end the block early.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [dataPath, outPath] = process.argv.slice(2)
if (!dataPath || !outPath) {
  throw new Error('usage: node scripts/build-static.mjs <data.json> <out.html>')
}

const template = readFileSync(new URL('./static-template.html', import.meta.url), 'utf8')
if (!template.includes('__PAYLOAD__')) throw new Error('template has no __PAYLOAD__ placeholder')

const json = readFileSync(dataPath, 'utf8').replace(/</g, '\\u003c')

// A literal $ in replacement text is a substitution token; pass a function so
// review bodies containing "$&" survive intact.
const html = template.replace('__PAYLOAD__', () => json)
writeFileSync(outPath, html)

console.log(`wrote ${outPath}  ${(html.length / 1e6).toFixed(2)} MB`)
