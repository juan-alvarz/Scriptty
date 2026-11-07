/**
 * Package name an import specifier loads from: `lodash/fp` -> `lodash`, `@scope/pkg/sub` -> `@scope/pkg`.
 * Null when it is not a package: relative or absolute paths, URLs and other `scheme:` specifiers
 * (`node:fs`, `bun:sqlite`, `C:\x`), `#subpath` imports, or a bare `@scope` without a name.
 */
export function packageOf(spec: string): string | null {
  if (!spec || /^(\.|\/|\\|#|[a-z][\w+.-]*:)/i.test(spec)) return null
  const parts = spec.split('/')
  if (spec.startsWith('@')) return parts.length > 1 && parts[0].length > 1 && parts[1] ? `${parts[0]}/${parts[1]}` : null
  return parts[0]
}
