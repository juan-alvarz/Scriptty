import { resolve } from 'node:path'
import { parseSync, visitorKeys } from 'oxc-parser'
import MagicString from 'magic-string'

export type Instrumented =
  | { ok: true; code: string; imports: string[] }
  | { ok: false; error: string; line: number }

type Node = { type: string; start: number; end: number; [key: string]: unknown }

/**
 * Reports values with `__r(line, value)` (see `reportValues`) and tags each `console.x(` call as `__log(line, "x")(`.
 * Only inserts text on existing lines, so runtime error line numbers match the editor.
 * Lines are 1-based. Output stays TypeScript: bun runs it natively.
 * With `baseDir`, relative import specifiers become absolute paths, because the instrumented copy runs
 * from another folder than the scratch.
 */
export function instrument(source: string, filename = 'scratch.ts', baseDir?: string): Instrumented {
  const { program, errors, comments } = parseSync(filename, source)
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
  }
  reportValues(program as unknown as Node, comments, source, lineOf, s)

  return { ok: true, code: s.toString(), imports: [...imports] }
}

type Comment = { type: string; value: string; start: number; end: number }
type Wrap = { start: number; end: number; line: number; quiet: boolean }

/**
 * Value reports, Quokka style (see docs/architecture.md, "Value reports"):
 * - Every expression statement, at any depth (function bodies, loops, blocks), becomes `__r(line, (expr))` on the
 *   line where it ends. Calls (`f()`, `await f()`, `a?.b()`) and `void x` pass a third argument, `1`, so an
 *   `undefined` result is not shown.
 * - A `const`/`let`/`var` statement in a block or at top level gets `;__r(line, x);` appended on the line where it
 *   ends. Several bound names (destructuring, `a = 1, b = 2`) report one object, `{ a, b }`. Names bound to
 *   functions or classes are left out.
 * - A `//?` (or `/*?*\/`) comment makes the line report even an `undefined` call result. Unless a report
 *   already ends at the comment, it also wraps the outermost expression that ends there before it
 *   (`return a + b //?`, an argument, a condition).
 * Never wrapped: directives, `super(...)`, `yield`, console calls (they report themselves), assignment targets,
 * callees (keeps `this`), links inside optional chains, `delete`/`typeof` operands, shorthand properties, methods.
 */
function reportValues(program: Node, comments: Comment[], source: string, lineOf: (o: number) => number, s: MagicString): void {
  // Line -> offset of its `//?` marker; candidates must end before it.
  const forced = new Map<number, number>()
  for (const c of comments) {
    if (c.type === 'Line' ? /^\?(\s|$)/.test(c.value) : c.value.trim() === '?') forced.set(lineOf(c.start), c.start)
  }
  const wraps: Wrap[] = []
  // Line -> end offset of the last automatic report on it; `//?` adds a wrap only for an expression ending later.
  const covered = new Map<number, number>()
  const cover = (line: number, end: number): void => void covered.set(line, Math.max(end, covered.get(line) ?? -1))
  const best = new Map<number, Node>()

  const visit = (node: Node, parent: Node | null, key: string, inChain: boolean): void => {
    if (node.type === 'ExpressionStatement' && !node.directive) {
      const expr = node.expression as Node
      const line = lineOf(expr.end - 1)
      if (consoleMethod(expr)) cover(line, expr.end)
      else if (!unreportable(expr)) {
        cover(line, expr.end)
        wraps.push({ start: expr.start, end: expr.end, line, quiet: isQuiet(expr) && !forced.has(line) })
      }
    } else if (parent && BLOCKS.has(parent.type) && (node.type === 'VariableDeclaration' || isExportedVars(node))) {
      reportDeclaration(node, source, lineOf, s, cover)
    }
    if (consoleMethod(node)) cover(lineOf(node.end - 1), node.end)

    if (parent && forced.size && isCandidate(node, parent, key, inChain)) {
      const line = lineOf(node.end - 1)
      const at = forced.get(line)
      const cur = best.get(line)
      if (at !== undefined && node.end <= at && (!cur || node.end > cur.end || (node.end === cur.end && node.start < cur.start)))
        best.set(line, node)
    }

    for (const k of childKeys(node)) {
      if (!descends(node, k)) continue
      const childInChain = node.type === 'ChainExpression' || (inChain && (k === 'object' || k === 'callee'))
      const child = node[k]
      if (Array.isArray(child)) for (const c of child) c && typeof c === 'object' && visit(c as Node, node, k, childInChain)
      else if (child && typeof child === 'object') visit(child as Node, node, k, childInChain)
    }
  }
  visit(program, null, '', false)

  for (const [line, node] of best) if (node.end > (covered.get(line) ?? -1)) wraps.push({ start: node.start, end: node.end, line, quiet: false })
  // Inner wraps first, so an outer wrap sharing a start or end offset lands outside it.
  wraps.sort((a, b) => a.end - a.start - (b.end - b.start))
  for (const w of wraps) {
    s.prependLeft(w.start, `__r(${w.line}, (`)
    s.appendRight(w.end, w.quiet ? '), 1)' : '))')
  }
}

/** Statement lists, where a declaration can be followed by another statement on the same line. */
const BLOCKS = new Set(['Program', 'BlockStatement', 'StaticBlock', 'SwitchCase', 'TSModuleBlock'])
const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'ClassExpression'])

function isExportedVars(node: Node): boolean {
  return node.type === 'ExportNamedDeclaration' && (node.declaration as Node | null)?.type === 'VariableDeclaration'
}

function reportDeclaration(stmt: Node, source: string, lineOf: (o: number) => number, s: MagicString, cover: (line: number, end: number) => void): void {
  const decl = stmt.type === 'VariableDeclaration' ? stmt : (stmt.declaration as Node)
  if (decl.declare) return
  const names: string[] = []
  for (const d of decl.declarations as Node[]) {
    const init = d.init as Node | null
    if (init && !FUNCTIONS.has(unwrap(init).type)) boundNames(d.id as Node, names)
  }
  if (!names.length) return
  const line = lineOf(stmt.end - 1)
  cover(line, stmt.end)
  const value = names.length === 1 ? names[0] : `{ ${names.join(', ')} }`
  // The trailing `;` keeps a next line starting with `(` or `[` from becoming a call on our report.
  s.appendLeft(stmt.end, `${source[stmt.end - 1] === ';' ? '' : ';'}__r(${line}, ${value});`)
}

function boundNames(pattern: Node, out: string[]): void {
  if (pattern.type === 'Identifier') out.push(pattern.name as string)
  else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties as Node[]) boundNames((p.type === 'RestElement' ? p : (p.value as Node)), out)
  else if (pattern.type === 'ArrayPattern') for (const e of pattern.elements as (Node | null)[]) e && boundNames(e, out)
  else if (pattern.type === 'AssignmentPattern') boundNames(pattern.left as Node, out)
  else if (pattern.type === 'RestElement') boundNames(pattern.argument as Node, out)
}

/** Strips parentheses and TS-only wrappers (`x as T`, `x!`, `x satisfies T`). */
function unwrap(node: Node): Node {
  while (TS_EXPRESSIONS.has(node.type) || node.type === 'ParenthesizedExpression') node = node.expression as Node
  return node
}

/** Statements whose wrapping would change what the code means. */
function unreportable(expr: Node): boolean {
  const e = unwrap(expr)
  return e.type === 'YieldExpression' || (e.type === 'CallExpression' && (e.callee as Node).type === 'Super')
}

/** Calls and `void`, whose `undefined` result is noise. */
function isQuiet(expr: Node): boolean {
  let e = unwrap(expr)
  if (e.type === 'AwaitExpression') e = unwrap(e.argument as Node)
  if (e.type === 'ChainExpression') e = e.expression as Node
  return e.type === 'CallExpression' || (e.type === 'UnaryExpression' && e.operator === 'void')
}

const TS_EXPRESSIONS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion'])
const EXPRESSIONS = new Set([
  'Identifier', 'Literal', 'TemplateLiteral', 'ArrayExpression', 'ObjectExpression', 'CallExpression', 'NewExpression',
  'MemberExpression', 'ChainExpression', 'BinaryExpression', 'LogicalExpression', 'UnaryExpression', 'UpdateExpression',
  'AssignmentExpression', 'ConditionalExpression', 'SequenceExpression', 'AwaitExpression', 'TaggedTemplateExpression',
  'ThisExpression', 'ParenthesizedExpression', ...TS_EXPRESSIONS
])
/** Never looked into: type-only code, bindings, labels, module syntax. */
const OPAQUE = new Set(['ImportDeclaration', 'ExportAllDeclaration', 'MetaProperty', 'Decorator', 'ObjectPattern', 'ArrayPattern', 'RestElement'])
const SKIPPED_KEYS = new Set(['id', 'params', 'label', 'param', 'decorators', 'typeAnnotation', 'typeArguments', 'typeParameters', 'returnType', 'superTypeArguments', 'implements'])

function childKeys(node: Node): readonly string[] {
  if (TS_EXPRESSIONS.has(node.type)) return ['expression']
  if (node.type === 'TSModuleDeclaration' || node.type === 'TSModuleBlock') return ['body']
  if (node.type.startsWith('TS') || node.type.startsWith('JSX') || OPAQUE.has(node.type)) return []
  if (node.type === 'ExportNamedDeclaration') return ['declaration']
  return visitorKeys[node.type] ?? []
}

function descends(node: Node, key: string): boolean {
  if (SKIPPED_KEYS.has(key)) return false
  if (node.type === 'ExpressionStatement' && node.directive) return false
  // Assignment targets and operands whose meaning depends on not being evaluated first.
  if ((node.type === 'AssignmentExpression' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') && key === 'left') return false
  if (node.type === 'UpdateExpression') return false
  if (node.type === 'UnaryExpression' && (node.operator === 'delete' || node.operator === 'typeof')) return false
  if (node.type === 'Property' && node.shorthand) return false
  if (key === 'key' && !node.computed) return false
  if (node.type === 'MemberExpression' && key === 'property' && !node.computed) return false
  return true
}

function isCandidate(node: Node, parent: Node, key: string, inChain: boolean): boolean {
  if (!EXPRESSIONS.has(node.type) || consoleMethod(node) || unreportable(node)) return false
  if (key === 'callee' || key === 'tag' || (key === 'object' && inChain)) return false
  if (parent.type === 'ImportExpression' && key === 'source') return false
  return true
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
