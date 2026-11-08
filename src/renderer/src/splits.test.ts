import { describe, expect, it } from 'vitest'
import { dropZone, focusAfterClose, readDrag } from './splits'

describe('dropZone', () => {
  it('splits on the outer quarters, opens in place in the middle', () => {
    expect(dropZone(10, 400, true)).toBe('left')
    expect(dropZone(200, 400, true)).toBe('center')
    expect(dropZone(390, 400, true)).toBe('right')
  })
  it('only opens in place when no more splits fit', () => {
    expect(dropZone(10, 400, false)).toBe('center')
    expect(dropZone(390, 400, false)).toBe('center')
  })
})

describe('focusAfterClose', () => {
  it('moves to the split that takes the closed one\'s place, or the one before', () => {
    expect(focusAfterClose([1, 2, 3], 2, 2)).toBe(3)
    expect(focusAfterClose([1, 2, 3], 3, 3)).toBe(2)
    expect(focusAfterClose([1, 2, 3], 1, 1)).toBe(2)
  })
  it('keeps focus when another split closes', () => {
    expect(focusAfterClose([1, 2, 3], 1, 3)).toBe(3)
  })
})

describe('readDrag', () => {
  it('accepts tree and tab drags only', () => {
    expect(readDrag('{"path":"a.ts","from":null}')).toEqual({ path: 'a.ts', from: null })
    expect(readDrag('{"path":"a.ts","from":2}')).toEqual({ path: 'a.ts', from: 2 })
    expect(readDrag('{"path":"","from":null}')).toBeNull()
    expect(readDrag('{"path":"a.ts","from":"x"}')).toBeNull()
    expect(readDrag('nope')).toBeNull()
  })
})
