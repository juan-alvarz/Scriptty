import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'
import { initVimMode, type VimAdapterInstance } from 'monaco-vim'
import type { Snippet, TypeLib } from '../../shared/protocol'
import { toSuggestions } from './snippets'

self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) =>
    label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker()
}

const ts = monaco.typescript
for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
  defaults.setCompilerOptions({
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    allowJs: true,
    // bun lets CommonJS packages be default-imported, so the editor should too.
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    strict: true,
    moduleDetection: 3 // force: every scratch is a module, so top-level await type-checks
  })
  // 7016: package has no type declarations. Untyped packages still run, so don't flag them.
  defaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [7016] })
}

/** Installed packages' .d.ts files, at file:///node_modules/... so TS resolves imports like it would on disk. */
export function setTypeLibs(libs: TypeLib[]): void {
  const extra = libs.map((l) => ({ content: l.content, filePath: l.path }))
  ts.typescriptDefaults.setExtraLibs(extra)
  ts.javascriptDefaults.setExtraLibs(extra)
}

// User snippets (Settings > Snippets). One provider for both languages; it reads the current list on every request.
let snippets: Snippet[] = []
export function setSnippets(list: Snippet[]): void {
  snippets = list
}
monaco.languages.registerCompletionItemProvider(['typescript', 'javascript'], {
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position)
    const lineBefore = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
    const { lineNumber, column } = position
    const suggestions = toSuggestions(snippets, model.getLanguageId(), lineBefore, word.startColumn).map((s) => ({
      ...s,
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: { value: s.documentation },
      range: { startLineNumber: lineNumber, startColumn: s.startColumn, endLineNumber: lineNumber, endColumn: column }
    }))
    return { suggestions }
  }
})

// Graphite syntax colors, same as design/scriptty-graphite.html (git show 42ffcb3).
monaco.editor.defineTheme('graphite-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '9B2F8A' },
    { token: 'string', foreground: '1F7A4D' },
    { token: 'number', foreground: 'B35A00' },
    { token: 'comment', foreground: '9AA0A9', fontStyle: 'italic' },
    { token: 'type.identifier', foreground: '0F7C8C' }
  ],
  colors: {
    'editor.background': '#FBFBFC',
    'editor.lineHighlightBackground': '#F1F3F6',
    'editorLineNumber.foreground': '#B4B9C2',
    'editorLineNumber.activeForeground': '#2F5BEA',
    'editorCursor.foreground': '#2F5BEA',
    'editor.selectionBackground': '#2F5BEA29'
  }
})
monaco.editor.defineTheme('graphite-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'E28AD3' },
    { token: 'string', foreground: '8FD6A6' },
    { token: 'number', foreground: 'F3B26A' },
    { token: 'comment', foreground: '6B717C', fontStyle: 'italic' },
    { token: 'type.identifier', foreground: '6FD0DC' }
  ],
  colors: {
    'editor.background': '#1C1E22',
    'editor.lineHighlightBackground': '#23262B',
    'editorLineNumber.foreground': '#555A63',
    'editorLineNumber.activeForeground': '#9DB3FF',
    'editorCursor.foreground': '#6E8EFF',
    'editor.selectionBackground': '#6E8EFF38'
  }
})

const dark = matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (): void => monaco.editor.setTheme(dark.matches ? 'graphite-dark' : 'graphite-light')
dark.addEventListener('change', applyTheme)

export const FONT_FAMILY = '"SF Mono", Menlo, Consolas, "Courier New", monospace'
export const lineHeightFor = (fontSize: number): number => Math.round(fontSize * 1.54)

export function createEditor(el: HTMLElement): monaco.editor.IStandaloneCodeEditor {
  const editor = monaco.editor.create(el, {
    model: null,
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    lineHeight: lineHeightFor(13),
    minimap: { enabled: false },
    padding: { top: 14 },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    renderLineHighlight: 'line',
    overviewRulerLanes: 0,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
  })
  applyTheme()
  return editor
}

/** Read-only JavaScript view for the Bundle tab. Its model lives outside file:/// so it never joins type-checking. */
export function createViewer(el: HTMLElement): monaco.editor.IStandaloneCodeEditor {
  return monaco.editor.create(el, {
    model: monaco.editor.createModel('', 'javascript', monaco.Uri.parse('inmemory://bundle/output.js')),
    readOnly: true,
    domReadOnly: true,
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    lineHeight: lineHeightFor(12),
    minimap: { enabled: false },
    padding: { top: 10 },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    renderLineHighlight: 'none',
    overviewRulerLanes: 0,
    lineNumbersMinChars: 3,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
  })
}

const uriOf = (rel: string): monaco.Uri => monaco.Uri.file('/' + rel)
export const languageOf = (rel: string): 'javascript' | 'typescript' => (/\.[mc]?js$/i.test(rel) ? 'javascript' : 'typescript')

/** One model per open file, so undo history survives switching files. */
export function modelFor(rel: string, content: string): monaco.editor.ITextModel {
  return monaco.editor.getModel(uriOf(rel)) ?? monaco.editor.createModel(content, languageOf(rel), uriOf(rel))
}

/** Drops cached models at `rel` or inside it (after a rename or delete). */
export function disposeModels(rel: string): void {
  const prefix = uriOf(rel).path
  for (const m of monaco.editor.getModels()) if (m.uri.path === prefix || m.uri.path.startsWith(prefix + '/')) m.dispose()
}

let vim: VimAdapterInstance | null = null
export function setVim(editor: monaco.editor.IStandaloneCodeEditor, on: boolean, status: HTMLElement): void {
  if (on && !vim) vim = initVimMode(editor, status)
  if (!on && vim) {
    vim.dispose()
    vim = null
    status.textContent = ''
  }
}

export { monaco }
