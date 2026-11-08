import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Added, PackageDetails, PackageInfo, PackageList, Result, TypeLib } from '../shared/protocol'
import { exec } from './exec'

// npm package name with an optional @version or @tag. Rejects anything that could be read as a CLI flag.
const SPEC = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=*|-]+)?$/i

export const isValidSpec = (spec: string): boolean => SPEC.test(spec) && !spec.startsWith('-')

/** Turns package.json `repository` forms (`github:a/b`, `a/b`, `git+https://…/b.git`, objects) into an https URL. */
export function repoUrl(repo: unknown): string {
  const raw = typeof repo === 'string' ? repo : typeof repo === 'object' && repo ? String((repo as { url?: unknown }).url ?? '') : ''
  const short = raw.match(/^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+)$/)
  if (short) return `https://${short[1] ?? 'github'}.${short[1] === 'bitbucket' ? 'org' : 'com'}/${short[2]}`
  const url = raw.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://').replace(/\.git$/, '')
  return /^https?:\/\//.test(url) ? url.replace(/^http:/, 'https:') : ''
}

const httpsOnly = (u: unknown): string => (typeof u === 'string' && /^https?:\/\//.test(u) ? u.replace(/^http:/, 'https:') : '')

/** `date-fns` -> `dateFns`, `@scope/x-y` -> `xY`. */
const identifierFor = (name: string): string =>
  (name.split('/').pop() ?? name).replace(/[^\w$]+(\w)/g, (_m, c: string) => c.toUpperCase()).replace(/^[^a-zA-Z_$]/, '_$&')

/** `lodash@4` -> `lodash`, `@scope/x@^1` -> `@scope/x`. */
const nameOf = (spec: string): string => spec.replace(/(.)@.*$/, '$1')

/** The DefinitelyTyped package for `name`: `@types/lodash`, `@types/scope__x`. */
const typesPackageOf = (name: string): string => `@types/${name.replace(/^@([^/]+)\//, '$1__')}`

/** Whether npm has this package. Offline counts as yes: the install then reports the real error. */
async function published(name: string): Promise<boolean> {
  try {
    const r = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
    return r.status !== 404
  } catch {
    return true
  }
}

/** Absolute path of the declaration file a package folder points to, if it has one. */
function typesEntryIn(dir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return [pkg.types, pkg.typings, 'index.d.ts'].map((f) => (typeof f === 'string' ? join(dir, f) : '')).find((f) => f && existsSync(f))
  } catch {
    return undefined
  }
}

/** One shared package environment, installed with the bundled bun (decision 9). */
export class Packages {
  constructor(
    private dir: string,
    private bun: string,
    private cacheDir: string
  ) {}

  list(): PackageList {
    const m = this.manifest()
    const infos = (deps: Record<string, string>): PackageInfo[] =>
      Object.keys(deps)
        .sort()
        .map((name) => ({ name, version: this.installedVersion(name) ?? deps[name] }))
    const typeLibraries = Object.fromEntries(Object.entries(m.devDependencies ?? {}).filter(([name]) => name.startsWith('@types/')))
    return { packages: infos(m.dependencies ?? {}), typeLibraries: infos(typeLibraries) }
  }

  /** Installs a package. For one without types, says which @types package exists, so the UI can offer it. */
  async add(spec: string): Promise<Result<Added>> {
    if (!isValidSpec(spec)) return { ok: false, error: `"${spec}" is not a valid package name` }
    const r = await this.bunCmd(['add', spec])
    if (!r.ok) return r
    const name = nameOf(spec)
    const typesPackage = typesPackageOf(name)
    const offer = this.typesOf(name).kind === 'none' && (await published(typesPackage))
    return { ok: true, value: { name, typesPackage: offer ? typesPackage : null } }
  }

  /** Installs DefinitelyTyped declarations for an installed package. A dev dependency, so it lists apart. */
  addTypes(name: string): Promise<Result> {
    if (!isValidSpec(name) || !(name in (this.manifest().dependencies ?? {}))) return Promise.resolve({ ok: false, error: `${name} is not installed` })
    return this.bunCmd(['add', '--dev', typesPackageOf(name)])
  }

  async remove(name: string): Promise<Result> {
    if (!isValidSpec(name)) return { ok: false, error: `"${name}" is not a valid package name` }
    const r = await this.bunCmd(['remove', name])
    const typesPackage = typesPackageOf(name)
    if (r.ok && typesPackage in (this.manifest().devDependencies ?? {})) await this.bunCmd(['remove', typesPackage])
    return r
  }

  /** Where a package's declarations come from: its own files, its @types package, or nowhere. */
  private typesOf(name: string): { kind: PackageDetails['types']; entry?: string } {
    const own = typesEntryIn(join(this.dir, 'node_modules', name))
    if (own) return { kind: 'bundled', entry: own }
    const fromTypes = typesEntryIn(join(this.dir, 'node_modules', typesPackageOf(name)))
    return fromTypes ? { kind: '@types', entry: fromTypes } : { kind: 'none' }
  }

  /** What the package panel shows when a package is clicked. Reads only files inside node_modules/<name>. */
  info(name: string): PackageDetails {
    const m = this.manifest()
    if (!isValidSpec(name) || !(name in { ...m.dependencies, ...m.devDependencies })) throw new Error(`${name} is not installed`)
    const dir = join(this.dir, 'node_modules', name)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const { kind: types, entry: typesEntry } = this.typesOf(name)
    const typesText = typesEntry ? readFileSync(typesEntry, 'utf8') : ''
    const id = identifierFor(name)
    // Default import when the types say there is one (or for untyped CJS, which bun default-imports fine).
    // Type libraries are never imported by name: TypeScript picks them up for their package.
    const importLine = name.startsWith('@types/')
      ? ''
      : /export\s+default|export\s*=/.test(typesText) || types === 'none'
        ? `import ${id} from "${name}"`
        : `import * as ${id} from "${name}"`
    const readmeFile = readdirSync(dir).find((f) => /^readme(\.md|\.markdown|\.txt)?$/i.test(f))
    const readme = readmeFile ? readFileSync(join(dir, readmeFile), 'utf8').slice(0, 200_000) : ''
    return {
      name,
      version: pkg.version ?? '',
      description: typeof pkg.description === 'string' ? pkg.description : '',
      license: typeof pkg.license === 'string' ? pkg.license : '',
      homepage: httpsOnly(pkg.homepage),
      repository: repoUrl(pkg.repository),
      npm: `https://www.npmjs.com/package/${name}`,
      dependencies: Object.keys(pkg.dependencies ?? {}).sort(),
      types,
      importLine,
      readme
    }
  }

  /**
   * Type declarations of every installed package, as Monaco extra libs under file:///node_modules/.
   * shortcut: sends all .d.ts files up to a size cap; switch to on-demand loading if workspaces get large.
   */
  types(nodeTypes: string | null, maxBytes = 30 * 1024 * 1024): TypeLib[] {
    const nm = join(this.dir, 'node_modules')
    const libs: TypeLib[] = []
    let total = 0
    const add = (abs: string, rel: string): void => {
      const size = statSync(abs).size
      if (total + size > maxBytes) return
      total += size
      libs.push({ path: `file:///node_modules/${rel}`, content: readFileSync(abs, 'utf8') })
    }
    const walk = (abs: string, rel: string): void => {
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        const a = join(abs, e.name)
        const r = `${rel}/${e.name}`
        if (e.isDirectory()) walk(a, r)
        else if (/\.d\.[mc]?ts$/.test(e.name) || (e.name === 'package.json' && rel.split('/').length <= 2)) add(a, r)
      }
    }
    // Bundled @types/node, so `node:fs` and friends type-check (bun implements them). A user-installed copy wins.
    if (nodeTypes && existsSync(nodeTypes) && !existsSync(join(nm, '@types/node'))) walk(nodeTypes, '@types/node')
    if (!existsSync(nm)) return libs
    // Packages with no declarations at all import as `any`, instead of "Cannot find module".
    const untyped = Object.keys(this.manifest().dependencies ?? {}).filter((name) => this.typesOf(name).kind === 'none')
    if (untyped.length) libs.push({ path: 'file:///node_modules/@scriptty/untyped.d.ts', content: untyped.map((n) => `declare module ${JSON.stringify(n)};`).join('\n') })
    for (const e of readdirSync(nm, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const names = e.name.startsWith('@') ? readdirSync(join(nm, e.name)).map((n) => `${e.name}/${n}`) : [e.name]
      for (const name of names) walk(join(nm, name), name)
    }
    return libs
  }

  private manifest(): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
    try {
      return JSON.parse(readFileSync(join(this.dir, 'package.json'), 'utf8'))
    } catch {
      return {}
    }
  }

  private installedVersion(name: string): string | null {
    try {
      return JSON.parse(readFileSync(join(this.dir, 'node_modules', name, 'package.json'), 'utf8')).version
    } catch {
      return null
    }
  }

  private async bunCmd(args: string[]): Promise<Result> {
    const env = { ...process.env, BUN_INSTALL_CACHE_DIR: this.cacheDir, NO_COLOR: '1' }
    const r = await exec(this.bun, [...args, '--no-progress'], { cwd: this.dir, env }, 5 * 60_000)
    if (!r.ok) return r
    const { code, stdout, stderr } = r.value
    if (code === 0) return { ok: true, value: undefined }
    const firstError = `${stderr}\n${stdout}`.split('\n').find((l) => /error/i.test(l))?.trim()
    return { ok: false, error: firstError || `Install failed (exit ${code})` }
  }
}
