<script lang="ts">
  import { onMount } from 'svelte'
  import { createEditor, disposeModels, lineHeightFor, modelFor, monaco, setTypeLibs, setVim } from './monaco'
  import Sidebar from './Sidebar.svelte'
  import Toolbar from './Toolbar.svelte'
  import Splitter from './Splitter.svelte'
  import FileTabs from './FileTabs.svelte'
  import ResultsPanel from './ResultsPanel.svelte'
  import BundlePanel from './BundlePanel.svelte'
  import StatusBar from './StatusBar.svelte'
  import SettingsDialog from './Settings.svelte'
  import DebugPanel, { type Paused } from './DebugPanel.svelte'
  import { allBreakpoints, attachBreakpointMargin, markPaused, toggleBreakpoint } from './breakpoints'
  import {
    DEFAULT_SETTINGS,
    WIDTH_LIMITS,
    type DebugCommand,
    type DebugEvent,
    type MenuAction,
    type RunnerEvent,
    type Settings,
    type SearchMatch,
    type TreeNode
  } from '../../shared/protocol'
  import MissingBanner from './MissingBanner.svelte'
  import { registerMissingQuickFix, setMissing } from './missing'
  import { RUNTIME_OWNER, runtimeMarkers } from './markers'
  import QuickOpen from './QuickOpen.svelte'

  const api = window.scriptty
  const mod = api.platform === 'darwin' ? '⌘' : 'Ctrl+'

  let editorEl: HTMLDivElement
  let bodyEl: HTMLDivElement
  let resultsPanel: ReturnType<typeof ResultsPanel>
  let bundlePanel: ReturnType<typeof BundlePanel>
  let missingBanner: ReturnType<typeof MissingBanner>
  let vimEl = $state<HTMLSpanElement>()
  // Raw: Monaco objects must not be wrapped in a Svelte proxy.
  let editor = $state.raw<monaco.editor.IStandaloneCodeEditor | null>(null)

  let settings = $state<Settings>({ ...DEFAULT_SETTINGS })
  let root = $state('')
  let tree = $state<TreeNode[]>([])
  let current = $state('')
  let selected = $state('')
  let renaming = $state('')
  let collapsed = $state<Record<string, boolean>>({})
  let settingsOpen = $state(false)
  let quickOpen = $state(false)
  let notice = $state('')
  let view = $state<'results' | 'bundle'>('results')
  let sideMode = $state<'files' | 'search'>('files')
  let searchFocus = $state(0)
  let tabs = $state<string[]>([])
  let ready = $state(false)
  // Packages the current file imports that are not installed (from the last run).
  let missing = $state<string[]>([])
  // Cursor, selection and scroll per open file, restored when its tab comes back.
  const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()
  // Live pane widths while dragging; saved to settings when the drag ends.
  let sideW = $state(DEFAULT_SETTINGS.sidebarWidth)
  let resW = $state(DEFAULT_SETTINGS.resultsWidth)
  let status = $state<{ mode: 'live' | 'running' | 'paused' | 'debugging' | 'stopped'; info: string }>({ mode: 'live', info: '' })

  /** The debug run in progress. Only Debug runs stop at breakpoints; live runs never pause. */
  type Session = { runId: number; paused: Paused | null; frame: number; finished: boolean }
  let session = $state<Session | null>(null)
  const endedRuns = new Set<number>()
  /** The last debug key handled here, so the same action from the menu's accelerator is not run twice. */
  let lastKey = { action: '', at: 0 }

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

  /** Debug: runs the current file in its own process with the inspector, stopping at breakpoints. */
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
      const top = e.frames[0]
      status = { mode: 'debugging', info: `Paused at ${top.file}:${top.line}` }
      await showFrame(0)
    } else {
      session.paused = null
      markPaused(null)
      status = { mode: 'debugging', info: session.finished ? 'Finished' : 'Running' }
    }
  }

  /** Shows a call stack frame: opens its file if needed and marks the line. */
  async function showFrame(i: number): Promise<void> {
    const f = session?.paused?.frames[i]
    if (!f || !editor || !session) return
    session.frame = i
    if (f.file !== current && findNode(f.file)?.kind === 'file') await open(f.file)
    markPaused({ rel: f.file, line: f.line, top: i === 0 })
    if (f.file === current) editor.revealLineInCenterIfOutsideViewport(f.line)
  }

  function debugCommand(c: DebugCommand): void {
    if (session?.paused) api.debug.command(c)
  }

  function stopDebug(): void {
    if (session) api.debug.stop()
  }

  /** Breakpoint changes reach a debug run at once; live runs never see them. */
  function syncBreakpoints(rel: string, lines: number[]): void {
    if (session) api.debug.setBreakpoints(rel, lines)
  }

  function toggleBreakpointAtCursor(): void {
    const model = editor?.getModel()
    const pos = editor?.getPosition()
    if (model && pos) syncBreakpoints(current, toggleBreakpoint(model, pos.lineNumber))
  }

  function debugAction(a: MenuAction): void {
    if (a === 'debug-start') {
      if (session?.paused) debugCommand('continue')
      else if (!session) startDebug()
    } else if (a === 'debug-stop') stopDebug()
    else if (a === 'debug-continue') debugCommand('continue')
    else if (a === 'debug-step-over') debugCommand('stepOver')
    else if (a === 'debug-step-into') debugCommand('stepInto')
    else if (a === 'debug-step-out') debugCommand('stepOut')
    else if (a === 'toggle-breakpoint') toggleBreakpointAtCursor()
  }

  /**
   * Debug keys, caught before Monaco (it binds F8 to "next problem"). The menu shows the same keys; on macOS a
   * key the page handles never reaches the menu, and elsewhere the menu does not register them.
   */
  function onDebugKey(e: KeyboardEvent): void {
    if (e.altKey) return
    const cmd = api.platform === 'darwin' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
    const plain = !e.metaKey && !e.ctrlKey
    let a: MenuAction | null = null
    if (cmd && e.shiftKey && e.key.toLowerCase() === 'd') a = 'debug-start'
    else if (!plain) return
    else if (e.key === 'F5') a = e.shiftKey ? 'debug-stop' : 'debug-start'
    else if (e.key === 'F8' && !e.shiftKey && session?.paused) a = 'debug-continue'
    else if (e.key === 'F9' && !e.shiftKey) a = 'toggle-breakpoint'
    else if (e.key === 'F10' && !e.shiftKey) a = 'debug-step-over'
    else if (e.key === 'F11') a = e.shiftKey ? 'debug-step-out' : 'debug-step-into'
    if (!a) return
    e.preventDefault()
    e.stopPropagation()
    lastKey = { action: a, at: Date.now() }
    debugAction(a)
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

  async function showView(v: 'results' | 'bundle'): Promise<void> {
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

  /** ⇧⌘F: shows the sidebar in Search mode with the query box focused. */
  function openSearch(): void {
    if (settings.sidebarHidden) change({ sidebarHidden: false })
    sideMode = 'search'
    searchFocus++
  }

  /** Opens a search hit's file and selects the match. */
  async function reveal(m: SearchMatch): Promise<void> {
    await open(m.path)
    if (!editor || current !== m.path) return
    const range = new monaco.Range(m.line, m.col, m.line, m.col + m.length)
    editor.setSelection(range)
    editor.revealRangeInCenterIfOutsideViewport(range, monaco.editor.ScrollType.Smooth)
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
  const saveTabs = async (): Promise<void> => {
    settings = await api.settings.set({ openFiles: [...tabs] })
  }

  async function closeTab(rel: string): Promise<void> {
    const i = tabs.indexOf(rel)
    if (i < 0) return
    if (rel === current) await flush()
    viewStates.delete(rel)
    tabs = tabs.filter((t) => t !== rel)
    if (rel === current) {
      const next = tabs[i] ?? tabs[i - 1]
      if (next) await open(next)
      else closeEditor()
    }
    await saveTabs()
  }

  function closeEditor(): void {
    editor?.setModel(null)
    bundlePanel.clear()
    current = ''
    setMissing((missing = []))
    resultsPanel.reset()
    status = { mode: 'live', info: '' }
  }

  function cycleTab(step: number): void {
    if (tabs.length < 2) return
    const i = tabs.indexOf(current)
    open(tabs[(i + step + tabs.length) % tabs.length])
  }

  async function refreshTree(): Promise<void> {
    const r = await api.fs.tree()
    if (r.ok) tree = r.value
    else notice = r.error
    // Every scratch becomes a Monaco model, so `import { x } from "./utils"` type-checks and autocompletes.
    const all = await api.fs.readAll()
    if (all.ok) for (const f of all.value) modelFor(f.path, f.content)
  }

  async function open(rel: string): Promise<void> {
    if (!editor || rel === current) return
    await flush()
    const r = await api.fs.read(rel)
    if (!r.ok) {
      notice = `Could not open ${rel}: ${r.error}`
      return
    }
    if (current) viewStates.set(current, editor.saveViewState())
    const model = modelFor(rel, r.value)
    model.updateOptions({ tabSize: settings.tabSize })
    editor.setModel(model)
    const saved = viewStates.get(rel)
    if (saved) editor.restoreViewState(saved)
    // New tabs open right after the current one, like most editors.
    if (!tabs.includes(rel)) {
      const i = tabs.indexOf(current)
      tabs = i < 0 ? [...tabs, rel] : [...tabs.slice(0, i + 1), rel, ...tabs.slice(i + 1)]
    }
    current = rel
    selected = rel
    resultsPanel.reset()
    settings = await api.settings.set({ lastFile: rel, openFiles: [...tabs] })
    editor.focus()
    // While paused, opening a file (the debugger may do it for a frame) must not replace the paused run.
    if (!session?.paused) runNow()
    if (view === 'bundle') bundlePanel.refresh()
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
    const moved = current && remap(current) !== current ? remap(current) : ''
    tabs = tabs.map(remap)
    for (const k of [...viewStates.keys()]) if (remap(k) !== k) viewStates.delete(k)
    disposeModels(node.path)
    await refreshTree()
    selected = r.value
    if (moved) {
      current = ''
      await open(moved)
    }
    await saveTabs()
  }

  async function trash(node: TreeNode): Promise<void> {
    await flush()
    const r = await api.fs.trash(node.path)
    if (!r.ok) {
      notice = r.error
      return
    }
    const gone = (p: string): boolean => p === node.path || p.startsWith(node.path + '/')
    const affected = gone(current)
    const idx = tabs.indexOf(current)
    tabs = tabs.filter((t) => !gone(t))
    for (const k of [...viewStates.keys()]) if (gone(k)) viewStates.delete(k)
    if (affected) closeEditor()
    disposeModels(node.path)
    await refreshTree()
    selected = ''
    if (affected) {
      const next = tabs[idx] ?? tabs[idx - 1] ?? tabs[tabs.length - 1]
      if (next) await open(next)
    }
    await saveTabs()
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

  function apply(s: Settings): void {
    if (!editor) return
    editor.updateOptions({ fontSize: s.fontSize, lineHeight: lineHeightFor(s.fontSize) })
    editor.getModel()?.updateOptions({ tabSize: s.tabSize })
    if (vimEl) setVim(editor, s.vim, vimEl)
  }

  async function change(p: Partial<Settings>): Promise<void> {
    settings = await api.settings.set(p)
    apply(settings)
    if ('autoRun' in p && settings.autoRun) runNow()
  }

  onMount(() => {
    const ed = createEditor(editorEl)
    editor = ed

    const off = api.onEvent(onRunnerEvent)
    const offDebug = api.debug.onEvent(onDebugEvent)
    const offFix = registerMissingQuickFix(monaco, (names) => missingBanner.install(names))
    const offMenu = api.onMenu((a) => {
      if (a.startsWith('debug-') || a === 'toggle-breakpoint') {
        if (lastKey.action !== a || Date.now() - lastKey.at > 300) debugAction(a)
      } else if (a === 'settings') settingsOpen = true
      else if (a === 'quick-open') quickOpen = true
      else if (a === 'toggle-sidebar') toggleSidebar()
      else if (a === 'search') openSearch()
      else if (a === 'close-tab') current && closeTab(current)
      else if (a === 'next-tab') cycleTab(1)
      else if (a === 'prev-tab') cycleTab(-1)
      else if (a === 'stop') stop()
      else create(a === 'new-file' ? 'file' : 'folder')
    })

    ed.onDidChangeModelContent(() => {
      pendingSave = { rel: current, content: ed.getValue() }
      clearTimeout(saveTimer)
      saveTimer = setTimeout(flush, 400)
      // Live runs wait while the debugger is paused; they take over again when the session ends.
      if (settings.autoRun && !session?.paused) {
        clearTimeout(runTimer)
        runTimer = setTimeout(runNow, settings.runDelayMs)
      }
    })
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runNow())
    const margin = attachBreakpointMargin(ed, syncBreakpoints)
    window.addEventListener('keydown', onDebugKey, true)
    // Takes ⌘. / Ctrl+. from Quick Fix (still on the lightbulb), so the Stop menu shortcut works while typing.
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period, stop)
    // Same as the menu accelerator, bound here too so the editor (and vim mode) never keeps the key for itself.
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, openSearch)
    window.addEventListener('beforeunload', flush)

    ;(async () => {
      settings = await api.settings.get()
      sideW = settings.sidebarWidth
      resW = settings.resultsWidth
      root = await api.fs.root()
      apply(settings)
      await refreshTree()
      const exists = (p: string): boolean => findNode(p)?.kind === 'file'
      tabs = settings.openFiles.filter(exists)
      const start = exists(settings.lastFile) ? settings.lastFile : (tabs[0] ?? firstFile())
      if (start) await open(start)
      else await create('file')
      ready = true
      setTypeLibs(await api.packages.types())
    })()

    return () => {
      off()
      offDebug()
      offMenu()
      margin.dispose()
      window.removeEventListener('keydown', onDebugKey, true)
      offFix.dispose()
      ed.dispose()
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
      {mod}
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
      debugging={!!session}
      {mod}
      ontogglesidebar={toggleSidebar}
      ontoggleautorun={() => change({ autoRun: !settings.autoRun })}
      onrun={runNow}
      ondebug={startDebug}
      onstopdebug={stopDebug}
      running={status.mode === 'running'}
      onstop={stop}
      onsettings={() => (settingsOpen = true)}
    />

    <MissingBanner bind:this={missingBanner} file={current} {missing} onadded={packagesChanged} />

    <div class="body" bind:this={bodyEl} style="grid-template-columns: minmax(0, 1fr) min({resW}px, calc(100% - 240px))">
      <div class="col">
        <FileTabs {tabs} {current} {mod} onopen={open} onclose={closeTab} />
        <div class="editor">
          <div class="host" bind:this={editorEl}></div>
          {#if ready && !current}
            <div class="noeditor">
              <p>No file open</p>
              <p class="muted">Pick a scratch in the sidebar, or start a new one.</p>
              <button class="tbtn" onclick={() => create('file')}>New file ({mod}N)</button>
            </div>
          {/if}
        </div>
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
        </div>
        <ResultsPanel bind:this={resultsPanel} {editor} fontSize={settings.fontSize} hidden={view !== 'results'} stale={status.mode === 'paused'} />
        <BundlePanel bind:this={bundlePanel} file={current} hidden={view !== 'bundle'} />
        {#if session}
          <DebugPanel
            paused={session.paused}
            finished={session.finished}
            frame={session.frame}
            oncommand={debugCommand}
            onstop={stopDebug}
            onselect={showFrame}
          />
        {/if}
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
  .col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .editor {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .noeditor {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 6px;
    background: var(--bg);
    text-align: center;
  }
  .noeditor p {
    margin: 0;
  }
  .noeditor p:first-child {
    font-size: 15px;
    font-weight: 600;
  }
  .noeditor .tbtn {
    margin-top: 8px;
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
  .tabs button:hover {
    color: var(--fg);
  }
  .tabs button[aria-selected='true'] {
    color: var(--fg);
    font-weight: 600;
    border-bottom-color: var(--accent);
  }
</style>
