<script lang="ts" module>
  import type { DebugCommand, DebugFrame, DebugScope, DebugValue, DebugVar } from '../../shared/protocol'

  export type Paused = { reason: string; frames: DebugFrame[] }
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import type { BreakpointItem } from './breakpoints'

  type Props = {
    /** The Debugger tab is not the one shown. */
    hidden: boolean
    /** A debug run is in progress (running or paused). */
    active: boolean
    /** Null while the debug run is running. */
    paused: Paused | null
    /** The run's top level has finished; the process stays attached for timers and callbacks. */
    finished: boolean
    frame: number
    oncommand: (c: DebugCommand) => void
    onstop: () => void
    onselect: (frame: number) => void
    /** Watch expressions, kept in settings. */
    watches: string[]
    onwatches: (watches: string[]) => void
    breakpoints: BreakpointItem[]
    onstart: () => void
    onjump: (rel: string, line: number) => void
    onremove: (rel: string, line: number) => void
    onclear: () => void
  }
  let { hidden, active, paused, finished, frame, oncommand, onstop, onselect, watches, onwatches, breakpoints, onstart, onjump, onremove, onclear }: Props =
    $props()

  const api = window.scriptty
  let scopes = $state<DebugScope[]>([])
  let error = $state('')
  /** Children of expanded values by path; null while loading. */
  let open = $state<Record<string, DebugVar[] | null>>({})
  let seq = 0

  // Each pause (or frame pick) reloads the variables; object ids from an earlier pause are gone by then.
  $effect(() => {
    const p = paused
    const f = frame
    const mine = ++seq
    open = {}
    if (!p) {
      scopes = []
      return
    }
    api.debug.scopes(f).then((r) => {
      if (mine !== seq) return
      scopes = r.ok ? r.value : []
      error = r.ok ? '' : r.error
    })
  })

  // Watch values follow every pause, frame pick and list change; expanded watch values are reloaded too.
  let watchVals = $state<DebugValue[]>([])
  let wseq = 0
  $effect(() => {
    const p = paused
    const f = frame
    const list = [...watches]
    const mine = ++wseq
    untrack(() => (open = Object.fromEntries(Object.entries(open).filter(([k]) => !k.startsWith('w')))))
    if (!p || !list.length) {
      watchVals = []
      return
    }
    api.debug.watch(f, list).then((r) => {
      if (mine !== wseq) return
      watchVals = r.ok ? r.value : list.map(() => ({ text: r.error, type: 'error' }))
    })
  })

  /** Index of the watch being edited, or -1. */
  let editing = $state(-1)
  let draft = $state('')

  function startEdit(i: number): void {
    editing = i
    draft = watches[i]
  }

  /** Saves the draft over watch `i`, or appends it when `i` is the list's length; an empty draft removes. */
  function commit(i: number, text: string): void {
    const w = text.trim()
    const next = [...watches]
    if (i >= next.length) {
      if (w) onwatches([...next, w])
    } else if (!w) onwatches(next.filter((_, j) => j !== i))
    else if (w !== next[i]) onwatches(next.with(i, w))
  }

  function onEditKey(e: KeyboardEvent, i: number): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      const text = draft
      editing = -1
      commit(i, text)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      editing = -1
    }
  }

  function onAddKey(e: KeyboardEvent): void {
    const el = e.currentTarget as HTMLInputElement
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(watches.length, el.value)
      el.value = ''
    } else if (e.key === 'Escape') {
      el.value = ''
      el.blur()
    }
  }

  const focus = (el: HTMLInputElement): void => {
    el.focus()
    el.select()
  }

  async function toggle(path: string, v: DebugVar): Promise<void> {
    if (path in open) {
      const { [path]: _, ...rest } = open
      open = rest
      return
    }
    if (!v.value.objectId) return
    open = { ...open, [path]: null }
    const mine = seq
    const r = await api.debug.props(v.value.objectId, v.value.type)
    if (mine === seq && path in open) open = { ...open, [path]: r.ok ? r.value : [] }
  }

  const REASON: Record<string, string> = { breakpoint: 'Paused on breakpoint', debugger: 'Paused on debugger statement', step: 'Paused', pause: 'Paused' }
  const top = $derived(paused?.frames[0])
  const controls: { c: DebugCommand; label: string; key: string; icon: string }[] = [
    { c: 'continue', label: 'Continue', key: 'F8', icon: 'M7 5v14M11 5l9 7-9 7z' },
    { c: 'stepOver', label: 'Step Over', key: 'F10', icon: 'M4 13a8 8 0 0 1 15-3M19 4v6h-6M12 19.5h.01' },
    { c: 'stepInto', label: 'Step Into', key: 'F11', icon: 'M12 3v11M7 9l5 5 5-5M12 20h.01' },
    { c: 'stepOut', label: 'Step Out', key: '⇧F11', icon: 'M12 15V4M7 9l5-5 5 5M12 20h.01' }
  ]
</script>

{#snippet children(path: string, depth: number)}
  {@const kids = open[path]}
  {#if kids === null}
    <p class="muted note" style="padding-left: {30 + depth * 14}px">Loading…</p>
  {:else if kids && kids.length}
    <ul>{@render tree(kids, path, depth + 1)}</ul>
  {:else}
    <p class="muted note" style="padding-left: {30 + depth * 14}px">No properties</p>
  {/if}
{/snippet}

{#snippet tree(vars: DebugVar[], base: string, depth: number)}
  {#each vars as v, i (base + '/' + i)}
    {@const path = base + '/' + i}
    <li>
      <button
        class="var"
        style="padding-left: {8 + depth * 14}px"
        class:leaf={!v.value.objectId}
        aria-expanded={v.value.objectId ? path in open : undefined}
        onclick={() => toggle(path, v)}
      >
        <span class="caret" aria-hidden="true">{v.value.objectId ? (path in open ? '▾' : '▸') : ''}</span>
        <span class="name">{v.name}</span><span class="colon">:</span>
        <span class="val {v.value.type}" title={v.value.text}>{v.value.text}</span>
      </button>
      {#if path in open}{@render children(path, depth)}{/if}
    </li>
  {/each}
{/snippet}

<section class="debug" {hidden} aria-label="Debugger">
  <header>
    <i class="dot" class:paused={!!paused} class:idle={!active}></i>
    <span class="state">
      {#if !active}
        <b>Not debugging</b>
      {:else if paused && top}
        <b>{REASON[paused.reason] ?? 'Paused'}</b> <span class="muted">{top.file}:{top.line}</span>
      {:else if finished}
        <b>Finished</b> <span class="muted">still attached for timers and callbacks</span>
      {:else}
        <b>Running</b>
      {/if}
    </span>
    <span class="sp"></span>
    {#if active}
      {#each controls as k (k.c)}
        <button class="ctl" title="{k.label} ({k.key})" aria-label={k.label} disabled={!paused} onclick={() => oncommand(k.c)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={k.icon} /></svg>
        </button>
      {/each}
      <button class="ctl stop" title="Stop (⇧F5)" aria-label="Stop debugging" onclick={onstop}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
      </button>
    {:else}
      <button class="start" title="Run the current file with the debugger: it stops at breakpoints (F5)" onclick={onstart}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
        Start debugging <span class="key">F5</span>
      </button>
    {/if}
  </header>
  <div class="main">
    {#if paused}
      <div class="cols">
        <div class="stack">
          <h5>Call stack</h5>
          <ul>
            {#each paused.frames as f, i (i)}
              <li>
                <button class="frame" class:on={i === frame} onclick={() => onselect(i)}>
                  <span class="fn">{f.name}</span>
                  <span class="muted">{f.file.split('/').pop()}:{f.line}</span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
        <div class="vars">
          <h5>Watch</h5>
          <ul class="watch">
            {#each watches as w, i (i)}
              {@const v = watchVals[i]}
              {@const path = `w${i}`}
              <li>
                {#if editing === i}
                  <input
                    class="wedit"
                    aria-label="Edit watch expression"
                    spellcheck="false"
                    bind:value={draft}
                    use:focus
                    onkeydown={(e) => onEditKey(e, i)}
                    onblur={() => editing === i && ((editing = -1), commit(i, draft))}
                  />
                {:else}
                  <div class="wrow">
                    <button
                      class="var"
                      class:leaf={!v?.objectId}
                      title="Double-click to edit"
                      aria-expanded={v?.objectId ? path in open : undefined}
                      onclick={() => v && toggle(path, { name: w, value: v })}
                      ondblclick={() => startEdit(i)}
                    >
                      <span class="caret" aria-hidden="true">{v?.objectId ? (path in open ? '▾' : '▸') : ''}</span>
                      <span class="name">{w}</span><span class="colon">:</span>
                      <span class="val {v?.type ?? 'unavailable'}" title={v?.text}>{v?.text ?? '…'}</span>
                    </button>
                    <button class="wbtn" title="Edit" aria-label="Edit {w}" onclick={() => startEdit(i)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>
                    </button>
                    <button class="wbtn" title="Remove" aria-label="Remove {w}" onclick={() => commit(i, '')}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                  </div>
                  {#if path in open}{@render children(path, 0)}{/if}
                {/if}
              </li>
            {/each}
            <li><input class="wadd" placeholder="Add expression…" aria-label="Add watch expression" spellcheck="false" onkeydown={onAddKey} /></li>
          </ul>
          {#if error}<p class="muted note">{error}</p>{/if}
          {#each scopes as s, si (si)}
            <h5>{s.name}</h5>
            <ul>{@render tree(s.vars, `${frame}:${si}`, 0)}</ul>
          {:else}
            {#if !error}<p class="muted note">No variables</p>{/if}
          {/each}
        </div>
      </div>
    {/if}
    <div class="bps" class:docked={!!paused}>
      <div class="bphead">
        <h5>Breakpoints</h5>
        <span class="sp"></span>
        {#if breakpoints.length}<button class="link" onclick={onclear}>Clear all</button>{/if}
      </div>
      {#if breakpoints.length}
        <ul>
          {#each breakpoints as b (b.rel + ':' + b.line)}
            <li class="bprow" class:hit={!!top && top.file === b.rel && top.line === b.line}>
              <button class="bp" title="Go to {b.rel}:{b.line}" onclick={() => onjump(b.rel, b.line)}>
                <i class="bpdot" aria-hidden="true"></i>
                <span class="loc">{b.rel.split('/').pop()}:{b.line}</span>
                <span class="code muted">{b.text}</span>
              </button>
              <button class="wbtn" title="Remove breakpoint" aria-label="Remove breakpoint at {b.rel}:{b.line}" onclick={() => onremove(b.rel, b.line)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted note">No breakpoints. Click left of a line number or press F9 to add one. Debug runs stop there; live runs ignore them.</p>
      {/if}
    </div>
  </div>
  {#if active}<p class="hint muted">F5 or F8 continue · F10 over · F11 into · ⇧F11 out · ⇧F5 stop · F9 breakpoint</p>{/if}
</section>

<style>
  .debug {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg);
    font-size: 12px;
  }
  .debug[hidden] {
    display: none;
  }
  .main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 5px 8px 5px 12px;
    border-bottom: 1px solid var(--line);
    min-height: 26px;
  }
  .state {
    margin-left: 6px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
  }
  .dot.paused {
    background: var(--warn);
  }
  .dot.idle {
    background: var(--muted);
  }
  .start {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: none;
    color: var(--fg);
    font-size: 12px;
    cursor: pointer;
  }
  .start:hover {
    background: color-mix(in srgb, var(--fg) 7%, transparent);
  }
  .start svg {
    width: 11px;
    height: 11px;
    fill: var(--ok);
  }
  .start .key {
    color: var(--muted);
  }
  .bps {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 0;
  }
  .bps.docked {
    flex: 0 1 auto;
    max-height: 32%;
    border-top: 1px solid var(--line);
  }
  .bphead {
    display: flex;
    align-items: center;
    padding-right: 10px;
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 11.5px;
    cursor: pointer;
  }
  .bprow {
    display: flex;
    align-items: center;
    padding-right: 6px;
  }
  .bprow:hover .wbtn,
  .bprow:focus-within .wbtn {
    opacity: 1;
  }
  .bprow.hit {
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }
  .bp {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 7px;
    padding: 3px 10px;
    border: 0;
    background: none;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .bp:hover {
    background: color-mix(in srgb, var(--fg) 6%, transparent);
  }
  .bpdot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--err);
    align-self: center;
  }
  .loc {
    flex: none;
  }
  .code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .ctl {
    flex: none;
    width: 26px;
    height: 24px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--accent);
    cursor: pointer;
  }
  .ctl:hover:not(:disabled) {
    background: color-mix(in srgb, var(--fg) 9%, transparent);
  }
  .ctl:disabled {
    color: var(--muted);
    opacity: 0.45;
    cursor: default;
  }
  .ctl.stop {
    color: var(--err);
  }
  .ctl svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(110px, 38%) minmax(0, 1fr);
  }
  .stack,
  .vars {
    min-height: 0;
    overflow: auto;
    padding: 8px 0;
  }
  .stack {
    border-right: 1px solid var(--line);
  }
  h5 {
    margin: 4px 0 4px 10px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .frame,
  .var {
    width: 100%;
    display: flex;
    align-items: baseline;
    gap: 6px;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    padding: 2px 10px;
    white-space: nowrap;
    overflow: hidden;
  }
  .frame:hover,
  .var:hover {
    background: color-mix(in srgb, var(--fg) 6%, transparent);
  }
  .frame.on {
    background: var(--sel);
  }
  .fn {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .var {
    font-family: var(--mono);
    font-size: 11.5px;
    padding-right: 10px;
  }
  .var.leaf {
    cursor: default;
  }
  .caret {
    flex: none;
    width: 10px;
    color: var(--muted);
  }
  .name {
    color: var(--fg);
  }
  .colon {
    margin-left: -6px;
    color: var(--muted);
  }
  .val {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--log);
    user-select: text;
  }
  .val.number,
  .val.bigint,
  .val.boolean {
    color: var(--val);
  }
  .val.string {
    color: var(--ok);
  }
  .val.undefined,
  .val.accessor {
    color: var(--muted);
  }
  .val.unavailable {
    color: var(--muted);
    font-style: italic;
  }
  .val.error {
    color: var(--err);
  }
  .watch {
    margin-bottom: 6px;
  }
  .wrow {
    display: flex;
    align-items: center;
  }
  .wrow .var {
    flex: 1;
    min-width: 0;
  }
  .wbtn {
    flex: none;
    width: 20px;
    height: 18px;
    display: grid;
    opacity: 0;
    place-items: center;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .wrow:hover .wbtn,
  .wrow:focus-within .wbtn {
    opacity: 1;
  }
  .wbtn:hover {
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 9%, transparent);
  }
  .wbtn svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .wadd,
  .wedit {
    display: block;
    width: calc(100% - 20px);
    margin: 2px 10px;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: var(--fg);
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .wedit,
  .wadd:focus {
    border-color: var(--accent);
    outline: none;
  }
  .wadd::placeholder {
    color: var(--muted);
  }
  .note {
    margin: 2px 10px;
    font-size: 11.5px;
  }
  .hint {
    margin: 0;
    padding: 4px 12px;
    border-top: 1px solid var(--line);
    font-size: 11px;
  }
</style>
