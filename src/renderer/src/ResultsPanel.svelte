<script lang="ts">
  import { lineHeightFor, type monaco } from './monaco'
  import { copyText } from './clipboard'
  import type { ResultKind } from '../../shared/protocol'

  /** `calls`: how many calls the entry stands for (default 1, see RunnerEvent in shared/protocol.ts). */
  type Entry = { kind: ResultKind; text: string; full?: string; calls?: number }
  type Props = { editor: monaco.editor.IStandaloneCodeEditor | null; fontSize: number; hidden: boolean; stale: boolean }
  let { editor, fontSize, hidden, stale }: Props = $props()

  let gutterEl: HTMLDivElement
  // The panels are Svelte state; per-line results are painted imperatively (they change on every keystroke).
  let results = new Map<number, Entry[]>()
  let general = $state<Entry[]>([])
  let detail = $state<{ line: number; entries: Entry[] } | null>(null)
  let queued = false

  const NO_ENTRIES: Entry[] = []
  const callsOf = (entries: Entry[]): number => entries.reduce((n, e) => n + (e.calls ?? 1), 0)
  const lineHeight = $derived(lineHeightFor(fontSize))
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

  /** Line 0 means "not tied to a line": it goes to the general panel, which keeps the last 5. */
  export function add(line: number, entry: Entry): void {
    if (line > 0) results.set(line, [...(results.get(line) ?? []), entry])
    else general = [...general.slice(-4), entry]
    paint()
  }

  /** Drops all results; an open detail panel stays and fills again as the next run reports. */
  export function clear(): void {
    results = new Map()
    general = []
    paint()
  }

  /** Clears everything, the detail panel too (another file opened, or none). */
  export function reset(): void {
    detail = null
    clear()
  }

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
        // The latest output (the latest error, if any) and how many calls the line made, the full list is in the panel.
        const err = entries.findLast((e) => e.kind === 'error')
        const last = err ?? entries[entries.length - 1]
        const calls = callsOf(entries)
        const cls = (err ? ' err' : '') + (detail?.line === line ? ' sel' : '')
        const body = `<span class="${last.kind}">${esc(last.text)}</span>`
        const n = calls > 1 ? `<span class="n">×${calls}</span>` : ''
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

  // Rows follow the editor: repaint when it scrolls, resizes or its text moves lines around.
  $effect(() => {
    if (!editor) return
    const subs = [editor.onDidChangeModelContent(paint), editor.onDidScrollChange(paint), editor.onDidLayoutChange(paint)]
    return () => subs.forEach((s) => s.dispose())
  })

  $effect(() => {
    void lineHeight
    paint()
  })

  function pick(e: MouseEvent): void {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-line]')
    if (!row) return
    const line = Number(row.dataset.line)
    detail = detail?.line === line ? null : { line, entries: results.get(line) ?? [] }
    paint()
  }
</script>

<div class="results" class:stale {hidden} aria-label="Results" style="--lh: {lineHeight}px; font-size: {fontSize}px">
  <!-- Rows are buttons; one delegated listener handles them all. -->
  <div class="gutter" role="presentation" bind:this={gutterEl} onclick={pick}></div>
  {#if detail}
    <section class="panel" aria-label="Output of line {detail.line}">
      <header>
        <b>Line {detail.line}</b>
        <span class="muted">{detail.entries.length} {detail.entries.length === 1 ? 'output' : 'outputs'}{callsOf(detail.entries) > detail.entries.length ? ` · ${callsOf(detail.entries)} calls` : ''}</span>
        <span class="sp"></span>
        <button class="tbtn" onclick={() => detail && copyText(detail.entries.map((e) => e.full ?? e.text).join('\n'))}>Copy</button>
        <button class="tbtn" aria-label="Close output" onclick={() => ((detail = null), paint())}>×</button>
      </header>
      <div class="pbody">
        {#each detail.entries as e, i (i)}
          {#if (e.calls ?? 1) > 1}<p class="muted calls">Latest of {e.calls} calls</p>{/if}
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

<style>
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
  .results[hidden] {
    display: none;
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
  .pbody .calls {
    margin: 0 0 4px;
    font: 11px var(--ui);
  }
  .pbody pre:last-child {
    margin-bottom: 0;
  }
  .pbody pre + pre,
  .pbody pre + .calls {
    border-top: 1px dashed var(--line);
    padding-top: 8px;
  }
  .general {
    max-height: 40%;
  }
</style>
