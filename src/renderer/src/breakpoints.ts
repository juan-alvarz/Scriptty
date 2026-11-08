// Breakpoints and the paused-line marker, as Monaco decorations on each file's model. Decorations move with
// the text as lines are added or removed, so a breakpoint stays on its statement while you edit.
import { monaco } from './monaco'
import type { Breakpoints } from '../../shared/protocol'

const STICKY = monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
const BREAKPOINT: monaco.editor.IModelDecorationOptions = {
  glyphMarginClassName: 'bp-glyph',
  glyphMarginHoverMessage: { value: 'Breakpoint (click to remove). Debug runs stop here; live runs ignore it.' },
  stickiness: STICKY
}

/** Workspace-relative path of a scratch model (see `modelFor`). */
const relOf = (model: monaco.editor.ITextModel): string => model.uri.path.replace(/^\//, '')
const modelOf = (rel: string): monaco.editor.ITextModel | null => monaco.editor.getModel(monaco.Uri.file('/' + rel))

const ids = new Map<string, string[]>()

/** Sorted, distinct 1-based lines of a file's breakpoints. */
export function linesOf(rel: string): number[] {
  const model = modelOf(rel)
  if (!model) return []
  const lines = (ids.get(rel) ?? []).map((id) => model.getDecorationRange(id)?.startLineNumber ?? 0).filter((l) => l > 0)
  return [...new Set(lines)].sort((a, b) => a - b)
}

/** Every file's breakpoints, for the start of a debug run. */
export function allBreakpoints(): Breakpoints {
  const out: Breakpoints = {}
  for (const rel of ids.keys()) {
    const lines = linesOf(rel)
    if (lines.length) out[rel] = lines
  }
  return out
}

function set(model: monaco.editor.ITextModel, lines: number[]): void {
  const rel = relOf(model)
  const next = model.deltaDecorations(
    ids.get(rel) ?? [],
    lines.map((l) => ({ range: new monaco.Range(l, 1, l, 1), options: BREAKPOINT }))
  )
  if (next.length) ids.set(rel, next)
  else ids.delete(rel)
}

/** Adds or removes the breakpoint on a line; returns the file's breakpoints after the change. */
export function toggleBreakpoint(model: monaco.editor.ITextModel, line: number): number[] {
  const rel = relOf(model)
  const lines = linesOf(rel)
  set(model, lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line].sort((a, b) => a - b))
  return linesOf(rel)
}

export type BreakpointItem = { rel: string; line: number; text: string }

/** Every breakpoint by file, then line, with its line of code: the Debugger tab's list. */
export function listBreakpoints(): BreakpointItem[] {
  const out: BreakpointItem[] = []
  for (const rel of [...ids.keys()].sort()) {
    const model = modelOf(rel)
    if (model) for (const line of linesOf(rel)) out.push({ rel, line, text: model.getLineContent(line).trim() })
  }
  return out
}

/** Removes one breakpoint; returns the file's breakpoints after the change. */
export function removeBreakpoint(rel: string, line: number): number[] {
  const model = modelOf(rel)
  if (model) set(model, linesOf(rel).filter((l) => l !== line))
  return linesOf(rel)
}

/** Removes every breakpoint; returns the files that had some. */
export function clearBreakpoints(): string[] {
  const files = [...ids.keys()]
  for (const rel of files) {
    const model = modelOf(rel)
    if (model) set(model, [])
    else ids.delete(rel)
  }
  return files
}

/** Glyph margin clicks toggle breakpoints, and a faint dot shows where a click would put one. */
export function attachBreakpointMargin(editor: monaco.editor.IStandaloneCodeEditor, onChange: (rel: string, lines: number[]) => void): monaco.IDisposable {
  const hover = editor.createDecorationsCollection()
  const GLYPH = monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
  const subs = [
    editor.onMouseDown((e) => {
      const model = editor.getModel()
      if (!model || e.target.type !== GLYPH || !e.target.position) return
      hover.clear()
      onChange(relOf(model), toggleBreakpoint(model, e.target.position.lineNumber))
    }),
    editor.onMouseMove((e) => {
      const line = e.target.type === GLYPH ? e.target.position?.lineNumber : undefined
      const model = editor.getModel()
      const has = !!model && !!line && linesOf(relOf(model)).includes(line)
      hover.set(line && !has ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'bp-hover' } }] : [])
    }),
    editor.onMouseLeave(() => hover.clear())
  ]
  return { dispose: () => subs.forEach((s) => s.dispose()) }
}

let paused: { model: monaco.editor.ITextModel; ids: string[] } | null = null

/** Marks the line execution is paused on (`top`), or a caller's line picked in the call stack. Null clears it. */
export function markPaused(at: { rel: string; line: number; top: boolean } | null): void {
  if (paused && !paused.model.isDisposed()) paused.model.deltaDecorations(paused.ids, [])
  paused = null
  const model = at && modelOf(at.rel)
  if (!at || !model) return
  const options: monaco.editor.IModelDecorationOptions = {
    isWholeLine: true,
    className: at.top ? 'dbg-line' : 'dbg-frame',
    glyphMarginClassName: at.top ? 'dbg-arrow' : 'dbg-frame-arrow',
    stickiness: STICKY
  }
  paused = { model, ids: model.deltaDecorations([], [{ range: new monaco.Range(at.line, 1, at.line, 1), options }]) }
}
