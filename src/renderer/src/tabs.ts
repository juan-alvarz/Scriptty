/** Pure tab-strip ordering helpers, kept out of the Svelte components so they can be unit-tested. */

/** Horizontal extent of a tab in client pixels (a subset of DOMRect). */
export type Span = { left: number; right: number }

/** Pointer travel in px before a press on a tab becomes a drag; below it the press stays a click. */
export const DRAG_THRESHOLD = 4

/** Returns a copy of `list` with the item at `from` moved so it ends up at index `to` (clamped). */
export function moveTab<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list]
  if (from < 0 || from >= out.length) return out
  const [item] = out.splice(from, 1)
  out.splice(Math.min(Math.max(to, 0), out.length), 0, item)
  return out
}

/**
 * Gap the pointer is over, from 0 (before the first tab) to `spans.length` (after the last).
 * A tab's left half drops before it, its right half after it.
 */
export function insertionIndex(x: number, spans: readonly Span[]): number {
  const i = spans.findIndex((s) => x < (s.left + s.right) / 2)
  return i < 0 ? spans.length : i
}

/** Final index of the dragged tab when it is dropped into `gap`; the gaps either side of it leave it in place. */
export const dropIndex = (from: number, gap: number): number => (gap > from ? gap - 1 : gap)

/** True when dropping the tab at `from` into `gap` would not change the order. */
export const isNoop = (from: number, gap: number): boolean => gap === from || gap === from + 1

/** Client x of the boundary at `gap`: a tab's left edge, or the last tab's right edge. */
export function gapX(gap: number, spans: readonly Span[]): number {
  if (!spans.length) return 0
  return gap < spans.length ? spans[Math.max(gap, 0)].left : spans[spans.length - 1].right
}

/**
 * Pixels to scroll the strip by this frame while dragging: negative near or past the left edge,
 * positive near or past the right, 0 in between. Speed grows with depth into the edge zone.
 */
export function autoScrollStep(x: number, strip: Span, zone = 32, max = 14): number {
  const depth = x < strip.left + zone ? x - (strip.left + zone) : x > strip.right - zone ? x - (strip.right - zone) : 0
  if (!depth) return 0
  const step = Math.round((Math.min(Math.abs(depth), zone) / zone) * max) || 1
  return Math.sign(depth) * step
}

/** Index the current tab moves to for a keyboard move by `step`, or -1 when it is already at that end. */
export function stepIndex(length: number, index: number, step: number): number {
  const to = index + step
  return index < 0 || to < 0 || to >= length ? -1 : to
}
