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

Done (debugger, 2026-11-08):
- Debug runs (decision 17): a **Debug** button in the toolbar (F5 or ⌘/Ctrl+Shift+D), separate from the live run. Live as-you-type runs are unchanged and never pause; breakpoints only take effect in a Debug run.
- Breakpoints: click the editor's glyph margin (red dot; a faint dot previews the spot) or press F9 on the cursor line, at any time. They are Monaco decorations, so they follow their line while you edit, and changes reach a running debug session at once. Breakpoints in scratches the file imports work too.
- When a debug run stops at a breakpoint or a `debugger;` statement, the line is highlighted (opening the file if it is another scratch) and a Debug panel docks under the results: call stack (click a frame to show its line and variables) and scopes (Local, Closure, Module) with expandable objects, arrays, maps and sets. Continue (F8, or F5 while paused), Step Over (F10), Step Into (F11), Step Out (⇧F11), Stop (⇧F5). The same items are in a Debug menu.
- Results and logs still stream to the gutter during a debug run. While paused, live runs wait; Stop (or the run's process ending) hands back to live runs with the current text. Editing while the debug run is not paused replaces it with a live run, like any run.
- Tests spawn real bun with the inspector: breakpoint with locals, step over/out, `debugger;` with object expansion, scope grouping, Step Into past the instrumentation wrappers, breakpoints in an imported file and while running, the watchdog leaving a paused run alone, and Stop.

Not done yet:
- Debugger: breakpoints are not saved across restarts; no conditional breakpoints, watch expressions or console while paused; no pause-on-exceptions (the host catches every error, so "uncaught" never fires). A busy loop cannot be paused: bun answers the inspector on the JS thread, so the freeze watchdog still ends it. After the top level finishes, a debug run stays attached (for timers and callbacks) until Stop or an edit.
- `import.meta.dir` / `__dirname` in a scratch point at the packages folder's `.runs`, not the scratch (the working directory is right).
- README in package details is plain text, not rendered Markdown.
- Tabs cannot be reordered by dragging yet.
- `Bun.*` globals have no editor types (add `bun-types` the same way as `@types/node`).
- Auto-update wiring, signing.
- Windows build not run yet (menu accelerators with the hidden title bar need checking there). CI not set up.
- The native context menu and ⌘, accelerator were checked by hand only; automated tests cover the main-process logic.

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
| 17 | Debugger: a **Debug run is its own bun process with the inspector**, driven from main over WebSocket | Bun ships a WebKit Inspector Protocol server (`--inspect=127.0.0.1:0/<random path>`); main connects with Node's global `WebSocket`, so no dependency. Live runs keep the warm spare without an inspector, so they never pause and stay as fast as before. Bun reprints every file it loads (comments, blank lines and types go), so lines go through the inline source map it reports; our instrumentation keeps editor lines, so mapping back lands on editor lines. Breakpoints are set from a gate: the debug entry imports a one-line `debugger;` module first, which runs only after the whole import graph is parsed, so every file's map is known and breakpoints are placed by script id before any user code runs. JavaScriptCore reports a module's own scope as empty, so the Module scope evaluates the file's top-level names (from the oxc AST) in the paused frame. Everything outside the workspace (host wrappers, packages) is blackboxed so Step Into skips it. The freeze watchdog is held while paused. A Node-based runner (CDP) was the alternative; it would mean a second runtime and different behaviour from live runs. | 2026-11-08 |

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
- Code that is only waiting (servers, `setInterval`, network) keeps running until the next edit replaces it. The status bar shows "Running".
- A debug run stopped at a breakpoint sends no heartbeats, so the debugger holds the watchdog while paused and restarts its clock on resume (decision 17).

## Debug runs (decision 17)

```
Renderer ──debug:start(code, file, breakpoints)──▶ Main ──spawn──▶ bun --inspect=127.0.0.1:0/<token> host.ts
                                                    │  ◀── stderr: ws:// URL
                                                    ├── WebSocket: Debugger.enable, blackbox non-workspace URLs
                                                    └── stdin: { run, entry: debug-N.ts }   (results stream as usual)
debug-N.ts:  import "debug-gate.ts"   ← `debugger;` once the graph is parsed: set breakpoints, resume
             import "run-N.ts"        ← the instrumented scratch
```

- `src/main/runner.ts` `debug()`: own process (not the spare), inspector banner kept out of the results, watchdog hold.
- `src/main/debugger.ts` `DebugSession`: scripts and their source maps, breakpoints by script id, pause and step, scopes and properties as small `DebugValue`s for the renderer.
- `src/main/inspector.ts`: JSON-RPC over WebSocket. `src/main/sourcemap.ts`: VLQ decode, generated ⇄ source lines.
- Protocol notes from bun 1.4: `Debugger.setPauseOnDebuggerStatements` must be on for `debugger;` to stop; a step that pauses again sends no `Debugger.resumed`; Step Out resumes at the caller's next statement; `Runtime.getCollectionEntries` lists map and set entries.

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
