// Runtime errors as editor markers: red squiggles, hover text and overview ruler marks.
// Pure on purpose (type-only Monaco import), so it runs under vitest without a DOM.
import type * as monaco from 'monaco-editor'
import type { RunnerEvent } from '../../shared/protocol'

export const RUNTIME_OWNER = 'scriptty-runtime'

type Result = Extract<RunnerEvent, { type: 'result' }>
/** The slice of a Monaco text model this module reads. */
export type LineSource = { getLineCount(): number; getLineContent(line: number): string; isDisposed(): boolean }

/** Only thrown errors and rejections get a marker; `console.error` output stays in the results gutter. */
const isRuntimeError = (r: Result): boolean => r.kind === 'error' && !!r.thrown && r.line > 0
const messageOf = (r: Result): string => r.full ?? r.text
const keyOf = (r: Result): string => `${r.line}\n${messageOf(r)}`

/**
 * One Error marker per distinct thrown error, spanning the line's first to last non-whitespace character.
 * `getLine` returns null for lines the file no longer has (it was edited since the run started).
 */
export function errorsToMarkers(results: Iterable<Result>, getLine: (line: number) => string | null): monaco.editor.IMarkerData[] {
  const markers: monaco.editor.IMarkerData[] = []
  const seen = new Set<string>()
  for (const r of results) {
    if (!isRuntimeError(r)) continue
    // A throwing interval or a loop of rejections reports the same error over and over.
    const key = keyOf(r)
    if (seen.has(key)) continue
    seen.add(key)
    const text = getLine(r.line)
    if (text === null) continue
    const start = text.search(/\S/)
    const end = text.trimEnd().length
    markers.push({
      severity: 8, // monaco.MarkerSeverity.Error (a value import would pull Monaco into this module)
      message: messageOf(r),
      source: 'runtime',
      startLineNumber: r.line,
      startColumn: start < 0 ? 1 : start + 1,
      endLineNumber: r.line,
      endColumn: start < 0 ? text.length + 1 : end + 1
    })
  }
  return markers
}

/**
 * Collects one run's errors and keeps the markers of the model that run belongs to in sync.
 * `apply` is `monaco.editor.setModelMarkers(model, RUNTIME_OWNER, markers)`; markers live per model,
 * so each file keeps the markers of its own last run while another tab is shown.
 */
export function runtimeMarkers<M extends LineSource>(apply: (model: M, markers: monaco.editor.IMarkerData[]) => void) {
  let model: M | null = null
  let errors: Result[] = []
  let seen = new Set<string>()
  return {
    /** A new run of `model` began reporting: drop that model's markers from its previous run. */
    start(next: M | null): void {
      model = next
      errors = []
      seen = new Set()
      if (model && !model.isDisposed()) apply(model, [])
    },
    add(e: RunnerEvent): void {
      if (!model || model.isDisposed() || e.type !== 'result' || !isRuntimeError(e) || seen.has(keyOf(e))) return
      seen.add(keyOf(e))
      errors.push(e)
      const m = model
      apply(m, errorsToMarkers(errors, (n) => (n <= m.getLineCount() ? m.getLineContent(n) : null)))
    }
  }
}
