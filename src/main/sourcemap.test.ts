import { describe, expect, it } from 'vitest'
import { decodeMappings, generatedFor, parseSourceMapUrl, sourceLine } from './sourcemap'

// Generated line 0 comes from source line 4 (cols 0 and 6), generated line 1 from source line 5.
const MAPPINGS = 'AAIA,MAAM;AACA'

describe('sourcemap', () => {
  it('decodes VLQ mappings per generated line', () => {
    expect(decodeMappings(MAPPINGS)).toEqual([
      [
        [0, 4, 0],
        [6, 4, 6]
      ],
      [[0, 5, 6]] // source columns are relative to the previous segment
    ])
  })

  it('maps generated positions back to source lines', () => {
    const map = decodeMappings(MAPPINGS)
    expect(sourceLine(map, 0, 8)).toBe(4)
    expect(sourceLine(map, 1, 3)).toBe(5)
    expect(sourceLine(map, 5, 0)).toBe(5) // past the end: the last mapped line
    expect(sourceLine(null, 7, 0)).toBe(7)
  })

  it('puts a breakpoint on the first code at or after a source line', () => {
    const map = decodeMappings(MAPPINGS)
    expect(generatedFor(map, 4)).toEqual({ line: 0, col: 0 })
    expect(generatedFor(map, 5)).toEqual({ line: 1, col: 0 })
    expect(generatedFor(map, 1)).toEqual({ line: 0, col: 0 }) // a comment above the code
    expect(generatedFor(map, 9)).toBeNull()
  })

  it('reads inline data URLs', () => {
    const url = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ version: 3, mappings: MAPPINGS })).toString('base64')
    expect(parseSourceMapUrl(url)).toEqual(decodeMappings(MAPPINGS))
    expect(parseSourceMapUrl('x.map')).toBeNull()
    expect(parseSourceMapUrl(undefined)).toBeNull()
  })
})
