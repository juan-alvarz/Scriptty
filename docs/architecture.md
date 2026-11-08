# Scriptty architecture

Scriptty is a desktop scratchpad that runs TypeScript and JavaScript as you type and shows each line's result beside it.

Status: architecture decided (decisions 1 to 17). Scaffold runs end to end. UI mocks were removed; they live in git history at commit `42ffcb3` under `design/`.

## Implementation status

Done (scaffold, 2026-11-06):
- Runner: warm spare bun process, freeze watchdog, stdio JSON lines (`src/main/runner.ts`, `resources/runner/host.ts`).
- Instrumentation with `oxc-parser` + `magic-string` (`src/main/instrument.ts`).
- Graphite window: Svelte 5 shell, Monaco editor, results gutter, status bar (`src/renderer/src/`).
- electron-builder config. An unsigned macOS arm64 `--dir` build was run and tested.
- Tests: `pnpm test` covers instrumentation and a real bun run (values, logs, errors, freeze).

Done (files, packages, settings, 2026-11-06):
- Scratches are real files in `~/Documents/Scriptty` (decision 14), with folders, a file tree, inline rename, a native context menu (New File, New Folder, Rename, Move to Trash, Reveal), and autosave 400 ms after typing.
- Packages panel: add with `bun add`, remove with `bun remove`, in the shared environment. Installed packages' `.d.ts` files and a bundled `@types/node` are loaded into Monaco, so imports autocomplete and type-check.
- Click any result to open the full output for that line (pretty-printed with `Bun.inspect`, every call, Copy).
- Settings (⌘/Ctrl + ,): appearance, font size, tab size, vim mode (`monaco-vim`), run as you type, run delay, freeze timeout. Stored in `userData/settings.json`.

Done (layout, bundle, imports, 2026-11-07):
- Panels fit the window at any zoom level: Monaco sits in an absolutely positioned host so its size never feeds back into the grid.
- Sidebar collapses (toolbar button, ⌘/Ctrl + B). Sidebar and results column resize by dragging their edge (arrow keys when focused, double-click to reset). Widths persist.
- Bundle tab next to Results: `bun build` output for the current file (TS stripped, relative imports inlined), with Minify and Include packages options and Copy.
- Package details on click: import line (Copy, Add to file), version, license, types, npm/homepage/repository links, dependencies, README, Remove.
- Imports between scratches run and type-check: relative specifiers are rewritten to absolute paths during instrumentation, bun gets `NODE_PATH` for the shared packages, runs start in the scratch's own folder, and every workspace file is a Monaco model.
- Tabs for open files in the editor column header: tree clicks open or focus a tab (new tabs go right after the current one), × / middle-click / ⌘W close, Ctrl+Tab and Ctrl+Shift+Tab cycle, cursor and scroll are kept per tab, tabs follow renames and deletes, and open tabs are restored on launch (`openFiles` in settings).
- The sidebar toggle sits inside the window-drag strips (sidebar top or toolbar, always 80px from the edge on macOS). Electron applies `-webkit-app-region` in document order, so a no-drag element placed before a drag region loses; keep clickable things inside the drag container.
- The runner starts bun with `--no-install`, so a missing package fails at once instead of bun fetching it from npm (this caused "stopped responding" while typing an import).

Done (stop, 2026-11-07):
- Stop a run that keeps going (servers, intervals): Run > Stop (⌘. on macOS, Ctrl+. elsewhere) or the toolbar's Stop button, shown while the status is "Running". `Runner.stop()` kills the active bun process, emits `done` with `stopped: true` and keeps the warm spare, so the next edit runs at once. The status bar then shows "Stopped" until the next run (decision 17).

Done (missing packages, 2026-11-07):
- When a scratch imports a package that is not installed, a slim banner above the editor and results says "`lodash` isn't installed — Add · Add all (n)". Adding shows progress in the banner, reloads editor types, refreshes the Packages panel and runs again. × dismisses it for that file (a package that goes missing later shows again).
- The import line gets a Monaco quick fix, "Install 'lodash'" (plus "Install all missing packages" when there are several), which installs through the same banner (`src/renderer/src/missing.ts`).
- Main checks the run's bare imports against `packages/node_modules/<name>` (`src/main/missing.ts`, decision 18) and returns `missing` on the run response. `lodash/fp` counts as `lodash`, `@scope/pkg/sub` as `@scope/pkg`; `node:*`, `bun:*`, `bun` and bare node builtins (`fs`, `path`, from `module.builtinModules`) are skipped.

Done (runtime error markers, 2026-11-07):
- Thrown errors and rejections get a red squiggle on their line (Monaco marker, owner `scriptty-runtime`), spanning the line's first to last non-whitespace character, with the error and its scratch stack frames in the hover. They also show in the overview ruler, which is now on with one lane (TS diagnostics show there too). Logic is in `src/renderer/src/markers.ts` (pure, tested); see decision 19.
- Markers live on the model that ran: a new run's first event clears that file's markers (like the results gutter), and each tab keeps the markers of its own last run. Errors on line 0 and repeats of the same error on a line get no extra marker.

Done (snippets, 2026-11-07):
- User snippets in VS Code's format (decision 20): type a prefix such as `clg` and accept the suggestion (Tab or Enter) to get `console.log($1)` with the cursor inside. Tab stops, placeholders, choices and `$0` come from Monaco's snippet engine.
- Stored in `userData/snippets.json` (`src/main/snippets.ts`), seeded once with a short starter set (`clg`, `con`, `afn`, `imp`, `tryc`) that doubles as examples. The file is JSONC (comments, trailing commas); a file that does not parse is reported in Settings and the last good snippets stay active. Edits from another editor are picked up by polling the file every second.
- Settings > Snippets: list, add, edit, delete (second click confirms), syntax help, Open snippets file, Show in Finder, Restore starter snippets (puts the starter ones back, keeps the user's own).
- One completion provider for TS and JS (`src/renderer/src/monaco.ts`); the snippet → suggestion conversion is plain TS in `src/renderer/src/snippets.ts` with unit tests.

Done (quick open, 2026-11-08):
- ⌘/Ctrl + P (File > Go to File…) opens a fuzzy file switcher over every scratch in the tree (`QuickOpen.svelte`, a native `<dialog>`). With no query, files shown most recently come first and the previous file is preselected, so ⌘P Enter switches back. Up/Down, Enter, Esc and mouse work. File names are bold, folders dimmed, matched characters highlighted.
- The matcher is `src/renderer/src/fuzzy.ts` (decision 21), unit-tested in `fuzzy.test.ts`. The shortcut is caught by a window capture listener, so Monaco and vim mode (where Ctrl+P is a motion) never swallow it.

Done (README rendering, 2026-11-08):
- Package READMEs render as Markdown (`src/renderer/src/markdown.ts`, decision 22): headings, code blocks colored with Monaco's tokenizers and scrolling sideways, tables, quotes, lists, task lists, `<details>`, in light and dark.
- Links open in the browser (https only); `#anchor` links scroll to the heading; relative links resolve against the GitHub or GitLab repository and are dropped for other hosts. Images show as their alt text, linked to the image.
- Main refuses navigation away from the app page and `window.open` (`will-navigate`, `setWindowOpenHandler`), as a second guard behind the click handler.

Not done yet:
- Snippets: saving from Settings rewrites `snippets.json` and drops the user's own comments (the explanatory header is rewritten). Monaco's standalone build has no `tabCompletion` (prefix + Tab without the suggestion list), so the list must be open. Snippet variables (`$TM_FILENAME`, `$CLIPBOARD` …) resolve only as far as Monaco's standalone resolvers go.
- `import.meta.dir` / `__dirname` in a scratch point at the packages folder's `.runs`, not the scratch (the working directory is right).
- Tabs cannot be reordered by dragging yet.
- Quick open's recent-files order lives in memory only (lost on restart), and files added outside the app appear only after the tree refreshes.
- `Bun.*` globals have no editor types (add `bun-types` the same way as `@types/node`).
- Auto-update wiring, signing.
- Windows build not run yet (menu accelerators with the hidden title bar need checking there). CI not set up.
- The native context menu and ⌘, accelerator were checked by hand only; automated tests cover the main-process logic.
- Missing-package check only sees static top-level `import` declarations (what `instrument()` collects), not `export … from`, `import()` or `require()`. The banner and quick fix are not covered by automated UI tests.
- Runtime error markers span the whole line, not the thrown expression: the stack's column points into the instrumented code (inserted `__r(` text shifts it). A small column map from `instrument` would fix it.
- Events that arrive between switching tabs and the new run's reply can land on the new tab's model (the results gutter has the same race); the new run's first event clears them.

Size of the unpacked macOS app: about 383 MB (Electron 253 MB, bun 96 MB, app 26 MB, mostly Monaco).

## Decisions

| # | Decision | Why | Date |
|---|----------|-----|------|
| 1 | Build with **Electron** | Ships Node, which is the runtime we need for user code and packages. One codebase for macOS and Windows. | 2026-11-06 |
| 2 | Target **macOS and Windows** | Electron code is shared. Each OS still needs its own build, signing and testing (see below). | 2026-11-06 |
| 3 | UI direction is **Graphite** | Native-feeling, results in a right gutter aligned to each line. Mock: `design/scriptty-graphite.html` at commit `42ffcb3`. Other directions: `design/scriptty-directions.html` at commit `42ffcb3`. | 2026-11-06 |
| 4 | Stay **package-manager agnostic** for the user | The user never installs or picks a package manager, and the UI says "Packages". Internally we use one bundled tool (decision 9). | 2026-11-06 |
| 5 | Keep v1 **simple** | Settings has General, Editor, Runtime. The "Account & team" placeholder was removed on 2026-11-07; team features come later without a reserved tab. | 2026-11-06 |
| 6 | **Rust where it pays off** | Use Rust tools (oxc) for the hot path. Write our own Rust only when profiling proves a need. See "Rust candidates". | 2026-11-06 |
| 7 | Editor is **Monaco** | Built-in TS language service (autocomplete, hover types, errors) and VS Code familiarity. Its weight matters little in Electron since it loads from disk. CodeMirror 6 was the lighter alternative. | 2026-11-06 |
| 8 | UI is **Svelte 5 + Vite + Bits UI** (no SvelteKit) | Least code for settings, lists and forms. Signals for state. Scoped CSS fits Graphite's design tokens. Bits UI gives accessible dialogs, tabs, menus, switches. React was the alternative (bigger ecosystem, more boilerplate). Compared against Preact, Solid and vanilla TS. | 2026-11-06 |
| 9 | Packages: **one shared environment** for all scratches, installed with a **bundled `bun install`** | Same npm registry and a normal `node_modules`, so packages behave as with npm. Fastest installer with a global cache. Bundled and pinned so users need nothing installed; the UI never names the tool. pnpm was the runner-up (smaller to bundle). | 2026-11-06 |
| 10 | Runner is a **warm spare process on bundled bun** | A fresh, pre-booted bun process per run: clean like a new process, near-instant like a warm one. Bun is already bundled (decision 9), starts fast and runs TS natively. Node stays a later Settings option behind the runtime interface. | 2026-11-06 |
| 11 | Timeout is a **freeze watchdog**, not a total run time | Kill only when the runner stops sending heartbeats (blocked event loop). Servers, intervals and slow network code keep running until the next edit replaces them. | 2026-11-06 |
| 12 | Instrumentation uses **`oxc-parser` + `magic-string`** | Fastest parser, ESTree AST in JS, no Wasm plugin versioning. Bun runs TS natively, so we only parse and wrap, never compile. swc was the alternative. | 2026-11-06 |
| 13 | Packaging and updates with **electron-builder** + `electron-updater` | Default for electron-vite. NSIS installer on Windows. Differential updates keep downloads small despite the bundled bun. Updates from any host (GitHub Releases, S3/R2, HTTP). Electron Forge was the alternative. | 2026-11-06 |
| 14 | Scratches live in **`~/Documents/Scriptty`** as plain files and folders | Users can see, back up and version them with any tool. Only script files (`.ts`, `.js`, `.mts`, `.mjs`, `.cts`, `.cjs`) show in the tree. Deletes go to the system Trash. | 2026-11-06 |
| 15 | Vim mode via **`monaco-vim`**; dialogs via native **`<dialog>`** | `monaco-vim` is the maintained Monaco binding. Native `<dialog>` gives modal focus trapping and Esc for free, so Bits UI waits until a primitive HTML lacks (menus, comboboxes). | 2026-11-06 |
| 16 | App icon is **Wink, close-up** | A cat head, because Scriptty ends in “tty” (kitty). The prompt chevron is a winking eye and the cobalt result dot is the open one, so it keeps the earlier chevron-and-dot mark. The head is cropped by the bottom edge so the face stays readable at 16 and 32 px. Sources are `build/icon.svg` (macOS grid: 824 px body on 1024, with shadow) and `build/icon-win.svg` (full bleed, no shadow); `pnpm icons` builds the `.icns`, `.ico` and the `.png` used for the Dock in dev. electron-builder picks them up from `build/` by default. | 2026-11-07 |
| 17 | **Stop** kills the active run; ⌘. / Ctrl+. is taken from Monaco's Quick Fix | Servers and intervals otherwise run until the next edit. Killing the process (not clearing timers in the host) is the only stop that always works, and the warm spare keeps the next run instant. The runner cannot tell an idle server from finished code, so the status goes back to "Running" (and Stop shows) when a run sends output after its `done`; an idle server can still be stopped with the shortcut. ⌘. is the macOS cancel key, so the editor rebinds it from Quick Fix (still on the lightbulb) to Stop. | 2026-11-07 |
| 18 | **Main decides which imports are missing**, after instrumenting and before the run; the run still starts | Main knows the packages folder and node's builtin list, so the renderer never guesses. A check is one `existsSync` per bare import, cheap enough for every run. The run is not blocked, so the rest of the scratch's results and bun's own error still show. The editor quick fix is offered only for names main reported, so it never offers to install `fs` while types are loading. | 2026-11-07 |
| 19 | Runtime errors are **Monaco markers on thrown errors only** | Markers give squiggles, hover and the overview ruler for free and are kept per model, so tabs need no bookkeeping. The runner flags thrown errors and rejections with `thrown: true` on the result event; `console.error` output is a log the user chose to write, so it stays in the results gutter without a squiggle. Hand-made decorations would duplicate what markers already render. | 2026-11-07 |
| 20 | **User snippets in VS Code's JSON format**, one file in `userData` | Users can paste snippets from VS Code (prefix and body as a string or array, `scope`, tab stops, placeholders, choices) and edit the file by hand; Settings covers the common cases. Main owns the file and rejects edits while it does not parse, so a typo never costs the user their snippets. One global file instead of per-language files keeps v1 simple (decision 5); `scope` still limits a snippet to TS or JS. Snippet suggestions sort inline by match quality (Monaco's default), and win ties with TS suggestions. | 2026-11-07 |
| 21 | Quick open uses an **in-house fuzzy matcher** | A small dynamic program (about 150 lines, no dependency) picks the best placement of the query: points per matched char, bonuses for consecutive chars and word, camelCase and path-segment starts, a cost per skipped char, and a bonus when the whole query fits in the file name, so name matches beat folder matches. Workspaces are small, so scoring every path per keystroke is cheap. fzf-style libraries (`fzf`, `fuse.js`) were the alternative; they add weight and rank folders and names alike. | 2026-11-08 |
| 22 | READMEs render with **`marked` + `DOMPurify`**, and **remote images stay blocked** | READMEs are untrusted HTML. DOMPurify is the maintained browser sanitizer and works in the sandboxed renderer; we allowlist tags and attributes (no `style`, `class`, `id`, forms, iframes, SVG), then on an inert `DOMParser` copy keep only https URLs (http upgraded, relative ones resolved against GitHub/GitLab) and turn images into alt-text chips. Together about 80 KB minified. The CSP keeps `img-src 'self' data:`: allowing `https:` would let any README make the app fetch from any host (tracking pixels, IP leaks) for mostly badges. A small image proxy in main could lift this later. Inline handlers in a README make Chromium log a CSP error while parsing; nothing runs. | 2026-11-08 |

## Electron on macOS and Windows

Electron gives one codebase. It does not give one binary.

- **Same for both:** all app code (UI, runner, settings, package handling).
- **Per OS:** a separate build (`.dmg` for macOS, `.exe`/`.msi` installer for Windows), code signing, an auto-update feed, and testing.
- **Signing costs:**
  - macOS: Apple Developer ID ($99 a year) plus notarization, or Gatekeeper blocks the app.
  - Windows: a code-signing certificate, or SmartScreen warns users.
- **Small platform differences in the UI:**
  - Title bar: `titleBarStyle: 'hiddenInset'` with traffic lights on macOS. `titleBarOverlay` with Windows' own controls on the right.
  - Sidebar material: `vibrancy: 'sidebar'` on macOS. `backgroundMaterial: 'mica'` on Windows 11.
  - Shortcuts: `CmdOrCtrl` accelerators.

Plan: build and test both OSes in CI from the first commit. Releasing on both at the same time only depends on having both signing setups ready.

## Process model

```
┌──────────────────────────┐   IPC (typed)   ┌──────────────────────────┐
│ Renderer (UI)            │ ◀─────────────▶ │ Main process             │
│ editor, results gutter,  │                 │ windows, menus, settings,│
│ settings. No Node access │                 │ files, package installs  │
└──────────────────────────┘                 └────────────┬─────────────┘
                                                          │ stdio, JSON lines
                                             ┌────────────▼─────────────┐
                                             │ Runner (bun child proc.) │
                                             │ active run + 1 warm spare│
                                             │ executes instrumented code│
                                             └──────────────────────────┘
```

Rules:
- User code **never** runs in the renderer or main process.
- The renderer has `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. It talks to main only through a small preload API.
- A freeze watchdog (Settings > Runtime) kills a runner that stops sending heartbeats. This handles `while (true) {}`. See decision 11.

## Architecture options for the runner

### Option A: fresh process per run
Spawn a new `utilityProcess` for every run, kill it after.
- Pro: simplest. Perfect isolation, no leaked state between runs.
- Con: about 50 to 150 ms startup per run. Fine with the typing debounce, noticeable on heavy imports.

### Option B: warm runner, restart on timeout (recommended)
Keep one runner process per scratch alive. Each run executes in a fresh `vm` context (or a `worker_threads` Worker) inside it. Kill and respawn only on timeout or crash.
- Pro: near-instant runs. Imported packages stay cached, so `import` of a large package does not cost every keystroke.
- Con: must reset globals between runs. A bug in user code can still leak state until restart.

### Option C: runtime of the user's choice
Like B, but the runner can be the bundled Electron Node or an external binary the user picks (Node, Bun, Deno) in Settings > Runtime.
- Pro: matches the user's real project environment.
- Con: more testing, version differences. Good as a later setting on top of B, not as the default.

### Option D: warm spare (chosen, decision 10)
Always keep one fresh runner booted and idle. A run takes the spare at once, the previous run's process is killed, and a new spare boots in the background.
- Pro: clean state every run (no leaked timers or globals) with no startup wait.
- Pre-import: while idle, the spare imports the packages the scratch used last run, so heavy imports are already loaded when the run starts.
- Runtime: bundled bun by default. Keep the runner behind a `Runtime` interface so "Run with Node" (option C) can plug in later.
- Protocol: main and runner talk over stdio as JSON lines: `{ type: "run", runId, code }` in; `{ type: "result" | "log" | "error" | "heartbeat" | "done", runId, line, kind, text }` out.

### Freeze watchdog (decision 11)
- The runner sends a heartbeat on a timer. If none arrives for N seconds (Settings > Runtime, "Stop code that freezes for"), main kills it and promotes the spare.
- Code that is only waiting (servers, `setInterval`, network) keeps running until the next edit replaces it or the user presses Stop (decision 17). The status bar shows "Running".

## Run pipeline

1. Renderer sends `{ scratchId, code, lang }` to main after the debounce (Settings > Editor).
2. Main **instruments** the source (decision 12). The scaffold does this on the main thread; move it to a `worker_thread` if large files stall IPC:
   - Parse with `oxc-parser` (TS and JS, ESTree AST with byte offsets).
   - Wrap each top-level expression statement with `magic-string`: `users.length` becomes `__r(10, users.length)`. Rewrite `console.*` calls the same way to tag their line.
   - Only insert text, never add or remove newlines, so line numbers in bun's errors match the editor without a source map. `magic-string` can emit a source map if exact columns are ever needed.
   - No type stripping: the output stays TS and bun runs it natively.
   - The mocks use regex for this only as a demo. The app must use the AST.
3. Runner executes. Each result, `console.*` call and error streams back as `{ runId, line, kind, text }`.
4. Renderer drops messages from stale `runId`s and paints the gutter.

Values are serialized in the runner (depth and length limits) so huge objects never cross IPC whole.

## Packages

Decided (decision 9): one shared environment, installed with a bundled `bun install`.

- **Layout:** one folder in the app data dir (`app.getPath('userData')/packages`) with a `package.json`, `bun.lock` and `node_modules`. Every scratch resolves imports from it. One version of each package for all scratches.
- **Installer:** a pinned `bun` binary shipped per OS and CPU (macOS arm64/x64, Windows x64/arm64). Never use a bun, npm or pnpm the user has installed.
- **Cache:** bun's global cache lives inside the app data dir (`BUN_INSTALL_CACHE_DIR`), so it is isolated from the user's own setup, on the same drive, and Settings can offer "Clear package cache".
- **User-facing agnostic:** the UI says "Add package" and never names bun. All calls go through one `installPackage(name, version)` / `removePackage(name)` module, so the tool can be swapped (pnpm is the fallback).
- **Install scripts:** bun skips dependency `postinstall` scripts unless the package is trusted. Most popular packages are trusted by default. Decide later whether to let the user trust more packages from the Packages panel.
- **Native addons:** user code runs on Electron's Node, so a native addon must use N-API or be rebuilt for Electron's ABI. Pure JS and N-API packages work as is. This is independent of the installer.
- **Cost accepted:** the bun binary adds roughly 50 to 100 MB per platform to the app download.
- **Later:** per-scratch packages. The shared layout can move to per-scratch folders without changing the UI contract.

## Rust candidates

Rule: prefer existing Rust tools shipped as npm packages. Write custom Rust (via `napi-rs`) only when a profile shows a real bottleneck.

| Area | Rust option | Worth it? |
|------|-------------|-----------|
| TS transpile | Not needed | Bun runs TS natively (decision 10). |
| Parsing for instrumentation | `oxc-parser` | Yes, from day one (decision 12). Rust under the hood, no custom code. |
| Line instrumentation rewrite | custom oxc transform via `napi-rs` | Only if profiling shows the JS `magic-string` rewrite is slow on large files. |
| Value serialization of large objects | custom `napi-rs` module | Only if profiling shows it. |
| Package install / resolution | existing tools | No custom Rust. |
| File watching for scratches | `@parcel/watcher` (C++) or `notify` crate | No custom Rust needed. |

## Stack (proposed, not final)

- Electron + electron-vite, TypeScript everywhere.
- UI: Svelte 5 with runes, Bits UI for primitives (decided, see decision 8).
  - Monaco and the results gutter are updated imperatively, outside Svelte's reactivity, because they change on every keystroke.
  - Use Svelte 5 docs only. Svelte 4 tutorials (stores, `export let`) are outdated.
- Editor: Monaco (decided, see decision 7).
  - Results gutter: separate pane aligned with `editor.getTopForLineNumber()` and `onDidScrollChange`. Inline results, if wanted later, via decorations.
  - Package types: load each installed package's `.d.ts` with `monaco.languages.typescript.typescriptDefaults.addExtraLib`.
  - Workers: configure `MonacoEnvironment.getWorker` for the Vite build.
  - Trade-offs accepted: higher memory, slower first open, less freedom to restyle than CodeMirror 6.
- Packaging and updates: electron-builder + `electron-updater` (decided, see decision 13).
  - Targets: macOS `dmg` + `zip` (zip is needed for auto-update), separate arm64 and x64 builds. Windows `nsis`, x64 and arm64.
  - Bundled bun: `extraResources` copies `node_modules/bun/bin/bun.exe` (the binary for the build machine) to `bin/bun` or `bin/bun.exe`. So build each OS and arch on its own CI runner; cross-builds would ship the wrong bun and miss oxc's native binding.
  - `electron-updater` is not installed yet; add it when the update host is chosen.
  - Signing: macOS Developer ID + notarization (`notarize` config). Windows via Azure Trusted Signing (`win.azureSignOptions`) where available, else a classic code-signing certificate.
  - Updates: differential (blockmap) downloads. Host on GitHub Releases or S3/R2.

## Later, not v1

- Account & team: sign in, workspaces, members and roles, shared scratches, shared packages and env. Add as a new Settings section when built.
- Other UI directions from `design/scriptty-directions.html` (commit `42ffcb3`) (Spotlight menu bar panel, Inspector timing bars) as extra modes or themes.
