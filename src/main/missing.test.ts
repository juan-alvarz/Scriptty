import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installedIn, missingPackages } from './missing'
import { packageOf } from '../shared/specifier'

const none = (): boolean => false

describe('packageOf', () => {
  it('maps specifiers to their package name', () => {
    expect(packageOf('lodash')).toBe('lodash')
    expect(packageOf('lodash/fp')).toBe('lodash')
    expect(packageOf('lodash/fp/map.js')).toBe('lodash')
    expect(packageOf('@scope/pkg')).toBe('@scope/pkg')
    expect(packageOf('@scope/pkg/sub/deep')).toBe('@scope/pkg')
  })

  it('returns null for anything that is not a package', () => {
    for (const s of ['', './a', '../a', '.', '/abs/a', '\\\\server\\a', 'C:\\x\\a.ts', 'C:/x/a.ts', 'node:fs', 'bun:sqlite', 'https://esm.sh/x', 'file:///a', '#internal', '@scope', '@/x'])
      expect(packageOf(s), s).toBeNull()
  })
})

describe('missingPackages', () => {
  it('reports bare packages that are not installed, once each, in order', () => {
    expect(missingPackages(['zod', 'lodash/fp', 'lodash', '@scope/pkg/sub', 'zod'], none)).toEqual(['zod', 'lodash', '@scope/pkg'])
  })

  it('skips node and bun builtins, prefixed or bare', () => {
    expect(missingPackages(['fs', 'fs/promises', 'path', 'node:fs', 'node:test', 'bun', 'bun:sqlite', 'bun:test', 'child_process'], none)).toEqual([])
  })

  it('ignores relative, absolute and URL specifiers', () => {
    expect(missingPackages(['./utils', '../lib/a', '/Users/me/a.ts', 'C:\\a.ts', 'https://esm.sh/zod', '#x'], none)).toEqual([])
  })

  it('ignores names that could never be installed', () => {
    expect(missingPackages(['-rf', 'a b', 'ok'], none)).toEqual(['ok'])
  })

  it('checks the package root, not the subpath, against the shared node_modules', () => {
    const nm = mkdtempSync(join(tmpdir(), 'scriptty-nm-'))
    mkdirSync(join(nm, 'lodash'))
    mkdirSync(join(nm, '@scope/pkg'), { recursive: true })
    const has = installedIn(nm)
    expect(missingPackages(['lodash/fp', '@scope/pkg/sub', '@scope/other', 'zod'], has)).toEqual(['@scope/other', 'zod'])
  })
})
