import { describe, expect, it } from 'vitest'
import { sanitize, watchList } from './settings'
import { DEFAULT_SETTINGS, WATCH_LIMITS } from '../shared/protocol'

describe('watch expressions in settings', () => {
  it('keeps trimmed, non-empty strings within the limits', () => {
    expect(watchList([' a + b ', '', '  ', 3, null, 'x'.repeat(WATCH_LIMITS.length + 1), 'obj.tags'])).toEqual(['a + b', 'obj.tags'])
    expect(watchList(Array.from({ length: 80 }, (_, i) => `v${i}`))).toHaveLength(WATCH_LIMITS.count)
    expect(watchList('a')).toBeNull()
  })

  it('falls back to the current list when settings.json has no valid one', () => {
    expect(sanitize({}).watches).toEqual(DEFAULT_SETTINGS.watches)
    expect(sanitize({ watches: 'oops' as never }, { ...DEFAULT_SETTINGS, watches: ['n'] }).watches).toEqual(['n'])
    expect(sanitize({ watches: ['n', 'm'] }).watches).toEqual(['n', 'm'])
  })
})
