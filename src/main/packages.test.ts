import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Packages } from './packages'

const ROOT = join(__dirname, '../..')
// Same bundled set as BUNDLED_TYPES in index.ts, from the dev node_modules.
const BUNDLED = Object.fromEntries(['@types/node', 'bun-types', 'undici-types'].map((n) => [n, join(ROOT, 'node_modules', n)]))

function write(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
}

describe('editor types', () => {
  it('ships bun-types without docs, test globals or the TS 7.1 entry', () => {
    const libs = new Packages(join(tmpdir(), 'scriptty-no-packages'), '', '').types(BUNDLED)
    const bun = libs.map((l) => l.path).filter((p) => p.startsWith('file:///node_modules/bun-types/'))
    expect(bun).toEqual(expect.arrayContaining(['index.d.ts', 'bun.d.ts', 'globals.d.ts', 'package.json', 'vendor/expect-type/index.d.ts'].map((f) => `file:///node_modules/bun-types/${f}`)))
    expect(bun.filter((p) => !/\.d\.ts$|\/package\.json$/.test(p) || /test-globals|ts7\.1|\/docs\//.test(p))).toEqual([])
    const content = (p: string): string | undefined => libs.find((l) => l.path === `file:///node_modules/${p}`)?.content
    expect(content('bun-types/bun.d.ts')).toMatch(/function inspect\(/)
    expect(content('bun-types/globals.d.ts')).toMatch(/interface ImportMeta/)
    // bun-types references node and undici-types, so both have to be there too.
    expect(content('@types/node/index.d.ts')).toBeDefined()
    expect(content('undici-types/index.d.ts')).toBeDefined()
  })

  it('prefers a copy the user installed over the bundled one', () => {
    const fake = mkdtempSync(join(tmpdir(), 'scriptty-types-'))
    write(fake, { 'bundled/index.d.ts': 'declare const bundled: 1', 'bundled/test-globals.d.ts': 'x' })
    const dir = join(fake, 'packages')
    const pkgs = new Packages(dir, '', '')
    const bundled = { 'bun-types': join(fake, 'bundled'), '@types/node': join(fake, 'missing') }
    expect(pkgs.types(bundled).map((l) => [l.path, l.content])).toEqual([['file:///node_modules/bun-types/index.d.ts', 'declare const bundled: 1']])

    // `bun add @types/bun` hoists bun-types next to it.
    write(dir, {
      'node_modules/@types/bun/index.d.ts': '/// <reference types="bun-types" />',
      'node_modules/bun-types/index.d.ts': 'declare const user: 1',
      'node_modules/bun-types/test-globals.d.ts': 'declare var test: 1',
      'node_modules/bun-types/ts7.1/index.d.ts': 'x'
    })
    expect(pkgs.types(bundled).map((l) => [l.path, l.content]).sort()).toEqual([
      ['file:///node_modules/@types/bun/index.d.ts', '/// <reference types="bun-types" />'],
      ['file:///node_modules/bun-types/index.d.ts', 'declare const user: 1']
    ])
  })
})
