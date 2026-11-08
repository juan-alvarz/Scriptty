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
  import { DEFAULT_SETTINGS, WIDTH_LIMITS, type RunnerEvent, type Settings, type TreeNode } from '../../shared/protocol'

  const api = window.scriptty
  const mod = api.platform === 'darwin' ? '⌘' : 'Ctrl+'

  let editorEl: HTMLDivElement
  let bodyEl: HTMLDivElement
  let resultsPanel: ReturnType<typeof ResultsPanel>
  let bundlePanel: ReturnType<typeof BundlePanel>
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
  let notice = $state('')
  let view = $state<'results' | 'bundle'>('results')
  let tabs = $state<string[]>([])
  let ready = $state(false)
  // Cursor, selection and scroll per open file, restored when its tab comes back.
  const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()
  // Live pane widths while dragging; saved to settings when the drag ends.
  let sideW = $state(DEFAULT_SETTINGS.sidebarWidth)
  let resW = $state(DEFAULT_SETTINGS.resultsWidth)
  let status = $state<{ mode: 'live' | 'running' | 'paused' | 'stopped'; info: string }>({ mode: 'live', info: '' })

  let currentRun = -1
  let fresh = false
  let count = 0
  let runTimer: ReturnType<typeof setTimeout> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let pendingSave: { rel: string; content: string } | null = null

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
    if (startRun(r.runId)) status = { mode: 'running', info: status.info }
  }

  /** Kills the current run (servers, intervals); the next edit or Run starts a fresh one as usual. */
  function stop(): void {
    clearTimeout(runTimer)
    api.stop()
  }

  function onRunnerEvent(e: RunnerEvent): void {
    if (e.runId < currentRun) return
    startRun(e.runId)
    if (fresh) {
      // Keep the previous run's results on screen until the new run says something, to avoid flicker.
      resultsPanel.clear()
      count = 0
      fresh = false
    }
    if (e.type === 'result') {
      count++
      resultsPanel.add(e.line, { kind: e.kind, text: e.text, full: e.full })
      // Output after `done` means timers or a server are still going, so offer Stop again.
      if (status.mode === 'live') status = { mode: 'running', info: status.info }
    } else if (e.stopped) {
      status = { mode: 'stopped', info: `${count} results` }
    } else {
      status = { mode: 'live', info: `${count} results · ${e.ms < 10 ? e.ms.toFixed(2) : Math.round(e.ms)}ms` }
    }
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
    runNow()
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
    const offMenu = api.onMenu((a) => {
      if (a === 'settings') settingsOpen = true
      else if (a === 'toggle-sidebar') toggleSidebar()
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
      if (settings.autoRun) {
        clearTimeout(runTimer)
        runTimer = setTimeout(runNow, settings.runDelayMs)
      }
    })
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runNow())
    // Takes ⌘. / Ctrl+. from Quick Fix (still on the lightbulb), so the Stop menu shortcut works while typing.
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period, stop)
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
      offMenu()
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
      ontoggle={toggleSidebar}
      oncreate={create}
      onopen={openNode}
      oncontext={context}
      onrename={rename}
      oncancel={() => (renaming = '')}
      ondismiss={() => (notice = '')}
      onpackageschange={async () => setTypeLibs(await api.packages.types())}
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
      {mod}
      ontogglesidebar={toggleSidebar}
      ontoggleautorun={() => change({ autoRun: !settings.autoRun })}
      onrun={runNow}
      running={status.mode === 'running'}
      onstop={stop}
      onsettings={() => (settingsOpen = true)}
    />

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
      </div>
    </div>

    <StatusBar {status} file={current} tabSize={settings.tabSize} bind:vimEl />
  </main>
</div>

<SettingsDialog open={settingsOpen} {settings} {root} onchange={change} onclose={() => ((settingsOpen = false), editor?.focus())} />

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
