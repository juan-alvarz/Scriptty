import { describe, expect, it } from 'vitest'
// @ts-expect-error Monaco's enum module has no .d.ts; it is plain JS that loads without a DOM.
import { KeyCode } from 'monaco-editor/editor/common/standalone/standaloneEnums.js'
import {
  ACTIONS,
  assignable,
  byShortcut,
  conflicts,
  defaultFor,
  label,
  normalize,
  resolve,
  sanitizeOverrides,
  shortcutOf,
  toMonaco,
  type KeyPress
} from './keybindings'

// Monaco's KeyMod bits (monaco.KeyMod); KeyCode is the real enum.
const monaco = { KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512, WinCtrl: 256 }, KeyCode: KeyCode as unknown as Record<string, number> }
const press = (key: string, code: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  key,
  code,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...mods
})

describe('defaults', () => {
  it('resolve CmdOrCtrl per platform', () => {
    expect(resolve({}, true).search).toBe('Shift+Cmd+F')
    expect(resolve({}, false).search).toBe('Ctrl+Shift+F')
    expect(resolve({}, true)['next-tab']).toBe('Ctrl+Tab')
    expect(resolve({}, true)['focus-split-2']).toBe('Cmd+2')
  })

  it('are valid and free of conflicts on both platforms', () => {
    for (const mac of [true, false]) {
      const b = resolve({}, mac)
      for (const a of ACTIONS) expect(assignable(b[a.id], mac), a.id).toBe(true)
      expect(conflicts(b).size).toBe(0)
    }
  })
})

describe('overrides', () => {
  it('replace the default, and an empty string unbinds', () => {
    const b = resolve({ run: 'cmd+r', stop: '' }, true)
    expect(b.run).toBe('Cmd+R')
    expect(b.stop).toBe('')
    expect(byShortcut(b).get('Cmd+R')).toBe('run')
    expect(byShortcut(b).has('Cmd+.')).toBe(false)
  })

  it('fall back to the default when they do not parse', () => {
    expect(resolve({ run: 'Hyper+R' }, true).run).toBe('Cmd+Enter')
  })

  it('are sanitized: unknown actions, bad keys, bare letters and defaults are dropped', () => {
    const raw = { run: 'Cmd+R', stop: '', 'no-such-action': 'Cmd+J', search: 'Cmd+Nope', 'new-file': 'N', 'close-tab': 'Cmd+W', settings: 7, 'toggle-sidebar': 'F6' }
    expect(sanitizeOverrides(raw, true)).toEqual({ run: 'Cmd+R', stop: '', 'toggle-sidebar': 'F6' })
    expect(sanitizeOverrides('nope', true)).toEqual({})
    expect(sanitizeOverrides(null, false)).toEqual({})
  })
})

describe('conflicts', () => {
  it('list every action sharing a shortcut; the first in ACTIONS wins the key', () => {
    const b = resolve({ 'close-tab': 'Cmd+P' }, true)
    expect(conflicts(b)).toEqual(new Map([['Cmd+P', ['quick-open', 'close-tab']]]))
    expect(byShortcut(b).get('Cmd+P')).toBe('quick-open')
    expect(byShortcut(b).has('Cmd+W')).toBe(false)
  })
})

describe('normalize', () => {
  it('orders modifiers and accepts aliases', () => {
    expect(normalize('Cmd+Shift+Alt+Ctrl+k', true)).toBe('Ctrl+Alt+Shift+Cmd+K')
    expect(normalize('Command+Option+Return', true)).toBe('Alt+Cmd+Enter')
    expect(normalize('Super+Esc', false)).toBe('Meta+Escape')
    expect(normalize('CmdOrCtrl+\\', false)).toBe('Ctrl+\\')
    expect(normalize('', true)).toBe('')
    expect(normalize('Ctrl+F13', true)).toBeNull()
    expect(normalize('Hyper+A', true)).toBeNull()
  })

  it('assignable needs Cmd, Ctrl or Alt, or a function key', () => {
    expect(assignable('Shift+A', true)).toBe(false)
    expect(assignable('Enter', true)).toBe(false)
    expect(assignable('F5', true)).toBe(true)
    expect(assignable('Alt+A', false)).toBe(true)
  })
})

describe('shortcutOf', () => {
  it('reads letters from key and the rest from code', () => {
    expect(shortcutOf(press('p', 'KeyP', { meta: true }), true)).toBe('Cmd+P')
    // Option changes `key`; the physical key still counts.
    expect(shortcutOf(press('π', 'KeyP', { alt: true, meta: true }), true)).toBe('Alt+Cmd+P')
    // Dvorak: the key labeled P sits where QWERTY has R.
    expect(shortcutOf(press('p', 'KeyR', { ctrl: true }), false)).toBe('Ctrl+P')
    expect(shortcutOf(press('!', 'Digit1', { shift: true, ctrl: true }), false)).toBe('Ctrl+Shift+1')
    expect(shortcutOf(press('.', 'Period', { meta: true }), true)).toBe('Cmd+.')
    expect(shortcutOf(press('Enter', 'NumpadEnter', { meta: true }), true)).toBe('Cmd+Enter')
    expect(shortcutOf(press('Tab', 'Tab', { ctrl: true, shift: true }), true)).toBe('Ctrl+Shift+Tab')
    expect(shortcutOf(press('ArrowUp', 'ArrowUp', { alt: true }), false)).toBe('Alt+Up')
    expect(shortcutOf(press('Meta', 'MetaLeft', { meta: true }), true)).toBeNull()
    expect(shortcutOf(press('CapsLock', 'CapsLock'), true)).toBeNull()
  })

  it('matches the resolved default', () => {
    const keys = byShortcut(resolve({}, false))
    expect(keys.get(shortcutOf(press('F', 'KeyF', { ctrl: true, shift: true }), false)!)).toBe('search')
    expect(keys.get(shortcutOf(press(',', 'Comma', { ctrl: true }), false)!)).toBe('settings')
  })
})

describe('label', () => {
  it('uses symbols on macOS and words elsewhere', () => {
    expect(label('Shift+Cmd+F', true)).toBe('⇧⌘F')
    expect(label('Ctrl+Alt+Shift+Cmd+Enter', true)).toBe('⌃⌥⇧⌘↵')
    expect(label('Ctrl+Shift+F', false)).toBe('Ctrl+Shift+F')
    expect(label('Meta+P', false)).toBe('Win+P')
    expect(label('', true)).toBe('')
  })
})

describe('toMonaco', () => {
  const { CtrlCmd, Shift, Alt, WinCtrl } = monaco.KeyMod
  it('maps the primary modifier to CtrlCmd on each platform', () => {
    expect(toMonaco('Cmd+Enter', true, monaco)).toBe(CtrlCmd | KeyCode.Enter)
    expect(toMonaco('Ctrl+Enter', false, monaco)).toBe(CtrlCmd | KeyCode.Enter)
    expect(toMonaco('Ctrl+Tab', true, monaco)).toBe(WinCtrl | KeyCode.Tab)
    expect(toMonaco('Meta+P', false, monaco)).toBe(WinCtrl | KeyCode.KeyP)
  })

  it('maps letters, digits, punctuation, arrows and function keys', () => {
    expect(toMonaco('Shift+Cmd+F', true, monaco)).toBe(CtrlCmd | Shift | KeyCode.KeyF)
    expect(toMonaco('Cmd+2', true, monaco)).toBe(CtrlCmd | KeyCode.Digit2)
    expect(toMonaco('Cmd+.', true, monaco)).toBe(CtrlCmd | KeyCode.Period)
    expect(toMonaco('Ctrl+\\', false, monaco)).toBe(CtrlCmd | KeyCode.Backslash)
    expect(toMonaco('Alt+Up', false, monaco)).toBe(Alt | KeyCode.UpArrow)
    expect(toMonaco('F5', true, monaco)).toBe(KeyCode.F5)
  })

  it('gives null when unbound or invalid', () => {
    expect(toMonaco('', true, monaco)).toBeNull()
    expect(toMonaco('Hyper+A', true, monaco)).toBeNull()
  })

  it('round-trips every default', () => {
    for (const mac of [true, false]) for (const a of ACTIONS) expect(toMonaco(defaultFor(a.id, mac), mac, monaco), a.id).toBeTypeOf('number')
  })
})
