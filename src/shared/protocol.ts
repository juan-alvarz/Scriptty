// Messages between main and the bun runner (JSON lines), and types shared with the renderer.

export type ResultKind = 'value' | 'log' | 'warn' | 'error'

/** Line 0 means "not tied to a line" (stdout from packages, a frozen runner, a crash). */
export type RunnerEvent =
  /**
   * `text` is one line for the gutter; `full` is the pretty, multi-line form for the detail panel.
   * `thrown` marks errors that were thrown or rejected, as opposed to `console.error` output.
   */
  | { type: 'result'; runId: number; line: number; kind: ResultKind; text: string; full?: string; thrown?: true }
  /** `stopped`: ended by the user (Stop), not by the code finishing. */
  | { type: 'done'; runId: number; ms: number; stopped?: boolean }

export type ToRunner =
  /** `dir` is the scratch's own folder: the run's working directory. */
  | { type: 'run'; runId: number; file: string; dir: string }
  | { type: 'preload'; modules: string[]; cwd: string }

export type FromRunner = RunnerEvent | { type: 'hb' }

/** `missing`: packages the scratch imports that are not in the shared environment (the run still starts). */
export type RunResponse = { ok: true; runId: number; missing: string[] } | { ok: false; error: string; line: number }

/** Marks protocol lines on the runner's stdout, so stray prints from user code or packages are told apart. */
export const MARK = '\u0001scriptty\u0001'

export type Settings = {
  appearance: 'system' | 'light' | 'dark'
  fontSize: number
  tabSize: number
  vim: boolean
  autoRun: boolean
  runDelayMs: number
  freezeSeconds: number
  /** Workspace-relative path of the last open file. */
  lastFile: string
  /** Workspace-relative paths of open tabs, in order. */
  openFiles: string[]
  sidebarHidden: boolean
  sidebarWidth: number
  resultsWidth: number
}

export const DEFAULT_SETTINGS: Settings = {
  appearance: 'system',
  fontSize: 13,
  tabSize: 2,
  vim: false,
  autoRun: true,
  runDelayMs: 260,
  freezeSeconds: 5,
  lastFile: 'scratch.ts',
  openFiles: [],
  sidebarHidden: false,
  sidebarWidth: 220,
  resultsWidth: 420
}

/** Paths are workspace-relative with forward slashes. */
export type TreeNode = { name: string; path: string; kind: 'file' | 'folder'; children?: TreeNode[] }

export type TreeAction = 'new-file' | 'new-folder' | 'rename' | 'trash' | 'reveal'

export type MenuAction = 'settings' | 'new-file' | 'new-folder' | 'toggle-sidebar' | 'search' | 'close-tab' | 'next-tab' | 'prev-tab' | 'stop' | 'quick-open'

export type SearchOptions = { regex: boolean; caseSensitive: boolean; wholeWord: boolean }

/** One hit. `line` and `col` are 1-based (Monaco positions); `preview` is the line trimmed around the match, which starts at `previewStart`. */
export type SearchMatch = { path: string; line: number; col: number; length: number; preview: string; previewStart: number }

/** An invalid regex is `ok: false`, never a thrown error. `truncated` means a cap in SEARCH_LIMITS was hit. */
export type SearchResult = { ok: true; matches: SearchMatch[]; truncated: boolean } | { ok: false; error: string }

export type PackageInfo = { name: string; version: string }

/** Installed packages, and the @types packages that type them (kept apart in the panel). */
export type PackageList = { packages: PackageInfo[]; typeLibraries: PackageInfo[] }

/** After an add: `typesPackage` is the @types package worth offering, or null when the package has types or none exist. */
export type Added = { name: string; typesPackage: string | null }

export type PackageDetails = PackageInfo & {
  description: string
  license: string
  /** Links are https URLs or empty. */
  homepage: string
  repository: string
  npm: string
  dependencies: string[]
  types: 'bundled' | '@types' | 'none'
  /** Suggested import line, e.g. `import axios from "axios"`. */
  importLine: string
  readme: string
}

export type TypeLib = { path: string; content: string }

export type BundleOptions = { minify: boolean; inlinePackages: boolean }

/** Pane width limits in px, shared by the settings validator and the resize handles. */
export const WIDTH_LIMITS = { sidebar: [160, 480], results: [200, 1600] } as const

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

/**
 * A user snippet, normalized from VS Code's snippet JSON. `name` is the entry's key in the file.
 * `body` uses VS Code snippet syntax: `$1`, `${1:placeholder}`, `${1|a,b|}`, `$0`.
 */
export type Snippet = { name: string; prefix: string[]; body: string; description: string; scope?: string }

/** `error` is set when the file could not be read; `snippets` then holds the last good set. */
export type SnippetsState = { snippets: Snippet[]; error: string; file: string }
