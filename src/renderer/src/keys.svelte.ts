// The current shortcuts, for labels in buttons and tooltips. App.svelte keeps `keymap.map` in sync with settings.
import { label, resolve, type ActionId } from '../../shared/keybindings'

export const mac = window.scriptty.platform === 'darwin'
export const keymap = $state({ map: resolve({}, mac) })

/** The action's shortcut for display (`⇧⌘F`, `Ctrl+Shift+F`), or '' when it is unbound. */
export const shortcut = (id: ActionId): string => label(keymap.map[id], mac)
/** `text (⌘W)`, or just `text` when the action is unbound. */
export const withKey = (text: string, id: ActionId): string => (shortcut(id) ? `${text} (${shortcut(id)})` : text)
