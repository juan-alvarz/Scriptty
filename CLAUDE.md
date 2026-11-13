# Scriptty

Desktop TS/JS live scratchpad built with Electron (macOS + Windows).

Read `docs/architecture.md` first: it holds the decisions log, implementation status, process model, runner design and Rust candidates. Add new decisions to its table.

UI mocks were removed from the tree; read them from history: `git show 42ffcb3:design/scriptty-graphite.html` (chosen direction), `git show 42ffcb3:design/scriptty-directions.html` (alternatives).

## Commands

- `pnpm dev`: run the app with hot reload
- `pnpm test`: instrumentation, runner and debugger tests (spawns the real bundled bun, with the inspector for debugger tests)
- `pnpm typecheck`: main/preload with tsc, renderer with svelte-check
- `pnpm dist:mac` / `pnpm dist:win`: package with electron-builder (run each on its own OS)
- `pnpm install:local`: build and replace `~/Applications/Scriptty.app` (macOS)
- Release: add a version on top of `CHANGELOG.md`, then run the Release workflow from GitHub's Actions tab
- `pnpm icons`: rebuild `build/icon.icns`, `.ico` and `.png` from the SVGs in `build/` (macOS, needs `rsvg-convert` and ImageMagick)

## Layout

- `src/main/`: Electron main, `instrument.ts` (oxc), `runner.ts` (bun process pool), `debugger.ts` + `inspector.ts` + `sourcemap.ts` (Debug runs over bun's inspector), `workspace.ts` (scratch files), `packages.ts` (bun add/remove, editor types), `settings.ts`, `menu.ts`
- `resources/runner/host.ts`: runs inside bun, executes the instrumented scratch
- `src/preload/`: the only bridge the renderer gets (`window.scriptty`)
- `src/renderer/src/`: Svelte 5 UI and Monaco setup
