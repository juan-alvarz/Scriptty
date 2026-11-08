import { describe, expect, it } from 'vitest'
import { errorsToMarkers, runtimeMarkers, type LineSource } from './markers'
import type { RunnerEvent } from '../../shared/protocol'

type Result = Extract<RunnerEvent, { type: 'result' }>
const lines = ['const a = 1', '  null.x  ', '', 'console.error("no")', '\t\t']
const getLine = (n: number): string | null => lines[n - 1] ?? null
const thrown = (line: number, text: string, full?: string): Result => ({ type: 'result', runId: 1, line, kind: 'error', text, full, thrown: true })

describe('errorsToMarkers', () => {
  it('marks a thrown error from the first to the last non-whitespace column, with the stack as message', () => {
    const full = "TypeError: null is not an object (evaluating 'null.x')\n    at line 2"
    expect(errorsToMarkers([thrown(2, 'TypeError: null is not an object', full)], getLine)).toEqual([
      { severity: 8, message: full, source: 'runtime', startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 9 }
    ])
  })

  it('falls back to the one-line text when there is no full form', () => {
    expect(errorsToMarkers([thrown(1, 'Error: boom')], getLine)[0]).toMatchObject({ message: 'Error: boom', startColumn: 1, endColumn: 12 })
  })

  it('skips console.error output, values, line 0 errors and lines the file no longer has', () => {
    const results: Result[] = [
      { type: 'result', runId: 1, line: 4, kind: 'error', text: '"no"' },
      { type: 'result', runId: 1, line: 1, kind: 'value', text: '1' },
      thrown(0, 'Stopped: the code stopped responding for 5s'),
      thrown(99, 'Error: gone')
    ]
    expect(errorsToMarkers(results, getLine)).toEqual([])
  })

  it('marks the whole line when it is blank, and drops repeats of the same error', () => {
    const markers = errorsToMarkers([thrown(5, 'Error: x'), thrown(5, 'Error: x'), thrown(3, 'Error: y')], getLine)
    expect(markers.map((m) => [m.startLineNumber, m.startColumn, m.endColumn])).toEqual([
      [5, 1, 3],
      [3, 1, 1]
    ])
  })
})

describe('runtimeMarkers', () => {
  const model = (name: string, disposed = false): LineSource & { name: string } => ({
    name,
    getLineCount: () => lines.length,
    getLineContent: (n) => lines[n - 1],
    isDisposed: () => disposed
  })

  it('clears the model on start and keeps each run’s markers on the model that ran', () => {
    const calls: [string, number[]][] = []
    const m = runtimeMarkers<ReturnType<typeof model>>((md, ms) => calls.push([md.name, ms.map((x) => x.startLineNumber!)]))
    const a = model('a')
    m.start(a)
    m.add(thrown(1, 'Error: one'))
    m.add({ type: 'result', runId: 1, line: 4, kind: 'error', text: '"no"' })
    m.add(thrown(2, 'Error: two'))
    m.add(thrown(2, 'Error: two'))
    m.add({ type: 'done', runId: 1, ms: 1 })
    m.start(model('b'))
    m.add(thrown(1, 'Error: b'))
    expect(calls).toEqual([
      ['a', []],
      ['a', [1]],
      ['a', [1, 2]],
      ['b', []],
      ['b', [1]]
    ])
  })

  it('does nothing without a model or once the model is disposed', () => {
    const calls: unknown[] = []
    const m = runtimeMarkers<LineSource>((...args) => calls.push(args))
    m.start(null)
    m.add(thrown(1, 'Error: x'))
    m.start(model('gone', true))
    m.add(thrown(1, 'Error: x'))
    expect(calls).toEqual([])
  })
})
