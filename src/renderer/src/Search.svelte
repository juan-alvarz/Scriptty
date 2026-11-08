<script lang="ts">
  import { untrack } from 'svelte'
  import type { SearchMatch, SearchOptions } from '../../shared/protocol'

  type Props = {
    /** Shown in the sidebar; results refresh each time it becomes active, since files may have changed. */
    active: boolean
    /** Bumped by ⇧⌘F: focuses the query box and selects its text. */
    focusSignal: number
    /** Saves the open file first, so the search sees what is on screen. */
    onflush: () => Promise<void>
    onreveal: (m: SearchMatch) => void
  }
  let { active, focusSignal, onflush, onreveal }: Props = $props()

  const DEBOUNCE_MS = 200

  let input = $state<HTMLInputElement>()
  let query = $state('')
  let opts = $state<SearchOptions>({ caseSensitive: false, regex: false, wholeWord: false })
  let matches = $state.raw<SearchMatch[]>([])
  let truncated = $state(false)
  let error = $state('')
  let searched = $state('')
  let folded = $state<Record<string, boolean>>({})
  let picked = $state('')

  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  // Matches arrive in tree order, so a file's matches are already together.
  const groups = $derived.by(() => {
    const out: { path: string; matches: SearchMatch[] }[] = []
    for (const m of matches) {
      const last = out[out.length - 1]
      if (last?.path === m.path) last.matches.push(m)
      else out.push({ path: m.path, matches: [m] })
    }
    return out
  })

  async function run(): Promise<void> {
    clearTimeout(timer)
    const id = ++seq
    const q = query
    if (!q) {
      matches = []
      error = ''
      truncated = false
      searched = ''
      return
    }
    await onflush()
    const r = await window.scriptty.fs.search(q, { ...opts })
    if (id !== seq) return // a newer search started meanwhile
    searched = q
    if (r.ok) {
      matches = r.matches
      truncated = r.truncated
      error = ''
    } else {
      matches = []
      truncated = false
      error = r.error
    }
  }

  function typed(): void {
    clearTimeout(timer)
    timer = setTimeout(run, DEBOUNCE_MS)
  }

  function toggle(k: keyof SearchOptions): void {
    opts[k] = !opts[k]
    run()
  }

  // Alt+C / Alt+R / Alt+W, as in VS Code. `code` is used because Alt changes `key` on macOS.
  const altKeys: Record<string, keyof SearchOptions> = { KeyC: 'caseSensitive', KeyR: 'regex', KeyW: 'wholeWord' }
  function keydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      run()
    } else if (e.altKey && !e.metaKey && !e.ctrlKey && altKeys[e.code]) {
      e.preventDefault()
      toggle(altKeys[e.code])
    }
  }

  $effect(() => {
    if (focusSignal && input) {
      input.focus()
      input.select()
    }
  })

  // untrack: run() reads the query and options, which must not re-trigger this (typing is debounced).
  $effect(() => {
    if (active) untrack(run)
  })

  const keyOf = (m: SearchMatch): string => `${m.path}:${m.line}:${m.col}`
  const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
  const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))

  function reveal(m: SearchMatch): void {
    picked = keyOf(m)
    onreveal(m)
  }

  const fileCount = $derived(groups.length)
</script>

<div class="search" hidden={!active}>
  <div class="box" class:bad={!!error}>
    <input
      bind:this={input}
      bind:value={query}
      oninput={typed}
      onkeydown={keydown}
      placeholder="Search"
      aria-label="Search all scratches"
      autocomplete="off"
      spellcheck="false"
    />
    <button class="opt" aria-pressed={opts.caseSensitive} title="Match case (Alt+C)" aria-label="Match case" onclick={() => toggle('caseSensitive')}>Aa</button>
    <button class="opt word" aria-pressed={opts.wholeWord} title="Match whole word (Alt+W)" aria-label="Match whole word" onclick={() => toggle('wholeWord')}>ab</button>
    <button class="opt" aria-pressed={opts.regex} title="Use regular expression (Alt+R)" aria-label="Use regular expression" onclick={() => toggle('regex')}>.*</button>
  </div>

  {#if error}
    <p class="hint err" role="alert">{error}</p>
  {:else if searched && !matches.length}
    <p class="hint">No results</p>
  {:else if matches.length}
    <p class="hint">
      {matches.length}{truncated ? '+' : ''} result{matches.length === 1 ? '' : 's'} in {fileCount} file{fileCount === 1 ? '' : 's'}
      {#if truncated}<span class="warn">· showing the first ones; narrow the search</span>{/if}
    </p>
  {/if}

  <div class="results">
    {#each groups as g (g.path)}
      <button class="file" aria-expanded={!folded[g.path]} title={g.path} onclick={() => (folded[g.path] = !folded[g.path])}>
        <span class="ic" aria-hidden="true">{folded[g.path] ? '▸' : '▾'}</span>
        <span class="nm">{nameOf(g.path)}</span>
        {#if dirOf(g.path)}<span class="dir">{dirOf(g.path)}</span>{/if}
        <span class="count">{g.matches.length}</span>
      </button>
      {#if !folded[g.path]}
        {#each g.matches as m (keyOf(m))}
          <button
            class="hit"
            class:on={picked === keyOf(m)}
            aria-current={picked === keyOf(m) || undefined}
            title="{g.path}:{m.line}:{m.col}"
            onclick={() => reveal(m)}
          >
            <span class="ln">{m.line}</span>
            <span class="pv"
              >{m.preview.slice(0, m.previewStart)}<mark>{m.preview.slice(m.previewStart, m.previewStart + m.length)}</mark>{m.preview.slice(
                m.previewStart + m.length
              )}</span
            >
          </button>
        {/each}
      {/if}
    {/each}
  </div>
</div>

<style>
  .search {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
  }
  .search[hidden] {
    display: none;
  }
  .box {
    display: flex;
    align-items: center;
    gap: 1px;
    background: var(--field);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 2px 3px 2px 0;
  }
  .box:focus-within {
    border-color: var(--accent);
  }
  .box.bad {
    border-color: var(--err);
  }
  input {
    flex: 1;
    min-width: 0;
    font: 12px var(--mono);
    color: var(--fg);
    background: none;
    border: 0;
    outline: none;
    padding: 3px 8px;
    user-select: text;
  }
  .opt {
    flex: none;
    width: 22px;
    height: 20px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    font: 600 11px var(--mono);
    cursor: pointer;
    padding: 0;
  }
  .opt.word {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .opt:hover {
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 8%, transparent);
  }
  .opt[aria-pressed='true'] {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
    background: var(--sel);
  }
  .hint {
    margin: 0 8px;
    color: var(--muted);
    font-size: 12px;
  }
  .warn {
    color: var(--warn);
  }
  .err {
    color: var(--err);
    user-select: text;
    word-break: break-word;
  }
  .results {
    display: flex;
    flex-direction: column;
  }
  .file,
  .hit {
    width: 100%;
    background: none;
    border: 0;
    text-align: left;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
    box-sizing: border-box;
    cursor: pointer;
  }
  .file {
    padding: 3px 6px 3px 8px;
    gap: 4px;
  }
  .hit {
    padding: 2px 6px 2px 24px;
  }
  .file:hover,
  .hit:hover {
    background: color-mix(in srgb, var(--fg) 6%, transparent);
  }
  .hit.on {
    background: var(--sel);
  }
  .ic {
    width: 12px;
    flex: none;
    color: var(--muted);
    font-size: 10px;
  }
  .nm {
    flex: none;
    max-width: 70%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .dir {
    flex: 1;
    min-width: 0;
    color: var(--muted);
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    margin-left: auto;
    flex: none;
    min-width: 16px;
    padding: 0 5px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--fg) 10%, transparent);
    color: var(--muted);
    font: 10.5px/16px var(--mono);
    text-align: center;
  }
  .ln {
    flex: none;
    min-width: 22px;
    color: var(--muted);
    font: 11px var(--mono);
    text-align: right;
  }
  .pv {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
    font: 11.5px var(--mono);
  }
  mark {
    color: inherit;
    background: color-mix(in srgb, var(--warn) 32%, transparent);
    border-radius: 2px;
  }
</style>
