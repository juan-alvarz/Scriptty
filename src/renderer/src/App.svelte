<script lang="ts">
  import { onMount } from 'svelte'
  import { createEditor, createViewer, disposeModels, languageOf, lineHeightFor, modelFor, monaco, setTypeLibs, setVim } from './monaco'
  import Tree from './Tree.svelte'
  import Packages from './Packages.svelte'
  import SettingsDialog from './Settings.svelte'
  import { DEFAULT_SETTINGS, WIDTH_LIMITS, type ResultKind, type RunnerEvent, type Settings, type TreeNode } from '../../shared/protocol'

  type Entry = { kind: ResultKind; text: string; full?: string }
  const api = window.scriptty
  const mod = api.platform === 'darwin' ? '⌘' : 'Ctrl+'

  let editorEl: HTMLDivElement
  let gutterEl: HTMLDivElement
  let vimEl: HTMLSpanElement
  let editor: monaco.editor.IStandaloneCodeEditor | null = null

  let settings = $state<Settings>({ ...DEFAULT_SETTINGS })
  let root = $state('')
  let tree = $state<TreeNode[]>([])
  let current = $state('')
  let selected = $state('')
  let renaming = $state('')
  let collapsed = $state<Record<string, boolean>>({})
  let settingsOpen = $state(false)
  let notice = $state('')

  let bodyEl: HTMLDivElement
  let viewerEl: HTMLDivElement
  let viewer: monaco.editor.IStandaloneCodeEditor | null = null
  let view = $state<'results' | 'bundle'>('results')
  let bundleOpts = $state({ minify: false, inlinePackages: false })
  let bundleState = $state({ busy: false, error: '', bytes: 0 })
  let bundleSeq = 0
  let tabs = $state<string[]>([])
  let tabsEl: HTMLDivElement
  let ready = $state(false)
  // Cursor, selection and scroll per open file, restored when its tab comes back.
  const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()
  // Live pane widths while dragging; saved to settings when the drag ends.
  let sideW = $state(DEFAULT_SETTINGS.sidebarWidth)
  let resW = $state(DEFAULT_SETTINGS.resultsWidth)

  // Status and panels are Svelte state; per-line results are painted imperatively (they change on every keystroke).
  let status = $state<{ mode: 'live' | 'running' | 'paused'; info: string }>({ mode: 'live', info: '' })
  let general = $state<Entry[]>([])
  let detail = $state<{ line: number; entries: Entry[] } | null>(null)

  let results = new Map<number, Entry[]>()
  let currentRun = -1
  let fresh = false
  let count = 0
  let runTimer: ReturnType<typeof setTimeout> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let pendingSave: { rel: string; content: string } | null = null
  let queued = false

  const NO_ENTRIES: Entry[] = []
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const lineHeight = $derived(lineHeightFor(settings.fontSize))

  // Microtask, not requestAnimationFrame: rAF is throttled while the window is in the background.
  function paint(): void {
    if (queued || !editor) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (!editor) return
      const scroll = editor.getScrollTop()
      const height = gutterEl.clientHeight
      let html = ''
      for (const [line, entries] of results) {
        const top = editor.getTopForLineNumber(line) - scroll
        if (top < -lineHeight || top > height) continue
        const cls = (entries.some((e) => e.kind === 'error') ? ' err' : '') + (detail?.line === line ? ' sel' : '')
        const body = entries.map((e) => `<span class="${e.kind}">${esc(e.text)}</span>`).join('<span class="sep"> · </span>')
        const n = entries.length > 1 ? `<span class="n">×${entries.length}</span>` : ''
        html += `<button class="row${cls}" data-line="${line}" style="top:${top}px" title="Show full output"><span class="t">${body}</span>${n}</button>`
      }
      gutterEl.innerHTML = html
      // Only touch the panel when its line got new output; paint also runs on every scroll.
      if (detail) {
        const entries = results.get(detail.line) ?? NO_ENTRIES
        if (entries !== detail.entries) detail = { line: detail.line, entries }
      }
    })
  }

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

  function clearResults(): void {
    results = new Map()
    general = []
    count = 0
    paint()
  }

  async function flush(): Promise<void> {
    clearTimeout(saveTimer)
    const s = pendingSave
    pendingSave = null
    if (!s) return
    const r = await api.fs.write(s.rel, s.content)
    if (!r.ok) notice = `Could not save ${s.rel}: ${r.error}`
    else if (view === 'bundle') refreshBundle()
  }

  /** Builds the saved file with bun; the newest request wins. */
  async function refreshBundle(): Promise<void> {
    if (!current || !viewer) return
    const seq = ++bundleSeq
    bundleState = { ...bundleState, busy: true }
    const r = await api.bundle(current, { ...bundleOpts })
    if (seq !== bundleSeq) return
    if (r.ok) {
      viewer.setValue(r.value)
      bundleState = { busy: false, error: '', bytes: new Blob([r.value]).size }
    } else {
      bundleState = { busy: false, error: r.error, bytes: 0 }
    }
  }

  async function showView(v: 'results' | 'bundle'): Promise<void> {
    view = v
    if (v === 'bundle') {
      await flush()
      refreshBundle()
    }
  }

  // Clipboard unavailable: the text stays selectable on screen.
  const copyText = (text: string): Promise<void> => navigator.clipboard.writeText(text).catch(() => {})

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

  function drag(e: PointerEvent, which: 'side' | 'res'): void {
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const w0 = which === 'side' ? sideW : resW
    const move = (ev: PointerEvent): void => setWidth(which, w0 + (which === 'side' ? 1 : -1) * (ev.clientX - x0))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      saveWidths()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  function nudge(e: KeyboardEvent, which: 'side' | 'res'): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = (e.key === 'ArrowRight' ? 16 : -16) * (which === 'side' ? 1 : -1)
    setWidth(which, (which === 'side' ? sideW : resW) + step)
    saveWidths()
  }

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
  const nameOf = (path: string): string => path.split('/').pop() ?? path
  /** Tab label; adds the folder when two open tabs share a file name. */
  const tabLabel = (p: string): { name: string; dir: string } => ({
    name: nameOf(p),
    dir: tabs.filter((t) => nameOf(t) === nameOf(p)).length > 1 ? parentOf(p) || '/' : ''
  })
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
    viewer?.setValue('')
    current = ''
    detail = null
    clearResults()
    status = { mode: 'live', info: '' }
  }

  function cycleTab(step: number): void {
    if (tabs.length < 2) return
    const i = tabs.indexOf(current)
    open(tabs[(i + step + tabs.length) % tabs.length])
  }

  $effect(() => {
    void current
    tabsEl?.querySelector('.ftab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })

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
    detail = null
    clearResults()
    settings = await api.settings.set({ lastFile: rel, openFiles: [...tabs] })
    editor.focus()
    runNow()
    if (view === 'bundle') refreshBundle()
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
    if (node) selected = node.path
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
    setVim(editor, s.vim, vimEl)
    paint()
  }

  async function change(p: Partial<Settings>): Promise<void> {
    settings = await api.settings.set(p)
    apply(settings)
    if ('autoRun' in p && settings.autoRun) runNow()
  }

  function pick(e: MouseEvent): void {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-line]')
    if (!row) return
    const line = Number(row.dataset.line)
    detail = detail?.line === line ? null : { line, entries: results.get(line) ?? [] }
    paint()
  }


  onMount(() => {
    const ed = createEditor(editorEl)
    editor = ed
    const vw = createViewer(viewerEl)
    viewer = vw

    const off = api.onEvent((e: RunnerEvent) => {
      if (e.runId < currentRun) return
      startRun(e.runId)
      if (fresh) {
        // Keep the previous run's results on screen until the new run says something, to avoid flicker.
        clearResults()
        fresh = false
      }
      if (e.type === 'result') {
        count++
        const entry = { kind: e.kind, text: e.text, full: e.full }
        if (e.line > 0) results.set(e.line, [...(results.get(e.line) ?? []), entry])
        else general = [...general.slice(-4), entry]
      } else {
        status = { mode: 'live', info: `${count} results · ${e.ms < 10 ? e.ms.toFixed(2) : Math.round(e.ms)}ms` }
      }
      paint()
    })
    const offMenu = api.onMenu((a) => {
      if (a === 'settings') settingsOpen = true
      else if (a === 'toggle-sidebar') toggleSidebar()
      else if (a === 'close-tab') current && closeTab(current)
      else if (a === 'next-tab') cycleTab(1)
      else if (a === 'prev-tab') cycleTab(-1)
      else create(a === 'new-file' ? 'file' : 'folder')
    })

    ed.onDidChangeModelContent(() => {
      paint()
      pendingSave = { rel: current, content: ed.getValue() }
      clearTimeout(saveTimer)
      saveTimer = setTimeout(flush, 400)
      if (settings.autoRun) {
        clearTimeout(runTimer)
        runTimer = setTimeout(runNow, settings.runDelayMs)
      }
    })
    ed.onDidScrollChange(paint)
    ed.onDidLayoutChange(paint)
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runNow())
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
      vw.dispose()
    }
  })
</script>

{#snippet sideToggle()}
  <!-- Lives inside the drag strips (like the toolbar buttons) so its no-drag reliably wins.
       Rendered in the sidebar strip or the toolbar, both 80px from the window edge, so it never moves. -->
  <button class="sidetoggle" title="{settings.sidebarHidden ? 'Show' : 'Hide'} sidebar ({mod}B)" aria-label="Toggle sidebar" aria-pressed={!settings.sidebarHidden} onclick={toggleSidebar}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M9.5 4.5v15" /></svg>
  </button>
{/snippet}

<div class="window" style="grid-template-columns: {settings.sidebarHidden ? '' : `${sideW}px `}minmax(0, 1fr)">
  {#if !settings.sidebarHidden}
    <aside class="side">
      <div class="drag traffic">{@render sideToggle()}</div>
      <section
        class="scratches"
        role="group"
        aria-label="Scratches"
        oncontextmenu={(e) => {
          e.preventDefault()
          selected = ''
          context(null)
        }}
      >
        <div class="sh">
          <h5>Scratches</h5>
          <span class="sp"></span>
          <button class="mini" title="New file ({mod}N)" aria-label="New file" onclick={() => create('file')}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h5l3 3v9H4z M9 2v3h3 M8 8v4 M6 10h4" /></svg>
          </button>
          <button class="mini" title="New folder (⇧{mod}N)" aria-label="New folder" onclick={() => create('folder')}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h4l1.5 1.5H14V13H2z M8 7.5v4 M6 9.5h4" /></svg>
          </button>
        </div>
        <Tree
          nodes={tree}
          {current}
          {selected}
          {renaming}
          {collapsed}
          onopen={openNode}
          oncontext={context}
          onrename={rename}
          oncancel={() => (renaming = '')}
        />
      </section>
      <Packages onchange={async () => setTypeLibs(await api.packages.types())} oninsert={insertImport} />
      {#if notice}
        <p class="notice" role="alert">{notice}<button aria-label="Dismiss" onclick={() => (notice = '')}>×</button></p>
      {/if}
    </aside>
  {/if}

  <main class="main" class:full={settings.sidebarHidden}>
    {#if !settings.sidebarHidden}
      <!-- A focusable separator is the ARIA window-splitter pattern: arrow keys resize. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="split side-split"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={sideW}
        aria-valuemin={WIDTH_LIMITS.sidebar[0]}
        aria-valuemax={WIDTH_LIMITS.sidebar[1]}
        tabindex="0"
        title="Drag to resize. Double-click to reset."
        onpointerdown={(e) => drag(e, 'side')}
        ondblclick={() => resetWidth('side')}
        onkeydown={(e) => nudge(e, 'side')}
      ></div>
    {/if}
    <header class="tb drag">
      {#if settings.sidebarHidden}{@render sideToggle()}{/if}
      <span class="sp"></span>
      <button class="tbtn" aria-pressed={settings.autoRun} onclick={() => change({ autoRun: !settings.autoRun })}>Auto-run</button>
      <button class="tbtn" onclick={() => runNow()}>Run {mod}↵</button>
      <button class="tbtn icon" title="Settings ({mod},)" aria-label="Settings" onclick={() => (settingsOpen = true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
      </button>
    </header>

    <div class="body" class:stale={status.mode === 'paused'} bind:this={bodyEl} style="grid-template-columns: minmax(0, 1fr) min({resW}px, calc(100% - 240px))">
      <!-- Monaco sits in an absolutely positioned host so its size never feeds back into the layout (the zoom bug). -->
      <div class="col">
        <div class="colhead filetabs" role="tablist" aria-label="Open files" bind:this={tabsEl}>
          {#each tabs as t (t)}
            {@const l = tabLabel(t)}
            <div class="ftab" class:on={t === current} title={t}>
              <button role="tab" class="fname" aria-selected={t === current} onclick={() => open(t)} onauxclick={(e) => e.button === 1 && closeTab(t)}>
                {l.name}{#if l.dir}<span class="fdir">{l.dir}</span>{/if}
              </button>
              <button class="fx" aria-label="Close {t}" title="Close ({mod}W)" onclick={() => closeTab(t)}>×</button>
            </div>
          {/each}
        </div>
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
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          class="split res-split"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize results"
          aria-valuenow={resW}
          aria-valuemin={WIDTH_LIMITS.results[0]}
          tabindex="0"
          title="Drag to resize. Double-click to reset."
          onpointerdown={(e) => drag(e, 'res')}
          ondblclick={() => resetWidth('res')}
          onkeydown={(e) => nudge(e, 'res')}
        ></div>
        <!-- Same height as the editor's header, so result rows stay level with their lines. -->
        <div class="colhead tabs" role="tablist" aria-label="Right panel">
          <button role="tab" aria-selected={view === 'results'} onclick={() => showView('results')}>Results</button>
          <button role="tab" aria-selected={view === 'bundle'} onclick={() => showView('bundle')}>Bundle</button>
        </div>
        <div class="results" hidden={view !== 'results'} aria-label="Results" style="--lh: {lineHeight}px; font-size: {settings.fontSize}px">
          <!-- Rows are buttons; one delegated listener handles them all. -->
          <div class="gutter" role="presentation" bind:this={gutterEl} onclick={pick}></div>
          {#if detail}
            <section class="panel" aria-label="Output of line {detail.line}">
              <header>
                <b>Line {detail.line}</b>
                <span class="muted">{detail.entries.length} {detail.entries.length === 1 ? 'output' : 'outputs'}</span>
                <span class="sp"></span>
                <button class="tbtn" onclick={() => detail && copyText(detail.entries.map((e) => e.full ?? e.text).join('\n'))}>Copy</button>
                <button class="tbtn" aria-label="Close output" onclick={() => ((detail = null), paint())}>×</button>
              </header>
              <div class="pbody">
                {#each detail.entries as e, i (i)}
                  <pre class={e.kind}>{e.full ?? e.text}</pre>
                {:else}
                  <p class="muted">No output on this line yet.</p>
                {/each}
              </div>
            </section>
          {:else if general.length}
            <section class="panel general" aria-label="Output not tied to a line">
              <div class="pbody">
                {#each general as g, i (i)}<pre class={g.kind}>{g.full ?? g.text}</pre>{/each}
              </div>
            </section>
          {/if}
        </div>
        <div class="bundle" hidden={view !== 'bundle'} aria-label="Bundle">
          <header>
            <label><input type="checkbox" bind:checked={bundleOpts.minify} onchange={refreshBundle} /> Minify</label>
            <label title="Inline installed packages instead of leaving them as imports">
              <input type="checkbox" bind:checked={bundleOpts.inlinePackages} onchange={refreshBundle} /> Include packages
            </label>
            <span class="sp"></span>
            <span class="muted">{bundleState.busy ? 'Building…' : bundleState.error ? 'Build failed' : `${(bundleState.bytes / 1024).toFixed(1)} KB`}</span>
            <button class="tbtn" onclick={() => copyText(viewer?.getValue() ?? '')} disabled={!!bundleState.error}>Copy</button>
          </header>
          {#if bundleState.error}<pre class="berr" role="alert">{bundleState.error}</pre>{/if}
          <div class="vhost" class:dim={!!bundleState.error}><div class="host" bind:this={viewerEl}></div></div>
        </div>
      </div>
    </div>

    <footer class="sb">
      <span><i class="dot {status.mode}"></i>{status.mode === 'live' ? 'Live' : status.mode === 'running' ? 'Running' : 'Paused'}</span>
      <span class="info">{status.info}</span>
      <span class="sp"></span>
      <span class="vim" bind:this={vimEl}></span>
      <span>{languageOf(current) === 'javascript' ? 'JavaScript' : 'TypeScript'}</span>
      <span>Spaces: {settings.tabSize}</span>
    </footer>
  </main>
</div>

<SettingsDialog open={settingsOpen} {settings} {root} onchange={change} onclose={() => ((settingsOpen = false), editor?.focus())} />

<style>
  .window {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
  }
  .side {
    position: relative;
    min-height: 0;
    background: var(--side);
    border-right: 1px solid var(--line);
    padding: 0 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    font-size: 12.5px;
    overflow: auto;
  }
  :global([data-platform='darwin']) .side {
    background: transparent;
  }
  .traffic {
    height: 40px;
    flex: none;
  }
  .drag {
    -webkit-app-region: drag;
  }
  .drag button {
    -webkit-app-region: no-drag;
  }
  .scratches {
    flex: 1 0 auto;
    min-height: 80px;
  }
  .sh {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 6px;
  }
  h5 {
    margin: 0 0 0 8px;
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 600;
  }
  .mini {
    width: 22px;
    height: 22px;
    border: 0;
    background: none;
    border-radius: 5px;
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--muted);
  }
  .mini:hover {
    background: color-mix(in srgb, var(--fg) 8%, transparent);
    color: var(--fg);
  }
  .mini svg,
  .icon svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .icon svg {
    stroke-width: 2;
  }
  .notice {
    margin: 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--err) 12%, transparent);
    color: var(--err);
    display: flex;
    gap: 8px;
    align-items: start;
    user-select: text;
  }
  .notice button {
    margin-left: auto;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .main {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg);
  }
  /* The button sits 80px from the window edge on macOS (right of the traffic lights), 10px elsewhere,
     whether it is in the sidebar strip (which already has 10px side padding) or in the toolbar. */
  .traffic {
    display: flex;
    align-items: center;
  }
  :global([data-platform='darwin']) .traffic {
    padding-left: 70px;
  }
  :global([data-platform='darwin']) .main.full .tb {
    padding-left: 80px;
  }
  .sidetoggle {
    flex: none;
    width: 28px;
    height: 26px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .sidetoggle:hover {
    background: color-mix(in srgb, var(--fg) 9%, transparent);
    color: var(--fg);
  }
  .sidetoggle svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
  }
  .main.full .tb {
    padding-left: 10px;
  }
  .col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .colhead {
    height: 32px;
    flex: none;
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
    box-sizing: border-box;
  }
  .tabs {
    background: var(--bg);
  }
  .filetabs {
    background: var(--panel);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .filetabs::-webkit-scrollbar {
    display: none;
  }
  .ftab {
    flex: none;
    height: 100%;
    max-width: 220px;
    display: flex;
    align-items: center;
    border-right: 1px solid var(--line);
    border-bottom: 2px solid transparent;
    box-sizing: border-box;
    color: var(--muted);
  }
  .ftab:hover {
    color: var(--fg);
  }
  .ftab.on {
    background: var(--bg);
    color: var(--fg);
    border-bottom-color: var(--accent);
  }
  .fname {
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px 0 14px;
    border: 0;
    background: none;
    color: inherit;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .ftab.on .fname {
    font-weight: 600;
  }
  .fdir {
    color: var(--muted);
    font-weight: 400;
  }
  .fx {
    width: 20px;
    height: 20px;
    margin-right: 6px;
    flex: none;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
  }
  .ftab:hover .fx,
  .ftab.on .fx,
  .fx:focus-visible {
    opacity: 1;
  }
  .fx:hover {
    background: color-mix(in srgb, var(--fg) 10%, transparent);
    color: var(--fg);
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
  .split {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 7px;
    cursor: col-resize;
    z-index: 3;
    touch-action: none;
    -webkit-app-region: no-drag; /* the toolbar is a window-drag region */
  }
  .split:hover,
  .split:focus-visible {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
    outline: none;
  }
  .side-split {
    left: -4px; /* lives in .main so the scrolling sidebar can't clip it */
  }
  .res-split {
    left: -4px;
  }
  .tb {
    height: 40px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    border-bottom: 1px solid var(--line);
    font-size: 12.5px;
  }
  :global(:root:not([data-platform='darwin'])) .tb {
    padding-right: 150px; /* room for the Windows caption buttons (titleBarOverlay) */
  }
  .muted {
    color: var(--muted);
  }
  .sp {
    flex: 1;
  }
  .tbtn {
    font-size: 12px;
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 3px 9px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
  }
  .tbtn.icon {
    padding: 3px 6px;
  }
  .tbtn[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
  }
  .editor {
    flex: 1;
  }
  .editor,
  .vhost {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .host {
    position: absolute;
    inset: 0;
  }
  .right {
    position: relative;
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--line);
    display: flex;
    flex-direction: column;
  }
  .results {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--panel);
    overflow: hidden;
    font-family: var(--mono);
    display: flex;
    flex-direction: column;
  }
  .gutter {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .stale .gutter {
    opacity: 0.45;
  }
  .gutter :global(.row) {
    position: absolute;
    left: 0;
    right: 0;
    height: var(--lh);
    line-height: var(--lh);
    padding: 0 14px;
    display: flex;
    gap: 8px;
    align-items: center;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
    user-select: none;
  }
  .gutter :global(.row:hover) {
    background: color-mix(in srgb, var(--fg) 6%, transparent);
  }
  .gutter :global(.row.sel) {
    background: var(--sel);
  }
  .gutter :global(.row.err) {
    background: color-mix(in srgb, var(--err) 12%, transparent);
  }
  .gutter :global(.t) {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gutter :global(.n) {
    flex: none;
    font-size: 0.8em;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 4px;
    line-height: 1.4;
  }
  .results :global(.value) {
    color: var(--val);
  }
  .results :global(.log) {
    color: var(--log);
  }
  .results :global(.warn) {
    color: var(--warn);
  }
  .results :global(.error) {
    color: var(--err);
  }
  .results :global(.sep) {
    color: var(--muted);
  }
  .panel {
    flex: 0 0 auto;
    max-height: 55%;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
    background: var(--bg);
    min-height: 0;
  }
  .panel header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 6px 14px;
    border-bottom: 1px solid var(--line);
    font: 12px var(--ui);
  }
  .pbody {
    overflow: auto;
    padding: 8px 14px 12px;
    user-select: text;
  }
  .pbody pre {
    margin: 0 0 8px;
    font: inherit;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.5;
  }
  .pbody pre:last-child {
    margin-bottom: 0;
  }
  .pbody pre + pre {
    border-top: 1px dashed var(--line);
    padding-top: 8px;
  }
  .general {
    max-height: 40%;
  }
  .bundle {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .bundle[hidden],
  .results[hidden] {
    display: none;
  }
  .bundle header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 10px 6px 14px;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
  }
  .bundle label {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }
  .vhost {
    flex: 1;
  }
  .vhost.dim {
    opacity: 0.4;
  }
  .berr {
    margin: 0;
    padding: 10px 14px;
    font: 12px/1.5 var(--mono);
    color: var(--err);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border-bottom: 1px solid var(--line);
    max-height: 40%;
    overflow: auto;
    user-select: text;
  }
  .sb {
    height: 26px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 12px;
    border-top: 1px solid var(--line);
    font-size: 11.5px;
    color: var(--muted);
    white-space: nowrap;
  }
  .info {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vim {
    font-family: var(--mono);
    color: var(--accent);
  }
  .vim :global(input) {
    font: inherit;
    color: var(--fg);
    background: none;
    border: 0;
    outline: none;
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
    margin-right: 6px;
    vertical-align: 1px;
  }
  .dot.paused {
    background: var(--err);
  }
  .dot.running {
    background: var(--warn);
  }
</style>
