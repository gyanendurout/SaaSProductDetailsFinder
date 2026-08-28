import type { RawProduct } from '../sources/types.js'

/**
 * Assortment gate.
 *
 * Broad collections leak: 'pickleball-sale' returns 65 products including bags,
 * balls and apparel, and 'ben-johns-paddles' includes signature packs. Without
 * this filter every average and count downstream is polluted by items that are
 * not the assortment we were asked to track.
 *
 * The prior Joola Pulse pipeline learned the same lesson the hard way — its data
 * dictionary says "always filter is_paddle = true".
 */

const NON_PADDLE_PATTERNS: RegExp[] = [
  /\b(bag|backpack|duffel|sling|tote|suitcase)\b/i,
  /\b(ball|balls)\b/i,
  /\b(net|nets|barrier|caddie|caddy)\b/i,
  /\b(grip|overgrip|tape|weight)\b/i,
  /\b(shirt|tee|short|shorts|hoodie|jacket|hat|cap|sock|apparel|skirt|dress)\b/i,
  /\b(shoe|shoes|footwear|sneaker)\b/i,
  /\b(towel|bottle|sticker|gift\s*card)\b/i,
  /\b(blade|rubber|racket|table)\b/i, // table-tennis catalogue lives on the same store
]

// Plural matters: '\bpaddle\b' does not match a title ending 'Pro UPA Paddles',
// because the word boundary falls after the 's'.
const PADDLE_PATTERNS: RegExp[] = [/\bpaddles?\b/i]

const BUNDLE_PATTERNS: RegExp[] = [/\b(pack|bundle|set|kit|combo)\b/i]

/** Tags that assert this IS a paddle: 'pickleball-paddles', 'paddle-sets', 'junior-paddles'. */
const PADDLE_TAG_RE = /(^|-)paddles?(-|$)/i
/**
 * ...except tags that merely reference paddles while describing an accessory.
 * Matched per hyphen-separated segment, because a substring test finds "ball"
 * inside "pickleball" and would reject every paddle on the store.
 */
const ACCESSORY_TAG_SEGMENTS = new Set([
  'grip', 'grips', 'tape', 'tapes', 'bag', 'bags', 'cover', 'covers',
  'accessory', 'accessories', 'weight', 'weights', 'ball', 'balls', 'case', 'cases',
  // Merchandising extras that ride along in paddle collections. 'JOOLA 3s
  // Keychain' was being counted as six paddle SKUs of a model called '3S'.
  'keychain', 'keychains', 'sticker', 'stickers', 'towel', 'towels', 'hat', 'hats',
  'shirt', 'shirts', 'apparel', 'sock', 'socks', 'gift',
])

/** Non-paddle merchandise that no tag marks — the title is the only signal. */
const ACCESSORY_TITLE_RE =
  /\b(keychain|key\s?chain|sticker|decal|towel|hat|cap|t-?shirt|hoodie|socks?|free\s+gift|gift\s+card)\b/i

function isAccessoryTag(tag: string): boolean {
  return tag.split('-').some((segment) => ACCESSORY_TAG_SEGMENTS.has(segment))
}

export interface AssortmentVerdict {
  isInAssortment: boolean
  isBundle: boolean
  reason: string
}

/**
 * Decides whether a product belongs to the paddle assortment.
 *
 * Tags win over the title: a merchandiser tagging something `pickleball-paddles`
 * is a deliberate statement, whereas a title is prose. Bundles stay in the
 * assortment (a two-paddle pack is still paddle revenue) but are flagged so the
 * model resolver does not invent a product line from 'Agassi/Graf'.
 */
export function classifyAssortment(product: RawProduct): AssortmentVerdict {
  const title = product.title
  const tags = product.tags.map((t) => t.toLowerCase())
  const isBundle = BUNDLE_PATTERNS.some((re) => re.test(title)) || tags.includes('paddle-sets')

  // Merchandise checked before the tags, unusually, because these items are
  // genuinely tagged into paddle collections — 'JOOLA 3s Keychain' carries
  // `pickleball-paddles` and was counted as six paddle SKUs. A title saying
  // 'keychain' outranks a tag saying 'paddle'. Bundles are exempt: a paddle set
  // may legitimately ship with a towel.
  const merch = !isBundle ? ACCESSORY_TITLE_RE.exec(title)?.[1] : undefined
  if (merch) {
    return { isInAssortment: false, isBundle, reason: `merchandise: ${merch.toLowerCase()}` }
  }

  // Any paddle tag counts, except the accessory tags that merely mention
  // paddles ('paddle-grips', 'paddle-accessories'). This matters for bundles
  // titled 'Pickleball Pack', whose title carries no paddle signal at all.
  const paddleTag = tags.find((t) => PADDLE_TAG_RE.test(t) && !isAccessoryTag(t))
  if (paddleTag) {
    return { isInAssortment: true, isBundle, reason: `tagged ${paddleTag}` }
  }

  const nonPaddle = NON_PADDLE_PATTERNS.find((re) => re.test(title))
  const looksLikePaddle = PADDLE_PATTERNS.some((re) => re.test(title))

  // A bundle can legitimately mention balls ('Paddle & Ball Set'); the paddle
  // signal wins as long as one is present.
  if (nonPaddle && !looksLikePaddle) {
    return { isInAssortment: false, isBundle, reason: `title matched ${nonPaddle.source}` }
  }
  if (looksLikePaddle) {
    return { isInAssortment: true, isBundle, reason: 'title mentions paddle' }
  }

  // Last resort: the shelf it sits on. Selkirk's 'SLK OMEGA Hybrid Air' carries
  // no tags and no 'paddle' in its title, yet lives in
  // 'edgeless-pickleball-paddles' — it is unmistakably a paddle, and tags-and-
  // title alone silently dropped it and three others.
  //
  // Deliberately below the NON_PADDLE check rather than beside the tag check,
  // because sale shelves leak: 'paddle-markdowns' and 'pickleball-paddle-deals'
  // match the paddle pattern while containing bags and apparel. Reaching here
  // means the title already cleared those.
  const shelf = product.categoryHandles.find(
    (h) => PADDLE_TAG_RE.test(h) && !isAccessoryTag(h),
  )
  if (shelf) {
    return { isInAssortment: true, isBundle, reason: `shelved in ${shelf}` }
  }

  return { isInAssortment: false, isBundle, reason: 'no paddle signal' }
}
