// Runs inside the bundled bun. One process handles one run (see docs/architecture.md, decision 10).
// In: JSON lines on stdin. Out: JSON lines on stdout, prefixed with MARK so stray prints are told apart.

// Must match MARK in src/shared/protocol.ts (this file ships alone, so it cannot import it).
const MARK = '\u0001scriptty\u0001'
const send = (m: object): void => void process.stdout.write(MARK + JSON.stringify(m) + '\n')

let runId = -1
/** Base name of the run file, as it appears in stack frames. */
let fileName = ''

setInterval(() => send({ type: 'hb' }), 200)

// Pretty, multi-line form for the detail panel.
const pretty = (v: unknown): string => Bun.inspect(v, { depth: 8, colors: false })
const value = (v: unknown) => (): Out => ({ text: fmt(v), full: pretty(v) })

type Out = { text: string; full?: string }
// A line sends its first CAP outputs one by one. After that it keeps only the latest output and how many calls it
// stands for, sent at most every FLUSH_MS and when the top level finishes, so a tight loop cannot flood IPC.
// Held outputs are formatted when sent, so an object mutated in the meantime shows its newer state.
const CAP = 100
const FLUSH_MS = 200
const sent = new Map<number, number>()
const held = new Map<number, { kind: string; out: () => Out; calls: number }>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function report(line: number, kind: string, out: () => Out, calls = 1): void {
  const n = sent.get(line) ?? 0
  if (n < CAP) {
    sent.set(line, n + 1)
    send({ type: 'result', runId, line, kind, ...out(), ...(calls === 1 ? {} : { calls }) })
    return
  }
  held.set(line, { kind, out, calls: (held.get(line)?.calls ?? 0) + calls })
  flushTimer ??= setTimeout(flush, FLUSH_MS)
}

function flush(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  for (const [line, h] of held) send({ type: 'result', runId, line, kind: h.kind, ...h.out(), calls: h.calls })
  held.clear()
}

const g = globalThis as Record<string, unknown>
/** `quiet` (calls and `void`, see src/main/instrument.ts): an `undefined` result is not shown. */
g.__r = (line: number, v: unknown, quiet?: 1): unknown => {
  if (isThenable(v)) {
    if (!quiet) report(line, 'value', () => ({ text: 'Promise { <pending> }' }))
    v.then(
      (x) => void (quiet && x === undefined ? 0 : report(line, 'value', value(x), quiet ? 1 : 0)),
      (e) => sendError(e, line)
    )
  } else if (!(quiet && v === undefined)) {
    report(line, 'value', value(v))
  }
  return v
}
g.__log = (line: number, method: string) => (...args: unknown[]): void => {
  const kind = method === 'warn' ? 'warn' : method === 'error' ? 'error' : 'log'
  const each = (f: (a: unknown) => string): string => args.map((a) => (typeof a === 'string' ? a : f(a))).join(' ')
  report(line, kind, () => ({ text: each(fmt), full: each(pretty) }))
}

process.on('uncaughtException', (e) => sendError(e))
process.on('unhandledRejection', (e) => sendError(e))

function sendError(e: unknown, fallbackLine = 0): void {
  const err = e as { name?: string; message?: string; stack?: string }
  const raw = err && err.message !== undefined ? `${err.name ?? 'Error'}: ${err.message}` : `Uncaught ${fmt(e)}`
  // Errors can quote the instrumented code; show the user's own spelling of console calls.
  const clean = (s: string): string => s.replace(/__log\(\d+, "(\w+)"\)/g, 'console.$1')
  const text = clean(raw)
  // Keep only stack frames from the scratch itself; host and bun internals are noise to the user.
  const frames = (err?.stack ?? '').split('\n').filter((l) => /^\s+at /.test(l) && fileName && l.includes(fileName))
  const tidy = (f: string): string =>
    clean(f)
      .replace(/\((?:.*[\\/])?run-\d+\.\w+:(\d+):\d+\)/, '(line $1)')
      .replace(/at (?:.*[\\/])?run-\d+\.\w+:(\d+):\d+$/, 'at line $1')
  const full = [text, ...frames.map(tidy)].join('\n')
  send({ type: 'result', runId, line: lineFromStack(err?.stack) ?? fallbackLine, kind: 'error', text, full })
}

function lineFromStack(stack?: string): number | null {
  if (!stack || !fileName) return null
  const name = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = stack.match(new RegExp(name + ':(\\d+)'))
  return m ? Number(m[1]) : null
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as { then?: unknown }).then === 'function'
}

export function fmt(v: unknown, d = 0): string {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  const t = typeof v
  if (t === 'string') return JSON.stringify(v)
  if (t === 'number' || t === 'boolean') return String(v)
  if (t === 'bigint') return `${v}n`
  if (t === 'symbol') return (v as symbol).toString()
  if (t === 'function') return `ƒ ${(v as { name?: string }).name || 'anonymous'}()`
  if (v instanceof Error) return `${v.name}: ${v.message}`
  if (v instanceof Date) return v.toISOString()
  if (v instanceof RegExp) return String(v)
  if (isThenable(v)) return 'Promise { <pending> }'
  if (d > 2) return Array.isArray(v) ? '[…]' : '{…}'
  if (Array.isArray(v))
    return '[' + v.slice(0, 20).map((x) => fmt(x, d + 1)).join(', ') + (v.length > 20 ? `, …${v.length - 20} more` : '') + ']'
  if (v instanceof Map)
    return `Map(${v.size}) {` + [...v].slice(0, 10).map(([k, x]) => fmt(k, d + 1) + ' => ' + fmt(x, d + 1)).join(', ') + '}'
  if (v instanceof Set) return `Set(${v.size}) {` + [...v].slice(0, 10).map((x) => fmt(x, d + 1)).join(', ') + '}'
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
  const ctor = (o.constructor as { name?: string } | undefined)?.name
  const name = ctor && ctor !== 'Object' ? ctor + ' ' : ''
  if (!keys.length) return name + '{}'
  return name + '{ ' + keys.slice(0, 12).map((k) => k + ': ' + fmt(o[k], d + 1)).join(', ') + (keys.length > 12 ? ', …' : '') + ' }'
}

for await (const raw of console) {
  const m = JSON.parse(raw)
  if (m.type === 'preload') {
    for (const name of m.modules) {
      try {
        await import(Bun.resolveSync(name, m.cwd))
      } catch {
        // missing or broken package: the run itself will report it
      }
    }
  } else if (m.type === 'run') {
    runId = m.runId
    fileName = m.file.split(/[\\/]/).pop() ?? ''
    try {
      process.chdir(m.dir) // relative fs paths in the scratch resolve next to the scratch
    } catch {
      // folder gone: keep the packages folder as cwd
    }
    const t0 = performance.now()
    try {
      await import(Bun.pathToFileURL(m.file).href)
    } catch (e) {
      sendError(e)
    }
    flush()
    send({ type: 'done', runId, ms: performance.now() - t0 })
  }
}
