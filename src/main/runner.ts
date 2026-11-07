import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { MARK, type FromRunner, type RunnerEvent, type ToRunner } from '../shared/protocol'

export type RunnerOptions = {
  bun: string
  host: string
  /** Shared packages folder: bare imports resolve from here. */
  cwd: string
  /** Kill a run whose event loop has not answered for this long (decision 11). */
  freezeMs: number
  onEvent: (e: RunnerEvent) => void
}

type Proc = { child: ChildProcess; lastBeat: number; runId: number; exited: boolean; killed: boolean }

/** Warm spare runner (decision 10): one fresh bun process waits, ready to take the next run. */
export class Runner {
  private spare: Proc
  private active: Proc | null = null
  private watchdog: NodeJS.Timeout

  constructor(private o: RunnerOptions) {
    this.spare = this.spawn([])
    this.watchdog = setInterval(() => this.check(), 250)
    this.watchdog.unref()
  }

  run(runId: number, file: string, preload: string[], dir: string): void {
    if (this.active) this.kill(this.active)
    const p = this.spare.exited ? this.spawn([]) : this.spare
    this.spare = this.spawn(preload)
    this.active = p
    p.runId = runId
    p.lastBeat = Date.now()
    this.send(p, { type: 'run', runId, file, dir })
  }

  setFreezeMs(ms: number): void {
    this.o.freezeMs = ms
  }

  dispose(): void {
    clearInterval(this.watchdog)
    if (this.active) this.kill(this.active)
    this.kill(this.spare)
  }

  private check(): void {
    const p = this.active
    if (!p || p.exited || Date.now() - p.lastBeat <= this.o.freezeMs) return
    this.kill(p)
    const secs = Math.round(this.o.freezeMs / 1000)
    this.finish(p, `Stopped: the code stopped responding for ${secs}s`)
  }

  private finish(p: Proc, error: string): void {
    this.o.onEvent({ type: 'result', runId: p.runId, line: 0, kind: 'error', text: error })
    this.o.onEvent({ type: 'done', runId: p.runId, ms: 0 })
  }

  private spawn(preload: string[]): Proc {
    // --no-install: bun would otherwise fetch unknown imports from npm mid-run (and freeze while typing a name).
    // NODE_PATH: files the scratch imports find the shared packages too, wherever they live.
    const child = spawn(this.o.bun, ['--no-install', this.o.host], {
      cwd: this.o.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_PATH: join(this.o.cwd, 'node_modules'), NO_COLOR: '1', FORCE_COLOR: '0' },
      windowsHide: true
    })
    const p: Proc = { child, lastBeat: Date.now(), runId: -1, exited: false, killed: false }
    child.stdin!.on('error', () => {})
    createInterface({ input: child.stdout! }).on('line', (line) => this.onLine(p, line))
    createInterface({ input: child.stderr! }).on('line', (line) => this.forward(p, { kind: 'warn', text: line }))
    child.on('error', (e) => {
      p.exited = true
      if (p === this.active) this.finish(p, `Could not start the runtime: ${e.message}`)
    })
    child.on('exit', (code, signal) => {
      p.exited = true
      if (p === this.active && !p.killed) this.finish(p, `The runtime exited (${signal ?? code})`)
    })
    if (preload.length) this.send(p, { type: 'preload', modules: preload, cwd: this.o.cwd })
    return p
  }

  private onLine(p: Proc, line: string): void {
    if (!line.startsWith(MARK)) return this.forward(p, { kind: 'log', text: line })
    let m: FromRunner
    try {
      m = JSON.parse(line.slice(MARK.length))
    } catch {
      return
    }
    if (m.type === 'hb') p.lastBeat = Date.now()
    else if (p === this.active) this.o.onEvent(m)
  }

  /** Output not sent through the protocol (packages printing, bun warnings) shows as line 0. */
  private forward(p: Proc, e: { kind: 'log' | 'warn'; text: string }): void {
    if (p === this.active) this.o.onEvent({ type: 'result', runId: p.runId, line: 0, ...e })
  }

  private send(p: Proc, m: ToRunner): void {
    p.child.stdin!.write(JSON.stringify(m) + '\n')
  }

  private kill(p: Proc): void {
    p.killed = true
    if (!p.exited) p.child.kill('SIGKILL')
  }
}
