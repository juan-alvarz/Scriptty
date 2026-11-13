# Scriptty architecture

Scriptty is a desktop scratchpad that runs TypeScript and JavaScript as you type and shows each line's result beside it.

Status: architecture decided (decisions 1 to 30). Scaffold runs end to end. UI mocks were removed; they live in git history at commit `42ffcb3` under `design/`.

## Implementation status

Done (scaffold, 2026-11-06):
- Runner: warm spare bun process, freeze watchdog, stdio JSON lines (`src/main/runner.ts`, `resources/runner/host.ts`).
- Instrumentation with `oxc-parser` + `magic-string` (`src/main/instrument.ts`).
- Graphite window: Svelte 5 shell, Monaco editor, results gutter, status bar (`src/renderer/src/`).
- electron-builder config. An unsigned macOS arm64 `--dir` build was run and tested.
- Tests: `pnpm test` covers instrumentation and a real bun run (values, logs, errors, freeze).

Done (files, packages, settings, 2026-11-06):
- Scratches are real files in `~/Documents/Scriptty` (decision 14), with folders, a file tree, inline rename, a native context menu (New File, New Folder, Rename, Move to Trash, Reveal), and autosave 400 ms after typing.
- Packages panel: add with `bun add`, remove with `bun remove`, in the shared environment. Installed packages' `.d.ts` files and a bundled `@types/node` are loaded into Monaco, so imports autocomplete and type-check. Untyped packages get an offer to install their `@types` package (decision 24).
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
- The matcher is `src/renderer/src/fuzzy.ts` (decision 21), unit-tested in `fuzzy.test.ts`. The shortcut goes through the keybinding registry (decision 30), so Monaco and vim mode (where Ctrl+P is a motion) never swallow it.

Done (README rendering, 2026-11-08):
- Package READMEs render as Markdown (`src/renderer/src/markdown.ts`, decision 22): headings, code blocks colored with Monaco's tokenizers and scrolling sideways, tables, quotes, lists, task lists, `<details>`, in light and dark.
- Links open in the browser (https only); `#anchor` links scroll to the heading; relative links resolve against the GitHub or GitLab repository and are dropped for other hosts. Images show as their alt text, linked to the image.
- Main refuses navigation away from the app page and `window.open` (`will-navigate`, `setWindowOpenHandler`), as a second guard behind the click handler.

Done (search, 2026-11-08):
- Search across all scratches (⇧⌘F / Ctrl+Shift+F, View > Search Scratches): the sidebar switches between Scratches and Search. Match case, whole word and regex toggles (also Alt+C / Alt+W / Alt+R in the box), typing is debounced 200 ms, results are grouped by file with counts and the match highlighted. Clicking a hit opens its tab and selects the match. Decision 23.
- `Workspace.search` in main (`src/main/workspace.ts`); an invalid regex comes back as `{ ok: false, error }` and is shown under the box. The open file is saved before each search, so unsaved typing is found.
- ⇧⌘F is matched in main like every app shortcut (decision 30), so Monaco and vim mode never keep the key.

Done (split views and keybindings, 2026-11-08):
- Up to three editor splits side by side (`EditorGroup.svelte`, decision 29), each with its own tabs, file, cursor and scroll per file, and its own vim mode. Splits on the same file share its Monaco model, so edits show in both and undo is shared.
- Open a split by dragging a file from the tree or a tab onto the left or right quarter of a split (an overlay shows where it lands; the middle opens the file in that split), with View > Split Editor Right (⌘\ / Ctrl+\), or with Focus Split 2/3 (⌘2 / ⌘3, Ctrl elsewhere) when that split does not exist yet: it opens with the current file. A dragged tab moves; a tree file opens. Closing a split's last tab closes the split.
- The results gutter, error markers, Run/Stop, the missing-package banner and the Bundle tab follow the focused split; focusing a split runs its file. Splits and their tabs are saved in `splits` / `activeSplit` and restored on launch; settings from before splits (`openFiles`, `lastFile`) become one split.
- With the debugger: Start Debugging runs the focused split's file; a pause opens the paused frame's file in the focused split and marks the line in every split showing it (decorations live on the model); breakpoint list clicks and go to definition open in the focused split. While paused, focusing another split does not start a live run. Tab drag reorder works within each split; dragging a tab off its strip onto an editor splits or moves it.
- Shortcuts come from one registry (`src/shared/keybindings.ts`, decision 30): named actions with a default per platform, user overrides in `keybindings` in settings.json. Main matches keys in `before-input-event`, so Monaco and vim mode never see them, and builds the menu with the same accelerators. App actions are also in Monaco's command palette (F1) with those keys.
- Settings > Keyboard Shortcuts lists every action: click to record a new combo (main captures the next key press, Esc cancels), remove, reset, reset all. Shared shortcuts get a warning naming the other actions; the one listed first wins the key. A shortcut needs Cmd, Ctrl or Alt, or a function key.
- Checked in the real app (`pnpm dev` with a throwaway home, keys sent through `webContents.sendInputEvent` so they pass `before-input-event`, drops as synthetic DragEvents): ⌘1/2/3, ⌘\ at the limit, ⌘W closing a split, edge and middle drops from the tree and from tabs, restore, recording, conflicts, Esc, the menu and F1 labels, vim per split. After merging the debugger, tab reorder and go to definition: ⌘⇧PageUp/PageDown and drag reorder within a split, dragging a tab off its strip onto another split (overlay, new split, move), F9 and F5 from another split (the paused file opens in the focused split and the line is marked in both splits showing it), F10, F8, ⇧F5, ⇧⌘D, ⌘-click go to definition, and rebinding Toggle Breakpoint to F6.

Done (debugger, 2026-11-08):
- Debug runs (decision 25): **Start debugging** in the right panel's **Debugger** tab (or F5, ⌘/Ctrl+Shift+D, Debug > Start Debugging), separate from the live run. The toolbar has no Debug button (decision 27). Live as-you-type runs are unchanged and never pause; breakpoints only take effect in a Debug run.
- Breakpoints: click the editor's glyph margin (red dot; a faint dot previews the spot) or press F9 on the cursor line, at any time. They are Monaco decorations, so they follow their line while you edit, and changes reach a running debug session at once. Breakpoints in scratches the file imports work too.
- Debugger tab (decision 27), next to Results and Bundle: its label carries a badge with the breakpoint count and a dot while paused. It lists every breakpoint as file:line with the line's code (refreshed as edits move them); click one to open its file on that line, × removes it, Clear all removes every one. The header shows the session state with Start debugging, or the stepping controls and Stop during a run.
- When a debug run stops at a breakpoint or a `debugger;` statement, the line is highlighted (opening the file if it is another scratch) and the Debugger tab comes to the front: call stack (click a frame to show its line and variables) and scopes (Local, Closure, Module) with expandable objects, arrays, maps and sets. Continue (F8, or F5 while paused), Step Over (F10), Step Into (F11), Step Out (⇧F11), Stop (⇧F5). The same items are in a Debug menu. While paused, the breakpoint list docks under the call stack and variables, and the breakpoint that was hit is highlighted.
- Watch (decision 26): a Watch list at the top of the variables column while paused. Type an expression in "Add expression…" and press Enter; double-click an entry (or its pencil) to edit it, Enter saves, Esc cancels, an empty entry is removed; × removes it. Each pause, step and frame pick re-evaluates every entry in the selected frame. Objects expand like variables. A name not in scope (or not initialized yet) shows "not available"; an expression that throws shows its error in red. The list is kept in settings (`watches`), so it survives restarts and applies to every file.
- Results and logs still stream to the gutter during a debug run. While paused, live runs wait; Stop (or the run's process ending) hands back to live runs with the current text. Editing while the debug run is not paused replaces it with a live run, like any run.
- Tests spawn real bun with the inspector: breakpoint with locals, step over/out, `debugger;` with object expansion, scope grouping, Step Into past the instrumentation wrappers, breakpoints in an imported file and while running, the watchdog leaving a paused run alone, Stop, and watch expressions (values per frame and after steps, out of scope, thrown errors, expanding a watched object).

Done (tab reorder, 2026-11-08):
- Drag a file tab to reorder it (`FileTabs.svelte`). A press becomes a drag after 4 px, so click still activates and middle-click still closes; a copy of the tab floats under the pointer while its slot stays dimmed, a bar marks the drop gap, the strip auto-scrolls near its edges, Esc cancels, and dragging never activates the tab. The order is saved in `openFiles`.
- ⌘⇧PageUp / ⌘⇧PageDown (Ctrl+Shift+PageUp / PageDown on Windows and Linux) move the current tab one place, stopping at the ends; also in View > Move Tab Left / Right (decision 28).
- Ordering math (move, insertion gap from pointer x and tab rects, auto-scroll speed) is pure in `src/renderer/src/tabs.ts` with vitest tests. Checked in the real app under xvfb: drag, no-op drop, click with jitter, middle-click, auto-scroll, persistence, and the shortcuts from inside Monaco.

Done (editor completions, 2026-11-08):
- String-literal unions suggest on the opening quote: `Utils.GetDate('` lists `'short' | 'long'`. Monaco's TS adapter only triggers on `.`, so a provider in `src/renderer/src/monaco.ts` asks the TS worker on `'`, `"` and `` ` `` and keeps its string-literal entries.
- Relative import paths complete from the workspace: `from './'` lists sibling folders (first) and files, `../` goes up, picking a folder suggests again. `.ts`/`.js`/`.tsx`/`.jsx` are left off, as bun resolves them. The TS worker cannot list folders, so the paths come from the models (every scratch is one); the logic is `src/renderer/src/importPaths.ts`, unit-tested.
- Snippets sort after TS suggestions on a tie (decision 20).

Done (go to definition, 2026-11-08):
- ⌘/Ctrl+click (or F12) on a name defined in another scratch opens that file's tab with the cursor on the definition. Monaco's standalone editor only jumps within the current model, so `App.svelte` registers an editor opener (`monaco.editor.registerEditorOpener`) that opens the tab through the same path as a search hit (`goTo`).
- Definitions in package or lib `.d.ts` files have no model, so nothing opens for them yet.

Not done yet:
- Debugger: breakpoints are not saved across restarts; no conditional breakpoints or console while paused; watch expressions run for real (`n++` changes `n`, a call runs the function) and one that loops forever hangs the debug run until Stop; no pause-on-exceptions (the host catches every error, so "uncaught" never fires). A busy loop cannot be paused: bun answers the inspector on the JS thread, so the freeze watchdog still ends it. After the top level finishes, a debug run stays attached (for timers and callbacks) until Stop or an edit.
- Snippets: saving from Settings rewrites `snippets.json` and drops the user's own comments (the explanatory header is rewritten). Monaco's standalone build has no `tabCompletion` (prefix + Tab without the suggestion list), so the list must be open. Snippet variables (`$TM_FILENAME`, `$CLIPBOARD` …) resolve only as far as Monaco's standalone resolvers go.
- `import.meta.dir` / `__dirname` in a scratch point at the packages folder's `.runs`, not the scratch (the working directory is right).
- Splits: no resizing (each takes an equal share), no vertical splits, tree drops were tested with synthetic DragEvents and tab drags with `sendInputEvent` mouse input, not a hand-held mouse. Rename and Move to Trash with splits open were only reviewed, not run. Focusing another split re-runs its file, which replaces the run of the split you left (one runner). Shortcuts that clash with menu roles (⌘C, ⌘Q…) are not flagged; binding one takes the key from the role.
- Quick open's recent-files order lives in memory only (lost on restart), and files added outside the app appear only after the tree refreshes.
- `Bun.*` globals have no editor types (add `bun-types` the same way as `@types/node`).
- Auto-update wiring, signing.
- Windows build not run yet (menu accelerators with the hidden title bar need checking there). The Release workflow (decision 31) is the only CI and has not run yet.
- The native context menu and ⌘, accelerator were checked by hand only; automated tests cover the main-process logic.
- Missing-package check only sees static top-level `import` declarations (what `instrument()` collects), not `export … from`, `import()` or `require()`. The banner and quick fix are not covered by automated UI tests.
- Runtime error markers span the whole line, not the thrown expression: the stack's column points into the instrumented code (inserted `__r(` text shifts it). A small column map from `instrument` would fix it.
- Events that arrive between switching tabs and the new run's reply can land on the new tab's model (the results gutter has the same race); the new run's first event clears them.
- Search has no replace, no include/exclude globs, and no multi-line matches. A pathological regex (catastrophic backtracking) can stall the main process; move search to a `worker_thread` with a timeout if that shows up.

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
| 20 | **User snippets in VS Code's JSON format**, one file in `userData` | Users can paste snippets from VS Code (prefix and body as a string or array, `scope`, tab stops, placeholders, choices) and edit the file by hand; Settings covers the common cases. Main owns the file and rejects edits while it does not parse, so a typo never costs the user their snippets. One global file instead of per-language files keeps v1 simple (decision 5); `scope` still limits a snippet to TS or JS. Snippet suggestions sort inline by match quality (Monaco's default), and lose ties to TS suggestions, so properties and variables come first when nothing is typed yet (for example inside an object literal). | 2026-11-07 |
| 21 | Quick open uses an **in-house fuzzy matcher** | A small dynamic program (about 150 lines, no dependency) picks the best placement of the query: points per matched char, bonuses for consecutive chars and word, camelCase and path-segment starts, a cost per skipped char, and a bonus when the whole query fits in the file name, so name matches beat folder matches. Workspaces are small, so scoring every path per keystroke is cheap. fzf-style libraries (`fzf`, `fuse.js`) were the alternative; they add weight and rank folders and names alike. | 2026-11-08 |
| 22 | READMEs render with **`marked` + `DOMPurify`**, and **remote images stay blocked** | READMEs are untrusted HTML. DOMPurify is the maintained browser sanitizer and works in the sandboxed renderer; we allowlist tags and attributes (no `style`, `class`, `id`, forms, iframes, SVG), then on an inert `DOMParser` copy keep only https URLs (http upgraded, relative ones resolved against GitHub/GitLab) and turn images into alt-text chips. Together about 80 KB minified. The CSP keeps `img-src 'self' data:`: allowing `https:` would let any README make the app fetch from any host (tracking pixels, IP leaks) for mostly badges. A small image proxy in main could lift this later. Inline handlers in a README make Chromium log a CSP error while parsing; nothing runs. | 2026-11-08 |
| 23 | Search runs in **main, in JS, over the same files as the editor models** | Reuses `readAll()` and its limits (300 script files, 512 KB each; binary files skipped), so search sees exactly what type-checking sees and needs no new dependency or bundled ripgrep. Matching is per line with a JS `RegExp` (columns are UTF-16 units, the same as Monaco). Results stop at 2000 matches or 200 files and say so. A bad regex is a typed result, not a thrown error. `$` counts as a word character for whole word, since it is one in JS identifiers. Ripgrep or a worker is the upgrade path if workspaces grow. | 2026-11-08 |
| 24 | Untyped packages: **offer `@types/<name>`** after the add | Packages like lodash ship no `.d.ts`, so the editor had nothing to autocomplete. After adding one, the Packages panel asks to install its DefinitelyTyped package, only when npm has it; package details also have an Install types button. Type packages are dev dependencies, listed apart under a collapsible Type libraries group, and removing a package removes its types. A package with no types anywhere gets `declare module "name"` so its import is `any`, not an error. The import path also offers installed package names, since Monaco's TS worker cannot list `node_modules`. | 2026-11-07 |
| 25 | Debugger: a **Debug run is its own bun process with the inspector**, driven from main over WebSocket | Bun ships a WebKit Inspector Protocol server (`--inspect=127.0.0.1:0/<random path>`); main connects with Node's global `WebSocket`, so no dependency. Live runs keep the warm spare without an inspector, so they never pause and stay as fast as before. Bun reprints every file it loads (comments, blank lines and types go), so lines go through the inline source map it reports; our instrumentation keeps editor lines, so mapping back lands on editor lines. Breakpoints are set from a gate: the debug entry imports a one-line `debugger;` module first, which runs only after the whole import graph is parsed, so every file's map is known and breakpoints are placed by script id before any user code runs. JavaScriptCore reports a module's own scope as empty, so the Module scope evaluates the file's top-level names (from the oxc AST) in the paused frame. Everything outside the workspace (host wrappers, packages) is blackboxed so Step Into skips it. The freeze watchdog is held while paused. A Node-based runner (CDP) was the alternative; it would mean a second runtime and different behaviour from live runs. | 2026-11-08 |
| 26 | Debugger **Watch** evaluates in the paused frame with `Debugger.evaluateOnCallFrame`, and the list lives in **settings** | The same call the Module scope already uses, over the same inspector socket, so no new channel. Values are plain `DebugValue`s, so a watched object expands with the existing `debug.props`. JavaScriptCore throws a `ReferenceError` for names not in scope and for `let`/`const` not yet initialized; both show as "not available", other errors show their message. One list for all files (like VS Code), saved in `settings.json` and checked by `sanitize` (at most 50 expressions of 500 characters), so it survives restarts, unlike breakpoints so far. Evaluating has side effects by design; a read-only mode would need parsing the expression for assignments and calls. | 2026-11-08 |
| 27 | Debugging lives in a **Debugger tab** beside Results and Bundle, not a toolbar button | The owner asked to see at a glance whether breakpoints are set and to start debugging from the same place. The tab badge shows the count, the tab lists and manages them, and a pause brings the tab to the front with call stack, Watch and variables, so the toolbar keeps only the live-run controls. Results stay one click away (the gutter still fills during a debug run). The breakpoint list is rebuilt from the Monaco decorations (`listBreakpoints`) on each toggle and edit instead of a parallel store, so it can never disagree with the editor. | 2026-11-08 |
| 28 | Tab drag uses **pointer events**; the move-tab keys are caught in main's **`before-input-event`** | HTML5 drag and drop has no drag threshold, its drag image cannot be styled and fights the click and middle-click handlers; pointer events with capture after 4 px keep both and allow edge auto-scroll. The floating tab is our own `position: fixed` copy (no pointer events), so the strip's overflow does not clip it. The shortcuts are matched in main (`src/main/shortcuts.ts`) before the page sees them, so Monaco and vim mode cannot consume them, and `preventDefault` there also stops the menu accelerator from firing a second time. The View menu items still show the keys. Note: Playwright's synthetic keys skip `before-input-event`; test these with real input (e.g. `xdotool` under xvfb). | 2026-11-08 |
| 29 | Split views: **one Monaco editor per split**, sharing models; **the focused split drives runs** | A split is `{ tabs, current }` plus its own editor instance; models stay one per file (`modelFor`), so two splits on one file stay in sync. Only the focused split runs and owns the results gutter, markers and Bundle tab, because there is one runner and one gutter; focusing a split re-runs its file. At most three splits (one Focus Split shortcut each, and the window's minimum width still fits them next to the results). Files from the tree drag with HTML5 drag events and a custom type, caught in the capture phase over the editor so Monaco never takes the drop and inserts text. Tabs keep the pointer-event drag of decision 28: released over the strip they reorder, released off it they go to the same `dropFile` (the split under the pointer is found with `elementFromPoint`, and the same overlay shows while dragging). Settings store `splits`/`activeSplit` and migrate `openFiles`/`lastFile`. | 2026-11-08 |
| 30 | Shortcuts: **one registry of named actions**, matched in **main's `before-input-event`** | Shortcuts were spread over menu accelerators, `ed.addCommand` calls and a window listener in quick open, so changing one meant three places and users could not rebind anything. Now `src/shared/keybindings.ts` lists every action with a default (Electron accelerator syntax; `CmdOrCtrl` gives the per-platform default) and settings.json keeps only the user's changes, validated on load. Main matches every key press before the page, the one place Monaco and vim mode cannot consume a key, and its `preventDefault` also stops the menu accelerator from firing a second time; the menu is rebuilt from the same bindings when they change. Letters match by `key` (so Dvorak and AZERTY users get the letter on the key) and everything else by `code` (Shift and Option change `key`). Recording a new shortcut also happens in main for the same reason: it takes the next key press, so Esc or ⌘W never reach the page or the menu mid-recording, and a reload ends it. When two actions share a key the first listed wins and the pane warns. Electron's `globalShortcut` was rejected (system-wide). A window capture listener in the renderer was the alternative; main sees keys earlier and needs no second rule to keep the menu accelerator quiet. This replaces decision 28's `shortcuts.ts` and the renderer's debug key listener: move-tab and debug keys are registry rows like the rest. Start Debugging has a second row (⇧⌘D / Ctrl+Shift+D) because the registry holds one key per action and F5 needs Fn on most Mac keyboards. F8 always reaches Continue now; when nothing is paused it runs Monaco's next problem, so its old meaning stays. Synthetic keys from Playwright or CDP skip `before-input-event`; test with `webContents.sendInputEvent`. | 2026-11-08 |
| 31 | Releases come from **`CHANGELOG.md`**, published by a **hand-started workflow** | Same as Dockry: the first `## <version>` heading is the version and its section is the release notes (`scripts/version.sh`, `--notes` joins wrapped lines because GitHub shows every line break). `.github/workflows/release.yml` (Actions tab, Run workflow) fails if `Scriptty-<version>` is already tagged, builds macOS arm64 and Windows x64 on their own runners (each build ships that machine's bun), stamps the version into `package.json` there, and creates the tag and release with the `.dmg`, `.zip`, `.exe`, blockmaps and `latest*.yml` (kept for electron-updater). `package.json`'s `version` is not the source of truth. `pnpm install:local` builds the same version into `~/Applications` (`SCRIPTTY_APP_DIR` to change), so each macOS account keeps its own copy. | 2026-11-12 |

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
- A debug run stopped at a breakpoint sends no heartbeats, so the debugger holds the watchdog while paused and restarts its clock on resume (decision 25).

## Debug runs (decision 25)

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
