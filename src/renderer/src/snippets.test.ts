import { describe, expect, it } from 'vitest'
import { inScope, prefixStart, preview, toSuggestions } from './snippets'
import type { Snippet } from '../../shared/protocol'

const clg: Snippet = { name: 'Log to console', prefix: ['clg'], body: 'console.log($1)', description: 'Log it' }

describe('preview', () => {
  it('fills placeholders and choices and drops bare tab stops', () => {
    expect(preview('console.log($1)')).toBe('console.log()')
    expect(preview('const ${1:name} = ($2) => {\n\t$0\n}')).toBe('const name = () => {\n\t\n}')
    expect(preview('console.${1|log,info|}($2)')).toBe('console.log()')
    expect(preview('${1:outer ${2:inner}}')).toBe('outer inner')
    expect(preview('${1}x${TM_FILENAME}${TM_FILENAME/(.*)/$1/}${VAR:dflt}')).toBe('xdflt')
  })

  it('resolves escapes and keeps a lone dollar', () => {
    expect(preview('cost: \\$5 \\} $ ok')).toBe('cost: $5 } $ ok')
  })
})

describe('prefixStart', () => {
  it('finds the typed part of a prefix at the start of a token', () => {
    expect(prefixStart('  cl', 'clg')).toBe(3)
    expect(prefixStart('clg', 'clg')).toBe(1)
    expect(prefixStart('x = CL', 'clg')).toBe(5)
    expect(prefixStart('foo.c', 'clg')).toBe(5)
    expect(prefixStart('fooc', 'clg')).toBe(0)
    expect(prefixStart('', 'clg')).toBe(0)
  })

  it('allows prefixes that start with punctuation', () => {
    expect(prefixStart('a!lo', '!log')).toBe(2)
  })
})

describe('toSuggestions', () => {
  it('turns each prefix into a suggestion', () => {
    const [s, ...rest] = toSuggestions([{ ...clg, prefix: ['clg', 'log'] }], 'typescript', 'cl', 1)
    expect(rest.map((r) => r.label.label)).toEqual(['log'])
    expect(s).toEqual({
      label: { label: 'clg', description: 'Log to console' },
      filterText: 'clg',
      insertText: 'console.log($1)',
      detail: 'Log it',
      documentation: '```typescript\nconsole.log()\n```',
      sortText: '0clg',
      startColumn: 1
    })
  })

  it('falls back to the word start for fuzzy matches and to the name for detail', () => {
    const [s] = toSuggestions([{ ...clg, description: '' }], 'javascript', 'x = cg', 5)
    expect(s.startColumn).toBe(5)
    expect(s.detail).toBe('Log to console')
  })

  it('respects VS Code scopes', () => {
    const ts = { ...clg, scope: 'typescript, typescriptreact' }
    expect(inScope(ts, 'typescript')).toBe(true)
    expect(inScope(ts, 'javascript')).toBe(false)
    expect(inScope(clg, 'javascript')).toBe(true)
    expect(toSuggestions([ts], 'javascript', '', 1)).toEqual([])
  })
})
