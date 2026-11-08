# Scriptty

A desktop scratchpad for TypeScript and JavaScript. It runs your code as you type and shows each line's result beside it. Built with Electron, Svelte 5, Monaco and a bundled [bun](https://bun.sh) runtime, for macOS and Windows.

## Features

- **Live results**: every line's value, `console.log` output and errors show in the results gutter as you type. Click a result for the full, pretty-printed output.
- **Stop**: end a run that keeps going (servers, intervals) with Run > Stop, the toolbar's Stop button, or ⌘. / Ctrl+.
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
| Toggle sidebar | ⌘B | Ctrl+B |
| Close tab | ⌘W | Ctrl+W |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Settings | ⌘, | Ctrl+, |

## Development

Needs Node and pnpm. bun is bundled; `pnpm install` fetches it.

```bash
pnpm install
pnpm dev          # run with hot reload
pnpm test         # instrumentation, runner and workspace tests
pnpm typecheck    # main/preload with tsc, renderer with svelte-check
pnpm dist:mac     # package for macOS (run on macOS)
pnpm dist:win     # package for Windows (run on Windows)
```

See [docs/architecture.md](docs/architecture.md) for the decisions log, process model and runner design.
