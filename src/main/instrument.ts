import { posix, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseSync, visitorKeys } from 'oxc-parser'
import MagicString from 'magic-string'

export type Instrumented =
  | { ok: true; code: string; imports: string[] }
  | { ok: false; error: string; line: number }

type Node = { type: string; start: number; end: number; [key: string]: unknown }

/**
 * Wraps each top-level expression in `__r(line, (expr))` and each `console.x(` call in `__log(line, "x")(`.
 * Only inserts text on existing lines, so runtime error line numbers match the editor.
 * Lines are 1-based. Output stays TypeScript: bun runs it natively.
 * The instrumented copy runs from another folder than the scratch, so:
 * - with `baseDir` (defaults to the folder of an absolute `filename`), relative import specifiers become
 *   absolute paths;
 * - with an absolute `filename` (the scratch's real path), `import.meta.dir` / `dirname` / `file` / `filename` /
 *   `path` / `url` / `main`, `__dirname`, `__filename` and `require.main === module` become literals that
 *   describe the scratch, not the copy.
 */
export function instrument(source: string, filename = 'scratch.ts', baseDir?: string): Instrumented {
  const { program, errors } = parseSync(/\.\w+$/.test(filename) ? filename : filename + '.ts', source)
  const lineOf = lineIndex(source)
  if (errors.length) {
    const e = errors[0]
    return { ok: false, error: e.message, line: lineOf(e.labels?.[0]?.start ?? 0) }
  }

  const s = new MagicString(source)
  const imports = new Set<string>()
  const path = /^[a-z]:[\\/]/i.test(filename) || process.platform === 'win32' ? win32 : posix
  const here = path.isAbsolute(filename) ? scratchLocation(filename, path) : null
  const dir = baseDir ?? (here ? path.dirname(filename) : undefined)
  const bound = here ? boundNames(program as unknown as Node) : new Set<string>()

  walk(program as unknown as Node, (node, parent, key, inType) => {
    if (here && !inType) {
      const literal = locationLiteral(node, parent, key, here, bound)
      if (literal !== null) {
        s.overwrite(node.start, node.end, literal)
        return false
      }
    }
    const method = consoleMethod(node)
    if (method) {
      const callee = node.callee as Node
      s.overwrite(callee.start, callee.end, `__log(${lineOf(node.start)}, ${JSON.stringify(method)})`)
    }
    const src = dir && importSource(node)
    if (src && /^\.\.?(\/|$)/.test(src.value)) {
      s.overwrite(src.start, src.end, JSON.stringify(path.resolve(dir, src.value).replace(/\\/g, '/')))
    }
  })

  for (const node of (program as unknown as { body: Node[] }).body) {
    if (node.type === 'ImportDeclaration') {
      const spec = (node.source as { value: string }).value
      if (isBare(spec)) imports.add(packageName(spec))
    }
    if (node.type === 'ExpressionStatement' && !node.directive) {
      const expr = node.expression as Node
      if (consoleMethod(expr)) continue
      s.prependLeft(expr.start, `__r(${lineOf(expr.end - 1)}, (`)
      s.appendRight(expr.end, '))')
    }
  }

  return { ok: true, code: s.toString(), imports: [...imports] }
}

const IMPORT_NODES = new Set(['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'])
const CONSOLE_METHODS = new Set(['log', 'info', 'debug', 'warn', 'error', 'table', 'dir'])

/** The string literal a static import, re-export or dynamic `import("...")` loads from. */
function importSource(node: Node): (Node & { value: string }) | null {
  if (!IMPORT_NODES.has(node.type)) return null
  const src = node.source as (Node & { value: unknown }) | null
  return src && src.type === 'Literal' && typeof src.value === 'string' ? (src as Node & { value: string }) : null
}

function consoleMethod(node: Node): string | null {
  if (node.type !== 'CallExpression') return null
  const callee = node.callee as Node
  if (callee.type !== 'MemberExpression' || callee.computed) return null
  const obj = callee.object as Node & { name?: string }
  const prop = callee.property as Node & { name?: string }
  if (obj.type !== 'Identifier' || obj.name !== 'console') return null
  return prop.name && CONSOLE_METHODS.has(prop.name) ? prop.name : null
}

type Visit = (n: Node, parent: Node | null, key: string, inType: boolean) => boolean | void

/** Depth-first walk. `inType` is true inside type-only TS syntax. `visit` returning false skips the children. */
function walk(node: Node, visit: Visit, parent: Node | null = null, key = '', inType = false): void {
  inType ||= node.declare === true || (node.type.startsWith('TS') && !TS_VALUE_NODES.has(node.type))
  if (visit(node, parent, key, inType) === false) return
  for (const k of visitorKeys[node.type] ?? []) {
    const child = node[k]
    if (Array.isArray(child)) for (const c of child) c && typeof c === 'object' && walk(c as Node, visit, node, k, inType)
    else if (child && typeof child === 'object') walk(child as Node, visit, node, k, inType)
  }
}

/** TS nodes that hold runtime code; every other `TS*` node is type-only. */
const TS_VALUE_NODES = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
  'TSParameterProperty',
  'TSExportAssignment',
  'TSModuleDeclaration',
  'TSModuleBlock'
])

type Location = { meta: Record<string, string>; ids: Record<string, string> }

/** JS literals for where the scratch really lives, keyed by `import.meta` property and by global name. */
function scratchLocation(file: string, path: typeof posix): Location {
  const dir = JSON.stringify(path.dirname(file))
  const full = JSON.stringify(file)
  const url = JSON.stringify(pathToFileURL(file, { windows: path === win32 }).href)
  return {
    // The scratch is imported by the runner host, so bun would say `main` is false; to the user it is the entry.
    meta: { dir, dirname: dir, file: JSON.stringify(path.basename(file)), filename: full, path: full, url, main: 'true' },
    ids: { __dirname: dir, __filename: full }
  }
}

/** The replacement for `node` if it reads the scratch's location, else null. */
function locationLiteral(node: Node, parent: Node | null, key: string, here: Location, bound: Set<string>): string | null {
  const isAssigned = parent && ((parent.type === 'AssignmentExpression' && key === 'left') || parent.type === 'UpdateExpression')
  if (node.type === 'MemberExpression' && (node.object as Node).type === 'MetaProperty' && !isAssigned) {
    const name = propertyName(node)
    return name && Object.hasOwn(here.meta, name) ? here.meta[name] : null
  }
  // `{ __dirname }` must keep its key: `{ __dirname: "/x" }`.
  if (node.type === 'Property' && node.shorthand && parent?.type === 'ObjectExpression') {
    const v = node.value as Node & { name?: string }
    return v.type === 'Identifier' && freeId(v.name, here, bound) ? `${v.name}: ${here.ids[v.name!]}` : null
  }
  if (node.type === 'Identifier' && freeId(node.name as string, here, bound) && isReference(parent, key)) {
    return here.ids[node.name as string]
  }
  // `require.main === module` (or `!==`, either order) is false for an imported file; the user means true.
  if (node.type === 'BinaryExpression' && /^[=!]==?$/.test(node.operator as string) && !bound.has('require') && !bound.has('module')) {
    const [a, b] = [node.left as Node, node.right as Node]
    if ((isRequireMain(a) && isIdent(b, 'module')) || (isRequireMain(b) && isIdent(a, 'module')))
      return String((node.operator as string)[0] === '=')
  }
  return null
}

const freeId = (name: string | undefined, here: Location, bound: Set<string>): name is string =>
  !!name && Object.hasOwn(here.ids, name) && !bound.has(name)

const isIdent = (n: Node, name: string): boolean => n.type === 'Identifier' && n.name === name

const isRequireMain = (n: Node): boolean =>
  n.type === 'MemberExpression' && isIdent(n.object as Node, 'require') && propertyName(n) === 'main'

/** `x.name` or `x["name"]`. */
function propertyName(member: Node): string | null {
  const p = member.property as Node & { name?: string; value?: unknown }
  if (!member.computed) return p.name ?? null
  return p.type === 'Literal' && typeof p.value === 'string' ? p.value : null
}

/** Whether an identifier at `parent[key]` reads a variable, rather than naming a property, label or export. */
function isReference(parent: Node | null, key: string): boolean {
  if (!parent) return true
  switch (parent.type) {
    case 'MemberExpression':
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
    case 'AccessorProperty':
      return key !== (parent.type === 'MemberExpression' ? 'property' : 'key') || !!parent.computed
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'ExportSpecifier':
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ExportAllDeclaration':
    case 'MetaProperty':
      return false
  }
  return true
}

/**
 * Names the scratch declares or assigns anywhere. Those are left alone everywhere: simpler than scope
 * analysis, and a scratch that defines its own `__dirname` (`dirname(fileURLToPath(import.meta.url))`) still
 * gets the right value through the rewritten `import.meta.url`.
 */
function boundNames(program: Node): Set<string> {
  const names = new Set<string>()
  const add = (p: unknown): void => {
    const n = p as (Node & { name?: string }) | null
    if (!n) return
    if (n.type === 'Identifier') names.add(n.name!)
    else if (n.type === 'ObjectPattern') for (const prop of n.properties as Node[]) add(prop.type === 'RestElement' ? prop : prop.value)
    else if (n.type === 'ArrayPattern') (n.elements as Node[]).forEach(add)
    else if (n.type === 'RestElement') add(n.argument)
    else if (n.type === 'AssignmentPattern') add(n.left)
    else if (n.type === 'TSParameterProperty') add(n.parameter)
  }
  walk(program, (n, _parent, _key, inType) => {
    // Enums and `import x =` are runtime bindings, though the walk counts them as TS syntax.
    if (n.type === 'TSEnumDeclaration' || n.type === 'TSImportEqualsDeclaration') add(n.id)
    // `declare const __dirname: string` only types bun's own variable; bun strips it.
    if (inType) return false
    switch (n.type) {
      case 'VariableDeclarator':
        return add(n.id)
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        add(n.id)
        return (n.params as Node[]).forEach(add)
      case 'ClassDeclaration':
      case 'ClassExpression':
      case 'TSModuleDeclaration':
        return add(n.id)
      case 'CatchClause':
        return add(n.param)
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        return add(n.local)
      case 'AssignmentExpression':
        return add(n.left)
      case 'UpdateExpression':
        return add(n.argument)
      case 'ForInStatement':
      case 'ForOfStatement':
        return add(n.left)
    }
  })
  return names
}

function lineIndex(source: string): (offset: number) => number {
  const starts = [0]
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1)
  return (offset) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

const isBare = (spec: string): boolean => !/^(\.|\/|[a-z]+:)/i.test(spec)
const packageName = (spec: string): string => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')
