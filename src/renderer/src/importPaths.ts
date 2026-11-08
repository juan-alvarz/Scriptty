// Relative import path completion. Monaco's TS worker cannot list folders, so the paths come from the
// workspace's models (every scratch is one). Plain TS without Monaco, so it runs in the unit tests.

export type PathSuggestion = { name: string; folder: boolean }

/** Extensions bun resolves without being written, so `./utils.ts` is offered as `./utils`. */
const IMPLICIT_EXT = /\.(tsx?|jsx?)$/

/**
 * Entries for the folder that `spec` (what is typed so far, e.g. `./` or `../lib/u`) points at,
 * seen from the file at `from`. Paths are absolute, `/`-separated (Monaco model paths). Only
 * specs starting with `./` or `../` get entries; the part after the last `/` is left to Monaco's filter.
 */
export function pathSuggestions(from: string, spec: string, paths: string[]): PathSuggestion[] {
  if (!/^\.\.?\//.test(spec)) return []
  const dirPart = spec.slice(0, spec.lastIndexOf('/') + 1)
  const dir = decodeURIComponent(new URL(dirPart, 'file://' + from).pathname)
  const seen = new Map<string, PathSuggestion>()
  for (const p of paths) {
    if (p === from || !p.startsWith(dir)) continue
    const rest = p.slice(dir.length)
    const slash = rest.indexOf('/')
    if (slash >= 0) seen.set(rest.slice(0, slash) + '/', { name: rest.slice(0, slash), folder: true })
    else seen.set(rest, { name: rest.replace(IMPLICIT_EXT, ''), folder: false })
  }
  return [...seen.values()]
}
