import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { TreeNode } from '../shared/protocol'

export const SCRIPT_EXT = /\.(ts|mts|cts|js|mjs|cjs)$/i

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
  async readAll(maxFiles = 300, maxBytes = 512 * 1024): Promise<{ path: string; content: string }[]> {
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
