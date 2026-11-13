import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { mkdirSync, rmSync, writeFileSync, existsSync, watchFile } from 'node:fs'
import { writeFile, rm } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { instrument } from './instrument'
import { Runner, type DebugRun } from './runner'
import { DebugSession } from './debugger'
import { Workspace } from './workspace'
import { Packages } from './packages'
import { loadSettings, sanitize, saveSettings, watchList } from './settings'
import { appMenu, treeMenu } from './menu'
import { bundle } from './bundle'
import { installedIn, missingPackages } from './missing'
import { SnippetStore } from './snippets'
import { SAMPLE } from '../shared/sample'
import type { Breakpoints, BundleOptions, DebugCommand, DebugEvent, Result, RunResponse, SearchOptions, SearchResult, Settings, Snippet } from '../shared/protocol'
import { byShortcut, resolve, shortcutOf, type ActionId } from '../shared/keybindings'

const isMac = process.platform === 'darwin'

function runtimePaths(): { bun: string; host: string; nodeTypes: string } {
  if (!app.isPackaged) {
    const root = app.getAppPath()
    return {
      bun: join(root, 'node_modules/bun/bin/bun.exe'),
      host: join(root, 'resources/runner/host.ts'),
      nodeTypes: join(root, 'node_modules/@types/node')
    }
  }
  return {
    bun: join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun'),
    host: join(process.resourcesPath, 'runner/host.ts'),
    nodeTypes: join(process.resourcesPath, 'types/node')
  }
}

/** Shared packages folder (decision 9). Bare imports in scratches resolve from its node_modules. */
function packagesDir(): { dir: string; runs: string } {
  const dir = join(app.getPath('userData'), 'packages')
  const runs = join(dir, '.runs')
  mkdirSync(dir, { recursive: true })
  if (!existsSync(join(dir, 'package.json')))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'scriptty-packages', private: true }, null, 2))
  rmSync(runs, { recursive: true, force: true })
  mkdirSync(runs)
  return { dir, runs }
}

/** Wraps a handler so failures reach the renderer as a readable Result instead of a rejected invoke. */
const safe =
  <A extends unknown[], T>(fn: (...a: A) => Promise<T> | T) =>
  async (_e: Electron.IpcMainInvokeEvent, ...a: A): Promise<Result<T>> => {
    try {
      return { ok: true, value: await fn(...a) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

let win: BrowserWindow | null = null
let runner: Runner | null = null
// Shortcut to action, from the settings; and the pending Settings > Keyboard Shortcuts recording, if any.
let keyActions = new Map<string, ActionId>()
let recorder: ((shortcut: string | null) => void) | null = null

function endRecording(shortcut: string | null): void {
  const r = recorder
  recorder = null
  r?.(shortcut)
}

/**
 * Every app shortcut is matched here, before the page sees the key, so Monaco and vim mode can never
 * consume one. preventDefault also stops the menu accelerator, so an action never runs twice.
 */
function onKey(e: Electron.Event, input: Electron.Input): void {
  if (input.type !== 'keyDown') return
  const k = shortcutOf({ key: input.key, code: input.code, ctrl: input.control, alt: input.alt, shift: input.shift, meta: input.meta }, isMac)
  if (recorder) {
    if (!k) return // a modifier on its own: keep waiting for the key
    e.preventDefault()
    endRecording(k === 'Escape' ? null : k)
    return
  }
  const action = k && keyActions.get(k)
  if (!action) return
  e.preventDefault()
  win?.webContents.send('menu', action)
}

type Debug = { runId: number; run: DebugRun; session: DebugSession | null }
/** The debug run in progress, if any (decision 25). */
let dbg: Debug | null = null

const COMMANDS = new Set<DebugCommand>(['continue', 'stepOver', 'stepInto', 'stepOut'])
const lines = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0) : [])
function breakpointsFrom(v: unknown): Breakpoints {
  const out: Breakpoints = {}
  if (v && typeof v === 'object') for (const [k, ls] of Object.entries(v)) out[k] = lines(ls)
  return out
}

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(what)), ms)
    p.then(resolve, reject).finally(() => clearTimeout(t))
  })
}

function overlay(): Electron.TitleBarOverlay {
  const dark = nativeTheme.shouldUseDarkColors
  return { color: '#00000000', symbolColor: dark ? '#E4E6EA' : '#1C1F24', height: 40 }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'Scriptty',
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 13 }, vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const, backgroundColor: '#00000000' }
      : { titleBarOverlay: overlay(), backgroundMaterial: 'mica' as const }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.on('before-input-event', onKey)
  // A reload mid-recording must not leave main swallowing the next key.
  win.webContents.on('did-start-loading', () => endRecording(null))
  // Links (README, results) open through `open-external`; the window itself never navigates away or opens others.
  win.webContents.on('will-navigate', (e, url) => url !== win?.webContents.getURL() && e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (!isMac) nativeTheme.on('updated', () => win?.setTitleBarOverlay(overlay()))

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  // Packaged apps take the icon from the bundle; dev runs would show Electron's.
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  const userData = app.getPath('userData')
  const settingsFile = join(userData, 'settings.json')
  let settings = loadSettings(settingsFile)
  nativeTheme.themeSource = settings.appearance

  const { bun, host, nodeTypes } = runtimePaths()
  const { dir, runs } = packagesDir()
  const workspace = new Workspace(join(app.getPath('documents'), 'Scriptty'))
  await workspace.ensure(SAMPLE)
  const packages = new Packages(dir, bun, join(userData, 'bun-cache'))
  runner = new Runner({
    bun,
    host,
    cwd: dir,
    freezeMs: settings.freezeSeconds * 1000,
    onEvent: (e) => win?.webContents.send('runner:event', e)
  })

  let seq = 0
  let lastFiles: string[] = []
  const isInstalled = installedIn(join(dir, 'node_modules'))
  const sendDebug = (e: DebugEvent): void => win?.webContents.send('debug:event', e)
  // The first statement of every debug run: it pauses once the import graph is parsed (see debugger.ts).
  const gate = join(runs, 'debug-gate.ts')
  writeFileSync(gate, 'debugger;\n')

  /** Instruments the editor's code and writes the copy that runs. The previous run's files go away. */
  async function prepare(code: string, rel: string) {
    const ext = extname(rel) || '.ts'
    const dir = dirname(workspace.abs(rel))
    // shortcut: instruments on the main thread; move to a worker_thread if large files stall IPC.
    const r = instrument(code, 'scratch' + ext, dir)
    if (!r.ok) return r
    const runId = ++seq
    const file = join(runs, `run-${runId}${ext}`)
    await writeFile(file, r.code)
    for (const f of lastFiles) rm(f, { force: true }).catch(() => {})
    lastFiles = [file]
    return { ok: true as const, runId, file, dir, imports: r.imports, names: r.names }
  }
  const failed = (e: unknown): RunResponse => ({ ok: false, error: e instanceof Error ? e.message : String(e), line: 0 })

  ipcMain.handle('run', async (_e, code: string, rel: string): Promise<RunResponse> => {
    try {
      const p = await prepare(code, rel)
      if (!p.ok) return p
      runner!.run(p.runId, p.file, p.imports, p.dir)
      return { ok: true, runId: p.runId, missing: missingPackages(p.imports, isInstalled) }
    } catch (e) {
      // A bad path or a failed write: report it in the status bar instead of rejecting the invoke.
      return failed(e)
    }
  })

  // Debug: its own bun process with the inspector on. Breakpoints only exist here; live runs never pause.
  ipcMain.handle('debug:start', async (_e, code: string, rel: string, bps: unknown): Promise<RunResponse> => {
    let d: Debug | null = null
    try {
      const p = await prepare(code, rel)
      if (!p.ok) return p
      const missing = missingPackages(p.imports, isInstalled)
      const entry = join(runs, `debug-${p.runId}.ts`)
      const spec = (f: string): string => JSON.stringify(f.replace(/\\/g, '/'))
      await writeFile(entry, `import ${spec(gate)}\nimport ${spec(p.file)}\n`)
      lastFiles.push(entry)
      const end = (): void => {
        if (dbg === d) dbg = null
        d?.session?.dispose()
        sendDebug({ type: 'ended', runId: p.runId })
      }
      const run = runner!.debug(p.runId, p.file, entry, p.dir, () => end())
      d = { runId: p.runId, run, session: null }
      dbg = d
      const url = await timeout(run.url, 10_000, 'The debugger did not start')
      const session = await DebugSession.attach(url, {
        runId: p.runId,
        runFile: p.file,
        rel,
        gate,
        root: workspace.root,
        names: p.names,
        breakpoints: breakpointsFrom(bps),
        onEvent: sendDebug,
        onHold: (paused) => run.hold(paused)
      })
      if (dbg !== d) {
        session.dispose() // replaced by another run while connecting
        return { ok: true, runId: p.runId, missing }
      }
      d.session = session
      session.onClosed(() => run.stop())
      run.start()
      return { ok: true, runId: p.runId, missing }
    } catch (e) {
      d?.run.stop()
      return failed(e)
    }
  })
  ipcMain.handle('debug:command', (_e, c: DebugCommand) => (COMMANDS.has(c) ? dbg?.session?.command(c).catch(() => {}) : undefined))
  ipcMain.handle('debug:stop', () => dbg?.run.stop())
  ipcMain.handle('debug:breakpoints', (_e, rel: string, ls: unknown) =>
    typeof rel === 'string' ? dbg?.session?.setBreakpoints(rel, lines(ls)).catch(() => {}) : undefined
  )
  ipcMain.handle('debug:scopes', safe((i: number) => dbg?.session?.scopes(Number(i)) ?? []))
  ipcMain.handle('debug:watch', safe((i: number, exprs: unknown) => dbg?.session?.evaluate(Number(i), watchList(exprs) ?? []) ?? []))
  ipcMain.handle('debug:props', safe((objectId: string, type: string) => dbg?.session?.props(String(objectId), String(type)) ?? []))
  ipcMain.handle('stop', () => runner?.stop() ?? false)

  const applyKeys = (): void => {
    const keys = resolve(settings.keybindings, isMac)
    keyActions = byShortcut(keys)
    Menu.setApplicationMenu(appMenu((a) => win?.webContents.send('menu', a), keys))
  }
  applyKeys()

  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const before = settings.keybindings
    settings = sanitize(patch, settings)
    saveSettings(settingsFile, settings)
    nativeTheme.themeSource = settings.appearance
    runner?.setFreezeMs(settings.freezeSeconds * 1000)
    if (settings.keybindings !== before) applyKeys()
    return settings
  })
  // Resolves with the next shortcut pressed in the window (null for Esc or a cancel). App shortcuts are off meanwhile.
  ipcMain.handle('keys:record', () => {
    endRecording(null)
    return new Promise<string | null>((r) => (recorder = r))
  })
  ipcMain.handle('keys:cancel', () => endRecording(null))

  ipcMain.handle('fs:root', () => workspace.root)
  ipcMain.handle('fs:tree', safe(() => workspace.tree()))
  ipcMain.handle('fs:read', safe((rel: string) => workspace.read(rel)))
  ipcMain.handle('fs:read-all', safe(() => workspace.readAll()))
  ipcMain.handle('fs:write', safe((rel: string, content: string) => workspace.write(rel, content)))
  ipcMain.handle('fs:create', safe((dirRel: string, kind: 'file' | 'folder') => workspace.create(dirRel, kind)))
  ipcMain.handle('fs:rename', safe((rel: string, name: string) => workspace.rename(rel, name)))
  ipcMain.handle('fs:trash', safe((rel: string) => shell.trashItem(workspace.abs(rel))))
  ipcMain.handle('fs:confirm-trash', async (e, name: string, folder: boolean) => {
    const bin = isMac ? 'Trash' : 'Recycle Bin'
    const r = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender)!, {
      type: 'warning',
      message: `Move “${name}” to the ${bin}?`,
      detail: `${folder ? 'The folder and everything in it' : 'The file'} can be restored from the ${bin}.`,
      buttons: [`Move to ${bin}`, 'Cancel'],
      defaultId: 0,
      cancelId: 1
    })
    return r.response === 0
  })
  ipcMain.handle('fs:reveal', safe((rel: string) => (rel ? shell.showItemInFolder(workspace.abs(rel)) : void shell.openPath(workspace.root))))
  // search() reports a bad regex itself; this catch is for a failed read (a file deleted mid-search).
  ipcMain.handle('fs:search', async (_e, query: string, o: SearchOptions): Promise<SearchResult> => {
    try {
      return await workspace.search(String(query ?? ''), { regex: !!o?.regex, caseSensitive: !!o?.caseSensitive, wholeWord: !!o?.wholeWord })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('fs:menu', (e, onItem: boolean) => treeMenu(BrowserWindow.fromWebContents(e.sender)!, onItem))

  ipcMain.handle('pkg:list', () => packages.list())
  ipcMain.handle('pkg:add', (_e, spec: string) => packages.add(spec))
  ipcMain.handle('pkg:add-types', (_e, name: string) => packages.addTypes(name))
  ipcMain.handle('pkg:remove', (_e, name: string) => packages.remove(name))
  ipcMain.handle('pkg:types', () => packages.types(nodeTypes))
  ipcMain.handle('pkg:info', safe((name: string) => packages.info(name)))
  ipcMain.handle('bundle', safe(async (rel: string, o: BundleOptions) => {
    const r = await bundle(bun, workspace.abs(rel), dir, { minify: !!o?.minify, inlinePackages: !!o?.inlinePackages })
    if (!r.ok) throw new Error(r.error)
    return r.value
  }))
  const snippets = new SnippetStore(join(userData, 'snippets.json'))
  snippets.ensure()
  snippets.load()
  const sendSnippets = (): void => win?.webContents.send('snippets:changed', snippets.state)
  // Picks up edits made in another editor ("Open snippets file"). Polling copes with editors that replace the file.
  watchFile(snippets.file, { interval: 1000 }, () => snippets.load() && sendSnippets())
  const snippetEdit =
    <A extends unknown[]>(fn: (...a: A) => unknown) =>
    (...a: A) => {
      fn(...a)
      sendSnippets()
      return snippets.state
    }
  ipcMain.handle('snippets:get', () => snippets.state)
  ipcMain.handle('snippets:put', safe(snippetEdit((oldName: string | null, s: Snippet) => snippets.put(oldName, s))))
  ipcMain.handle('snippets:remove', safe(snippetEdit((name: string) => snippets.remove(name))))
  ipcMain.handle('snippets:restore', safe(snippetEdit(() => snippets.restore())))
  ipcMain.handle('snippets:open', async () => {
    const err = await shell.openPath(snippets.file)
    if (err) shell.showItemInFolder(snippets.file) // no app for .json: show it in the file manager instead
  })
  ipcMain.handle('snippets:reveal', () => shell.showItemInFolder(snippets.file))

  // Only web links leave the app; anything else (file:, custom schemes) is refused.
  ipcMain.handle('open-external', (_e, url: string) => (/^https:\/\//.test(url) ? shell.openExternal(url) : undefined))

  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
app.on('before-quit', () => runner?.dispose())
