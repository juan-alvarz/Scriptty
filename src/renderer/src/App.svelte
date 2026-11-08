<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import { createEditor, disposeModels, lineHeightFor, modelFor, monaco, setTypeLibs, setVim, showVimFor } from './monaco'
  import Sidebar from './Sidebar.svelte'
  import Toolbar from './Toolbar.svelte'
  import Splitter from './Splitter.svelte'
  import EditorGroup from './EditorGroup.svelte'
  import ResultsPanel from './ResultsPanel.svelte'
  import BundlePanel from './BundlePanel.svelte'
  import StatusBar from './StatusBar.svelte'
  import SettingsDialog from './Settings.svelte'
  import DebugPanel, { type Paused } from './DebugPanel.svelte'
  import {
    allBreakpoints,
    attachBreakpointMargin,
    clearBreakpoints,
    listBreakpoints,
    markPaused,
    removeBreakpoint,
    toggleBreakpoint,
    type BreakpointItem
  } from './breakpoints'
  import { moveTab, stepIndex } from './tabs'
  import MissingBanner from './MissingBanner.svelte'
  import { registerMissingQuickFix, setMissing } from './missing'
  import { RUNTIME_OWNER, runtimeMarkers } from './markers'
  import QuickOpen from './QuickOpen.svelte'
  import { keymap, mac } from './keys.svelte'
  import { dropZone, focusAfterClose, type FileDrag, type Zone } from './splits'
  import { ACTIONS, resolve, toMonaco, type ActionId, type Bindings } from '../../shared/keybindings'
  import {
    DEFAULT_SETTINGS,
    MAX_SPLITS,
    WIDTH_LIMITS,
    type DebugCommand,
    type DebugEvent,
    type RunnerEvent,
    type SearchMatch,
    type Settings,
    type TreeNode
  } from '../../shared/protocol'

  const api = window.scriptty

  let bodyEl: HTMLDivElement
  let resultsPanel: ReturnType<typeof ResultsPanel>
  let bundlePanel: ReturnType<typeof BundlePanel>
  let missingBanner: ReturnType<typeof MissingBanner>
  let vimEl = $state<HTMLSpanElement>()

  /** One editor split: its tabs and the file it shows. `id` never changes while the split is open. */
  type Group = { id: number; tabs: string[]; current: string }
  let groups = $state<Group[]>([{ id: 0, tabs: [], current: '' }])
  let activeId = $state(0)
  let nextId = 1
  const editors = new Map<number, monaco.editor.IStandaloneCodeEditor>()
  // The focused split's editor: runs, the results gutter, error markers and the Bundle tab follow it.
  // Raw: Monaco objects must not be wrapped in a Svelte proxy.
  let editor = $state.raw<monaco.editor.IStandaloneCodeEditor | null>(null)
  const active = $derived(groups.find((g) => g.id === activeId) ?? groups[0])
  const current = $derived(active.current)
  const tabs = $derived(active.tabs)
  const byId = (id: number): Group | undefined => groups.find((g) => g.id === id)

  let settings = $state<Settings>({ ...DEFAULT_SETTINGS })
  let root = $state('')
  let tree = $state<TreeNode[]>([])
  let selected = $state('')
  let renaming = $state('')
  let collapsed = $state<Record<string, boolean>>({})
  let settingsOpen = $state(false)
  let quickOpen = $state(false)
  let notice = $state('')
  let view = $state<'results' | 'bundle' | 'debugger'>('results')
  /** Every breakpoint, for the Debugger tab (decorations move with edits, so this is refreshed on change). */
  let bps = $state<BreakpointItem[]>([])
  const refreshBps = (): void => void (bps = listBreakpoints())
  let sideMode = $state<'files' | 'search'>('files')
  let searchFocus = $state(0)
  let ready = $state(false)
  // Packages the current file imports that are not installed (from the last run).
  let missing = $state<string[]>([])
  // Cursor, selection and scroll per split and file, restored when that tab comes back.
  const viewStates = new Map<number, Map<string, monaco.editor.ICodeEditorViewState | null>>()
  function viewsOf(id: number): Map<string, monaco.editor.ICodeEditorViewState | null> {
    let m = viewStates.get(id)
    if (!m) viewStates.set(id, (m = new Map()))
    return m
  }
  // Live pane widths while dragging; saved to settings when the drag ends.
  let sideW = $state(DEFAULT_SETTINGS.sidebarWidth)
  let resW = $state(DEFAULT_SETTINGS.resultsWidth)
  let status = $state<{ mode: 'live' | 'running' | 'paused' | 'debugging' | 'stopped'; info: string }>({ mode: 'live', info: '' })

  /** The debug run in progress. Only Debug runs stop at breakpoints; live runs never pause. */
  type Session = { runId: number; paused: Paused | null; frame: number; finished: boolean }
  let session = $state<Session | null>(null)
  const endedRuns = new Set<number>()

  let currentRun = -1
  let fresh = false
  let count = 0
  let runTimer: ReturnType<typeof setTimeout> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let pendingSave: { rel: string; content: string } | null = null
  // Red squiggles for the current run's thrown errors, on the model that ran.
  const markers = runtimeMarkers<monaco.editor.ITextModel>((m, ms) => monaco.editor.setModelMarkers(m, RUNTIME_OWNER, ms))

  // A run's events can arrive before its invoke reply, so whichever comes first starts the run.
  function startRun(id: number): boolean {
    if (id <= currentRun) return false
    currentRun = id
    fresh = true
    return true
  }

  async function runNow(): Promise<void> {
    clearTimeout(runTimer)
    if (!editor || !current) return
    const r = await api.run(editor.getValue(), current)
    if (!r.ok) {
      status = { mode: 'paused', info: `Line ${r.line}: ${r.error}` }
      return
    }
    if (r.runId >= currentRun) setMissing((missing = r.missing))
    if (startRun(r.runId)) status = { mode: 'running', info: status.info }
  }

  /** Kills the current run (servers, intervals); the next edit or Run starts a fresh one as usual. */
  function stop(): void {
    clearTimeout(runTimer)
    api.stop()
  }

  // After packages change (banner, quick fix or Packages panel): new editor types, and run again.
  async function packagesChanged(): Promise<void> {
    setTypeLibs(await api.packages.types())
    runNow()
  }

  function onRunnerEvent(e: RunnerEvent): void {
    if (e.runId < currentRun) return
    startRun(e.runId)
    if (fresh) {
      // Keep the previous run's results on screen until the new run says something, to avoid flicker.
      resultsPanel.clear()
      markers.start(editor?.getModel() ?? null)
      count = 0
      fresh = false
    }
    if (e.type === 'result') {
      count++
      resultsPanel.add(e.line, { kind: e.kind, text: e.text, full: e.full })
      markers.add(e)
      // Output after `done` means timers or a server are still going, so offer Stop again.
      if (status.mode === 'live') status = { mode: 'running', info: status.info }
    } else if (session?.runId === e.runId) {
      session.finished = true
      if (!session.paused) status = { mode: 'debugging', info: `${count} results · finished` }
    } else if (e.stopped) {
      status = { mode: 'stopped', info: `${count} results` }
    } else {
      status = { mode: 'live', info: `${count} results · ${e.ms < 10 ? e.ms.toFixed(2) : Math.round(e.ms)}ms` }
    }
  }

  /** Debug: runs the focused split's file in its own process with the inspector, stopping at breakpoints. */
  async function startDebug(): Promise<void> {
    clearTimeout(runTimer)
    if (!editor || !current) return
    status = { mode: 'debugging', info: 'Starting…' }
    const r = await api.debug.start(editor.getValue(), current, allBreakpoints())
    if (!r.ok) {
      status = { mode: 'paused', info: r.line ? `Line ${r.line}: ${r.error}` : r.error }
      return
    }
    if (r.runId >= currentRun) setMissing((missing = r.missing))
    startRun(r.runId)
    // Its first pause can arrive before this reply; the event handler then made the session already.
    if (!endedRuns.has(r.runId) && (!session || session.runId < r.runId)) session = { runId: r.runId, paused: null, frame: 0, finished: false }
    if (session?.runId === r.runId && !session.paused) status = { mode: 'debugging', info: 'Running' }
  }

  async function onDebugEvent(e: DebugEvent): Promise<void> {
    if (e.type === 'ended') {
      endedRuns.add(e.runId)
      if (session?.runId !== e.runId) return
      session = null
      markPaused(null)
      // Stopped (not replaced by a newer run): live runs take over again with the current text.
      if (e.runId === currentRun) {
        status = { mode: 'live', info: '' }
        if (settings.autoRun) runNow()
      }
      return
    }
    if (e.runId < currentRun || endedRuns.has(e.runId)) return
    if (session?.runId !== e.runId) session = { runId: e.runId, paused: null, frame: 0, finished: false }
    if (e.type === 'paused') {
      clearTimeout(runTimer) // an edit made just before the pause must not replace the paused run
      session.paused = { reason: e.reason, frames: e.frames }
      view = 'debugger'
      const top = e.frames[0]
      status = { mode: 'debugging', info: `Paused at ${top.file}:${top.line}` }
      await showFrame(0)
    } else {
      session.paused = null
      markPaused(null)
      status = { mode: 'debugging', info: session.finished ? 'Finished' : 'Running' }
    }
  }

  /** Shows a call stack frame: opens its file in the focused split if needed and marks the line (in every split showing it). */
  async function showFrame(i: number): Promise<void> {
    const f = session?.paused?.frames[i]
    if (!f || !session) return
    session.frame = i
    if (f.file !== current && findNode(f.file)?.kind === 'file') await open(f.file)
    markPaused({ rel: f.file, line: f.line, top: i === 0 })
    if (f.file === current) editor?.revealLineInCenterIfOutsideViewport(f.line)
  }

  function debugCommand(c: DebugCommand): void {
    if (session?.paused) api.debug.command(c)
  }

  function stopDebug(): void {
    if (session) api.debug.stop()
  }

  /** Breakpoint changes reach a debug run at once; live runs never see them. */
  function syncBreakpoints(rel: string, lines: number[]): void {
    refreshBps()
    if (session) api.debug.setBreakpoints(rel, lines)
  }

  function clearAllBreakpoints(): void {
    for (const rel of clearBreakpoints()) syncBreakpoints(rel, [])
    refreshBps()
  }

  /** Opens a breakpoint's file in the focused split and puts the cursor on its line. */
  function jumpTo(rel: string, line: number): Promise<void> {
    return goTo(rel, { lineNumber: line, column: 1 })
  }

  function toggleBreakpointAtCursor(): void {
    const model = editor?.getModel()
    const pos = editor?.getPosition()
    if (model && pos) syncBreakpoints(current, toggleBreakpoint(model, pos.lineNumber))
  }

  async function flush(): Promise<void> {
    clearTimeout(saveTimer)
    const s = pendingSave
    pendingSave = null
    if (!s) return
    const r = await api.fs.write(s.rel, s.content)
    if (!r.ok) notice = `Could not save ${s.rel}: ${r.error}`
    else if (view === 'bundle') bundlePanel.refresh()
  }

  /** Autosave, and a run when the edit is in the focused split. Two splits on one file share a model, so both report it. */
  function edited(id: number, ed: monaco.editor.IStandaloneCodeEditor): void {
    const rel = byId(id)?.current
    if (!rel) return
    if (bps.length) refreshBps()
    if (pendingSave && pendingSave.rel !== rel) flush()
    pendingSave = { rel, content: ed.getValue() }
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, 400)
    // Live runs wait while the debugger is paused; they take over again when the session ends.
    if (settings.autoRun && id === activeId && !session?.paused) {
      clearTimeout(runTimer)
      runTimer = setTimeout(runNow, settings.runDelayMs)
    }
  }

  async function showView(v: 'results' | 'bundle' | 'debugger'): Promise<void> {
    view = v
    if (v === 'bundle') {
      await flush()
      bundlePanel.refresh()
    }
  }

  function insertImport(line: string): void {
    const model = editor?.getModel()
    if (!editor || !model || model.getValue().includes(line)) return
    editor.executeEdits('scriptty', [{ range: new monaco.Range(1, 1, 1, 1), text: line + '\n' }])
    editor.focus()
  }

  const toggleSidebar = (): Promise<void> => change({ sidebarHidden: !settings.sidebarHidden })

  /** Shows the sidebar in Search mode with the query box focused. */
  function openSearch(): void {
    if (settings.sidebarHidden) change({ sidebarHidden: false })
    sideMode = 'search'
    searchFocus++
  }

  /** Opens a search hit's file and selects the match. */
  function reveal(m: SearchMatch): Promise<void> {
    return goTo(m.path, new monaco.Range(m.line, m.col, m.line, m.col + m.length))
  }

  /** Opens `rel` in the focused split and selects `at` (a range or a cursor position), scrolled into view. */
  async function goTo(rel: string, at?: monaco.IRange | monaco.IPosition): Promise<void> {
    await open(rel)
    if (!editor || current !== rel) return
    if (at) {
      const range = 'startLineNumber' in at ? monaco.Range.lift(at) : monaco.Range.fromPositions(at)
      editor.setSelection(range)
      editor.revealRangeInCenterIfOutsideViewport(range, monaco.editor.ScrollType.Smooth)
    }
    editor.focus()
  }
  const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

  function setWidth(which: 'side' | 'res', w: number): void {
    const [lo, hi] = WIDTH_LIMITS[which === 'side' ? 'sidebar' : 'results']
    if (which === 'side') sideW = clamp(Math.round(w), lo, hi)
    else resW = clamp(Math.round(w), lo, Math.min(hi, Math.max(lo, (bodyEl?.clientWidth ?? 1000) - 240)))
  }
  const saveWidths = (): Promise<void> => change({ sidebarWidth: sideW, resultsWidth: resW })

  function resetWidth(which: 'side' | 'res'): void {
    setWidth(which, which === 'side' ? DEFAULT_SETTINGS.sidebarWidth : DEFAULT_SETTINGS.resultsWidth)
    saveWidths()
  }

  function findNode(path: string, nodes: TreeNode[] = tree): TreeNode | null {
    for (const n of nodes) {
      if (n.path === path) return n
      const hit = n.children && findNode(path, n.children)
      if (hit) return hit
    }
    return null
  }

  function firstFile(nodes: TreeNode[] = tree): string {
    for (const n of nodes) {
      if (n.kind === 'file') return n.path
      const f = n.children && firstFile(n.children)
      if (f) return f
    }
    return ''
  }

  const parentOf = (path: string): string => path.split('/').slice(0, -1).join('/')
  /** Saves every split's tabs and which split is focused, for the next launch. */
  const saveLayout = async (): Promise<void> => {
    const splits = groups.map((g) => ({ files: [...g.tabs], current: g.current }))
    settings = await api.settings.set({ splits, activeSplit: Math.max(0, groups.findIndex((g) => g.id === activeId)) })
  }

  /** Moves focus to split `id`: the results, Run/Stop and the Bundle tab switch to its file, which runs. */
  function activate(id: number): void {
    flush()
    activeId = id
    editor = editors.get(id) ?? null
    showVimFor(editor)
    resultsPanel.reset()
    setMissing((missing = []))
    const g = byId(id)
    if (g?.current) {
      selected = g.current
      // While paused, showing a file (the debugger may do it for a frame) must not replace the paused run.
      if (!session?.paused) runNow()
      if (view === 'bundle') bundlePanel.refresh()
    } else {
      bundlePanel.clear()
      status = { mode: 'live', info: '' }
    }
  }

  function focusGroup(id: number): void {
    if (id === activeId || !byId(id)) return
    activate(id)
    saveLayout()
  }

  /** Opens `rel` in a new split at position `at` (0 is the far left) and focuses it. Null when no more splits fit. */
  async function split(at: number, rel: string): Promise<number | null> {
    if (groups.length >= MAX_SPLITS) return null
    const id = nextId++
    groups.splice(at, 0, { id, tabs: [], current: '' })
    await tick() // its EditorGroup mounts and creates the editor
    await open(rel, id)
    if (!byId(id)?.current) closeSplit(id) // the file could not be read
    return id
  }

  function closeSplit(id: number): void {
    const next = focusAfterClose(
      groups.map((g) => g.id),
      id,
      activeId
    )
    groups = groups.filter((g) => g.id !== id)
    viewStates.delete(id)
    if (next !== activeId) activate(next)
  }

  /** Focus Split 1/2/3. The one right after the last split opens it with the current file, like VS Code. */
  function focusSplit(i: number): void {
    const g = groups[i]
    if (!g) {
      if (current) split(groups.length, current)
      return
    }
    focusGroup(g.id)
    editors.get(g.id)?.focus()
  }

  /** Where a tab dragged off its strip would land: the split under the pointer and the zone in it. */
  let tabHover = $state<{ id: number; zone: Zone } | null>(null)
  function splitAt(at: { x: number; y: number } | null): { id: number; zone: Zone } | null {
    const ed = at && document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('[data-split] .editor')
    if (!at || !ed) return null
    const r = ed.getBoundingClientRect()
    return { id: Number(ed.closest<HTMLElement>('[data-split]')!.dataset.split), zone: dropZone(at.x - r.left, r.width, groups.length < MAX_SPLITS) }
  }

  /** A file dropped on split `target`: its edges open a new split there, its middle opens the file in it. Tabs move; tree files open. */
  async function dropFile(target: number, zone: Zone, d: FileDrag): Promise<void> {
    const at = groups.findIndex((g) => g.id === target) + (zone === 'right' ? 1 : 0)
    const into = zone === 'center' ? target : ((await split(at, d.path)) ?? target)
    if (into === target) await open(d.path, target)
    if (d.from !== null && d.from !== into) await closeTab(d.path, d.from)
  }

  async function closeTab(rel: string, id = activeId): Promise<void> {
    const g = byId(id)
    const i = g ? g.tabs.indexOf(rel) : -1
    if (!g || i < 0) return
    if (rel === g.current) await flush()
    viewsOf(id).delete(rel)
    g.tabs = g.tabs.filter((t) => t !== rel)
    // Closing a split's last tab closes the split, unless it is the only one.
    if (!g.tabs.length && groups.length > 1) closeSplit(id)
    else if (rel === g.current) {
      const next = g.tabs[i] ?? g.tabs[i - 1]
      if (next) await open(next, id, false)
      else closeEditor(id)
    }
    await saveLayout()
  }

  function closeEditor(id = activeId): void {
    editors.get(id)?.setModel(null)
    const g = byId(id)
    if (g) g.current = ''
    if (id !== activeId) return
    bundlePanel.clear()
    setMissing((missing = []))
    resultsPanel.reset()
    status = { mode: 'live', info: '' }
  }

  function cycleTab(step: number): void {
    if (tabs.length < 2) return
    const i = tabs.indexOf(current)
    open(tabs[(i + step + tabs.length) % tabs.length])
  }

  /** Drag reorder within split `id`. */
  function reorder(from: number, to: number, id = activeId): void {
    const g = byId(id)
    if (!g) return
    g.tabs = moveTab(g.tabs, from, to)
    saveLayout()
  }

  /** Move Tab Left / Right: moves the focused split's current tab one place, stopping at the ends. */
  function stepTab(step: number): void {
    const i = tabs.indexOf(current)
    const to = stepIndex(tabs.length, i, step)
    if (to >= 0) reorder(i, to)
  }

  async function refreshTree(): Promise<void> {
    const r = await api.fs.tree()
    if (r.ok) tree = r.value
    else notice = r.error
    // Every scratch becomes a Monaco model, so `import { x } from "./utils"` type-checks and autocompletes.
    const all = await api.fs.readAll()
    if (all.ok) for (const f of all.value) modelFor(f.path, f.content)
  }

  /**
   * Shows `rel` in split `id` (the focused one by default), adding a tab if needed.
   * `focus` false leaves focus where it is, unless `id` is the focused split.
   */
  async function open(rel: string, id = activeId, focus = true): Promise<void> {
    const g = byId(id)
    const ed = editors.get(id)
    if (!g || !ed) return
    if (rel === g.current) {
      if (focus) focusGroup(id)
      return
    }
    await flush()
    const r = await api.fs.read(rel)
    if (!r.ok) {
      notice = `Could not open ${rel}: ${r.error}`
      return
    }
    if (g.current) viewsOf(id).set(g.current, ed.saveViewState())
    const model = modelFor(rel, r.value)
    model.updateOptions({ tabSize: settings.tabSize })
    ed.setModel(model)
    const saved = viewsOf(id).get(rel)
    if (saved) ed.restoreViewState(saved)
    // New tabs open right after the current one, like most editors.
    if (!g.tabs.includes(rel)) {
      const i = g.tabs.indexOf(g.current)
      g.tabs = i < 0 ? [...g.tabs, rel] : [...g.tabs.slice(0, i + 1), rel, ...g.tabs.slice(i + 1)]
    }
    g.current = rel
    if (focus || id === activeId) {
      activate(id)
      if (focus) ed.focus()
    }
    await saveLayout()
  }

  /** New file or folder next to the selection; a new name field opens right away. */
  async function create(kind: 'file' | 'folder'): Promise<void> {
    await flush()
    const sel = findNode(selected)
    const dir = !sel ? '' : sel.kind === 'folder' ? sel.path : parentOf(sel.path)
    const r = await api.fs.create(dir, kind)
    if (!r.ok) {
      notice = r.error
      return
    }
    if (dir) collapsed[dir] = false
    await refreshTree()
    if (kind === 'file') await open(r.value)
    selected = r.value
    renaming = r.value
  }

  async function rename(node: TreeNode, name: string): Promise<void> {
    if (renaming !== node.path) return // Enter and blur both commit; only the first counts
    renaming = ''
    const trimmed = name.trim()
    if (!trimmed || trimmed === node.name) return
    await flush()
    const r = await api.fs.rename(node.path, name)
    if (!r.ok) {
      notice = r.error
      return
    }
    notice = ''
    const remap = (p: string): string => (p === node.path ? r.value : p.startsWith(node.path + '/') ? r.value + p.slice(node.path.length) : p)
    const moved = groups.filter((g) => g.current && remap(g.current) !== g.current).map((g) => ({ id: g.id, to: remap(g.current) }))
    for (const g of groups) g.tabs = g.tabs.map(remap)
    for (const m of viewStates.values()) for (const k of [...m.keys()]) if (remap(k) !== k) m.delete(k)
    disposeModels(node.path)
    await refreshTree()
    refreshBps()
    selected = r.value
    for (const m of moved) {
      const g = byId(m.id)
      if (!g) continue
      g.current = ''
      await open(m.to, m.id, false)
    }
    await saveLayout()
  }

  async function trash(node: TreeNode): Promise<void> {
    await flush()
    const r = await api.fs.trash(node.path)
    if (!r.ok) {
      notice = r.error
      return
    }
    const gone = (p: string): boolean => p === node.path || p.startsWith(node.path + '/')
    const affected = groups.filter((g) => gone(g.current)).map((g) => ({ id: g.id, idx: g.tabs.indexOf(g.current) }))
    for (const g of groups) g.tabs = g.tabs.filter((t) => !gone(t))
    for (const m of viewStates.values()) for (const k of [...m.keys()]) if (gone(k)) m.delete(k)
    for (const a of affected) closeEditor(a.id)
    disposeModels(node.path)
    await refreshTree()
    refreshBps()
    selected = ''
    for (const a of affected) {
      const g = byId(a.id)
      const next = g && (g.tabs[a.idx] ?? g.tabs[a.idx - 1] ?? g.tabs[g.tabs.length - 1])
      if (next) await open(next, a.id, false)
    }
    // Splits left without tabs close, as when their last tab is closed.
    for (const g of [...groups]) if (!g.tabs.length && groups.length > 1) closeSplit(g.id)
    await saveLayout()
  }

  async function context(node: TreeNode | null): Promise<void> {
    selected = node?.path ?? ''
    const action = await api.fs.menu(!!node)
    if (action === 'new-file') create('file')
    else if (action === 'new-folder') create('folder')
    else if (action === 'rename' && node) renaming = node.path
    else if (action === 'trash' && node) trash(node)
    else if (action === 'reveal') api.fs.reveal(node?.path ?? '')
  }

  function openNode(n: TreeNode): void {
    selected = n.path
    if (n.kind === 'folder') collapsed[n.path] = !collapsed[n.path]
    else open(n.path)
  }

  function applyTo(ed: monaco.editor.IStandaloneCodeEditor, s: Settings): void {
    ed.updateOptions({ fontSize: s.fontSize, lineHeight: lineHeightFor(s.fontSize) })
    ed.getModel()?.updateOptions({ tabSize: s.tabSize })
    if (vimEl) setVim(ed, s.vim, vimEl)
  }

  function apply(s: Settings): void {
    for (const ed of editors.values()) applyTo(ed, s)
    showVimFor(editor)
  }

  async function change(p: Partial<Settings>): Promise<void> {
    settings = await api.settings.set(p)
    apply(settings)
    if ('autoRun' in p && settings.autoRun) runNow()
  }

  /** What each app action does. Shortcuts are matched in main (before Monaco or vim can see them) and arrive here like menu clicks. */
  const actions: Record<ActionId, () => void> = {
    run: runNow,
    stop,
    'quick-open': () => (quickOpen = true),
    search: openSearch,
    'toggle-sidebar': toggleSidebar,
    'new-file': () => create('file'),
    'new-folder': () => create('folder'),
    'close-tab': () => current && closeTab(current),
    'next-tab': () => cycleTab(1),
    'prev-tab': () => cycleTab(-1),
    'move-tab-left': () => stepTab(-1),
    'move-tab-right': () => stepTab(1),
    'split-right': () => current && split(groups.findIndex((g) => g.id === activeId) + 1, current),
    'focus-split-1': () => focusSplit(0),
    'focus-split-2': () => focusSplit(1),
    'focus-split-3': () => focusSplit(2),
    'debug-start': () => (session?.paused ? debugCommand('continue') : !session && startDebug()),
    'debug-start-alt': () => actions['debug-start'](),
    'debug-stop': stopDebug,
    // Not paused: the key keeps Monaco's meaning of F8 (next problem), as before the registry.
    'debug-continue': () => (session?.paused ? debugCommand('continue') : editor?.trigger('keyboard', 'editor.action.marker.nextInFiles', null)),
    'debug-step-over': () => debugCommand('stepOver'),
    'debug-step-into': () => debugCommand('stepInto'),
    'debug-step-out': () => debugCommand('stepOut'),
    'toggle-breakpoint': toggleBreakpointAtCursor,
    settings: () => (settingsOpen = true)
  }

  // App actions in Monaco's command palette (F1), with the user's shortcuts as labels.
  const palette = new Map<monaco.editor.IStandaloneCodeEditor, monaco.IDisposable[]>()
  function bindPalette(ed: monaco.editor.IStandaloneCodeEditor, keys: Bindings): void {
    palette.get(ed)?.forEach((d) => d.dispose())
    palette.set(
      ed,
      ACTIONS.map((a) => {
        const k = toMonaco(keys[a.id], mac, monaco)
        return ed.addAction({ id: 'scriptty.' + a.id, label: a.label, keybindings: k === null ? [] : [k], run: () => actions[a.id]() })
      })
    )
  }

  // Compared as text: settings is a new object after every save.
  const keysJson = $derived(JSON.stringify(settings.keybindings))
  $effect(() => {
    const keys = resolve(JSON.parse(keysJson), mac)
    keymap.map = keys
    for (const ed of editors.values()) bindPalette(ed, keys)
  })

  /** Creates split `id`'s editor (EditorGroup calls this on mount); returns the cleanup for when the split closes. */
  function mountEditor(id: number, el: HTMLElement): () => void {
    const ed = createEditor(el)
    editors.set(id, ed)
    if (id === activeId) editor = ed
    applyTo(ed, settings)
    showVimFor(editor)
    bindPalette(ed, untrack(() => keymap.map))
    const subs = [
      ed.onDidChangeModelContent(() => edited(id, ed)),
      ed.onDidFocusEditorText(() => focusGroup(id)),
      attachBreakpointMargin(ed, syncBreakpoints)
    ]
    return () => {
      subs.forEach((s) => s.dispose())
      palette.get(ed)?.forEach((d) => d.dispose())
      palette.delete(ed)
      if (vimEl) setVim(ed, false, vimEl)
      editors.delete(id)
      if (editor === ed) editor = null
      ed.dispose()
    }
  }

  /** Reopens the saved splits and their tabs (files that are gone are skipped); the focused split opens last. */
  async function restore(): Promise<void> {
    const exists = (p: string): boolean => findNode(p)?.kind === 'file'
    const saved = settings.splits.map((s) => ({ files: s.files.filter(exists), current: s.current })).filter((s) => s.files.length)
    if (!saved.length) {
      const start = firstFile()
      return start ? open(start) : create('file')
    }
    groups = saved.map((s, i) => ({ id: i ? nextId++ : groups[0].id, tabs: s.files, current: '' }))
    const focus = groups[Math.min(settings.activeSplit, groups.length - 1)].id
    activeId = focus
    await tick()
    const first = (i: number): string => (exists(saved[i].current) ? saved[i].current : saved[i].files[0])
    for (const [i, g] of groups.entries()) if (g.id !== focus) await open(first(i), g.id, false)
    await open(first(groups.findIndex((g) => g.id === focus)), focus)
  }

  onMount(() => {
    const off = api.onEvent(onRunnerEvent)
    const offDebug = api.debug.onEvent(onDebugEvent)
    // Go to definition (⌘/Ctrl+click, F12) into another scratch: Monaco only switches within one model, so open it
    // in the focused split (the click focused the split it came from). Package and lib .d.ts files have no model
    // here, so those are left to Monaco (nothing opens).
    const offOpener = monaco.editor.registerEditorOpener({
      openCodeEditor(_source, resource, at) {
        if (resource.scheme !== 'file' || resource.path.startsWith('/node_modules/')) return false
        void goTo(resource.path.slice(1), at)
        return true
      }
    })
    const offFix = registerMissingQuickFix(monaco, (names) => missingBanner.install(names))
    const offMenu = api.onMenu((a) => actions[a]?.())
    window.addEventListener('beforeunload', flush)

    ;(async () => {
      settings = await api.settings.get()
      sideW = settings.sidebarWidth
      resW = settings.resultsWidth
      root = await api.fs.root()
      apply(settings)
      await refreshTree()
      await restore()
      ready = true
      setTypeLibs(await api.packages.types())
    })()

    return () => {
      off()
      offDebug()
      offMenu()
      offFix.dispose()
      offOpener.dispose()
    }
  })
</script>


<div class="window" style="grid-template-columns: {settings.sidebarHidden ? '' : `${sideW}px `}minmax(0, 1fr)">
  {#if !settings.sidebarHidden}
    <Sidebar
      {tree}
      {current}
      {selected}
      {renaming}
      {collapsed}
      {notice}
      mode={sideMode}
      {searchFocus}
      onmode={(m) => (sideMode = m)}
      onflush={flush}
      onreveal={reveal}
      ontoggle={toggleSidebar}
      oncreate={create}
      onopen={openNode}
      oncontext={context}
      onrename={rename}
      oncancel={() => (renaming = '')}
      ondismiss={() => (notice = '')}
      onpackageschange={packagesChanged}
      oninsert={insertImport}
    />
  {/if}

  <main class="main">
    {#if !settings.sidebarHidden}
      <Splitter
        label="Resize sidebar"
        value={sideW}
        min={WIDTH_LIMITS.sidebar[0]}
        max={WIDTH_LIMITS.sidebar[1]}
        direction={1}
        onresize={(w) => setWidth('side', w)}
        ondone={saveWidths}
        onreset={() => resetWidth('side')}
      />
    {/if}
    <Toolbar
      sidebarHidden={settings.sidebarHidden}
      autoRun={settings.autoRun}
      ontogglesidebar={toggleSidebar}
      ontoggleautorun={() => change({ autoRun: !settings.autoRun })}
      onrun={runNow}
      running={status.mode === 'running'}
      onstop={stop}
      onsettings={() => (settingsOpen = true)}
    />

    <MissingBanner bind:this={missingBanner} file={current} {missing} onadded={packagesChanged} />

    <div class="body" bind:this={bodyEl} style="grid-template-columns: minmax(0, 1fr) min({resW}px, calc(100% - 240px))">
      <div class="splits">
        {#each groups as g (g.id)}
          <EditorGroup
            id={g.id}
            tabs={g.tabs}
            current={g.current}
            dimmed={groups.length > 1 && g.id !== activeId}
            canSplit={groups.length < MAX_SPLITS}
            {ready}
            mount={mountEditor}
            onfocus={() => focusGroup(g.id)}
            onopen={(rel) => open(rel, g.id)}
            onclose={(rel) => closeTab(rel, g.id)}
            oncreate={() => (focusGroup(g.id), create('file'))}
            ondrop={(zone, d) => dropFile(g.id, zone, d)}
            onmove={(from, to) => reorder(from, to, g.id)}
            ontabdrag={(_rel, at) => (tabHover = splitAt(at))}
            ontabdrop={(path, at) => {
              const h = splitAt(at)
              if (h) dropFile(h.id, h.zone, { path, from: g.id })
            }}
            hover={tabHover?.id === g.id ? tabHover.zone : null}
          />
        {/each}
      </div>
      <div class="right">
        <Splitter
          label="Resize results"
          value={resW}
          min={WIDTH_LIMITS.results[0]}
          direction={-1}
          onresize={(w) => setWidth('res', w)}
          ondone={saveWidths}
          onreset={() => resetWidth('res')}
        />
        <div class="colhead tabs" role="tablist" aria-label="Right panel">
          <button role="tab" aria-selected={view === 'results'} onclick={() => showView('results')}>Results</button>
          <button role="tab" aria-selected={view === 'bundle'} onclick={() => showView('bundle')}>Bundle</button>
          <button role="tab" aria-selected={view === 'debugger'} onclick={() => showView('debugger')}>
            Debugger
            {#if session?.paused}<i class="tabdot" title="Paused"></i>{/if}
            {#if bps.length}<span class="badge" title="{bps.length} breakpoint{bps.length === 1 ? '' : 's'}">{bps.length}</span>{/if}
          </button>
        </div>
        <ResultsPanel bind:this={resultsPanel} {editor} fontSize={settings.fontSize} hidden={view !== 'results'} stale={status.mode === 'paused'} />
        <BundlePanel bind:this={bundlePanel} file={current} hidden={view !== 'bundle'} />
        <DebugPanel
          hidden={view !== 'debugger'}
          active={!!session}
          paused={session?.paused ?? null}
          finished={session?.finished ?? false}
          frame={session?.frame ?? 0}
          oncommand={debugCommand}
          onstop={stopDebug}
          onselect={showFrame}
          watches={settings.watches}
          onwatches={async (w) => (settings = await api.settings.set({ watches: w }))}
          breakpoints={bps}
          onstart={startDebug}
          onjump={jumpTo}
          onremove={(rel, line) => syncBreakpoints(rel, removeBreakpoint(rel, line))}
          onclear={clearAllBreakpoints}
        />
      </div>
    </div>

    <StatusBar {status} file={current} tabSize={settings.tabSize} bind:vimEl />
  </main>
</div>

<SettingsDialog open={settingsOpen} {settings} {root} onchange={change} onclose={() => ((settingsOpen = false), editor?.focus())} />
<QuickOpen bind:open={quickOpen} {tree} {current} {tabs} onopen={open} />

<style>
  .window {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
  }
  .main {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
  }
  .splits {
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .right {
    position: relative;
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--line);
    display: flex;
    flex-direction: column;
  }
  .tabs {
    background: var(--bg);
  }
  .tabs button {
    flex: 1;
    height: 100%;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .tabs button + button {
    border-left: 1px solid var(--line);
  }
  .badge {
    display: inline-block;
    min-width: 16px;
    margin-left: 5px;
    padding: 0 4px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--err) 85%, transparent);
    color: #fff;
    font-size: 10px;
    line-height: 16px;
    font-weight: 600;
    box-sizing: border-box;
  }
  .tabdot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-left: 5px;
    border-radius: 50%;
    background: var(--warn);
    vertical-align: middle;
  }
  .tabs button:hover {
    color: var(--fg);
  }
  .tabs button[aria-selected='true'] {
    color: var(--fg);
    font-weight: 600;
    border-bottom-color: var(--accent);
  }
</style>
