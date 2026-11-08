import { describe, expect, it } from 'vitest'
import { missingOn, specifiersIn } from './missing'

describe('specifiersIn', () => {
  it('finds the specifier of each import form with 1-based columns', () => {
    const line = 'import a from "lodash/fp"'
    const [hit] = specifiersIn(line)
    expect(hit.spec).toBe('lodash/fp')
    expect(line.slice(hit.start - 1, hit.end - 1)).toBe('lodash/fp')
    expect(specifiersIn("import 'side-effect'").map((h) => h.spec)).toEqual(['side-effect'])
    expect(specifiersIn('export * from "x"').map((h) => h.spec)).toEqual(['x'])
    expect(specifiersIn('const z = await import( "zod" )').map((h) => h.spec)).toEqual(['zod'])
    expect(specifiersIn("const _ = require('lodash'); import t from 'b'").map((h) => h.spec)).toEqual(['lodash', 'b'])
    expect(specifiersIn("import type { A } from '@scope/pkg/sub'").map((h) => h.spec)).toEqual(['@scope/pkg/sub'])
  })

  it('does not treat method calls or plain strings as imports', () => {
    expect(specifiersIn('Array.from("abc"); obj.require("x"); const s = "lodash"')).toEqual([])
  })
})

describe('missingOn', () => {
  it('returns only missing packages, by package name', () => {
    const missing = new Set(['lodash', '@scope/pkg'])
    const hits = missingOn('import fp from "lodash/fp"; import z from "zod"; import "@scope/pkg/x"; import "./lodash"', missing)
    expect(hits.map((h) => h.name)).toEqual(['lodash', '@scope/pkg'])
  })
})
