import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { instrument } from './instrument'
import { Runner, type DebugRun } from './runner'
import { DebugSession, describe as describeValue } from './debugger'
import type { Breakpoints, DebugEvent, DebugScope, RunnerEvent } from '../shared/protocol'

const bun = resolve('node_modules/bun/bin/bun.exe')
const host = resolve('resources/runner/host.ts')
const runs = mkdtempSync(join(tmpdir(), 'scriptty-dbg-'))
const gate = join(runs, 'debug-gate.ts')
writeFileSync(gate, 'debugger;\n')

let runner: Runner | null = null
let session: DebugSession | null = null
afterEach(() => {
  session?.dispose()
  runner?.dispose()
})

/** What the app does on Debug (index.ts), with a queue of events to await in order. */
async function debug(code: string, breakpoints: Breakpoints, o: { ws?: string; rel?: string; freezeMs?: number } = {}) {
  const ws = o.ws ?? mkdtempSync(join(tmpdir(), 'scriptty-dws-'))
  const rel = o.rel ?? 'main.ts'
  const r = instrument(code, 'scratch.ts', ws)
  if (!r.ok) throw new Error(r.error)
  const file = join(runs, `run-${Math.random().toString(36).slice(2)}.ts`)
  const entry = file.replace('run-', 'debug-')
  writeFileSync(file, r.code)
  writeFileSync(entry, `import ${JSON.stringify(gate)}\nimport ${JSON.stringify(file)}\n`)

  const queue: (DebugEvent | RunnerEvent)[] = []
  const waiters: (() => void)[] = []
  const push = (e: DebugEvent | RunnerEvent): void => {
    queue.push(e)
    waiters.splice(0).forEach((w) => w())
  }
  /** Resolves with the next event of `type`, skipping others (results are collected separately). */
  const next = async <T extends (DebugEvent | RunnerEvent)['type']>(type: T, ms = 8000) => {
    const t0 = Date.now()
    for (;;) {
      const i = queue.findIndex((e) => e.type === type)
      if (i >= 0) return queue.splice(0, i + 1).pop() as Extract<DebugEvent | RunnerEvent, { type: T }>
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${type}`)
      await new Promise<void>((res) => {
        waiters.push(res)
        setTimeout(res, 100)
      })
    }
  }
  const results: string[] = []
  runner = new Runner({
    bun,
    host,
    cwd: runs,
    freezeMs: o.freezeMs ?? 5000,
    onEvent: (e) => {
      if (e.type === 'result') results.push(`${e.line} ${e.kind} ${e.text}`)
      push(e)
    }
  })
  let ended = false
  const run: DebugRun = runner.debug(1, file, entry, ws, () => {
    ended = true
    push({ type: 'ended', runId: 1 })
  })
  session = await DebugSession.attach(await run.url, {
    runId: 1,
    runFile: file,
    rel,
    gate,
    root: ws,
    names: r.names,
    breakpoints,
    onEvent: push,
    onHold: (p) => run.hold(p)
  })
  run.start()
  return { s: session, run, next, results, ws, isEnded: () => ended }
}

const vars = (scopes: DebugScope[], name: string): Record<string, string> =>
  Object.fromEntries((scopes.find((s) => s.name === name)?.vars ?? []).map((v) => [v.name, v.value.text]))

// Lines: 1 comment, 2 type, 3 blank, 4 function, 5-6 body, 8 obj, 9 total, 10 log, 11 value.
const CODE = [
  '// bun drops this comment and the type below, so its line numbers differ from ours',
  'type T = { n: number; tags: string[] }',
  '',
  'function add(a: number, b: number) {',
  '  const sum = a + b',
  '  return sum',
  '}',
  'const obj: T = { n: 1, tags: ["x", "y"] }',
  'const total = add(2, 3)',
  'console.log("total", total)',
  'total * 2'
].join('\n')

describe('debugger', () => {
  it('stops at a breakpoint with locals, steps, and continues to the end', async () => {
    const d = await debug(CODE, { 'main.ts': [5] })
    const p = await d.next('paused')
    expect(p.reason).toBe('breakpoint')
    expect(p.frames.map((f) => `${f.name}@${f.file}:${f.line}`)).toEqual(['add@main.ts:5', '(top level)@main.ts:9'])

    let scopes = await d.s.scopes(0)
    expect(vars(scopes, 'Local')).toMatchObject({ a: '2', b: '3' })
    expect(vars(scopes, 'Module')).toMatchObject({ obj: '{ n: 1, tags: ["x", "y"] }', add: 'ƒ add()' })

    await d.s.command('stepOver')
    await d.next('resumed')
    const p2 = await d.next('paused')
    expect(p2.reason).toBe('step')
    expect(p2.frames[0].line).toBe(6)
    scopes = await d.s.scopes(0)
    expect(vars(scopes, 'Local')).toMatchObject({ sum: '5' })

    // The outer frame sees the module's own bindings.
    const outer = await d.s.scopes(1)
    expect(vars(outer, 'Module')).toHaveProperty('obj')

    await d.s.command('stepOut')
    const p3 = await d.next('paused')
    expect(p3.frames).toHaveLength(1)
    expect(p3.frames[0].line).toBe(10) // JavaScriptCore steps out to the next statement

    await d.s.command('continue')
    await d.next('done')
    expect(d.results).toEqual(['10 log total 5', '11 value 10'])
  })

  it('stops at debugger statements and expands objects', async () => {
    const d = await debug(['const m = new Map([["k", { deep: [1, 2] }]])', 'const list = [{ id: 1 }, { id: 2 }]', 'debugger', 'list.length'].join('\n'), {})
    const p = await d.next('paused')
    expect(p.reason).toBe('debugger')
    expect(p.frames[0].line).toBe(3)
    const mod = (await d.s.scopes(0)).find((s) => s.name === 'Module')!
    const list = mod.vars.find((v) => v.name === 'list')!
    expect(list.value).toMatchObject({ text: '[{ id: 1 }, { id: 2 }]', type: 'array' })
    const items = await d.s.props(list.value.objectId!, list.value.type)
    expect(items.map((v) => `${v.name}=${v.value.text}`)).toEqual(['0={ id: 1 }', '1={ id: 2 }'])
    const m = mod.vars.find((v) => v.name === 'm')!
    expect(m.value.text).toBe('Map(1) {"k" => { deep: [1, 2] }}')
    const entries = await d.s.props(m.value.objectId!, m.value.type)
    expect(entries[0]).toMatchObject({ name: '"k"', value: { text: '{ deep: [1, 2] }' } })
    await d.s.command('continue')
    await d.next('done')
    expect(d.results).toEqual(['4 value 2'])
  })

  it('does not let the freeze watchdog kill a paused run', async () => {
    const d = await debug('let n = 1\ndebugger\nn + 1', {}, { freezeMs: 300 })
    await d.next('paused')
    await new Promise((r) => setTimeout(r, 1000))
    expect(d.isEnded()).toBe(false)
    await d.s.command('continue')
    await d.next('done')
    expect(d.results).toEqual(['3 value 2'])
  })

  it('sets breakpoints in imported scratches and while running', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'scriptty-dws-'))
    mkdirSync(join(ws, 'lib'))
    writeFileSync(join(ws, 'lib/math.ts'), '// helpers\n\nexport function double(n: number): number {\n  const out = n * 2\n  return out\n}\n')
    const code = 'import { double } from "./lib/math"\nconst a = double(4)\nawait new Promise((r) => setTimeout(r, 300))\nconst b = double(5)\nb'
    const d = await debug(code, { 'lib/math.ts': [4] }, { ws })
    const p = await d.next('paused')
    expect(p.frames.map((f) => `${f.name}@${f.file}:${f.line}`)).toEqual(['double@lib/math.ts:4', '(top level)@main.ts:2'])
    expect(vars(await d.s.scopes(0), 'Local')).toMatchObject({ n: '4' })
    // Clear the breakpoint in the library and add one on the main file while it runs.
    await d.s.setBreakpoints('lib/math.ts', [])
    await d.s.setBreakpoints('main.ts', [5])
    await d.s.command('continue')
    const p2 = await d.next('paused')
    expect(p2.frames[0]).toMatchObject({ file: 'main.ts', line: 5 })
    expect(vars(await d.s.scopes(0), 'Module')).toMatchObject({ a: '8', b: '10' })
    await d.s.command('continue')
    await d.next('done')
    expect(d.results).toEqual(['3 value undefined', '5 value 10'])
  })

  it('groups scopes into Local, Closure and Module, and steps into calls the instrumentation wraps', async () => {
    const code = [
      'function outer(k: number) {',
      '  const cap = k + 1',
      '  return (z: number) => {',
      '    for (let i = 0; i < 1; i++) {',
      '      const inner = z + cap + i',
      '      debugger',
      '    }',
      '  }',
      '}',
      'const fn = outer(1)',
      'fn(5)' // runs as __r(11, (fn(5))): Step Into must skip the host's __r
    ].join('\n')
    const d = await debug(code, { 'main.ts': [11] })
    await d.next('paused')
    await d.s.command('stepInto')
    const p = await d.next('paused')
    expect(p.frames.map((f) => `${f.name}:${f.line}`)).toEqual(['(anonymous):4', '(top level):11'])
    await d.s.command('continue')
    await d.next('paused')
    const scopes = await d.s.scopes(0)
    expect(scopes.map((s) => s.name)).toEqual(['Local', 'Closure (outer)', 'Module'])
    expect(vars(scopes, 'Local')).toEqual({ inner: '7', i: '0', z: '5' })
    expect(vars(scopes, 'Closure (outer)')).toEqual({ cap: '2', k: '1' })
    expect(vars(scopes, 'Module')).toEqual({ outer: 'ƒ outer()', fn: 'ƒ anonymous()' })
    await d.s.command('continue')
    await d.next('done')
  })

  it('ends when the run is stopped', async () => {
    const d = await debug('debugger\n1', {})
    await d.next('paused')
    d.run.stop()
    await d.next('ended')
    expect(d.isEnded()).toBe(true)
  })
})

describe('describe', () => {
  it('formats protocol values like the results gutter', () => {
    expect(describeValue({ type: 'string', value: 'hi' })).toEqual({ text: '"hi"', type: 'string' })
    expect(describeValue({ type: 'object', subtype: 'null', value: null })).toEqual({ text: 'null', type: 'object' })
    expect(describeValue({ type: 'function', description: 'async function load(x) {}', objectId: '1' })).toEqual({ text: 'ƒ load()', type: 'function' })
    expect(describeValue({ type: 'function', subtype: 'class', className: 'K', objectId: '1' }).text).toBe('class K')
    expect(
      describeValue({
        type: 'object',
        className: 'Promise',
        objectId: '2',
        preview: { type: 'object', properties: [{ name: 'status', type: 'string', value: 'fulfilled' }, { name: 'result', type: 'number', value: '1' }] }
      })
    ).toEqual({ text: 'Promise { <fulfilled>: 1 }', type: 'object', objectId: '2' })
  })
})
