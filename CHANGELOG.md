# Changelog

The first `## <version>` heading below is Scriptty's version: builds stamp it into the app,
and the Release workflow, started by hand, publishes that version as `Scriptty-<version>`
with its notes. Each version is released once: to release, add a new heading on top with what
changed. A heading that isn't a version, like `## Unreleased`, is skipped.

A version's section is Markdown: `###` subsections (What's new, Fixes, Updating from …) and
bullets that start with a **bold lead-in**. Wrap lines freely; the release notes join them
back (`scripts/version.sh --notes`), so a new line only starts at a blank line, a bullet or
a heading.

## 0.1.0

### What's new

- **Live results.** Every line's value, `console.log` output and errors show beside it as
  you type. Click a result for the full output.
- **Debugger.** Breakpoints, stepping, call stack, variables and Watch expressions, in the
  Debugger tab next to Results.
- **Scratches are plain files** in `~/Documents/Scriptty`, with folders, tabs, split views,
  quick open, search across scratches and go to definition.
- **Packages.** Add npm packages from the Packages panel; their types load into the editor.
  A missing import offers to install the package.
- **Snippets, Bundle tab and rebindable keyboard shortcuts**, plus vim mode in Settings.
