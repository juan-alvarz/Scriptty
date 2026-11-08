import { describe, expect, it } from 'vitest'
import { sanitize } from './settings'
import { DEFAULT_SETTINGS } from '../shared/protocol'

describe('sanitize: splits', () => {
  it('turns settings from before splits into one split', () => {
    const s = sanitize({ openFiles: ['a.ts', 'b.ts'], lastFile: 'b.ts' } as never)
    expect(s.splits).toEqual([{ files: ['a.ts', 'b.ts'], current: 'b.ts' }])
    expect(s.activeSplit).toBe(0)
  })

  it('drops empty splits, caps the count and keeps the active index in range', () => {
    const splits = [{ files: [] }, { files: ['a.ts'], current: 'gone.ts' }, { files: ['b.ts', 7, 'b.ts'] }, { files: ['c.ts'] }, { files: ['d.ts'] }]
    const s = sanitize({ splits, activeSplit: 9 } as never)
    expect(s.splits).toEqual([
      { files: ['a.ts'], current: 'a.ts' },
      { files: ['b.ts'], current: 'b.ts' },
      { files: ['c.ts'], current: 'c.ts' }
    ])
    expect(s.activeSplit).toBe(2)
    expect(sanitize({ splits: 'nope' } as never).splits).toEqual([])
  })

  it('keeps the current splits when a patch does not touch them', () => {
    const base = sanitize({ splits: [{ files: ['a.ts'], current: 'a.ts' }] })
    expect(sanitize({ fontSize: 14 }, base).splits).toEqual(base.splits)
  })
})

describe('sanitize: keybindings', () => {
  it('keeps valid overrides and leaves them alone in unrelated patches', () => {
    const s = sanitize({ keybindings: { run: 'cmd+r', stop: '', bogus: 'Cmd+J' } as never }, DEFAULT_SETTINGS, true)
    expect(s.keybindings).toEqual({ run: 'Cmd+R', stop: '' })
    expect(sanitize({ vim: true }, s, true).keybindings).toBe(s.keybindings)
  })
})
