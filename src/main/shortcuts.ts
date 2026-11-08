import type { MenuAction } from '../shared/protocol'

type Keys = Pick<Electron.Input, 'type' | 'key' | 'shift' | 'control' | 'meta' | 'alt'>

/**
 * Menu action for a key handled before the page sees it: ⌘⇧PageUp / PageDown on macOS,
 * Ctrl+Shift+PageUp / PageDown elsewhere, move the current tab. Monaco and vim mode never get them.
 */
export function moveTabShortcut(k: Keys, mac: boolean): MenuAction | null {
  if (k.type !== 'keyDown' || !k.shift || k.alt || (mac ? !k.meta || k.control : !k.control || k.meta)) return null
  return k.key === 'PageUp' ? 'move-tab-left' : k.key === 'PageDown' ? 'move-tab-right' : null
}
