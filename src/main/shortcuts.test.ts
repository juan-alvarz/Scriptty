import { describe, expect, it } from 'vitest'
import { moveTabShortcut } from './shortcuts'

type Mods = Partial<Record<'shift' | 'control' | 'meta' | 'alt', boolean>>
const key = (key: string, mods: Mods, type = 'keyDown'): Parameters<typeof moveTabShortcut>[0] =>
  ({ type, key, shift: false, control: false, meta: false, alt: false, ...mods }) as Parameters<typeof moveTabShortcut>[0]

describe('moveTabShortcut', () => {
  it('maps Cmd+Shift+PageUp/PageDown on macOS', () => {
    expect(moveTabShortcut(key('PageUp', { meta: true, shift: true }), true)).toBe('move-tab-left')
    expect(moveTabShortcut(key('PageDown', { meta: true, shift: true }), true)).toBe('move-tab-right')
    expect(moveTabShortcut(key('PageUp', { control: true, shift: true }), true)).toBeNull()
    expect(moveTabShortcut(key('PageUp', { meta: true, control: true, shift: true }), true)).toBeNull()
  })

  it('maps Ctrl+Shift+PageUp/PageDown elsewhere', () => {
    expect(moveTabShortcut(key('PageUp', { control: true, shift: true }), false)).toBe('move-tab-left')
    expect(moveTabShortcut(key('PageDown', { control: true, shift: true }), false)).toBe('move-tab-right')
    expect(moveTabShortcut(key('PageUp', { meta: true, shift: true }), false)).toBeNull()
  })

  it('ignores other keys, missing or extra modifiers, and key up', () => {
    expect(moveTabShortcut(key('PageUp', { control: true }), false)).toBeNull()
    expect(moveTabShortcut(key('PageUp', { control: true, shift: true, alt: true }), false)).toBeNull()
    expect(moveTabShortcut(key('Home', { control: true, shift: true }), false)).toBeNull()
    expect(moveTabShortcut(key('PageUp', { control: true, shift: true }, 'keyUp'), false)).toBeNull()
  })
})
