// App actions and their keyboard shortcuts: one registry for main's key handler, the menu,
// Monaco's command palette and Settings > Keyboard Shortcuts.
//
// Shortcuts are Electron accelerator strings. Defaults may say `CmdOrCtrl`, which resolves to Cmd on
// macOS and Ctrl elsewhere, so each default is per platform. Resolved and stored shortcuts are canonical:
// modifiers in the order Ctrl, Alt, Shift, Cmd (Meta off macOS), then the key, e.g. `Shift+Cmd+F`.

export const ACTIONS = [
  { id: 'run', label: 'Run Now', key: 'CmdOrCtrl+Enter' },
  { id: 'stop', label: 'Stop', key: 'CmdOrCtrl+.' },
  { id: 'quick-open', label: 'Go to File', key: 'CmdOrCtrl+P' },
  { id: 'search', label: 'Search Scratches', key: 'Shift+CmdOrCtrl+F' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', key: 'CmdOrCtrl+B' },
  { id: 'new-file', label: 'New File', key: 'CmdOrCtrl+N' },
  { id: 'new-folder', label: 'New Folder', key: 'Shift+CmdOrCtrl+N' },
  { id: 'close-tab', label: 'Close Tab', key: 'CmdOrCtrl+W' },
  { id: 'next-tab', label: 'Next Tab', key: 'Ctrl+Tab' },
  { id: 'prev-tab', label: 'Previous Tab', key: 'Ctrl+Shift+Tab' },
  { id: 'move-tab-left', label: 'Move Tab Left', key: 'CmdOrCtrl+Shift+PageUp' },
  { id: 'move-tab-right', label: 'Move Tab Right', key: 'CmdOrCtrl+Shift+PageDown' },
  { id: 'split-right', label: 'Split Editor Right', key: 'CmdOrCtrl+\\' },
  { id: 'focus-split-1', label: 'Focus Split 1', key: 'CmdOrCtrl+1' },
  { id: 'focus-split-2', label: 'Focus Split 2', key: 'CmdOrCtrl+2' },
  { id: 'focus-split-3', label: 'Focus Split 3', key: 'CmdOrCtrl+3' },
  { id: 'debug-start', label: 'Start Debugging', key: 'F5' },
  // A second key for the same action: F5 needs Fn on most Mac keyboards.
  { id: 'debug-start-alt', label: 'Start Debugging (second key)', key: 'Shift+CmdOrCtrl+D' },
  { id: 'debug-stop', label: 'Stop Debugging', key: 'Shift+F5' },
  { id: 'debug-continue', label: 'Continue', key: 'F8' },
  { id: 'debug-step-over', label: 'Step Over', key: 'F10' },
  { id: 'debug-step-into', label: 'Step Into', key: 'F11' },
  { id: 'debug-step-out', label: 'Step Out', key: 'Shift+F11' },
  { id: 'toggle-breakpoint', label: 'Toggle Breakpoint', key: 'F9' },
  { id: 'settings', label: 'Settings', key: 'CmdOrCtrl+,' }
] as const

export type ActionId = (typeof ACTIONS)[number]['id']
/** Shortcut per action; '' means unbound. */
export type Bindings = Record<ActionId, string>
/** What settings.json stores: only the actions the user changed. */
export type Overrides = Partial<Record<ActionId, string>>

type Chord = { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string }

// Punctuation keys: accelerator character, DOM `code`, Monaco KeyCode name (the same word for both).
const PUNCT: Record<string, string> = {
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal'
}
const ARROWS: Record<string, string> = { Up: 'UpArrow', Down: 'DownArrow', Left: 'LeftArrow', Right: 'RightArrow' }
const NAMED = ['Enter', 'Tab', 'Escape', 'Space', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown']
const ALIASES: Record<string, string> = { Return: 'Enter', Esc: 'Escape', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }
const FKEY = /^F([1-9]|1[0-2])$/

function keyName(k: string): string | null {
  k = ALIASES[k] ?? k
  if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase()
  if (k in PUNCT || k in ARROWS || NAMED.includes(k) || FKEY.test(k)) return k
  return null
}

function parse(accel: string, mac: boolean): Chord | null {
  const parts = accel.split('+').map((p) => p.trim())
  const c: Chord = { ctrl: false, alt: false, shift: false, meta: false, key: '' }
  for (const p of parts.slice(0, -1)) {
    const m = p.toLowerCase()
    if (m === 'cmdorctrl' || m === 'commandorcontrol') c[mac ? 'meta' : 'ctrl'] = true
    else if (m === 'ctrl' || m === 'control') c.ctrl = true
    else if (m === 'cmd' || m === 'command' || m === 'meta' || m === 'super') c.meta = true
    else if (m === 'alt' || m === 'option') c.alt = true
    else if (m === 'shift') c.shift = true
    else return null
  }
  const key = keyName(parts[parts.length - 1])
  return key ? { ...c, key } : null
}

function format(c: Chord, mac: boolean): string {
  const mods = [c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', c.meta && (mac ? 'Cmd' : 'Meta')].filter(Boolean)
  return [...mods, c.key].join('+')
}

/** Canonical form of a shortcut for this platform; '' stays '' (unbound); null when it does not parse. */
export function normalize(accel: string, mac: boolean): string | null {
  if (accel === '') return ''
  const c = parse(accel, mac)
  return c && format(c, mac)
}

/** A shortcut must use Cmd, Ctrl or Alt, or be a function key, so it can never take a key needed for typing. */
export function assignable(accel: string, mac: boolean): boolean {
  const c = parse(accel, mac)
  return !!c && (c.ctrl || c.alt || c.meta || FKEY.test(c.key))
}

export const defaultFor = (id: ActionId, mac: boolean): string => normalize(ACTIONS.find((a) => a.id === id)!.key, mac)!

/** Every action's shortcut: the user's override where there is one, else the platform default. */
export function resolve(overrides: Overrides, mac: boolean): Bindings {
  const out = {} as Bindings
  for (const a of ACTIONS) {
    const o = overrides[a.id]
    out[a.id] = o === undefined ? defaultFor(a.id, mac) : (normalize(o, mac) ?? defaultFor(a.id, mac))
  }
  return out
}

/** Shortcut to action. When two actions share a shortcut, the one listed first in ACTIONS gets it. */
export function byShortcut(b: Bindings): Map<string, ActionId> {
  const m = new Map<string, ActionId>()
  for (const a of ACTIONS) if (b[a.id] && !m.has(b[a.id])) m.set(b[a.id], a.id)
  return m
}

/** Shortcuts bound to more than one action, with those actions in ACTIONS order. */
export function conflicts(b: Bindings): Map<string, ActionId[]> {
  const m = new Map<string, ActionId[]>()
  for (const a of ACTIONS) if (b[a.id]) m.set(b[a.id], [...(m.get(b[a.id]) ?? []), a.id])
  return new Map([...m].filter(([, ids]) => ids.length > 1))
}

/** Validates settings.json's `keybindings`: known actions only, valid shortcuts, defaults dropped. */
export function sanitizeOverrides(input: unknown, mac: boolean): Overrides {
  const out: Overrides = {}
  if (!input || typeof input !== 'object') return out
  for (const a of ACTIONS) {
    const v = (input as Record<string, unknown>)[a.id]
    if (typeof v !== 'string') continue
    const k = normalize(v, mac)
    if (k === null || (k && !assignable(k, mac)) || k === defaultFor(a.id, mac)) continue
    out[a.id] = k
  }
  return out
}

/** A key press, from a DOM KeyboardEvent or Electron's `before-input-event` Input. */
export type KeyPress = { key: string; code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }

const CODE_KEYS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PUNCT).map(([k, code]) => [code, k])),
  ...Object.fromEntries(Object.keys(ARROWS).map((k) => ['Arrow' + k, k])),
  NumpadEnter: 'Enter'
}

/** The canonical shortcut for a key press, or null for a modifier on its own or a key we do not bind. */
export function shortcutOf(k: KeyPress, mac: boolean): string | null {
  // Letters come from `key`, so other layouts (Dvorak, AZERTY) match the letter printed on the key.
  // Everything else comes from `code`, because Shift and Option change `key` ('!' for 1, 'π' for P).
  const letter = k.key.length === 1 && /^[a-z]$/i.test(k.key) ? k.key.toUpperCase() : null
  const fromCode = /^Key[A-Z]$/.test(k.code) ? k.code.slice(3) : /^Digit\d$/.test(k.code) ? k.code.slice(5) : (CODE_KEYS[k.code] ?? k.code)
  const key = letter ?? keyName(fromCode)
  return key ? format({ ctrl: k.ctrl, alt: k.alt, shift: k.shift, meta: k.meta, key }, mac) : null
}

const GLYPHS: Record<string, string> = {
  Enter: '↵',
  Tab: '⇥',
  Escape: '⎋',
  Backspace: '⌫',
  Delete: '⌦',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→'
}

/** Display form: `⇧⌘F` on macOS, `Ctrl+Shift+F` elsewhere; '' when unbound. */
export function label(accel: string, mac: boolean): string {
  const c = accel ? parse(accel, mac) : null
  if (!c) return ''
  if (!mac) return format(c, false).replace('Meta', 'Win')
  return (c.ctrl ? '⌃' : '') + (c.alt ? '⌥' : '') + (c.shift ? '⇧' : '') + (c.meta ? '⌘' : '') + (GLYPHS[c.key] ?? c.key)
}

/** The slice of Monaco's enums toMonaco needs (passed in, so this module never loads Monaco). */
export type MonacoKeys = { KeyMod: { CtrlCmd: number; Shift: number; Alt: number; WinCtrl: number }; KeyCode: Record<string, number | string> }

/** Monaco keybinding number for a shortcut (Cmd is CtrlCmd on macOS, Ctrl is CtrlCmd elsewhere), or null. */
export function toMonaco(accel: string, mac: boolean, m: MonacoKeys): number | null {
  const c = accel ? parse(accel, mac) : null
  if (!c) return null
  const name = /^[A-Z]$/.test(c.key) ? 'Key' + c.key : /^\d$/.test(c.key) ? 'Digit' + c.key : (PUNCT[c.key] ?? ARROWS[c.key] ?? c.key)
  const code = m.KeyCode[name]
  if (typeof code !== 'number') return null
  const { CtrlCmd, WinCtrl, Shift, Alt } = m.KeyMod
  const primary = mac ? c.meta : c.ctrl
  const secondary = mac ? c.ctrl : c.meta
  return code | (primary ? CtrlCmd : 0) | (secondary ? WinCtrl : 0) | (c.shift ? Shift : 0) | (c.alt ? Alt : 0)
}
