<script lang="ts">
  import { autoScrollStep, DRAG_THRESHOLD, dropIndex, gapX, insertionIndex, isNoop } from './tabs'

  type Props = {
    tabs: string[]
    current: string
    mod: string
    onopen: (rel: string) => void
    onclose: (rel: string) => void
    /** Drag reorder: move the tab at `from` so it ends up at `to`. */
    onmove: (from: number, to: number) => void
  }
  let { tabs, current, mod, onopen, onclose, onmove }: Props = $props()

  let el: HTMLDivElement

  // A press on a tab; it becomes a drag only after DRAG_THRESHOLD px, so clicks and middle-clicks stay as they were.
  let press: { from: number; id: number; x0: number; x: number } | null = null
  let dragging = $state(-1) // index of the tab being dragged
  let gap = $state(-1) // insertion gap under the pointer, -1 when the drop would change nothing
  let barX = $state(0) // indicator position in the strip's scrolled content
  let frame = 0
  let swallowClick = false

  function onpointerdown(e: PointerEvent, i: number): void {
    if (e.button !== 0 || (e.target as Element).closest('.fx')) return
    press = { from: i, id: e.pointerId, x0: e.clientX, x: e.clientX }
  }

  function onpointermove(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return
    if (!(e.buttons & 1)) return end() // released outside the strip before the drag started
    press.x = e.clientX
    if (dragging < 0) {
      if (Math.abs(press.x - press.x0) < DRAG_THRESHOLD) return
      dragging = press.from
      // Capture only now: capturing on press would retarget the click away from the tab button.
      el.setPointerCapture(press.id)
      frame = requestAnimationFrame(scrollLoop)
    }
    track()
  }

  /** Recomputes the drop gap and indicator from the pointer and the tabs' current rects. */
  function track(): void {
    if (!press) return
    const spans = [...el.querySelectorAll('.ftab')].map((t) => t.getBoundingClientRect())
    const g = insertionIndex(press.x, spans)
    gap = isNoop(press.from, g) ? -1 : g
    barX = gapX(g, spans) - el.getBoundingClientRect().left + el.scrollLeft
  }

  /** Scrolls the strip while the pointer is near or past either edge. */
  function scrollLoop(): void {
    if (!press || dragging < 0) return
    const step = autoScrollStep(press.x, el.getBoundingClientRect())
    if (step) {
      el.scrollLeft += step
      track()
    }
    frame = requestAnimationFrame(scrollLoop)
  }

  function onpointerup(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return
    if (dragging >= 0) {
      if (gap >= 0) onmove(press.from, dropIndex(press.from, gap))
      // The release can still produce a click on a tab; it must not also activate it.
      swallowClick = true
      setTimeout(() => (swallowClick = false))
    }
    end()
  }

  function end(): void {
    cancelAnimationFrame(frame)
    if (press && el.hasPointerCapture(press.id)) el.releasePointerCapture(press.id)
    press = null
    dragging = -1
    gap = -1
  }

  const onkeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && dragging >= 0) {
      e.preventDefault()
      end()
    }
  }

  const nameOf = (path: string): string => path.split('/').pop() ?? path
  const parentOf = (path: string): string => path.split('/').slice(0, -1).join('/')
  /** Tab label; adds the folder when two open tabs share a file name. */
  const labelOf = (p: string): { name: string; dir: string } => ({
    name: nameOf(p),
    dir: tabs.filter((t) => nameOf(t) === nameOf(p)).length > 1 ? parentOf(p) || '/' : ''
  })

  // Keep the current tab in view when it changes or moves (keyboard reorder can push it off screen).
  const currentIndex = $derived(tabs.indexOf(current))
  $effect(() => {
    void currentIndex
    el.querySelector('.ftab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
</script>

<div
  class="colhead filetabs"
  class:dragging={dragging >= 0}
  role="tablist"
  aria-label="Open files"
  tabindex="-1"
  bind:this={el}
  {onpointermove}
  {onpointerup}
  onpointercancel={end}
  onlostpointercapture={end}
  {onkeydown}
>
  {#each tabs as t, i (t)}
    {@const l = labelOf(t)}
    <div class="ftab" class:on={t === current} class:lifted={i === dragging} title={t} role="presentation" onpointerdown={(e) => onpointerdown(e, i)}>
      <button
        role="tab"
        class="fname"
        aria-selected={t === current}
        onclick={() => swallowClick || onopen(t)}
        onauxclick={(e) => e.button === 1 && onclose(t)}
      >
        {l.name}{#if l.dir}<span class="fdir">{l.dir}</span>{/if}
      </button>
      <button class="fx" aria-label="Close {t}" title="Close ({mod}W)" onclick={() => onclose(t)}>×</button>
    </div>
  {/each}
  {#if gap >= 0}<div class="drop" style="left: {barX}px" aria-hidden="true"></div>{/if}
</div>

<style>
  .filetabs {
    position: relative;
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
  .dragging,
  .dragging * {
    cursor: grabbing;
  }
  .ftab.lifted {
    opacity: 0.5;
  }
  /* Insertion indicator: sits on the gap the dragged tab would drop into. */
  .drop {
    position: absolute;
    top: 4px;
    bottom: 4px;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--accent);
    pointer-events: none;
  }
</style>
