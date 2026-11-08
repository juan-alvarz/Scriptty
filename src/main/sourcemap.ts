// Just enough of source map v3 for the debugger: bun reprints every file it loads (comments, blank lines and
// types go away), so breakpoint and pause lines go through the inline map it reports. Lines here are 0-based.

/** Per generated line, its segments as [generated column, source line, source column], sorted by column. */
export type LineMap = [number, number, number][][]

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const DIGIT = new Map([...B64].map((c, i) => [c, i]))

/** Decodes the `mappings` string, keeping only segments that point into the first source. */
export function decodeMappings(mappings: string): LineMap {
  const lines: LineMap = []
  let src = 0
  let srcLine = 0
  let srcCol = 0
  for (const line of mappings.split(';')) {
    const segs: [number, number, number][] = []
    let col = 0
    for (const seg of line.split(',')) {
      if (!seg) continue
      const v = vlq(seg)
      col += v[0]
      if (v.length < 4) continue // a segment with no source position
      src += v[1]
      srcLine += v[2]
      srcCol += v[3]
      if (src === 0) segs.push([col, srcLine, srcCol])
    }
    lines.push(segs.sort((a, b) => a[0] - b[0]))
  }
  return lines
}

function vlq(seg: string): number[] {
  const out: number[] = []
  let value = 0
  let shift = 0
  for (const c of seg) {
    const d = DIGIT.get(c)
    if (d === undefined) break
    value += (d & 31) << shift
    if (d & 32) {
      shift += 5
      continue
    }
    out.push(value & 1 ? -(value >>> 1) : value >>> 1)
    value = 0
    shift = 0
  }
  return out
}

/** Reads the mappings out of a `sourceMappingURL` (bun inlines them as base64 data URLs). */
export function parseSourceMapUrl(url: string | undefined): LineMap | null {
  const m = url?.match(/^data:application\/json[^,]*;base64,(.*)$/)
  if (!m) return null
  try {
    const json = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) as { mappings?: unknown }
    return typeof json.mappings === 'string' ? decodeMappings(json.mappings) : null
  } catch {
    return null
  }
}

/** Source line of a generated position: the nearest segment at or before it (identity without a map). */
export function sourceLine(map: LineMap | null, line: number, col: number): number {
  if (!map) return line
  for (let l = Math.min(line, map.length - 1); l >= 0; l--) {
    const segs = map[l]
    if (!segs.length) continue
    if (l < line) return segs[segs.length - 1][1]
    let hit = segs[0]
    for (const s of segs) if (s[0] <= col) hit = s
    return hit[1]
  }
  return line
}

/**
 * Where to put a breakpoint for a source line: the first generated position that maps to it, or to the next
 * source line that has code (a breakpoint on a comment or a type stops at the code after it).
 */
export function generatedFor(map: LineMap | null, line: number): { line: number; col: number } | null {
  if (!map) return { line, col: 0 }
  let best: { src: number; line: number; col: number } | null = null
  for (let l = 0; l < map.length; l++) {
    for (const [col, src] of map[l]) {
      if (src < line || (best && src >= best.src)) continue
      best = { src, line: l, col }
    }
  }
  return best && { line: best.line, col: best.col }
}
