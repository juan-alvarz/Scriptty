import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { instrument } from './instrument'
import { Runner } from './runner'
import type { RunnerEvent } from '../shared/protocol'

const bun = resolve('node_modules/bun/bin/bun.exe')
const host = resolve('resources/runner/host.ts')
const dir = mkdtempSync(join(tmpdir(), 'scriptty-test-'))

let runner: Runner | null = null
afterEach(() => runner?.dispose())

function runCode(code: string, freezeMs = 5000, scratchDir = dir): Promise<RunnerEvent[]> {
  const r = instrument(code, 'scratch.ts', scratchDir)
  if (!r.ok) throw new Error(r.error)
  const file = join(dir, `run-${Math.random().toString(36).slice(2)}.ts`)
  writeFileSync(file, r.code)
  return new Promise((done) => {
    const events: RunnerEvent[] = []
    runner = new Runner({
      bun,
      host,
      cwd: dir,
      freezeMs,
      onEvent: (e) => {
        events.push(e)
        if (e.type === 'done') done(events)
      }
    })
    runner.run(1, file, [], scratchDir)
  })
}

const results = (es: RunnerEvent[]) =>
  es.flatMap((e) => (e.type === 'result' ? [`${e.line} ${e.kind} ${e.text}`] : []))

describe('runner', () => {
  it('runs TypeScript and reports values, logs and errors on their lines', async () => {
    const es = await runCode(
      ['const xs: number[] = [1, 2, 3]', 'xs.length', 'console.log("sum", xs.reduce((a, b) => a + b, 0))', 'await Promise.resolve("ok")', 'null.x'].join('\n')
    )
    expect(results(es)).toEqual([
      '1 value [1, 2, 3]',
      '2 value 3',
      '3 log sum 6',
      '4 value "ok"',
      expect.stringMatching(/^5 error TypeError/)
    ])
  })

  it('reports declarations, loop bodies with call counts, //? lines, and caps output per line', async () => {
    const es = await runCode(
      [
        'const total = [1, 2, 3].length',
        'let acc = 0',
        'for (let i = 1; i <= 3; i++) {',
        '  acc += i',
        '}',
        'function twice(n: number) {',
        '  return n * 2 //?',
        '}',
        'twice(1) + twice(5);',
        '[1, 2].forEach((x) => {})',
        'const pr = Promise.resolve(7)',
        'for (let i = 0; i < 1000; i++) i',
        'Promise.resolve(8)'
      ].join('\n')
    )
    const on = (line: number) => es.flatMap((e) => (e.type === 'result' && e.line === line ? [e] : []))
    const calls = (line: number) => on(line).reduce((n, e) => n + (e.type === 'result' ? (e.calls ?? 1) : 0), 0)
    const last = (line: number) => on(line).at(-1)
    expect(results(es).slice(0, 2)).toEqual(['1 value 3', '2 value 0'])
    expect(on(4).map((e) => e.text)).toEqual(['1', '3', '6'])
    expect(on(7).map((e) => e.text)).toEqual(['2', '10'])
    expect(on(10)).toEqual([]) // forEach returns undefined: not shown
    expect(on(11).map((e) => e.text)).toEqual(['Promise { <pending> }', '7'])
    expect(calls(11)).toBe(1)
    expect(on(13).map((e) => e.text)).toEqual(['8']) // a call's promise shows only once it settles
    // 1000 iterations: the first 100 one by one, then one entry with the latest value standing for the rest.
    expect(on(12)).toHaveLength(101)
    expect(last(12)).toMatchObject({ text: '999', calls: 900 })
    expect(calls(12)).toBe(1000)
  })

  it('runs imports between scratch files, packages from nested files, and relative fs paths', async () => {
    // Shared packages live in `dir/node_modules`; scratches live elsewhere, like ~/Documents/Scriptty.
    mkdirSync(join(dir, 'node_modules/fakepkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules/fakepkg/package.json'), '{"name":"fakepkg","main":"index.js"}')
    writeFileSync(join(dir, 'node_modules/fakepkg/index.js'), 'module.exports = { hi: () => "hi" }')
    const ws = mkdtempSync(join(tmpdir(), 'scriptty-ws-'))
    mkdirSync(join(ws, 'lib'))
    writeFileSync(join(ws, 'lib/utils.ts'), 'import { hi } from "fakepkg"\nexport const twice = (n: number): number => n * 2\nexport const greet = () => hi()')
    writeFileSync(join(ws, 'data.txt'), 'from disk')
    const es = await runCode(
      ['import { twice, greet } from "./lib/utils"', 'import { readFileSync } from "node:fs"', 'twice(21)', 'greet()', 'readFileSync("./data.txt", "utf8")'].join('\n'),
      5000,
      ws
    )
    expect(results(es)).toEqual(['3 value 42', '4 value "hi"', '5 value "from disk"'])
  })

  it('fails fast on a missing package instead of fetching it from npm', async () => {
    const es = await runCode('import x from "surely-not-installed-zzz"\nx')
    expect(results(es)).toEqual([expect.stringMatching(/^\d error .*surely-not-installed-zzz/)])
  })

  it('kills code that freezes', async () => {
    const es = await runCode('while (true) {}', 800)
    expect(results(es)).toEqual(['0 error Stopped: the code stopped responding for 1s'])
  })
})
