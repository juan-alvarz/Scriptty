import { describe, expect, it } from 'vitest'
import { instrument } from './instrument'

describe('instrument', () => {
  it('wraps top-level expressions and tags console calls, keeping line count', () => {
    const src = [
      'interface U { n: number }',
      'const xs: number[] = [1, 2]',
      'xs.length',
      'console.log("a", xs)',
      'xs.map(x => {',
      '  console.warn(x)',
      '  return x * 2',
      '})'
    ].join('\n')
    const r = instrument(src)
    if (!r.ok) throw new Error(r.error)
    const out = r.code.split('\n')
    expect(out).toHaveLength(8)
    expect(out[2]).toBe('__r(3, (xs.length))')
    expect(out[3]).toBe('__log(4, "log")("a", xs)')
    expect(out[4]).toBe('__r(8, (xs.map(x => {')
    expect(out[5]).toBe('  __log(6, "warn")(x)')
    expect(out[7]).toBe('})))')
  })

  it('leaves directives alone', () => {
    const r = instrument('"use strict"\n1')
    expect(r.ok && r.code).toBe('"use strict"\n__r(2, (1))')
  })

  it('uses UTF-16 offsets so text after emoji is not shifted', () => {
    const r = instrument('const s = "😀"; s.length')
    expect(r.ok && r.code).toBe('const s = "😀"; __r(1, (s.length))')
  })

  it('collects bare package imports only', () => {
    const r = instrument('import { z } from "zod"\nimport a from "@scope/pkg/sub"\nimport b from "./local"\nimport fs from "node:fs"')
    expect(r.ok && r.imports).toEqual(['zod', '@scope/pkg'])
  })

  it('makes relative imports absolute when given the scratch folder', () => {
    const r = instrument('import { a } from "./lib/a"\nexport * from "../b"\nconst c = await import("./c")\nimport z from "zod"', 'x.ts', '/ws/dir')
    expect(r.ok && r.code.split('\n')).toEqual([
      'import { a } from "/ws/dir/lib/a"',
      'export * from "/ws/b"',
      'const c = await import("/ws/dir/c")',
      'import z from "zod"'
    ])
  })

  it('points import.meta and __dirname at the scratch, keeping lines', () => {
    const src = [
      'import.meta.dir',
      'const d = import.meta.dirname, f = import.meta.file, p = import.meta.path, n = import.meta.filename',
      'console.log(new URL("./a.txt", import.meta.url).href, import.meta["dir"])',
      'if (import.meta.main) __dirname',
      'const o = { __dirname, f: __filename, __filename: 1 }',
      'o.__dirname',
      'require.main === module',
      'import.meta.env'
    ].join('\n')
    const r = instrument(src, '/ws/my dir/a.ts')
    expect(r.ok && r.code.split('\n')).toEqual([
      '__r(1, ("/ws/my dir"))',
      'const d = "/ws/my dir", f = "a.ts", p = "/ws/my dir/a.ts", n = "/ws/my dir/a.ts"',
      '__log(3, "log")(new URL("./a.txt", "file:///ws/my%20dir/a.ts").href, "/ws/my dir")',
      'if (true) "/ws/my dir"',
      'const o = { __dirname: "/ws/my dir", f: "/ws/my dir/a.ts", __filename: 1 }',
      '__r(6, (o.__dirname))',
      '__r(7, (true))',
      '__r(8, (import.meta.env))'
    ])
  })

  it('leaves __dirname alone where the scratch declares, assigns or only types it', () => {
    const src = [
      'const __dirname = dirname(fileURLToPath(import.meta.url))',
      'function f(__filename: string): typeof __filename { return __filename }',
      'let x: typeof __dirname = __dirname',
      'import.meta.dir = "x"'
    ].join('\n')
    const r = instrument(src, '/ws/a.ts')
    expect(r.ok && r.code.split('\n')).toEqual([
      'const __dirname = dirname(fileURLToPath("file:///ws/a.ts"))',
      'function f(__filename: string): typeof __filename { return __filename }',
      'let x: typeof __dirname = __dirname',
      '__r(4, (import.meta.dir = "x"))'
    ])
    const declared = instrument('declare const __dirname: string\n__dirname', '/ws/a.ts')
    expect(declared.ok && declared.code).toBe('declare const __dirname: string\n__r(2, ("/ws"))')
  })

  it('writes Windows paths as escaped literals and file URLs', () => {
    const r = instrument('import.meta.dir\n__filename\nimport.meta.url\nimport x from "./lib/x"', 'C:\\Users\\me\\Scriptty\\a.ts')
    expect(r.ok && r.code.split('\n')).toEqual([
      '__r(1, ("C:\\\\Users\\\\me\\\\Scriptty"))',
      '__r(2, ("C:\\\\Users\\\\me\\\\Scriptty\\\\a.ts"))',
      '__r(3, ("file:///C:/Users/me/Scriptty/a.ts"))',
      'import x from "C:/Users/me/Scriptty/lib/x"'
    ])
  })

  it('keeps import.meta as is without a real path', () => {
    const r = instrument('import.meta.dir\n__dirname')
    expect(r.ok && r.code).toBe('__r(1, (import.meta.dir))\n__r(2, (__dirname))')
  })

  it('reports syntax errors with a line', () => {
    const r = instrument('const a = 1\nconst = 2')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.line).toBe(2)
  })
})
