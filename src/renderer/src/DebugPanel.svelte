<script lang="ts" module>
  import type { DebugCommand, DebugFrame, DebugScope, DebugVar } from '../../shared/protocol'

  export type Paused = { reason: string; frames: DebugFrame[] }
</script>

<script lang="ts">
  type Props = {
    /** Null while the debug run is running. */
    paused: Paused | null
    /** The run's top level has finished; the process stays attached for timers and callbacks. */
    finished: boolean
    frame: number
    oncommand: (c: DebugCommand) => void
    onstop: () => void
    onselect: (frame: number) => void
  }
  let { paused, finished, frame, oncommand, onstop, onselect }: Props = $props()

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

{#snippet tree(vars: DebugVar[], base: string, depth: number)}
  {#each vars as v, i (base + '/' + i)}
    {@const path = base + '/' + i}
    {@const kids = open[path]}
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
      {#if path in open}
        {#if kids === null}
          <p class="muted note" style="padding-left: {30 + depth * 14}px">Loading…</p>
        {:else if kids && kids.length}
          <ul>{@render tree(kids, path, depth + 1)}</ul>
        {:else}
          <p class="muted note" style="padding-left: {30 + depth * 14}px">No properties</p>
        {/if}
      {/if}
    </li>
  {/each}
{/snippet}

<section class="debug" class:open={!!paused} aria-label="Debugger">
  <header>
    <i class="dot" class:paused={!!paused}></i>
    <span class="state">
      {#if paused && top}
        <b>{REASON[paused.reason] ?? 'Paused'}</b> <span class="muted">{top.file}:{top.line}</span>
      {:else if finished}
        <b>Finished</b> <span class="muted">still attached for timers and callbacks</span>
      {:else}
        <b>Running</b>
      {/if}
    </span>
    <span class="sp"></span>
    {#each controls as k (k.c)}
      <button class="ctl" title="{k.label} ({k.key})" aria-label={k.label} disabled={!paused} onclick={() => oncommand(k.c)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={k.icon} /></svg>
      </button>
    {/each}
    <button class="ctl stop" title="Stop (⇧F5)" aria-label="Stop debugging" onclick={onstop}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
    </button>
  </header>
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
        {#if error}<p class="muted note">{error}</p>{/if}
        {#each scopes as s, si (si)}
          <h5>{s.name}</h5>
          <ul>{@render tree(s.vars, `${frame}:${si}`, 0)}</ul>
        {:else}
          {#if !error}<p class="muted note">No variables</p>{/if}
        {/each}
      </div>
    </div>
    <p class="hint muted">F5 or F8 continue · F10 over · F11 into · ⇧F11 out · ⇧F5 stop · F9 breakpoint</p>
  {/if}
</section>

<style>
  .debug {
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-top: 1px solid var(--line);
    background: var(--bg);
    font-size: 12px;
  }
  .debug.open {
    flex: 0 0 52%;
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
