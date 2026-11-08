import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { SearchMatch, SearchOptions, SearchResult, TreeNode } from '../shared/protocol'

export const SCRIPT_EXT = /\.(ts|mts|cts|js|mjs|cjs)$/i

/** Read limits shared by readAll() and search(): files past these are left out. */
export const READ_LIMITS = { files: 300, bytes: 512 * 1024 }
/** Search stops once it has this many matches, or matches in this many files, and says it was cut short. */
export const SEARCH_LIMITS = { matches: 2000, files: 200 }
/**
 * Preview window: `before` characters of context ahead of the match (the sidebar is narrow, so the match
 * must sit near the start), unless that would cut fewer than `slack`; `length` characters in all.
 */
const PREVIEW = { before: 8, slack: 6, length: 120 }

/** Builds the search regex. Throws a SyntaxError for an invalid user regex. */
export function searchPattern(query: string, o: SearchOptions): RegExp {
  let src = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // `$` counts as a word character, since it is one in JS identifiers.
  if (o.wholeWord) src = `(?<![\\w$])(?:${src})(?![\\w$])`
  return new RegExp(src, o.caseSensitive ? 'g' : 'gi')
}

/** Cuts a long line down to a window around the match. `start` is where the match begins in `text`. */
function preview(line: string, col: number, length: number): { text: string; start: number } {
  // Leading indentation is dropped; a cut-off start gets an ellipsis.
  const indent = Math.min(col, line.length - line.trimStart().length)
  const cut = col - indent > PREVIEW.before + PREVIEW.slack
  const from = cut ? col - PREVIEW.before : indent
  const lead = (cut ? '…' : '') + line.slice(from, col)
  const stop = col + Math.min(length, PREVIEW.length)
  const tail = line.slice(stop, Math.max(stop, from + PREVIEW.length)).trimEnd()
  return { text: lead + line.slice(col, stop) + tail, start: lead.length }
}

/** Scratch files on disk. All paths in and out are workspace-relative with forward slashes. */
export class Workspace {
  constructor(readonly root: string) {}

  /** Resolves a relative path and refuses anything outside the workspace. */
  abs(rel: string): string {
    const p = resolve(this.root, rel)
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error('Path is outside the workspace')
    return p
  }

  private rel(abs: string): string {
    return relative(this.root, abs).split(sep).join('/')
  }

  async ensure(sample: string): Promise<void> {
    await mkdir(this.root, { recursive: true })
    if ((await readdir(this.root)).length === 0) await writeFile(join(this.root, 'scratch.ts'), sample)
  }

  async tree(dir = this.root): Promise<TreeNode[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const nodes: TreeNode[] = []
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const abs = join(dir, e.name)
      if (e.isDirectory()) nodes.push({ name: e.name, path: this.rel(abs), kind: 'folder', children: await this.tree(abs) })
      else if (e.isFile() && SCRIPT_EXT.test(e.name)) nodes.push({ name: e.name, path: this.rel(abs), kind: 'file' })
    }
    return nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'folder' ? -1 : 1))
  }

  /** Every script file's content, so the editor can type-check imports between scratches. */
  async readAll(maxFiles = READ_LIMITS.files, maxBytes = READ_LIMITS.bytes): Promise<{ path: string; content: string }[]> {
    const files: string[] = []
    const collect = (nodes: TreeNode[]): void => {
      for (const n of nodes) n.kind === 'file' ? files.push(n.path) : collect(n.children ?? [])
    }
    collect(await this.tree())
    const out: { path: string; content: string }[] = []
    for (const path of files.slice(0, maxFiles)) {
      const abs = this.abs(path)
      // Check the size first, so a huge file is never read just to be dropped.
      if ((await stat(abs)).size <= maxBytes) out.push({ path, content: await readFile(abs, 'utf8') })
    }
    return out
  }

  /**
   * Finds `query` in every script file, in tree order. Lines and columns are 1-based and count UTF-16
   * code units, like Monaco. A match never spans lines, and empty matches are skipped. Never throws for
   * a bad regex: it comes back as `{ ok: false }` so the renderer can show it as you type.
   */
  async search(query: string, o: SearchOptions, limits = SEARCH_LIMITS): Promise<SearchResult> {
    if (!query) return { ok: true, matches: [], truncated: false }
    let re: RegExp
    try {
      re = searchPattern(query, o)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.replace(/^Invalid regular expression: \/[\s\S]*\/[a-z]*: /, '') : String(e) }
    }
    const matches: SearchMatch[] = []
    let files = 0
    for (const { path, content } of await this.readAll()) {
      if (content.includes('\0')) continue // binary
      const before = matches.length
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0
        for (let m = re.exec(lines[i]); m; m = re.exec(lines[i])) {
          if (!m[0].length) {
            re.lastIndex++
            continue
          }
          if (matches.length === before && files === limits.files) return { ok: true, matches, truncated: true }
          if (matches.length === limits.matches) return { ok: true, matches, truncated: true }
          const p = preview(lines[i], m.index, m[0].length)
          matches.push({ path, line: i + 1, col: m.index + 1, length: m[0].length, preview: p.text, previewStart: p.start })
        }
      }
      if (matches.length > before) files++
    }
    return { ok: true, matches, truncated: false }
  }

  // async on read and write: a bad path from abs() becomes a rejected promise, not a sync throw.
  async read(rel: string): Promise<string> {
    return readFile(this.abs(rel), 'utf8')
  }

  async write(rel: string, content: string): Promise<void> {
    return writeFile(this.abs(rel), content)
  }

  /** Creates `untitled.ts` / `New Folder` (with a numeric suffix if taken) inside `dirRel`. */
  async create(dirRel: string, kind: 'file' | 'folder'): Promise<string> {
    const dir = this.abs(dirRel)
    const [base, ext] = kind === 'file' ? ['untitled', '.ts'] : ['New Folder', '']
    let name = base + ext
    for (let i = 2; existsSync(join(dir, name)); i++) name = `${base} ${i}${ext}`
    const abs = join(dir, name)
    if (kind === 'file') await writeFile(abs, '', { flag: 'wx' })
    else await mkdir(abs)
    return this.rel(abs)
  }

  async rename(rel: string, newName: string): Promise<string> {
    const name = newName.trim()
    if (!name || name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name)) throw new Error('That name is not allowed')
    const from = this.abs(rel)
    const to = this.abs(join(dirname(rel), name))
    if (to === from) return rel
    if (existsSync(to)) throw new Error(`"${name}" already exists here`)
    await rename(from, to)
    return this.rel(to)
  }
}
