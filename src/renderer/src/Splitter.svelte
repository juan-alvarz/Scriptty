<script lang="ts">
  type Props = {
    label: string
    /** Current width of the pane this handle resizes, in px. */
    value: number
    min: number
    max?: number
    /** 1 when dragging right grows the pane (a pane on the left), -1 for a pane on the right. */
    direction: 1 | -1
    onresize: (width: number) => void
    /** The drag or key press ended: save the width. */
    ondone: () => void
    onreset: () => void
  }
  let { label, value, min, max, direction, onresize, ondone, onreset }: Props = $props()

  function drag(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const w0 = value
    const move = (ev: PointerEvent): void => onresize(w0 + direction * (ev.clientX - x0))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      ondone()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  function nudge(e: KeyboardEvent): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    onresize(value + (e.key === 'ArrowRight' ? 16 : -16) * direction)
    ondone()
  }
</script>

<!-- A focusable separator is the ARIA window-splitter pattern: arrow keys resize. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="split"
  role="separator"
  aria-orientation="vertical"
  aria-label={label}
  aria-valuenow={value}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  title="Drag to resize. Double-click to reset."
  onpointerdown={drag}
  ondblclick={onreset}
  onkeydown={nudge}
></div>

<style>
  .split {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -4px; /* the parent places it on the pane edge, outside any scrolling box that could clip it */
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
</style>
