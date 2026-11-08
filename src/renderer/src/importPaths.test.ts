import { describe, expect, it } from 'vitest'
import { pathSuggestions } from './importPaths'

const paths = ['/P/app.ts', '/P/types.ts', '/P/utils.js', '/P/data.mjs', '/P/lib/a.ts', '/P/lib/deep/b.ts', '/top.ts']
const names = (from: string, spec: string): string[] =>
  pathSuggestions(from, spec, paths).map((s) => s.name + (s.folder ? '/' : ''))

describe('pathSuggestions', () => {
  it('lists siblings and folders, without the current file', () => {
    expect(names('/P/app.ts', './')).toEqual(['types', 'utils', 'data.mjs', 'lib/'])
  })

  it('keeps the typed partial for the filter, so it lists the whole folder', () => {
    expect(names('/P/app.ts', './ty')).toEqual(['types', 'utils', 'data.mjs', 'lib/'])
  })

  it('goes into subfolders and up', () => {
    expect(names('/P/app.ts', './lib/')).toEqual(['a', 'deep/'])
    expect(names('/P/lib/a.ts', '../')).toEqual(['app', 'types', 'utils', 'data.mjs', 'lib/'])
    expect(names('/P/app.ts', '../')).toEqual(['P/', 'top'])
  })

  it('ignores package names and bare dots', () => {
    expect(names('/P/app.ts', 'lodash')).toEqual([])
    expect(names('/P/app.ts', '.')).toEqual([])
    expect(names('/P/app.ts', '..')).toEqual([])
  })

  it('handles spaces in folder names', () => {
    expect(pathSuggestions('/My P/app.ts', './', ['/My P/app.ts', '/My P/x.ts'])).toEqual([{ name: 'x', folder: false }])
  })
})
