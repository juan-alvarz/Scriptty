# Scriptty

A desktop scratchpad for TypeScript and JavaScript. It runs your code as you type and shows each line's result beside it. Built with Electron, Svelte 5, Monaco and a bundled [bun](https://bun.sh) runtime, for macOS and Windows.

## Features

- **Live results**: every line's value, `console.log` output and errors show in the results gutter as you type. Click a result for the full, pretty-printed output.
- **Stop**: end a run that keeps going (servers, intervals) with Run > Stop, the toolbar's Stop button, or ⌘. / Ctrl+.
- **Debugger**: the **Debugger** tab next to Results and Bundle. Click the editor's left margin (or press F9) to set a breakpoint; the tab shows how many are set and lists them (click to jump, × to remove, Clear all). **Start debugging** there (or F5) runs the current file with the debugger attached; it stops at breakpoints and `debugger;` statements. While paused the tab shows the call stack and variables (Local, Closure, Module) with expandable objects, and has Continue, Step Over, Step Into, Step Out and Stop. Live as-you-type runs never stop at breakpoints.
  - **Watch**: type an expression under Watch and press Enter. It is re-evaluated in the selected frame on every pause and step; names out of scope show "not available". Double-click an entry to edit it, × to remove it. The list is saved in settings. Watch expressions really run, so avoid ones that change state (`n++`).
- **Runtime error markers**: thrown errors and rejections get a red squiggle on their line, with the error and stack in the hover.
- **Scratches are plain files** in `~/Documents/Scriptty`, with folders, a file tree, tabs (restored on launch) and autosave.
- **Quick open**: ⌘P / Ctrl+P opens a fuzzy file switcher over every scratch. ⌘P Enter switches back to the previous file.
- **Search across scratches**: ⇧⌘F / Ctrl+Shift+F, with match case, whole word and regex toggles. Click a hit to open it.
- **Packages**: add and remove npm packages from the Packages panel. Their types load into the editor, so imports autocomplete and type-check.
  - Untyped packages (like `lodash`) get an offer to install their `@types` package. Type packages are listed apart under Type libraries.
  - Import a package that isn't installed and a banner offers to add it. The import line also has an "Install" quick fix.
  - Package details show the README rendered as Markdown (sanitized; remote images are not loaded).
- **Snippets** in VS Code's format: type a prefix such as `clg` and accept the suggestion. Manage them in Settings > Snippets or edit `snippets.json` directly.
- **Bundle tab**: `bun build` output for the current file, with Minify and Include packages options.
- **Settings** (⌘, / Ctrl+,): appearance, font size, tab size, vim mode, run as you type, run delay, freeze timeout.

## Keyboard shortcuts

| Action | macOS | Windows |
|--------|-------|---------|
| Run now | ⌘Enter | Ctrl+Enter |
| Stop | ⌘. | Ctrl+. |
| Quick open | ⌘P | Ctrl+P |
| Search scratches | ⇧⌘F | Ctrl+Shift+F |
| Debug / continue | F5 | F5 |
| Stop debugging | ⇧F5 | Shift+F5 |
| Toggle breakpoint | F9 | F9 |
| Step over / into / out | F10 / F11 / ⇧F11 | F10 / F11 / Shift+F11 |
| Toggle sidebar | ⌘B | Ctrl+B |
| Close tab | ⌘W | Ctrl+W |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Settings | ⌘, | Ctrl+, |

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
