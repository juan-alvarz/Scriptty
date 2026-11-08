import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { READ_LIMITS, Workspace } from './workspace'
import type { SearchOptions, SearchResult } from '../shared/protocol'
import { Packages, isValidSpec, repoUrl } from './packages'
import { sanitize } from './settings'
import { DEFAULT_SETTINGS } from '../shared/protocol'

describe('workspace', () => {
  const ws = new Workspace(mkdtempSync(join(tmpdir(), 'scriptty-ws-')))

  it('seeds a sample, creates files and folders with unique names, renames and lists them', async () => {
    await ws.ensure('1 + 1')
    expect(readFileSync(join(ws.root, 'scratch.ts'), 'utf8')).toBe('1 + 1')
    const dir = await ws.create('', 'folder')
    expect(dir).toBe('New Folder')
    expect(await ws.create(dir, 'file')).toBe('New Folder/untitled.ts')
    expect(await ws.create(dir, 'file')).toBe('New Folder/untitled 2.ts')
    const moved = await ws.rename('New Folder', 'utils')
    expect(moved).toBe('utils')
    expect(existsSync(join(ws.root, 'utils/untitled.ts'))).toBe(true)
    const tree = await ws.tree()
    expect(tree.map((n) => n.path)).toEqual(['utils', 'scratch.ts'])
    expect(tree[0].children?.map((n) => n.name)).toEqual(['untitled 2.ts', 'untitled.ts'])
  })

  it('refuses paths outside the workspace and bad names', async () => {
    expect(() => ws.abs('../escape.ts')).toThrow(/outside/)
    await expect(ws.read('../../etc/passwd')).rejects.toThrow(/outside/)
    await expect(ws.rename('scratch.ts', '../x.ts')).rejects.toThrow(/not allowed/)
    await expect(ws.rename('scratch.ts', 'utils')).rejects.toThrow(/already exists/)
  })
})

describe('workspace search', () => {
  const ws = new Workspace(mkdtempSync(join(tmpdir(), 'scriptty-search-')))
  const put = (rel: string, content: string): void => {
    mkdirSync(join(ws.root, rel, '..'), { recursive: true })
    writeFileSync(join(ws.root, rel), content)
  }
  put('a.ts', 'const foo = 1\r\nconst Foo = foo + 1\n  fooBar(foo)\n')
  put('lib/deep/b.ts', "export const $foo = 'foo'\n")
  put('notes.txt', 'foo') // not a script
  put('node_modules/x/index.ts', 'foo')
  put('.hidden/c.ts', 'foo')
  put('binary.js', 'foo\0foo')
  put('big.ts', 'foo\n'.repeat(READ_LIMITS.bytes / 4 + 1))

  const plain: SearchOptions = { regex: false, caseSensitive: false, wholeWord: false }
  const hits = async (q: string, o: Partial<SearchOptions> = {}): Promise<string[]> => {
    const r = await ws.search(q, { ...plain, ...o })
    if (!r.ok) throw new Error(r.error)
    return r.matches.map((m) => `${m.path}:${m.line}:${m.col}+${m.length}`)
  }

  it('finds plain text case-insensitively, in tree order, with 1-based columns, skipping non-scripts, big and binary files', async () => {
    expect(await hits('foo')).toEqual([
      'lib/deep/b.ts:1:15+3',
      'lib/deep/b.ts:1:22+3',
      'a.ts:1:7+3',
      'a.ts:2:7+3',
      'a.ts:2:13+3',
      'a.ts:3:3+3',
      'a.ts:3:10+3'
    ])
    // Regex characters are literal without the regex option.
    expect(await hits('foo + 1')).toEqual(['a.ts:2:13+7'])
    expect(await hits('')).toEqual([])
  })

  it('respects case, whole word and regex', async () => {
    expect(await hits('Foo', { caseSensitive: true })).toEqual(['a.ts:2:7+3'])
    // `$foo` and `fooBar` are other identifiers; the quoted 'foo' is a word.
    expect(await hits('foo', { wholeWord: true })).toEqual(['lib/deep/b.ts:1:22+3', 'a.ts:1:7+3', 'a.ts:2:7+3', 'a.ts:2:13+3', 'a.ts:3:10+3'])
    expect(await hits('f\\w+\\(', { regex: true })).toEqual(['a.ts:3:3+7'])
    expect(await hits('^const', { regex: true })).toEqual(['a.ts:1:1+5', 'a.ts:2:1+5'])
    expect(await hits('foo|bar', { regex: true, wholeWord: true, caseSensitive: true })).toEqual(['lib/deep/b.ts:1:22+3', 'a.ts:1:7+3', 'a.ts:2:13+3', 'a.ts:3:10+3'])
    // Empty matches are skipped instead of looping.
    expect(await hits('z*', { regex: true })).toEqual([])
  })

  it('returns an error for an invalid regex instead of throwing', async () => {
    const r = await ws.search('foo(', { ...plain, regex: true })
    expect(r.ok).toBe(false)
    expect((r as Extract<SearchResult, { ok: false }>).error).toBe('Unterminated group')
    // The same text is fine as plain text.
    expect((await ws.search('foo(', plain)).ok).toBe(true)
  })

  it('trims previews around the match and marks where it starts', async () => {
    put('long/line.ts', '    ' + 'x'.repeat(200) + ' needle ' + 'y'.repeat(200) + '\n\t\tindented needle  \n')
    const r = await ws.search('needle', plain)
    if (!r.ok) throw new Error(r.error)
    const [far, near] = r.matches
    expect(far).toMatchObject({ path: 'long/line.ts', line: 1, col: 206, length: 6 })
    expect(far.preview.startsWith('…' + 'x'.repeat(7) + ' needle y')).toBe(true)
    expect(far.preview.slice(far.previewStart, far.previewStart + 6)).toBe('needle')
    expect(far.preview.length).toBeLessThan(150)
    expect(near).toMatchObject({ line: 2, col: 12, preview: 'indented needle', previewStart: 9 })
    // Cutting only a few characters is not worth it; past that the start is cut even on a short line.
    const word = await ws.search('foo', { ...plain, wholeWord: true })
    if (!word.ok) throw new Error(word.error)
    expect(word.matches.find((m) => m.path === 'a.ts' && m.line === 2 && m.col === 13)).toMatchObject({ preview: 'const Foo = foo + 1', previewStart: 12 })
    expect(word.matches[0]).toMatchObject({ preview: "…$foo = 'foo'", previewStart: 9 })
  })

  it('stops at the match and file caps and says so', async () => {
    const all = await ws.search('foo', plain)
    expect(all.ok && all.truncated).toBe(false)
    const few = await ws.search('foo', plain, { matches: 3, files: 10 })
    expect(few.ok && few.matches.length === 3 && few.truncated).toBe(true)
    const oneFile = await ws.search('foo', plain, { matches: 100, files: 1 })
    expect(oneFile.ok && oneFile.truncated && oneFile.matches.map((m) => m.path)).toEqual(['lib/deep/b.ts', 'lib/deep/b.ts'])
    // Exactly at the cap is not truncated.
    const exact = await ws.search('foo', plain, { matches: 7, files: 2 })
    expect(exact.ok && !exact.truncated && exact.matches.length).toBe(7)
  })
})

describe('package specs', () => {
  it('accepts names with versions and rejects flags or paths', () => {
    for (const ok of ['zod', 'lodash@4', '@scope/pkg', '@scope/pkg@^1.2.0', 'date-fns@latest']) expect(isValidSpec(ok)).toBe(true)
    for (const bad of ['--global', '-g', '../evil', 'a b', 'https://x.dev/p.tgz', '']) expect(isValidSpec(bad)).toBe(false)
  })
})

describe('package types', () => {
  it('finds bundled and @types declarations, and stubs packages that have none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scriptty-pkg-'))
    const pkg = (name: string, json: object, files: Record<string, string> = {}): void => {
      mkdirSync(join(dir, 'node_modules', name), { recursive: true })
      writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...json }))
      for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, 'node_modules', name, f), text)
    }
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { typed: '1', lodash: '4', bare: '1' }, devDependencies: { '@types/lodash': '4' } }))
    pkg('typed', { types: 'main.d.ts' }, { 'main.d.ts': 'export default 1' })
    pkg('lodash', {})
    pkg('@types/lodash', {}, { 'index.d.ts': 'declare const _: unknown; export = _' })
    pkg('bare', {})
    const p = new Packages(dir, 'bun', dir)
    expect([p.info('typed').types, p.info('lodash').types, p.info('bare').types]).toEqual(['bundled', '@types', 'none'])
    expect(p.info('lodash').importLine).toBe('import lodash from "lodash"')
    expect(p.list()).toEqual({
      packages: ['bare', 'lodash', 'typed'].map((name) => ({ name, version: '1.0.0' })),
      typeLibraries: [{ name: '@types/lodash', version: '1.0.0' }]
    })
    expect([p.info('@types/lodash').types, p.info('@types/lodash').importLine]).toEqual(['bundled', ''])
    const stub = p.types(null).find((l) => l.path.endsWith('untyped.d.ts'))
    expect(stub?.content).toBe('declare module "bare";')
  })
})

describe('repository links', () => {
  it('normalizes package.json repository forms to https', () => {
    expect(repoUrl({ type: 'git', url: 'git+https://github.com/axios/axios.git' })).toBe('https://github.com/axios/axios')
    expect(repoUrl('github:colinhacks/zod')).toBe('https://github.com/colinhacks/zod')
    expect(repoUrl('lodash/lodash')).toBe('https://github.com/lodash/lodash')
    expect(repoUrl('git://github.com/a/b.git')).toBe('https://github.com/a/b')
    expect(repoUrl('javascript:alert(1)')).toBe('')
    expect(repoUrl(undefined)).toBe('')
  })
})

describe('settings', () => {
  it('clamps and rejects invalid values', () => {
    const s = sanitize({ fontSize: 99, tabSize: 3, appearance: 'neon' as never, freezeSeconds: -5, vim: 'yes' as never })
    expect(s).toEqual({ ...DEFAULT_SETTINGS, fontSize: 24, freezeSeconds: 1 })
  })
})
