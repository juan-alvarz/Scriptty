import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Workspace } from './workspace'
import { isValidSpec, repoUrl } from './packages'
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
