import { builtinModules } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { packageOf } from '../shared/specifier'
import { isValidSpec } from './packages'

// Bare node builtins (`fs`, `fs/promises`, `_http_agent`) plus bun's own `bun` module.
// `node:*` and `bun:*` never get this far: packageOf treats any `scheme:` specifier as not a package.
const BUILTINS = new Set([...builtinModules, 'bun'])

/** True when `<nodeModules>/<name>` exists, i.e. the package is in the shared environment (decision 9). */
export const installedIn =
  (nodeModules: string) =>
  (name: string): boolean =>
    existsSync(join(nodeModules, name))

/**
 * Packages that the import specifiers need but are not installed: deduplicated, in first-seen order.
 * Builtins, paths, URLs and names that could not be installed anyway are skipped.
 */
export function missingPackages(specs: Iterable<string>, isInstalled: (name: string) => boolean): string[] {
  const out = new Set<string>()
  for (const spec of specs) {
    const name = packageOf(spec)
    if (!name || BUILTINS.has(spec) || BUILTINS.has(name) || out.has(name) || !isValidSpec(name)) continue
    if (!isInstalled(name)) out.add(name)
  }
  return [...out]
}
