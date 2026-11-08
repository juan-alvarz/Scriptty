import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { instrument } from './instrument'
import { Runner } from './runner'
import { EnvFiles } from './env'
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
      '2 value 3',
      '3 log sum 6',
      '4 value "ok"',
      expect.stringMatching(/^5 error TypeError/)
    ])
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

  it('gives each run its .env variables, nearer files first, without leaking into the next run', async () => {
    // A package that reads the env on load: the warm spare preloads it, so it must see the scratch's .env too.
    mkdirSync(join(dir, 'node_modules/envpkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules/envpkg/package.json'), '{"name":"envpkg","main":"index.js"}')
    writeFileSync(join(dir, 'node_modules/envpkg/index.js'), 'module.exports = { seen: process.env.FOO }')
    const ws = mkdtempSync(join(tmpdir(), 'scriptty-ws-'))
    const sub = join(ws, 'a', 'b')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(ws, '.env'), 'FOO=root\nBAR=root\n')
    writeFileSync(join(ws, 'a', 'b', '.env'), 'export FOO="near"\r\n')
    const envs = new EnvFiles(ws)

    const waiting = new Map<number, (es: RunnerEvent[]) => void>()
    const events = new Map<number, RunnerEvent[]>()
    runner = new Runner({
      bun,
      host,
      cwd: dir,
      freezeMs: 5000,
      onEvent: (e) => {
        events.set(e.runId, [...(events.get(e.runId) ?? []), e])
        if (e.type === 'done') waiting.get(e.runId)?.(events.get(e.runId)!)
      }
    })
    let id = 0
    const run = async (code: string, scratchDir: string): Promise<string[]> => {
      const r = instrument(code, 'scratch.ts', scratchDir)
      if (!r.ok) throw new Error(r.error)
      const file = join(dir, `run-env-${++id}.ts`)
      writeFileSync(file, r.code)
      const done = new Promise<RunnerEvent[]>((ok) => waiting.set(id, ok))
      runner!.run(id, file, r.imports, scratchDir, await envs.load(scratchDir, {}))
      return results(await done)
    }
    const code = 'import { seen } from "envpkg"\nprocess.env.FOO\nBun.env.BAR\nseen'

    expect(await run(code, sub)).toEqual(['2 value "near"', '3 value "root"', '4 value "near"'])
    // Same .env: this run takes the spare that preloaded envpkg under it.
    expect(await run(code, sub)).toEqual(['2 value "near"', '3 value "root"', '4 value "near"'])
    // Different .env: the preloaded spare is dropped, so envpkg loads again with the root values.
    expect(await run(code, ws)).toEqual(['2 value "root"', '3 value "root"', '4 value "root"'])
    rmSync(join(ws, '.env'))
    rmSync(join(ws, 'a', 'b', '.env'))
    expect(await run(code, sub)).toEqual(['2 value undefined', '3 value undefined', '4 value undefined'])
  })

  it('kills code that freezes', async () => {
    const es = await runCode('while (true) {}', 800)
    expect(results(es)).toEqual(['0 error Stopped: the code stopped responding for 1s'])
  })
})
