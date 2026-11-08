import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SnippetStore, STARTER, normalize, parseSnippets, stripJsonc } from './snippets'

const fresh = (): SnippetStore => new SnippetStore(join(mkdtempSync(join(tmpdir(), 'scriptty-sn-')), 'snippets.json'))

describe('stripJsonc', () => {
  it('removes comments and trailing commas but leaves strings alone', () => {
    const text = `{
      // line comment
      "a": "http://x.dev/*not a comment*/", /* block */
      "b": ["x", "y",],
      "c": "quote \\" // still string",
    }`
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: 'http://x.dev/*not a comment*/', b: ['x', 'y'], c: 'quote " // still string' })
  })

  it('keeps line breaks so error positions match the file', () => {
    const text = '{\n// c\n"a": 1,\n}'
    expect(stripJsonc(text).split('\n').length).toBe(4)
    expect(stripJsonc(text).length).toBe(text.length)
  })

  it('handles a byte order mark and a trailing comma before a comment', () => {
    expect(JSON.parse(stripJsonc('﻿{"a": 1, // last\n}'))).toEqual({ a: 1 })
  })
})

describe('parseSnippets', () => {
  it('accepts body and prefix as a string or an array, and skips broken entries', () => {
    const p = parseSnippets(`{
      "One": { "prefix": "one", "body": "a$1" },
      "Two": { "prefix": ["two", "deux"], "body": ["l1", "\\tl2"], "description": "d", "scope": "typescript" },
      "No body": { "prefix": "x" },
      "No prefix": { "body": "x" },
      "Not an object": 3,
    }`)
    expect(p.snippets).toEqual([
      { name: 'One', prefix: ['one'], body: 'a$1', description: '' },
      { name: 'Two', prefix: ['two', 'deux'], body: 'l1\n\tl2', description: 'd', scope: 'typescript' }
    ])
    expect(p.skipped).toEqual(['No body', 'No prefix', 'Not an object'])
  })

  it('reports invalid JSON and non-object files', () => {
    expect(() => parseSnippets('{ "a": ')).toThrow(/not valid JSON/)
    expect(() => parseSnippets('[1, 2]')).toThrow(/must be an object/)
    expect(parseSnippets('').snippets).toEqual([])
  })

  it('normalizes every starter snippet', () => {
    for (const [name, raw] of Object.entries(STARTER)) expect(normalize(name, raw)).not.toBeNull()
  })
})

describe('SnippetStore', () => {
  it('seeds the starter set once and never overwrites user edits', () => {
    const store = fresh()
    expect(store.ensure()).toBe(true)
    store.load()
    expect(store.state.snippets.map((s) => s.prefix[0])).toContain('clg')
    writeFileSync(store.file, '{ "Mine": { "prefix": "m", "body": "mine" } }')
    expect(store.ensure()).toBe(false)
    store.load()
    expect(store.state.snippets).toEqual([{ name: 'Mine', prefix: ['m'], body: 'mine', description: '' }])
  })

  it('writes a file that parses again, with a comment header and the body as lines', () => {
    const store = fresh()
    store.ensure()
    store.load()
    const text = readFileSync(store.file, 'utf8')
    expect(text.startsWith('//')).toBe(true)
    expect(parseSnippets(text).raw['Try/catch'].body).toEqual(STARTER['Try/catch'].body)
  })

  it('round-trips add, edit, rename and delete, keeping fields it does not edit', () => {
    const store = fresh()
    writeFileSync(store.file, '{ "A": { "prefix": "a", "body": "x", "scope": "javascript", "isFileTemplate": true }, "B": { "prefix": "b", "body": "y" } }')
    store.load()
    store.put(null, { name: 'C', prefix: ['c', 'cc'], body: 'line 1\nline 2', description: 'see' })
    store.put('A', { name: 'A2', prefix: ['a'], body: 'z', description: '' })
    const raw = parseSnippets(readFileSync(store.file, 'utf8')).raw
    expect(Object.keys(raw)).toEqual(['A2', 'B', 'C'])
    expect(raw.A2).toEqual({ prefix: 'a', body: ['z'], scope: 'javascript', isFileTemplate: true })
    expect(raw.C).toEqual({ prefix: ['c', 'cc'], body: ['line 1', 'line 2'], description: 'see' })

    const reloaded = new SnippetStore(store.file)
    reloaded.load()
    expect(reloaded.state.snippets.find((s) => s.name === 'C')?.body).toBe('line 1\nline 2')
    reloaded.remove('B')
    expect(reloaded.state.snippets.map((s) => s.name)).toEqual(['A2', 'C'])
  })

  it('validates edits', () => {
    const store = fresh()
    store.ensure()
    store.load()
    const ok = { name: 'X', prefix: ['x'], body: 'x', description: '' }
    expect(() => store.put(null, { ...ok, name: ' ' })).toThrow(/name/)
    expect(() => store.put(null, { ...ok, prefix: [''] })).toThrow(/prefix/)
    expect(() => store.put(null, { ...ok, prefix: ['a b'] })).toThrow(/spaces/)
    expect(() => store.put(null, { ...ok, body: '  ' })).toThrow(/empty/)
    expect(() => store.put(null, { ...ok, name: 'Import' })).toThrow(/already exists/)
  })

  it('keeps the last good snippets on a broken file and refuses to overwrite it', () => {
    const store = fresh()
    store.ensure()
    store.load()
    const good = store.state.snippets
    writeFileSync(store.file, '{ "oops": ')
    expect(store.load()).toBe(true)
    expect(store.state.snippets).toEqual(good)
    expect(store.state.error).toMatch(/not valid JSON/)
    expect(() => store.put(null, { name: 'X', prefix: ['x'], body: 'x', description: '' })).toThrow(/Fix snippets.json/)
    expect(readFileSync(store.file, 'utf8')).toBe('{ "oops": ')
    writeFileSync(store.file, '{}')
    store.load()
    expect(store.state).toEqual({ snippets: [], error: '', file: store.file })
  })

  it('restores the starter set and keeps the user snippets', () => {
    const store = fresh()
    writeFileSync(store.file, '{ "Log to console": { "prefix": "clg", "body": "changed" }, "Mine": { "prefix": "m", "body": "m" } }')
    store.load()
    store.restore()
    const names = store.state.snippets.map((s) => s.name)
    expect(names).toEqual(expect.arrayContaining([...Object.keys(STARTER), 'Mine']))
    expect(store.state.snippets.find((s) => s.name === 'Log to console')?.body).toBe('console.log($1)')
  })

  it('treats a missing file as empty and reports no change on an identical reload', () => {
    const store = fresh()
    expect(existsSync(store.file)).toBe(false)
    expect(store.load()).toBe(false)
    expect(store.state.snippets).toEqual([])
  })
})
