import { describe, expect, it } from 'vitest'
import { instrument, topLevelNames } from './instrument'

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

  it('reports syntax errors with a line', () => {
    const r = instrument('const a = 1\nconst = 2')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.line).toBe(2)
  })

  it('lists top-level runtime bindings for the debugger', () => {
    const src = [
      'import a, { b, type T } from "x"',
      'import type { U } from "y"',
      'const { c, d: [e, ...f], g = 1, ...h } = obj',
      'let i = 1, j',
      'function k() { const local = 1 }',
      'export class L {}',
      'export const m = 2',
      'enum N { A }',
      'declare const n: number',
      'type V = number',
      'interface W {}'
    ].join('\n')
    expect(topLevelNames(src, 'x.ts')).toEqual(['a', 'b', 'c', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'L', 'm', 'N'])
    const r = instrument('const z = 1\nz')
    expect(r.ok && r.names).toEqual(['z'])
    expect(topLevelNames('const = 1', 'x.ts')).toEqual([])
  })
})
