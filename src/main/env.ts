// `.env` files for scratches. Before each run, main loads `.env` from the workspace root down to the
// scratch's folder (the nearer file wins) and sends the variables on the run message.
// Values are secrets: nothing here logs them or puts them in an error message.
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

/** A value is literal text and `${NAME}` references, resolved once all files are known. */
export type EnvPart = string | { ref: string }
export type EnvEntry = { key: string; parts: EnvPart[] }

const KEY = /[A-Za-z_][A-Za-z0-9_.-]*/y
const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', $: '$' }

/**
 * Parses dotenv syntax:
 * - `KEY=value`, `export KEY=value`, `KEY=` (empty), blank lines and `#` comments, LF or CRLF.
 * - Unquoted values are trimmed; ` #` starts a comment.
 * - `'single'` and `` `backtick` `` values are literal. `"double"` values take `\n`, `\r`, `\t`, `\"`, `\\` and `\$`.
 *   Quoted values may span lines; text after the closing quote is ignored.
 * - `${NAME}` expands in unquoted and double-quoted values (see `resolveEnv`). `$NAME` without braces stays literal.
 * Malformed lines are skipped.
 */
export function parseEnv(text: string): EnvEntry[] {
  const s = text.replace(/\r\n?/g, '\n')
  const out: EnvEntry[] = []
  let i = 0
  const eol = (from: number): number => {
    const n = s.indexOf('\n', from)
    return n < 0 ? s.length : n
  }
  const blank = (): void => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++
  }
  while (i < s.length) {
    blank()
    if (s.startsWith('export ', i) || s.startsWith('export\t', i)) {
      i += 7
      blank()
    }
    KEY.lastIndex = i
    const m = KEY.exec(s)
    if (!m) {
      i = eol(i) + 1 // blank line, comment or junk
      continue
    }
    i += m[0].length
    blank()
    if (s[i] !== '=') {
      i = eol(i) + 1
      continue
    }
    i++
    blank()
    const q = s[i]
    const close = q === '"' || q === "'" || q === '`' ? closing(s, i + 1, q) : -1
    let parts: EnvPart[]
    if (close >= 0) {
      const body = s.slice(i + 1, close)
      parts = q === '"' ? split(body, true) : [body]
      i = eol(close + 1) + 1
    } else {
      // Unquoted (or an unmatched quote, kept as text): up to the end of the line, minus a ` #` comment.
      const end = eol(i)
      const raw = s.slice(i, end).replace(/(^|\s)#.*$/, '').trim()
      parts = split(raw, false)
      i = end + 1
    }
    out.push({ key: m[0], parts })
  }
  return out
}

function closing(s: string, from: number, q: string): number {
  for (let j = from; j < s.length; j++) {
    if (q === '"' && s[j] === '\\') j++
    else if (s[j] === q) return j
  }
  return -1
}

/** Splits a value into text and `${NAME}` references; `escapes` turns on double-quote escapes. */
function split(v: string, escapes: boolean): EnvPart[] {
  const parts: EnvPart[] = []
  let text = ''
  for (let j = 0; j < v.length; j++) {
    const c = v[j]
    if (escapes && c === '\\' && j + 1 < v.length) {
      const e = ESCAPES[v[j + 1]]
      text += e ?? c + v[j + 1]
      j++
    } else if (c === '$' && v[j + 1] === '{') {
      const end = v.indexOf('}', j + 2)
      const name = end < 0 ? '' : v.slice(j + 2, end)
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        text += c
        continue
      }
      if (text) parts.push(text)
      text = ''
      parts.push({ ref: name })
      j = end
    } else text += c
  }
  if (text || !parts.length) parts.push(text)
  return parts
}

/**
 * Merges files from farthest to nearest, so a nearer file overrides. `${NAME}` takes the value defined so far
 * (an earlier line, or a farther file), else `base` (the app's own environment), else empty.
 */
export function resolveEnv(files: EnvEntry[][], base: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const entries of files)
    for (const { key, parts } of entries)
      env[key] = parts.map((p) => (typeof p === 'string' ? p : (Object.hasOwn(env, p.ref) ? env[p.ref] : base[p.ref]) ?? '')).join('')
  return env
}

/** Folders from `root` down to `dir`, both included. A `dir` outside `root` gets only itself. */
export function envDirs(root: string, dir: string): string[] {
  const rel = relative(root, dir)
  if (rel.startsWith('..') || isAbsolute(rel)) return [dir]
  const dirs = [root]
  let cur = root
  for (const name of rel ? rel.split(sep) : []) dirs.push((cur = join(cur, name)))
  return dirs
}

/** Loads the `.env` chain for a run. Parsed files are cached by mtime and size, so a run costs only a few `stat`s. */
export class EnvFiles {
  private cache = new Map<string, { mtimeMs: number; size: number; entries: EnvEntry[] }>()

  constructor(readonly root: string) {}

  async load(dir: string, base: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
    const files = await Promise.all(envDirs(this.root, dir).map((d) => this.file(join(d, '.env'))))
    return resolveEnv(files, base)
  }

  private async file(path: string): Promise<EnvEntry[]> {
    try {
      const st = await stat(path)
      if (!st.isFile()) return []
      const hit = this.cache.get(path)
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.entries
      const entries = parseEnv(await readFile(path, 'utf8'))
      this.cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, entries })
      return entries
    } catch {
      // Missing or unreadable: no variables from this folder.
      this.cache.delete(path)
      return []
    }
  }
}
