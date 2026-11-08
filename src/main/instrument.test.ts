import { describe, expect, it } from 'vitest'
import { parseSync } from 'oxc-parser'
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
    expect(out[1]).toBe('const xs: number[] = [1, 2];__r(2, xs);')
    expect(out[7]).toBe('})), 1)')
  })

  it('leaves directives alone', () => {
    const r = instrument('"use strict"\n1')
    expect(r.ok && r.code).toBe('"use strict"\n__r(2, (1))')
  })

  it('uses UTF-16 offsets so text after emoji is not shifted', () => {
    const r = instrument('const s = "😀"; s.length')
    expect(r.ok && r.code).toBe('const s = "😀";__r(1, s); __r(1, (s.length))')
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
      'const c = await import("/ws/dir/c");__r(3, c);',
      'import z from "zod"'
    ])
  })

  it('reports declarations, nested statements and //? lines without changing the line count', () => {
    // [source, expected] pairs; every case also checks the line count.
    const cases: [string, string][] = [
      // Declarations: one name reports its value, several report an object, functions and classes are left out.
      ['const x = 1', 'const x = 1;__r(1, x);'],
      ['let y = f();', 'let y = f();__r(1, y);'],
      ['const { a, b: [c], ...rest } = o, z = 2', 'const { a, b: [c], ...rest } = o, z = 2;__r(1, { a, c, rest, z });'],
      ['let n', 'let n'],
      ['let m = 1, k', 'let m = 1, k;__r(1, m);'],
      ['const f = (x: number) => x * 2', 'const f = (x: number) => x * 2'],
      ['const g = function () {}, C = class {}, v = 3', 'const g = function () {}, C = class {}, v = 3;__r(1, v);'],
      ['export const e = 1', 'export const e = 1;__r(1, e);'],
      ['declare const d: number', 'declare const d: number'],
      // Multi-line declarations report on their last line; the `;` guards a next line starting with `(`.
      ['const r = xs\n  .map(x => x)\n(r)', 'const r = xs\n  .map(x => x)\n(r);__r(3, r);'],
      ['const r = 1;\n(r)', 'const r = 1;__r(1, r);\n__r(2, ((r)))'],
      // Nested statements and declarations, in loops, functions, blocks and switch cases.
      [
        'for (let i = 0; i < 3; i++) {\n  i * 2\n  const sq = i * i\n}',
        'for (let i = 0; i < 3; i++) {\n  __r(2, (i * 2))\n  const sq = i * i;__r(3, sq);\n}'
      ],
      ['for (const k in o) k', 'for (const k in o) __r(1, (k))'],
      ['if (a) b = 1; else c', 'if (a) __r(1, (b = 1)); else __r(1, (c))'],
      ['switch (x) { case 1: x; break }', 'switch (x) { case 1: __r(1, (x)); break }'],
      ['xs.forEach(x => { x })', '__r(1, (xs.forEach(x => { __r(1, (x)) })), 1)'],
      ['class K { static { this.x } }', 'class K { static { __r(1, (this.x)) } }'],
      ['namespace N { export const v = 1 }', 'namespace N { export const v = 1;__r(1, v); }'],
      // Calls, awaited calls, optional calls and `void` hide an undefined result.
      ['async function h() { await sleep(1); await x }', 'async function h() { __r(1, (await sleep(1)), 1); __r(1, (await x)) }'],
      ['a?.b()', '__r(1, (a?.b()), 1)'],
      ['void 0', '__r(1, (void 0), 1)'],
      // Left alone: directives, super(), yield, console calls, `for` headers, enums.
      ['function s() {\n  "use strict"\n  1\n}', 'function s() {\n  "use strict"\n  __r(3, (1))\n}'],
      ['class A extends B { constructor(private q: number) { super(q); this.q } }', 'class A extends B { constructor(private q: number) { super(q); __r(1, (this.q)) } }'],
      ['function* gen() { yield 1; const got = yield 2 }', 'function* gen() { yield 1; const got = yield 2;__r(1, got); }'],
      ['function l() { console.log(1) }', 'function l() { __log(1, "log")(1) }'],
      ['enum E { A = 1, B = A * 2 }', 'enum E { A = 1, B = A * 2 }'],
      // `//?` reports a call's undefined and wraps the outermost expression ending before it.
      ['f() //?', '__r(1, (f())) //?'],
      ['function t() {\n  return a + b //?\n}', 'function t() {\n  return __r(2, (a + b)) //?\n}'],
      ['function t() { return a?.b.c } //?', 'function t() { return __r(1, (a?.b.c)) } //?'],
      ['if (a > b) { //?\n  a = b\n}', 'if (__r(1, (a > b))) { //?\n  __r(2, (a = b))\n}'],
      ['foo(bar(1), //?\n  2)', '__r(2, (foo(__r(1, (bar(1))), //?\n  2)), 1)'],
      ['function q() {\n  return obj.method(x) //?\n}', 'function q() {\n  return __r(2, (obj.method(x))) //?\n}'],
      ['function w() { return new Foo(1) /*?*/ }', 'function w() { return __r(1, (new Foo(1))) /*?*/ }'],
      ['class S extends T { m() { super.m(); return super.n } } //?', 'class S extends T { m() { __r(1, (super.m())); return __r(1, (super.n)) } } //?'],
      // ...but not twice, nor shorthand properties, methods, callees, assignment targets or console calls.
      ['const v = a?.b.c //?', 'const v = a?.b.c;__r(1, v); //?'],
      ['console.log(x) //?', '__log(1, "log")(x) //?'],
      ['function sh() { return { a, //?\n  b } }', 'function sh() { return { a, //?\n  b } }'],
      ['function m() { return { f() { return 1 } } } //?', 'function m() { return __r(1, ({ f() { return 1 } })) } //?'],
      ['function as() { o.x! = 1 } //?', 'function as() { __r(1, (o.x! = 1)) } //?'],
      ['function u() { typeof nope //?\n}', 'function u() { __r(1, (typeof nope)) //?\n}'],
      ['let p = 1 //? note', 'let p = 1;__r(1, p); //? note'],
      ['x //?no', '__r(1, (x)) //?no']
    ]
    for (const [src, expected] of cases) {
      const r = instrument(src)
      if (!r.ok) throw new Error(`${src}: ${r.error}`)
      expect(r.code, src).toBe(expected)
      expect(r.code.split('\n').length, src).toBe(src.split('\n').length)
      expect(parseSync('check.ts', r.code).errors, r.code).toEqual([])
    }
  })

  it('reports syntax errors with a line', () => {
    const r = instrument('const a = 1\nconst = 2')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.line).toBe(2)
  })
})
