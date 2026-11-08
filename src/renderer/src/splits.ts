// Pure helpers for editor splits (App.svelte), kept apart so vitest can run them without a DOM.

/** Drag data for a file dragged from the tree (`from` null) or from a split's tab bar (`from` is that split's id). */
export type FileDrag = { path: string; from: number | null }
export const FILE_DRAG = 'application/x-scriptty-file'

export function readDrag(raw: string): FileDrag | null {
  try {
    const d = JSON.parse(raw) as Partial<FileDrag>
    return typeof d?.path === 'string' && d.path && (d.from === null || typeof d.from === 'number') ? { path: d.path, from: d.from } : null
  } catch {
    return null
  }
}

export type Zone = 'left' | 'right' | 'center'

/** Where a drop at `x` px into a split `width` px wide lands: its outer quarters open a new split, when there is room. */
export function dropZone(x: number, width: number, canSplit: boolean): Zone {
  if (!canSplit || width <= 0) return 'center'
  return x < width / 4 ? 'left' : x > (width * 3) / 4 ? 'right' : 'center'
}

/** The split to focus after `closed` goes away: the one now in its place, else the one before. Unchanged when another closes. */
export function focusAfterClose(ids: number[], closed: number, active: number): number {
  const i = ids.indexOf(closed)
  if (closed !== active || i < 0) return active
  const rest = ids.filter((id) => id !== closed)
  return rest[Math.min(i, rest.length - 1)] ?? active
}
