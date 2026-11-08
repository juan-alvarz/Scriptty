import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Snippet, SnippetsState } from '../shared/protocol'

/** One entry as VS Code writes it: `prefix` and `body` may be a string or an array. */
type RawSnippet = { prefix?: unknown; body?: unknown; description?: unknown; scope?: unknown; [k: string]: unknown }
type RawFile = Record<string, RawSnippet>

/** Seeded on first run, and put back by "Restore starter snippets". Short on purpose: they double as examples. */
export const STARTER: RawFile = {
  'Log to console': { prefix: 'clg', body: ['console.log($1)'], description: 'console.log() with the cursor inside' },
  'Console method': {
    prefix: 'con',
    body: ['console.${1|log,info,warn,error,table|}($2)'],
    description: 'Pick a console method from a list, then type its arguments'
  },
  'Arrow function': { prefix: 'afn', body: ['const ${1:name} = ($2) => {', '\t$0', '}'], description: 'Named arrow function' },
  Import: { prefix: 'imp', body: ["import { $2 } from '${1:module}'"], description: 'Import names from a module (module first, so names autocomplete)' },
  'Try/catch': { prefix: 'tryc', body: ['try {', '\t$1', '} catch (${2:error}) {', '\t$0', '}'], description: 'try/catch block' }
}

const HEADER = `// Scriptty snippets, in VS Code's snippet format. Type a prefix in the editor and accept
// the suggestion (Tab or Enter) to insert the body.
//
//   $1, $2, ...    tab stops, visited in order with Tab
//   \${1:name}      a tab stop with placeholder text, selected so typing replaces it
//   \${1|a,b,c|}    a tab stop with a list of choices
//   $0             where the cursor ends up
//
// "body" is a string or an array of lines. Snippets from VS Code can be pasted in as they are.
// Comments and trailing commas are allowed. Editing snippets in Settings rewrites this file
// and keeps only this header comment.
`

/**
 * Turns JSONC (VS Code's JSON with comments and trailing commas) into plain JSON.
 * Comments and trailing commas become spaces, so JSON.parse error positions still match the file.
 */
export function stripJsonc(text: string): string {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text // byte order mark
  const out = src.split('')
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
  }
  let lastComma = -1 // position of a comma that may turn out to be trailing
  for (let i = 0; i < out.length; i++) {
    const c = src[i]
    if (c === '"') {
      lastComma = -1
      for (i++; i < src.length && src[i] !== '"' && src[i] !== '\n'; i++) if (src[i] === '\\') i++
    } else if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i)
      blank(i, end < 0 ? out.length : end)
      i = end < 0 ? out.length : end
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? out.length : end + 2
      blank(i, stop)
      i = stop - 1
    } else if (c === ',') {
      lastComma = i
    } else if (c === '}' || c === ']') {
      if (lastComma >= 0) out[lastComma] = ' '
      lastComma = -1
    } else if (!/\s/.test(c)) {
      lastComma = -1
    }
  }
  return out.join('')
}

const lines = (v: unknown): string | null =>
  typeof v === 'string' ? v : Array.isArray(v) && v.every((l) => typeof l === 'string') ? v.join('\n') : null

/** Normalizes one VS Code entry; null when it has no usable prefix or body. */
export function normalize(name: string, raw: unknown): Snippet | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as RawSnippet
  const prefix = (typeof r.prefix === 'string' ? [r.prefix] : Array.isArray(r.prefix) ? r.prefix : [])
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter(Boolean)
  const body = lines(r.body)
  if (!prefix.length || body === null) return null
  const description = lines(r.description) ?? ''
  return { name, prefix, body, description, ...(typeof r.scope === 'string' && r.scope.trim() ? { scope: r.scope.trim() } : {}) }
}

/** Parses a snippets file. Throws a readable error when it is not a JSON object. */
export function parseSnippets(text: string): { raw: RawFile; snippets: Snippet[]; skipped: string[] } {
  let data: unknown
  try {
    data = JSON.parse(stripJsonc(text) || '{}')
  } catch (e) {
    throw new Error(`snippets.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('snippets.json must be an object of named snippets')
  const raw = data as RawFile
  const snippets: Snippet[] = []
  const skipped: string[] = []
  for (const [name, entry] of Object.entries(raw)) {
    const s = normalize(name, entry)
    if (s) snippets.push(s)
    else skipped.push(name)
  }
  return { raw, snippets, skipped }
}

/** The file form of a snippet: body as an array of lines, a single prefix as a string, like VS Code. */
function toRaw(s: Snippet, base: RawSnippet = {}): RawSnippet {
  const out: RawSnippet = { ...base, prefix: s.prefix.length === 1 ? s.prefix[0] : s.prefix, body: s.body.split(/\r?\n/) }
  if (s.description.trim()) out.description = s.description.trim()
  else delete out.description
  return out
}

/** User snippets in one VS Code-compatible JSONC file (`userData/snippets.json`). */
export class SnippetStore {
  private raw: RawFile = {}
  /** The file on disk does not parse; edits from the UI are refused until it does. */
  private broken = false
  private current: SnippetsState

  constructor(readonly file: string) {
    this.current = { snippets: [], error: '', file }
  }

  /** Writes the starter set only when there is no file yet, so user edits are never overwritten. */
  ensure(): boolean {
    if (existsSync(this.file)) return false
    this.write({ ...STARTER })
    return true
  }

  get state(): SnippetsState {
    return this.current
  }

  /** Re-reads the file. On a bad file the last good snippets stay and `error` says what is wrong. Returns whether anything changed. */
  load(): boolean {
    let next: SnippetsState
    try {
      const text = existsSync(this.file) ? readFileSync(this.file, 'utf8') : ''
      const p = parseSnippets(text)
      this.raw = p.raw
      this.broken = false
      const note = p.skipped.length ? `Skipped ${p.skipped.map((n) => `"${n}"`).join(', ')}: a snippet needs a prefix and a body.` : ''
      next = { snippets: p.snippets, error: note, file: this.file }
    } catch (e) {
      this.broken = true
      const msg = e instanceof Error ? e.message : String(e)
      next = { ...this.current, error: `${msg}. The last working snippets stay active until the file is fixed.` }
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.current)
    this.current = next
    return changed
  }

  /** Adds a snippet, or replaces the one called `oldName` (which may be a rename). Fields the UI does not edit are kept. */
  put(oldName: string | null, s: Snippet): SnippetsState {
    this.writable()
    const name = s.name.trim()
    const prefix = s.prefix.map((p) => p.trim()).filter(Boolean)
    if (!name) throw new Error('Give the snippet a name')
    if (!prefix.length) throw new Error('Give the snippet a prefix')
    if (prefix.some((p) => /\s/.test(p))) throw new Error('A prefix cannot contain spaces')
    if (!s.body.trim()) throw new Error('The body is empty')
    if (name !== oldName && name in this.raw) throw new Error(`A snippet called "${name}" already exists`)
    const entry = toRaw({ ...s, name, prefix }, oldName ? this.raw[oldName] : undefined)
    const next: RawFile = {}
    let placed = false
    for (const [k, v] of Object.entries(this.raw)) {
      if (k === oldName) {
        next[name] = entry
        placed = true
      } else next[k] = v
    }
    if (!placed) next[name] = entry
    this.write(next)
    return this.current
  }

  remove(name: string): SnippetsState {
    this.writable()
    const next = { ...this.raw }
    delete next[name]
    this.write(next)
    return this.current
  }

  /** Puts the starter snippets back (replacing ones with the same name) and keeps the user's own. */
  restore(): SnippetsState {
    this.writable()
    this.write({ ...this.raw, ...STARTER })
    return this.current
  }

  /** Refuses to rewrite a file that does not parse, so a typo never costs the user their snippets. */
  private writable(): void {
    if (this.broken) throw new Error('Fix snippets.json first: ' + this.current.error)
  }

  private write(raw: RawFile): void {
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, HEADER + JSON.stringify(raw, null, 2) + '\n')
    renameSync(tmp, this.file) // atomic, so the file watcher never reads half a file
    this.load()
  }
}
