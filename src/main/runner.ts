import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
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

type Proc = {
  child: ChildProcessWithoutNullStreams
  lastBeat: number
  runId: number
  exited: boolean
  killed: boolean
  /** Debug runs: stopped at a breakpoint, so no heartbeats come and the watchdog waits. */
  held?: boolean
  /** Debug runs: called once when the process is killed or exits. */
  onEnd?: () => void
  /** Debug runs: receives the inspector URL bun prints on stderr. */
  onUrl?: (url: string) => void
  /** Debug runs: 0 before, 1 inside, 2 after bun's inspector banner on stderr (kept out of the results). */
  banner?: number
}

/** A run in its own bun process with the inspector on (see docs/architecture.md, decision 25). */
export type DebugRun = {
  /** The inspector's ws:// URL (localhost, random port and path). */
  url: Promise<string>
  /** Sends the run once the debugger is attached. */
  start(): void
  /** Holds the freeze watchdog while paused; resuming restarts its clock. */
  hold(paused: boolean): void
  stop(): void
}

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

  /**
   * Starts a debug run in a fresh process (not the warm spare, which has no inspector). It replaces the active
   * run like `run` does, and a later `run` replaces it in turn. `onEnd` fires once when its process goes away.
   */
  debug(runId: number, file: string, entry: string, dir: string, onEnd: () => void): DebugRun {
    if (this.active) this.kill(this.active)
    const token = randomBytes(16).toString('hex')
    const p = this.spawn([], [`--inspect=127.0.0.1:0/${token}`])
    p.runId = runId
    p.onEnd = onEnd
    p.banner = 0
    this.active = p
    const url = new Promise<string>((resolve, reject) => {
      p.onUrl = resolve
      p.child.once('exit', () => reject(new Error('The runtime exited before the debugger started')))
    })
    return {
      url,
      start: () => {
        p.lastBeat = Date.now()
        this.send(p, { type: 'run', runId, file, dir, entry })
      },
      hold: (paused) => {
        p.held = paused
        p.lastBeat = Date.now()
      },
      stop: () => {
        this.kill(p)
        if (this.active === p) this.active = null
      }
    }
  }

  /** Kills the active run (servers, intervals) and reports it done; the warm spare stays ready. False if nothing was running. */
  stop(): boolean {
    const p = this.active
    if (!p) return false
    this.active = null // drop anything still buffered from it
    this.kill(p)
    this.o.onEvent({ type: 'done', runId: p.runId, ms: 0, stopped: true })
    return true
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
    if (!p || p.exited || p.held || Date.now() - p.lastBeat <= this.o.freezeMs) return
    this.kill(p)
    const secs = Math.round(this.o.freezeMs / 1000)
    this.finish(p, `Stopped: the code stopped responding for ${secs}s`)
  }

  private finish(p: Proc, error: string): void {
    this.o.onEvent({ type: 'result', runId: p.runId, line: 0, kind: 'error', text: error })
    this.o.onEvent({ type: 'done', runId: p.runId, ms: 0 })
  }

  private spawn(preload: string[], flags: string[] = []): Proc {
    // --no-install: bun would otherwise fetch unknown imports from npm mid-run (and freeze while typing a name).
    // NODE_PATH: files the scratch imports find the shared packages too, wherever they live.
    const child = spawn(this.o.bun, ['--no-install', ...flags, this.o.host], {
      cwd: this.o.cwd,
      env: { ...process.env, NODE_PATH: join(this.o.cwd, 'node_modules'), NO_COLOR: '1', FORCE_COLOR: '0' },
      windowsHide: true
    })
    const p: Proc = { child, lastBeat: Date.now(), runId: -1, exited: false, killed: false }
    child.stdin.on('error', () => {})
    createInterface({ input: child.stdout }).on('line', (line) => this.onLine(p, line))
    createInterface({ input: child.stderr }).on('line', (line) => this.onErrLine(p, line))
    child.on('error', (e) => {
      p.exited = true
      if (p === this.active) this.finish(p, `Could not start the runtime: ${e.message}`)
    })
    child.on('exit', (code, signal) => {
      p.exited = true
      if (p === this.active && !p.killed) this.finish(p, `The runtime exited (${signal ?? code})`)
      this.ended(p)
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

  private onErrLine(p: Proc, line: string): void {
    if (p.banner !== undefined && p.banner < 2) {
      // bun prints a banner with the inspector URL; it is for us, not for the results.
      const url = line.match(/ws:\/\/\S+/)
      if (url) p.onUrl?.(url[0])
      if (line.includes('Bun Inspector')) p.banner++
      if (p.banner > 0 || url) return
    }
    this.forward(p, { kind: 'warn', text: line })
  }

  /** Output not sent through the protocol (packages printing, bun warnings) shows as line 0. */
  private forward(p: Proc, e: { kind: 'log' | 'warn'; text: string }): void {
    if (p === this.active) this.o.onEvent({ type: 'result', runId: p.runId, line: 0, ...e })
  }

  private send(p: Proc, m: ToRunner): void {
    p.child.stdin.write(JSON.stringify(m) + '\n')
  }

  private kill(p: Proc): void {
    p.killed = true
    if (!p.exited) p.child.kill('SIGKILL')
    this.ended(p)
  }

  private ended(p: Proc): void {
    const fn = p.onEnd
    p.onEnd = undefined
    fn?.()
  }
}
