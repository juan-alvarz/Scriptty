import { resolve } from 'node:path'
import { parseSync, visitorKeys } from 'oxc-parser'
import MagicString from 'magic-string'

export type Instrumented =
  /** `names`: the file's top-level bindings, which the debugger shows as the Module scope. */
  | { ok: true; code: string; imports: string[]; names: string[] }
  | { ok: false; error: string; line: number }

type Node = { type: string; start: number; end: number; [key: string]: unknown }

/**
 * Wraps each top-level expression in `__r(line, (expr))` and each `console.x(` call in `__log(line, "x")(`.
 * Only inserts text on existing lines, so runtime error line numbers match the editor.
 * Lines are 1-based. Output stays TypeScript: bun runs it natively.
 * With `baseDir`, relative import specifiers become absolute paths, because the instrumented copy runs
 * from another folder than the scratch.
 */
export function instrument(source: string, filename = 'scratch.ts', baseDir?: string): Instrumented {
  const { program, errors } = parseSync(filename, source)
  const lineOf = lineIndex(source)
  if (errors.length) {
    const e = errors[0]
    return { ok: false, error: e.message, line: lineOf(e.labels?.[0]?.start ?? 0) }
  }

  const s = new MagicString(source)
  const imports = new Set<string>()

  walk(program as unknown as Node, (node) => {
    const method = consoleMethod(node)
    if (method) {
      const callee = node.callee as Node
      s.overwrite(callee.start, callee.end, `__log(${lineOf(node.start)}, ${JSON.stringify(method)})`)
    }
    const src = baseDir && importSource(node)
    if (src && /^\.\.?(\/|$)/.test(src.value)) {
      s.overwrite(src.start, src.end, JSON.stringify(resolve(baseDir, src.value).replace(/\\/g, '/')))
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

  return { ok: true, code: s.toString(), imports: [...imports], names: declaredNames(program as unknown as Node) }
}

/** Top-level runtime bindings of a file (types, `declare` and type-only imports left out). Empty if it fails to parse. */
export function topLevelNames(source: string, filename: string): string[] {
  const { program, errors } = parseSync(filename, source)
  return errors.length ? [] : declaredNames(program as unknown as Node)
}

function declaredNames(program: Node): string[] {
  const names = new Set<string>()
  const add = (id: unknown): void => void ((id as Node | null)?.type === 'Identifier' && names.add((id as unknown as { name: string }).name))
  const pattern = (p: Node | null): void => {
    if (!p) return
    if (p.type === 'Identifier') add(p)
    else if (p.type === 'ObjectPattern') for (const q of p.properties as Node[]) pattern((q.type === 'RestElement' ? q.argument : q.value) as Node)
    else if (p.type === 'ArrayPattern') for (const q of p.elements as (Node | null)[]) pattern(q)
    else if (p.type === 'AssignmentPattern') pattern(p.left as Node)
    else if (p.type === 'RestElement') pattern(p.argument as Node)
  }
  const decl = (n: Node | null): void => {
    if (!n || n.declare) return
    if (n.type === 'VariableDeclaration') for (const d of n.declarations as Node[]) pattern(d.id as Node)
    else if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration' || n.type === 'TSEnumDeclaration') add(n.id)
    else if (n.type === 'ImportDeclaration' && n.importKind !== 'type') {
      for (const sp of (n.specifiers ?? []) as Node[]) if (sp.importKind !== 'type') add(sp.local)
    } else if (n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') decl(n.declaration as Node | null)
  }
  for (const n of (program as unknown as { body: Node[] }).body) decl(n)
  return [...names]
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

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node)
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key]
    if (Array.isArray(child)) for (const c of child) c && typeof c === 'object' && walk(c as Node, visit)
    else if (child && typeof child === 'object') walk(child as Node, visit)
  }
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
