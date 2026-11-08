import { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Workspace } from './workspace'
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
