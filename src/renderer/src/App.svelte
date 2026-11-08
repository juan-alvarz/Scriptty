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
  import MissingBanner from './MissingBanner.svelte'
  import { registerMissingQuickFix, setMissing } from './missing'
  import { RUNTIME_OWNER, runtimeMarkers } from './markers'
  import QuickOpen from './QuickOpen.svelte'
  import { keymap, mac } from './keys.svelte'
  import { focusAfterClose, type FileDrag, type Zone } from './splits'
  import { ACTIONS, resolve, toMonaco, type ActionId, type Bindings } from '../../shared/keybindings'
  import { DEFAULT_SETTINGS, MAX_SPLITS, WIDTH_LIMITS, type RunnerEvent, type SearchMatch, type Settings, type TreeNode } from '../../shared/protocol'

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
  let view = $state<'results' | 'bundle'>('results')
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
  let status = $state<{ mode: 'live' | 'running' | 'paused' | 'stopped'; info: string }>({ mode: 'live', info: '' })

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

  /** Autosave, and a run when the edit is in the focused split. Two splits on one file share a model, so both report it. */
  function edited(id: number, ed: monaco.editor.IStandaloneCodeEditor): void {
    const rel = byId(id)?.current
    if (!rel) return
    if (pendingSave && pendingSave.rel !== rel) flush()
    pendingSave = { rel, content: ed.getValue() }
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, 400)
    if (settings.autoRun && id === activeId) {
      clearTimeout(runTimer)
      runTimer = setTimeout(runNow, settings.runDelayMs)
    }
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

  /** Shows the sidebar in Search mode with the query box focused. */
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
      runNow()
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
    'split-right': () => current && split(groups.findIndex((g) => g.id === activeId) + 1, current),
    'focus-split-1': () => focusSplit(0),
    'focus-split-2': () => focusSplit(1),
    'focus-split-3': () => focusSplit(2),
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
    const subs = [ed.onDidChangeModelContent(() => edited(id, ed)), ed.onDidFocusEditorText(() => focusGroup(id))]
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
      offMenu()
      offFix.dispose()
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
        </div>
        <ResultsPanel bind:this={resultsPanel} {editor} fontSize={settings.fontSize} hidden={view !== 'results'} stale={status.mode === 'paused'} />
        <BundlePanel bind:this={bundlePanel} file={current} hidden={view !== 'bundle'} />
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
  .tabs button:hover {
    color: var(--fg);
  }
  .tabs button[aria-selected='true'] {
    color: var(--fg);
    font-weight: 600;
    border-bottom-color: var(--accent);
  }
</style>
