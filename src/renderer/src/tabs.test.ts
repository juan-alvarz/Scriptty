import { describe, expect, it } from 'vitest'
import { autoScrollStep, dropIndex, gapX, insertionIndex, isNoop, moveTab, stepIndex } from './tabs'

const list = ['a', 'b', 'c', 'd']
// Four 100px tabs starting at x = 10.
const spans = [0, 1, 2, 3].map((i) => ({ left: 10 + i * 100, right: 110 + i * 100 }))

describe('moveTab', () => {
  it('moves forward and backward without touching the input', () => {
    expect(moveTab(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveTab(list, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveTab(list, 1, 1)).toEqual(list)
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })

  it('clamps the target and ignores a bad source', () => {
    expect(moveTab(list, 1, 99)).toEqual(['a', 'c', 'd', 'b'])
    expect(moveTab(list, 2, -5)).toEqual(['c', 'a', 'b', 'd'])
    expect(moveTab(list, -1, 0)).toEqual(list)
    expect(moveTab(list, 4, 0)).toEqual(list)
    expect(moveTab([], 0, 0)).toEqual([])
  })
})

describe('insertionIndex', () => {
  it('splits each tab at its midpoint', () => {
    expect(insertionIndex(0, spans)).toBe(0)
    expect(insertionIndex(59, spans)).toBe(0)
    expect(insertionIndex(60, spans)).toBe(1)
    expect(insertionIndex(250, spans)).toBe(2)
    expect(insertionIndex(359, spans)).toBe(3)
    expect(insertionIndex(360, spans)).toBe(4)
    expect(insertionIndex(9999, spans)).toBe(4)
    expect(insertionIndex(5, [])).toBe(0)
  })
})

describe('dropIndex and isNoop', () => {
  it('turns a gap into the final index of the dragged tab', () => {
    // Dragging "b" (1): gaps 1 and 2 are its own edges.
    expect([0, 1, 2, 3, 4].map((g) => isNoop(1, g))).toEqual([false, true, true, false, false])
    expect(dropIndex(1, 0)).toBe(0)
    expect(dropIndex(1, 3)).toBe(2)
    expect(dropIndex(1, 4)).toBe(3)
    expect(moveTab(list, 1, dropIndex(1, 4))).toEqual(['a', 'c', 'd', 'b'])
    expect(moveTab(list, 3, dropIndex(3, 0))).toEqual(['d', 'a', 'b', 'c'])
    for (let g = 0; g <= 4; g++) if (isNoop(2, g)) expect(moveTab(list, 2, dropIndex(2, g))).toEqual(list)
  })
})

describe('gapX', () => {
  it('uses left edges, then the last right edge', () => {
    expect(gapX(0, spans)).toBe(10)
    expect(gapX(2, spans)).toBe(210)
    expect(gapX(4, spans)).toBe(410)
    expect(gapX(0, [])).toBe(0)
  })
})

describe('autoScrollStep', () => {
  const strip = { left: 100, right: 500 }
  it('scrolls only inside the edge zones, faster deeper in, capped past the edge', () => {
    expect(autoScrollStep(300, strip)).toBe(0)
    expect(autoScrollStep(132, strip)).toBe(0)
    expect(autoScrollStep(131, strip)).toBe(-1)
    expect(autoScrollStep(100, strip)).toBe(-14)
    expect(autoScrollStep(-500, strip)).toBe(-14)
    expect(autoScrollStep(469, strip)).toBe(1)
    expect(autoScrollStep(484, strip)).toBe(7)
    expect(autoScrollStep(900, strip)).toBe(14)
  })
})

describe('stepIndex', () => {
  it('moves one place and stops at the ends', () => {
    expect(stepIndex(4, 1, -1)).toBe(0)
    expect(stepIndex(4, 1, 1)).toBe(2)
    expect(stepIndex(4, 0, -1)).toBe(-1)
    expect(stepIndex(4, 3, 1)).toBe(-1)
    expect(stepIndex(4, -1, 1)).toBe(-1)
  })
})
