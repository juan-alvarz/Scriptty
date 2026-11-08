// "Install 'x'" quick fix on import lines whose package is not installed.
// Main decides what is missing (it knows the builtins and the packages folder); this only finds the import strings.
import type * as Monaco from 'monaco-editor'
import { packageOf } from '../../shared/specifier'

/** A module specifier on one line; columns are 1-based like Monaco's, `end` is exclusive. */
export type SpecifierHit = { spec: string; start: number; end: number }

// `from "x"`, `import "x"`, `import("x")`, `require("x")`, but not `Array.from("x")`. Group 2 is the specifier.
const SPECIFIER = /(?<![\w$.])(?:from|import|require)\s*\(?\s*(['"])([^'"\n]+)\1/g

/** Module specifiers of import, export-from, dynamic import and require on one line of source. */
export function specifiersIn(line: string): SpecifierHit[] {
  const hits: SpecifierHit[] = []
  for (const m of line.matchAll(SPECIFIER)) {
    const start = m.index + m[0].length - m[2].length - 1 // first char inside the quotes
    hits.push({ spec: m[2], start: start + 1, end: start + 1 + m[2].length })
  }
  return hits
}

/** Missing packages imported on `line`, each with the specifier's column range. */
export function missingOn(line: string, missing: ReadonlySet<string>): (SpecifierHit & { name: string })[] {
  const out: (SpecifierHit & { name: string })[] = []
  for (const hit of specifiersIn(line)) {
    const name = packageOf(hit.spec)
    if (name && missing.has(name) && !out.some((o) => o.name === name)) out.push({ ...hit, name })
  }
  return out
}

let missing: ReadonlySet<string> = new Set()

/** Packages the last run reported as missing; the quick fix is only offered for these. */
export function setMissing(names: readonly string[]): void {
  missing = new Set(names)
}

const COMMAND = 'scriptty.installPackage'

/** Window event fired after packages were added outside the Packages panel, so its list refreshes. */
export const PACKAGES_CHANGED = 'scriptty:packages-changed'

/** Registers the quick fix for TS and JS models. `install` does the work (and shows progress in the banner). */
export function registerMissingQuickFix(monaco: typeof Monaco, install: (names: string[]) => void): Monaco.IDisposable {
  const command = monaco.editor.registerCommand(COMMAND, (_accessor, ...names: string[]) => install(names))
  const provider: Monaco.languages.CodeActionProvider = {
    provideCodeActions(model, range, context) {
      const actions: Monaco.languages.CodeAction[] = []
      if (!missing.size) return { actions, dispose() {} }
      const all = new Set<string>()
      for (let ln = range.startLineNumber; ln <= range.endLineNumber; ln++) {
        for (const hit of missingOn(model.getLineContent(ln), missing)) {
          all.add(hit.name)
          if (actions.some((a) => a.command?.arguments?.[0] === hit.name)) continue
          const at = new monaco.Range(ln, hit.start, ln, hit.end)
          actions.push({
            title: `Install '${hit.name}'`,
            kind: 'quickfix',
            isPreferred: true,
            diagnostics: context.markers.filter((m) => monaco.Range.areIntersectingOrTouching(m, at)),
            command: { id: COMMAND, title: `Install '${hit.name}'`, arguments: [hit.name] }
          })
        }
      }
      if (missing.size > 1 && all.size) {
        const names = [...missing]
        actions.push({
          title: `Install all missing packages (${names.length})`,
          kind: 'quickfix',
          command: { id: COMMAND, title: 'Install all missing packages', arguments: names }
        })
      }
      return { actions, dispose() {} }
    }
  }
  const registrations = ['typescript', 'javascript'].map((lang) =>
    monaco.languages.registerCodeActionProvider(lang, provider, { providedCodeActionKinds: ['quickfix'] })
  )
  return { dispose: () => [command, ...registrations].forEach((d) => d.dispose()) }
}
