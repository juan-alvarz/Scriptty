# Scriptty

A desktop scratchpad for TypeScript and JavaScript. It runs your code as you type and shows each line's result beside it. Built with Electron, Svelte 5, Monaco and a bundled [bun](https://bun.sh) runtime, for macOS and Windows.

## Features

- **Live results**: every line's value, `console.log` output and errors show in the results gutter as you type. Click a result for the full, pretty-printed output.
- **Stop**: end a run that keeps going (servers, intervals) with Run > Stop, the toolbar's Stop button, or ⌘. / Ctrl+.
- **Debugger**: the **Debugger** tab next to Results and Bundle. Click the editor's left margin (or press F9) to set a breakpoint; the tab shows how many are set and lists them (click to jump, × to remove, Clear all). **Start debugging** there (or F5) runs the current file with the debugger attached; it stops at breakpoints and `debugger;` statements. While paused the tab shows the call stack and variables (Local, Closure, Module) with expandable objects, and has Continue, Step Over, Step Into, Step Out and Stop. Live as-you-type runs never stop at breakpoints.
  - **Watch**: type an expression under Watch and press Enter. It is re-evaluated in the selected frame on every pause and step; names out of scope show "not available". Double-click an entry to edit it, × to remove it. The list is saved in settings. Watch expressions really run, so avoid ones that change state (`n++`).
- **Runtime error markers**: thrown errors and rejections get a red squiggle on their line, with the error and stack in the hover.
- **Scratches are plain files** in `~/Documents/Scriptty`, with folders, a file tree, tabs (drag to reorder, restored on launch) and autosave.
- **Go to definition**: ⌘-click / Ctrl-click (or F12) a function, class or type to jump to it, also in another scratch.
- **Split views**: up to three editors side by side, each with its own tabs. Drag a file from the sidebar, or a tab off its tab bar, onto the left or right edge of an editor to split it (drop in the middle to open it there), or press ⌘\ / Ctrl+\. ⌘1 / ⌘2 / ⌘3 (Ctrl+1/2/3 on Windows) focus a split; focusing the next one that doesn't exist yet opens it with the current file. Results, error markers, Run/Stop, the Debugger and the Bundle tab follow the focused split, and go to definition and breakpoints open files there. Splits are restored on launch.
- **Quick open**: ⌘P / Ctrl+P opens a fuzzy file switcher over every scratch. ⌘P Enter switches back to the previous file.
- **Search across scratches**: ⇧⌘F / Ctrl+Shift+F, with match case, whole word and regex toggles. Click a hit to open it.
- **Packages**: add and remove npm packages from the Packages panel. Their types load into the editor, so imports autocomplete and type-check.
  - Untyped packages (like `lodash`) get an offer to install their `@types` package. Type packages are listed apart under Type libraries.
  - Import a package that isn't installed and a banner offers to add it. The import line also has an "Install" quick fix.
  - Package details show the README rendered as Markdown (sanitized; remote images are not loaded).
- **Snippets** in VS Code's format: type a prefix such as `clg` and accept the suggestion. Manage them in Settings > Snippets or edit `snippets.json` directly.
- **Bundle tab**: `bun build` output for the current file, with Minify and Include packages options.
- **Settings** (⌘, / Ctrl+,): appearance, font size, tab size, vim mode, run as you type, run delay, freeze timeout, keyboard shortcuts.

## Keyboard shortcuts

Defaults:

| Action | macOS | Windows |
|--------|-------|---------|
| Run now | ⌘Enter | Ctrl+Enter |
| Stop | ⌘. | Ctrl+. |
| Go to definition | ⌘-click or F12 | Ctrl-click or F12 |
| Go to file (quick open) | ⌘P | Ctrl+P |
| Search scratches | ⇧⌘F | Ctrl+Shift+F |
| Start debugging / continue | F5 or ⇧⌘D (continue also F8) | F5 or Ctrl+Shift+D (continue also F8) |
| Stop debugging | ⇧F5 | Shift+F5 |
| Toggle breakpoint | F9 | F9 |
| Step over / into / out | F10 / F11 / ⇧F11 | F10 / F11 / Shift+F11 |
| Toggle sidebar | ⌘B | Ctrl+B |
| New file / new folder | ⌘N / ⇧⌘N | Ctrl+N / Ctrl+Shift+N |
| Close tab | ⌘W | Ctrl+W |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Move tab left / right | ⌘⇧PageUp / ⌘⇧PageDown | Ctrl+Shift+PageUp / PageDown |
| Split editor right | ⌘\ | Ctrl+\ |
| Focus split 1 / 2 / 3 | ⌘1 / ⌘2 / ⌘3 | Ctrl+1 / Ctrl+2 / Ctrl+3 |
| Settings | ⌘, | Ctrl+, |

Change any of them in Settings > Keyboard Shortcuts: click a shortcut and press the new keys (Esc cancels), remove it with ×, or reset it with ↺. Two actions on one shortcut get a warning; the one listed first runs. A shortcut needs ⌘, Ctrl or Alt, or a function key. Shortcuts work the same in the editor and in vim mode, and app actions are also in the editor's command palette (F1).

Your changes are stored in `settings.json` in the app's data folder, under `keybindings`, keyed by action, with `""` to unbind:

```json
"keybindings": { "run": "Cmd+R", "stop": "" }
```

## Development

Needs Node and pnpm. bun is bundled; `pnpm install` fetches it.

```bash
pnpm install
pnpm dev          # run with hot reload
pnpm test         # instrumentation, runner, debugger and workspace tests
pnpm typecheck    # main/preload with tsc, renderer with svelte-check
pnpm dist:mac     # package for macOS (run on macOS)
pnpm dist:win     # package for Windows (run on Windows)
```

See [docs/architecture.md](docs/architecture.md) for the decisions log, process model and runner design.
