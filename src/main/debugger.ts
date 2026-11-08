// Debug session for one debug run (decision 25): talks to bun's inspector, maps lines through bun's source
// maps, and turns WebKit protocol objects into the small shapes the renderer shows.
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Inspector } from './inspector'
import { topLevelNames } from './instrument'
import { generatedFor, parseSourceMapUrl, sourceLine, type LineMap } from './sourcemap'
import type { Breakpoints, DebugCommand, DebugEvent, DebugFrame, DebugScope, DebugValue, DebugVar } from '../shared/protocol'

export type DebugOptions = {
  runId: number
  /** The instrumented copy that runs for `rel`; its lines match the editor. */
  runFile: string
  /** Workspace-relative path of the file being debugged. */
  rel: string
  /** Imported first by the debug entry; its `debugger;` is where breakpoints get set (the graph is parsed by then). */
  gate: string
  /** Workspace root: other scratches the run imports are debuggable too. */
  root: string
  /** Top-level names of the run file, shown as its Module scope. */
  names: string[]
  breakpoints: Breakpoints
  onEvent: (e: DebugEvent) => void
  /** Paused or resumed: the runner holds its freeze watchdog while paused. */
  onHold: (paused: boolean) => void
}

type Preview = {
  type: string
  subtype?: string
  description?: string
  overflow?: boolean
  size?: number
  properties?: { name: string; type: string; subtype?: string; value?: string; valuePreview?: Preview; internal?: boolean }[]
  entries?: { key?: Preview; value: Preview }[]
}
export type RemoteObject = {
  type: string
  subtype?: string
  className?: string
  description?: string
  value?: unknown
  objectId?: string
  size?: number
  preview?: Preview
}
type PropertyDescriptor = { name: string; value?: RemoteObject; get?: RemoteObject; set?: RemoteObject }
type Scope = { object: RemoteObject; type: string; name?: string; location?: { scriptId: string; lineNumber: number; columnNumber: number } }
type CallFrame = {
  callFrameId: string
  functionName: string
  location: { scriptId: string; lineNumber: number; columnNumber: number }
  scopeChain: Scope[]
}
type Script = { rel: string; abs: string; map: LineMap | null; names?: Promise<string[]> }

const GROUP = 'scriptty'
const MAX_PROPS = 500
const REASONS: Record<string, string> = {
  Breakpoint: 'breakpoint',
  DebuggerStatement: 'debugger'
}

const norm = (p: string): string => {
  const path = p.startsWith('file:') ? fileURLToPath(p) : p
  const s = path.replace(/\\/g, '/')
  return process.platform === 'win32' ? s.toLowerCase() : s
}
const real = (p: string): string => {
  try {
    return realpathSync.native(p)
  } catch {
    return p
  }
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A regex for a path that matches either slash direction. */
const pathRe = (p: string): string => escapeRe(p.replace(/\\/g, '/')).replace(/\//g, '[\\\\/]')

export class DebugSession {
  private scripts = new Map<string, Script>()
  private gateId = ''
  private armed = false
  private bpIds = new Map<string, string[]>()
  private frames: CallFrame[] = []
  private lastCommand: DebugCommand | null = null
  private breakpoints: Breakpoints

  private constructor(
    private ins: Inspector,
    private o: DebugOptions
  ) {
    this.breakpoints = { ...o.breakpoints }
  }

  /** Connects and enables the debugger. Call before the run starts, so no script is missed. */
  static async attach(url: string, o: DebugOptions): Promise<DebugSession> {
    // bun reports real paths (on macOS the temp folder /var is /private/var), so compare against those.
    o = { ...o, root: real(o.root), runFile: real(o.runFile), gate: real(o.gate) }
    const ins = await Inspector.connect(url)
    const s = new DebugSession(ins, o)
    ins.on('Debugger.scriptParsed', (p: { scriptId: string; url: string; sourceMapURL?: string }) => s.onScript(p))
    ins.on('Debugger.paused', (p: { callFrames: CallFrame[]; reason: string }) => void s.onPaused(p).catch(() => {}))
    ins.on('Debugger.resumed', () => s.onResumed())
    await ins.call('Inspector.enable').catch(() => {})
    await ins.call('Runtime.enable')
    await ins.call('Debugger.enable')
    await ins.call('Debugger.setBreakpointsActive', { active: true })
    await ins.call('Debugger.setPauseOnDebuggerStatements', { enabled: true }).catch(() => {})
    // Step Into skips everything but the user's files: the host's __r/__log wrappers, packages, bun internals.
    const mine = [o.root.replace(/[\\/]+$/, '') + '/', o.runFile, o.gate].map(pathRe).join('|')
    await ins
      .call('Debugger.setShouldBlackboxURL', { url: `^(?!(?:${mine})).*`, isRegex: true, caseSensitive: process.platform !== 'win32', shouldBlackbox: true })
      .catch(() => {})
    await ins.call('Inspector.initialized').catch(() => {})
    return s
  }

  onClosed(fn: () => void): void {
    this.ins.onClosed(fn)
  }

  dispose(): void {
    this.ins.close()
  }

  get isPaused(): boolean {
    return this.frames.length > 0
  }

  async command(c: DebugCommand): Promise<void> {
    if (!this.isPaused) return
    this.lastCommand = c
    // WebKit sends no Debugger.resumed for a step that pauses again, so resuming is reported here.
    this.onResumed()
    const method = { continue: 'resume', stepOver: 'stepOver', stepInto: 'stepInto', stepOut: 'stepOut' }[c]
    await this.ins.call(`Debugger.${method}`)
  }

  /** Replaces the breakpoints of one file; takes effect at once if the run is past the gate. */
  async setBreakpoints(rel: string, lines: number[]): Promise<void> {
    this.breakpoints[rel] = lines
    if (!this.armed) return
    for (const [id, s] of this.scripts) if (s.rel === rel) await this.apply(id, s)
  }

  /** Scopes of a frame of the current pause, innermost first, with their variables. */
  async scopes(index: number): Promise<DebugScope[]> {
    const f = this.frames[index]
    if (!f) return []
    const out: DebugScope[] = []
    let lastKey = ''
    // JavaScriptCore splits a function's variables over several scopes (blocks, then the function itself), all
    // carrying the function's location: those merge into Local, and each outer function becomes one Closure.
    const local = where(f.scopeChain[0])
    for (const sc of f.scopeChain) {
      if (sc.type === 'global' || !sc.object.objectId) continue
      const vars = (await this.props(sc.object.objectId, 'scope')).filter((v) => v.name !== 'arguments')
      if (!vars.length) continue
      const name =
        sc.type === 'catch'
          ? 'Catch'
          : sc.type === 'with'
            ? 'With'
            : sc.type === 'globalLexicalEnvironment'
              ? 'Script'
              : local && where(sc) === local
                ? 'Local'
                : `Closure${sc.name ? ` (${sc.name})` : ''}`
      const key = `${name}@${where(sc)}`
      if (out.length && key === lastKey && name !== 'Catch') out[out.length - 1].vars.push(...vars)
      else out.push({ name, vars })
      lastKey = key
    }
    const mod = await this.moduleScope(f, new Set(out.flatMap((s) => s.vars.map((v) => v.name))))
    if (mod) out.push(mod)
    return out
  }

  /** Children of an expandable value. `type` is the DebugValue's type (maps and sets list their entries). */
  async props(objectId: string, type = 'object'): Promise<DebugVar[]> {
    const vars: DebugVar[] = []
    if (type === 'map' || type === 'set' || type === 'weakmap' || type === 'weakset') {
      const r = await this.ins.call<{ entries: { key?: RemoteObject; value: RemoteObject }[] }>('Runtime.getCollectionEntries', {
        objectId,
        objectGroup: GROUP,
        fetchStart: 0,
        fetchCount: MAX_PROPS
      })
      r.entries.forEach((e, i) => vars.push({ name: e.key ? describe(e.key).text : String(i), value: describe(e.value) }))
    }
    const r = await this.ins.call<{ properties: PropertyDescriptor[]; internalProperties?: PropertyDescriptor[] }>('Runtime.getProperties', {
      objectId,
      ownProperties: true,
      generatePreview: true,
      fetchStart: 0,
      fetchCount: MAX_PROPS
    })
    for (const p of r.properties) {
      if (p.name === '__proto__') continue
      vars.push({ name: p.name, value: p.value ? describe(p.value) : { text: p.get ? '(getter)' : 'undefined', type: 'accessor' } })
    }
    for (const p of r.internalProperties ?? []) if (p.value) vars.push({ name: `[[${p.name}]]`, value: describe(p.value) })
    return vars.slice(0, MAX_PROPS)
  }

  private onScript(p: { scriptId: string; url: string; sourceMapURL?: string }): void {
    if (!p.url) return
    const url = norm(p.url)
    if (url === norm(this.o.gate)) {
      this.gateId = p.scriptId
      return
    }
    let rel = ''
    if (url === norm(this.o.runFile)) rel = this.o.rel
    else {
      const r = relative(norm(this.o.root), url)
      if (!r || r.startsWith('..') || isAbsolute(r)) return
      rel = r.replace(/\\/g, '/')
    }
    const abs = url === norm(this.o.runFile) ? this.o.runFile : join(this.o.root, rel)
    this.scripts.set(p.scriptId, { rel, abs, map: parseSourceMapUrl(p.sourceMapURL) })
  }

  private async onPaused(p: { callFrames: CallFrame[]; reason: string }): Promise<void> {
    if (!this.armed && p.callFrames[0]?.location.scriptId === this.gateId) {
      // The whole import graph is parsed now: set every breakpoint, then let the run go.
      this.armed = true
      for (const [id, s] of this.scripts) await this.apply(id, s)
      await this.ins.call('Debugger.resume')
      return
    }
    const user = p.callFrames.filter((f) => this.scripts.has(f.location.scriptId))
    if (!user.length) {
      await this.ins.call('Debugger.resume')
      return
    }
    this.frames = user
    this.o.onHold(true)
    const reason = REASONS[p.reason] ?? (this.lastCommand && this.lastCommand !== 'continue' ? 'step' : 'pause')
    this.lastCommand = null
    this.o.onEvent({ type: 'paused', runId: this.o.runId, reason, frames: user.map((f) => this.frame(f)) })
  }

  private onResumed(): void {
    if (!this.isPaused) return
    this.frames = []
    this.o.onHold(false)
    this.ins.call('Runtime.releaseObjectGroup', { objectGroup: GROUP }).catch(() => {})
    this.o.onEvent({ type: 'resumed', runId: this.o.runId })
  }

  private frame(f: CallFrame): DebugFrame {
    const s = this.scripts.get(f.location.scriptId)!
    const fn = f.functionName
    return {
      name: !fn || fn === 'module code' ? (fn ? '(top level)' : '(anonymous)') : fn,
      file: s.rel,
      line: sourceLine(s.map, f.location.lineNumber, f.location.columnNumber) + 1
    }
  }

  private async apply(scriptId: string, s: Script): Promise<void> {
    for (const id of this.bpIds.get(scriptId) ?? []) await this.ins.call('Debugger.removeBreakpoint', { breakpointId: id }).catch(() => {})
    const ids: string[] = []
    const seen = new Set<string>()
    for (const line of this.breakpoints[s.rel] ?? []) {
      const at = generatedFor(s.map, line - 1)
      if (!at || seen.has(`${at.line}:${at.col}`)) continue
      seen.add(`${at.line}:${at.col}`)
      try {
        const r = await this.ins.call<{ breakpointId: string }>('Debugger.setBreakpoint', {
          location: { scriptId, lineNumber: at.line, columnNumber: at.col }
        })
        ids.push(r.breakpointId)
      } catch {
        // no code there: nothing to stop at
      }
    }
    this.bpIds.set(scriptId, ids)
  }

  /**
   * Module-level bindings. JavaScriptCore reports a module's own scope as empty, so read the file's top-level
   * names by evaluating them in the frame (names a local shadows are left out; not-yet-initialized ones too).
   */
  private async moduleScope(f: CallFrame, shown: Set<string>): Promise<DebugScope | null> {
    const s = this.scripts.get(f.location.scriptId)
    if (!s) return null
    s.names ??= s.abs === this.o.runFile ? Promise.resolve(this.o.names) : readFile(s.abs, 'utf8').then((src) => topLevelNames(src, s.abs), () => [])
    const names = (await s.names).filter((n) => !shown.has(n))
    if (!names.length) return null
    const o = '__scripttyScope'
    const expression = `(() => { const ${o} = Object.create(null); ${names.map((n) => `try { ${o}[${JSON.stringify(n)}] = ${n} } catch {}`).join(' ')} return ${o} })()`
    const r = await this.ins.call<{ result: RemoteObject; wasThrown?: boolean }>('Debugger.evaluateOnCallFrame', {
      callFrameId: f.callFrameId,
      expression,
      objectGroup: GROUP,
      doNotPauseOnExceptionsAndMuteConsole: true,
      returnByValue: false
    })
    if (r.wasThrown || !r.result.objectId) return null
    const vars = await this.props(r.result.objectId)
    return vars.length ? { name: 'Module', vars } : null
  }
}

const where = (sc?: Scope): string => (sc?.location ? `${sc.location.scriptId}:${sc.location.lineNumber}:${sc.location.columnNumber}` : '')

/** One-line text for a protocol value, close to the results gutter's style. */
export function describe(o: RemoteObject): DebugValue {
  const type = o.subtype && o.subtype !== 'null' ? o.subtype : o.type
  const expandable = !!o.objectId && o.type === 'object' && o.subtype !== 'null'
  const v: DebugValue = { text: text(o), type }
  if (expandable) v.objectId = o.objectId
  return v
}

function text(o: RemoteObject): string {
  switch (o.type) {
    case 'undefined':
      return 'undefined'
    case 'string':
      return JSON.stringify(o.value)
    case 'number':
    case 'boolean':
      return o.description ?? String(o.value)
    case 'bigint':
    case 'symbol':
      return o.description ?? ''
    case 'function':
      return o.subtype === 'class' ? `class ${o.className ?? ''}`.trim() : `ƒ ${fnName(o.description)}()`
  }
  if (o.subtype === 'null') return 'null'
  return o.preview ? preview(o.preview, o.className) : (o.description ?? o.className ?? 'Object')
}

const fnName = (d = ''): string => d.match(/^(?:async\s+)?function\*?\s*([\w$]+)/)?.[1] ?? d.match(/^(?:async\s+)?([\w$]+)\s*\(/)?.[1] ?? 'anonymous'

function preview(p: Preview, className?: string): string {
  const more = p.overflow ? ', …' : ''
  const props = p.properties ?? []
  switch (p.subtype) {
    case 'array':
      return `[${props.map(propText).join(', ')}${more}]`
    case 'map':
    case 'weakmap':
      return `Map(${p.size ?? '?'}) {${(p.entries ?? []).map((e) => `${e.key ? short(e.key) : '?'} => ${short(e.value)}`).join(', ')}${more}}`
    case 'set':
    case 'weakset':
      return `Set(${p.size ?? '?'}) {${(p.entries ?? []).map((e) => short(e.value)).join(', ')}${more}}`
    case 'date':
    case 'regexp':
    case 'error':
      return p.description ?? ''
  }
  if (className === 'Promise') {
    const status = props.find((x) => x.name === 'status')?.value ?? 'pending'
    const result = props.find((x) => x.name === 'result')
    return `Promise { <${status}>${result ? ': ' + propText(result) : ''} }`
  }
  const name = className && className !== 'Object' ? className + ' ' : ''
  if (!props.length) return name + '{}'
  return `${name}{ ${props.map((x) => `${x.name}: ${propText(x)}`).join(', ')}${more} }`
}

function propText(x: NonNullable<Preview['properties']>[number]): string {
  if (x.type === 'string') return JSON.stringify(x.value ?? '')
  if (x.type === 'function') return 'ƒ'
  if (x.type === 'object' && x.subtype !== 'null') return x.valuePreview ? short(x.valuePreview) : x.subtype === 'array' ? '[…]' : '{…}'
  return x.value ?? x.type
}

/** A nested preview stays short: one level only. */
function short(p: Preview): string {
  if (p.type === 'string') return JSON.stringify(p.description ?? '')
  if (p.type !== 'object' || p.subtype === 'null') return p.description ?? p.type
  if (p.subtype === 'array') return p.properties ? `[${p.properties.map(propText).join(', ')}${p.overflow ? ', …' : ''}]` : '[…]'
  if (p.subtype === 'date' || p.subtype === 'regexp' || p.subtype === 'error') return p.description ?? ''
  if (p.properties && !p.subtype) {
    const name = p.description && p.description !== 'Object' ? p.description + ' ' : ''
    return p.properties.length ? `${name}{ ${p.properties.map((x) => `${x.name}: ${propText(x)}`).join(', ')}${p.overflow ? ', …' : ''} }` : name + '{}'
  }
  return p.description ?? '{…}'
}
