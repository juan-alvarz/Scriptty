import { describe, expect, it } from 'vitest'
import { match, matchPath, rank, segments } from './fuzzy'

const paths = (q: string, list: string[], recent: string[] = []): string[] => rank(q, list, recent).map((h) => h.path)

describe('fuzzy match', () => {
  it('matches subsequences case-insensitively and rejects the rest', () => {
    expect(match('fbr', 'fooBar.ts')).not.toBeNull()
    expect(match('FOO', 'foo.ts')).not.toBeNull()
    expect(match('rab', 'fooBar.ts')).toBeNull()
    expect(match('foo.tsx', 'foo.ts')).toBeNull()
    expect(match('', 'foo.ts')).toEqual({ score: 0, ranges: [] })
  })

  it('ignores spaces and accepts backslashes as separators', () => {
    expect(match('foo bar', 'foobar.ts')).not.toBeNull()
    expect(matchPath('utils\\x', 'utils/x.ts')).not.toBeNull()
  })

  it('returns merged ranges for consecutive chars', () => {
    expect(match('foo', 'foo.ts')!.ranges).toEqual([[0, 3]])
    expect(match('fb', 'fooBar.ts')!.ranges).toEqual([[0, 1], [3, 4]])
  })

  it('places the query where it scores best, not where it first fits', () => {
    // Greedy would take the first "a" and "p"; the contiguous "app" later scores higher.
    expect(match('app', 'a-p-x/app.ts')!.ranges).toEqual([[6, 9]])
  })

  it('prefers consecutive chars over scattered ones', () => {
    expect(match('abc', 'abc.ts')!.score).toBeGreaterThan(match('abc', 'axbxc.ts')!.score)
    expect(paths('abc', ['a-b-c.ts', 'abc.ts'])).toEqual(['abc.ts', 'a-b-c.ts'])
  })

  it('rewards word, camelCase and segment starts', () => {
    expect(paths('ap', ['map.ts', 'app.ts'])).toEqual(['app.ts', 'map.ts'])
    expect(paths('uc', ['much.ts', 'userController.ts'])).toEqual(['userController.ts', 'much.ts'])
    expect(paths('uc', ['much.ts', 'user-controller.ts'])).toEqual(['user-controller.ts', 'much.ts'])
    expect(match('sm', 'src/main.ts')!.ranges).toEqual([[0, 1], [4, 5]])
  })

  it('ranks file-name matches above folder matches', () => {
    expect(paths('ut', ['utils/x.ts', 'lib/out.ts'])).toEqual(['lib/out.ts', 'utils/x.ts'])
    expect(paths('main', ['main/helpers.ts', 'src/main.ts'])).toEqual(['src/main.ts', 'main/helpers.ts'])
  })

  it('gives path ranges in whole-path coordinates', () => {
    expect(matchPath('main', 'src/main.ts')!.ranges).toEqual([[4, 8]])
    // Spans folder and file name when the name alone cannot match.
    expect(matchPath('srcmain', 'src/main.ts')!.ranges).toEqual([[0, 3], [4, 8]])
    expect(matchPath('s/m', 'src/main.ts')!.ranges).toEqual([[0, 1], [3, 5]])
  })

  it('breaks ties by recency, then shorter path, then name', () => {
    expect(paths('a', ['b/a.ts', 'c/a.ts'], ['c/a.ts'])).toEqual(['c/a.ts', 'b/a.ts'])
    expect(paths('a', ['dd/a.ts', 'd/a.ts'])).toEqual(['d/a.ts', 'dd/a.ts'])
    expect(paths('a', ['y/a.ts', 'x/a.ts'])).toEqual(['x/a.ts', 'y/a.ts'])
  })
})

describe('rank with an empty query', () => {
  it('lists recent files first in order, then the rest alphabetically, skipping unknown recents', () => {
    const list = ['z.ts', 'a.ts', 'm/b.ts', 'c.ts']
    expect(paths('', list, ['c.ts', 'gone.ts', 'm/b.ts', 'c.ts'])).toEqual(['c.ts', 'm/b.ts', 'a.ts', 'z.ts'])
    expect(paths('  ', list)).toEqual(['a.ts', 'c.ts', 'm/b.ts', 'z.ts'])
  })
})

describe('segments', () => {
  it('splits text into plain and highlighted pieces', () => {
    expect(segments('fooBar.ts', [[0, 1], [3, 4]])).toEqual([
      { text: 'f', hit: true },
      { text: 'oo', hit: false },
      { text: 'B', hit: true },
      { text: 'ar.ts', hit: false }
    ])
    expect(segments('abc', [])).toEqual([{ text: 'abc', hit: false }])
  })

  it('clips whole-path ranges to a slice', () => {
    const path = 'src/main.ts'
    const { ranges } = matchPath('srcmain', path)!
    expect(segments(path.slice(4), ranges, 4)).toEqual([
      { text: 'main', hit: true },
      { text: '.ts', hit: false }
    ])
    expect(segments(path.slice(0, 3), ranges, 0)).toEqual([{ text: 'src', hit: true }])
  })
})
