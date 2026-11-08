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

function writeRun(code: string, scratchDir = dir): string {
  const r = instrument(code, 'scratch.ts', scratchDir)
  if (!r.ok) throw new Error(r.error)
  const file = join(dir, `run-${Math.random().toString(36).slice(2)}.ts`)
  writeFileSync(file, r.code)
  return file
}

/** Resolves once `test` passes on the events so far (polled; the runner pushes into `events`). */
async function until(events: RunnerEvent[], test: (es: RunnerEvent[]) => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!test(events)) {
    if (Date.now() > end) throw new Error('timed out: ' + JSON.stringify(events))
    await new Promise((r) => setTimeout(r, 20))
  }
}

function runCode(code: string, freezeMs = 5000, scratchDir = dir): Promise<RunnerEvent[]> {
  const file = writeRun(code, scratchDir)
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
      '2 value 3',
      '3 log sum 6',
      '4 value "ok"',
      expect.stringMatching(/^5 error TypeError/)
    ])
  })

  it('flags thrown errors and rejections, not console.error output', async () => {
    const es = await runCode(['console.error("careful")', 'Promise.reject(new Error("later"))', 'throw new Error("now")'].join('\n'))
    const errors = es.flatMap((e) => (e.type === 'result' && e.kind === 'error' ? [`${e.line} ${e.thrown ?? false} ${e.text}`] : []))
    expect(errors).toEqual(['1 false careful', '2 true Error: later', '3 true Error: now'])
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

  it('stops a run that keeps going, sends nothing after, and runs the next one', async () => {
    const events: RunnerEvent[] = []
    runner = new Runner({ bun, host, cwd: dir, freezeMs: 5000, onEvent: (e) => events.push(e) })
    runner.run(1, writeRun('let n = 0\nsetInterval(() => console.log("tick", ++n), 20)'), [], dir)
    await until(events, (es) => results(es).length >= 2)
    expect(runner.stop()).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'done', runId: 1, ms: 0, stopped: true })
    const seen = events.length
    await new Promise((r) => setTimeout(r, 300))
    expect(events.length).toBe(seen)
    expect(runner.stop()).toBe(false)

    runner.run(2, writeRun('1 + 1'), [], dir)
    await until(events, (es) => es.some((e) => e.type === 'done' && e.runId === 2))
    expect(results(events.filter((e) => e.runId === 2))).toEqual(['1 value 2'])
  })
})
