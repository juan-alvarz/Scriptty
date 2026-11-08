/**
 * Fuzzy matching for quick open. Pure, no DOM.
 *
 * A query matches a path when its characters appear in order (case-insensitive, spaces ignored).
 * Among all the ways to place them, the best one is picked with a small dynamic program:
 * each matched char scores, chars right after the previous match and chars at a word or
 * path-segment start score extra, and skipped chars cost a little. A match inside the file name
 * beats the same match spread over folders.
 */

/** Half-open `[start, end)` character range in the path. */
export type Range = [start: number, end: number]
export type Match = { score: number; ranges: Range[] }
export type Hit = Match & { path: string }

const MATCH = 16
const CONSECUTIVE = 8
const START = 10 // first char of the text
const SEGMENT = 10 // after a path separator
const WORD = 8 // after - _ . or a space
const CAMEL = 7 // lowercase to uppercase, or letter to digit
const GAP_OPEN = 3
const GAP = 1 // per skipped char between two matched chars
const LEAD = 0.5 // per char before the first match, up to LEAD_MAX chars
const LEAD_MAX = 8
const BASENAME = 24

const lower = (c: string): boolean => c >= 'a' && c <= 'z'
const upper = (c: string): boolean => c >= 'A' && c <= 'Z'
const digit = (c: string): boolean => c >= '0' && c <= '9'

function bonusAt(text: string, j: number): number {
  if (j === 0) return START
  const p = text[j - 1]
  const c = text[j]
  if (p === '/' || p === '\\') return SEGMENT
  if (p === '-' || p === '_' || p === '.' || p === ' ') return WORD
  if ((lower(p) && upper(c)) || ((lower(p) || upper(p)) && digit(c))) return CAMEL
  return 0
}

/** Lowercase, drop whitespace, and accept Windows separators. */
export function normalize(query: string): string {
  return query.replace(/\s+/g, '').replace(/\\/g, '/').toLowerCase()
}

/** Best match of an already normalized query in `text`, or null if the chars are not all there in order. */
function score(q: string, text: string): Match | null {
  const m = q.length
  const n = text.length
  if (m === 0) return { score: 0, ranges: [] }
  if (m > n) return null
  const t = text.toLowerCase()
  let k = 0
  for (let j = 0; j < n && k < m; j++) if (t[j] === q[k]) k++
  if (k < m) return null

  // s[i*n + j]: best score with q[0..i] placed and q[i] on text[j]; from[]: where q[i-1] sat.
  const s = new Float64Array(m * n).fill(-Infinity)
  const from = new Int32Array(m * n).fill(-1)
  const bonus = Array.from({ length: n }, (_, j) => bonusAt(text, j))
  for (let i = 0; i < m; i++) {
    const row = i * n
    const prev = row - n
    // run: max over c <= j-2 of s[i-1][c] - GAP * (j-1-c), i.e. the best earlier placement with a gap.
    let run = -Infinity
    let runAt = -1
    for (let j = 0; j < n; j++) {
      if (i > 0 && j >= 2) {
        run -= GAP
        const c = s[prev + j - 2] - GAP
        if (c >= run) {
          run = c
          runAt = j - 2
        }
      }
      if (t[j] !== q[i]) continue
      if (i === 0) {
        s[j] = MATCH + bonus[j] - LEAD * Math.min(j, LEAD_MAX)
        continue
      }
      let best = -Infinity
      let at = -1
      if (j > 0 && s[prev + j - 1] > -Infinity) {
        best = s[prev + j - 1] + MATCH + bonus[j] + CONSECUTIVE
        at = j - 1
      }
      if (run > -Infinity && run - GAP_OPEN + MATCH + bonus[j] > best) {
        best = run - GAP_OPEN + MATCH + bonus[j]
        at = runAt
      }
      s[row + j] = best
      from[row + j] = at
    }
  }

  const last = (m - 1) * n
  let end = -1
  let top = -Infinity
  for (let j = 0; j < n; j++) {
    if (s[last + j] > top) {
      top = s[last + j]
      end = j
    }
  }
  if (end < 0) return null
  const positions: number[] = []
  for (let i = m - 1, j = end; i >= 0; j = from[i * n + j], i--) positions.push(j)
  positions.reverse()
  return { score: top, ranges: toRanges(positions) }
}

function toRanges(positions: number[]): Range[] {
  const out: Range[] = []
  for (const p of positions) {
    const last = out[out.length - 1]
    if (last && last[1] === p) last[1] = p + 1
    else out.push([p, p + 1])
  }
  return out
}

/** Fuzzy match `query` against any text. Ranges index into `text`. */
export function match(query: string, text: string): Match | null {
  return score(normalize(query), text)
}

/** Match a workspace path (`/`-separated). Prefers a match inside the file name; ranges index into the whole path. */
export function matchPath(query: string, path: string): Hit | null {
  const q = normalize(query)
  const full = score(q, path)
  if (!full) return null
  const cut = path.lastIndexOf('/') + 1
  const base = cut > 0 ? score(q, path.slice(cut)) : null
  if (base && base.score + BASENAME >= full.score) {
    return { path, score: base.score + BASENAME, ranges: base.ranges.map(([a, b]) => [a + cut, b + cut]) }
  }
  return { path, ...full, score: full.score + (cut === 0 ? BASENAME : 0) }
}

/**
 * Rank `paths` for `query`. `recent` lists paths most recent first; it orders an empty query
 * (recent first, then the rest alphabetically) and breaks ties otherwise. Paths in `recent`
 * that are not in `paths` are ignored.
 */
export function rank(query: string, paths: string[], recent: string[] = []): Hit[] {
  const order = new Map<string, number>()
  recent.forEach((p, i) => order.has(p) || order.set(p, i))
  const age = (p: string): number => order.get(p) ?? recent.length
  const byName = (a: Hit, b: Hit): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  if (!normalize(query)) {
    return paths.map((path) => ({ path, score: 0, ranges: [] as Range[] })).sort((a, b) => age(a.path) - age(b.path) || byName(a, b))
  }
  const hits: Hit[] = []
  for (const p of paths) {
    const h = matchPath(query, p)
    if (h) hits.push(h)
  }
  return hits.sort((a, b) => b.score - a.score || age(a.path) - age(b.path) || a.path.length - b.path.length || byName(a, b))
}

/**
 * Split a slice of a matched path into plain and highlighted pieces for rendering.
 * `text` is `path.slice(offset, offset + text.length)`; `ranges` index into the whole path.
 */
export function segments(text: string, ranges: Range[], offset = 0): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = []
  let at = 0
  for (const [a, b] of ranges) {
    const s = Math.max(a - offset, at)
    const e = Math.min(b - offset, text.length)
    if (e <= s) continue
    if (s > at) out.push({ text: text.slice(at, s), hit: false })
    out.push({ text: text.slice(s, e), hit: true })
    at = e
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out
}
