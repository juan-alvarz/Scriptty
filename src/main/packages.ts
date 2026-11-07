import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PackageDetails, PackageInfo, Result, TypeLib } from '../shared/protocol'

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

/** One shared package environment, installed with the bundled bun (decision 9). */
export class Packages {
  constructor(
    private dir: string,
    private bun: string,
    private cacheDir: string
  ) {}

  list(): PackageInfo[] {
    const deps = this.manifest().dependencies ?? {}
    return Object.keys(deps)
      .sort()
      .map((name) => ({ name, version: this.installedVersion(name) ?? deps[name] }))
  }

  add(spec: string): Promise<Result> {
    if (!isValidSpec(spec)) return Promise.resolve({ ok: false, error: `"${spec}" is not a valid package name` })
    return this.bunCmd(['add', spec])
  }

  remove(name: string): Promise<Result> {
    if (!isValidSpec(name)) return Promise.resolve({ ok: false, error: `"${name}" is not a valid package name` })
    return this.bunCmd(['remove', name])
  }

  /** What the package panel shows when a package is clicked. Reads only files inside node_modules/<name>. */
  info(name: string): PackageDetails {
    if (!isValidSpec(name) || !(name in (this.manifest().dependencies ?? {}))) throw new Error(`${name} is not installed`)
    const dir = join(this.dir, 'node_modules', name)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const typesEntry = [pkg.types, pkg.typings, 'index.d.ts'].find((f) => typeof f === 'string' && existsSync(join(dir, f)))
    const types = typesEntry ? 'bundled' : existsSync(join(this.dir, 'node_modules/@types', name.replace(/^@([^/]+)\//, '$1__'))) ? '@types' : 'none'
    const typesText = typesEntry ? readFileSync(join(dir, typesEntry), 'utf8') : ''
    const id = identifierFor(name)
    // Default import when the types say there is one (or for untyped CJS, which bun default-imports fine).
    const importLine = /export\s+default|export\s*=/.test(typesText) || types === 'none' ? `import ${id} from "${name}"` : `import * as ${id} from "${name}"`
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
    for (const e of readdirSync(nm, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const names = e.name.startsWith('@') ? readdirSync(join(nm, e.name)).map((n) => `${e.name}/${n}`) : [e.name]
      for (const name of names) walk(join(nm, name), name)
    }
    return libs
  }

  private manifest(): { dependencies?: Record<string, string> } {
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

  private bunCmd(args: string[]): Promise<Result> {
    return new Promise((done) => {
      const child = spawn(this.bun, [...args, '--no-progress'], {
        cwd: this.dir,
        env: { ...process.env, BUN_INSTALL_CACHE_DIR: this.cacheDir, NO_COLOR: '1' },
        windowsHide: true
      })
      let out = ''
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (out += d))
      const timer = setTimeout(() => child.kill('SIGKILL'), 5 * 60_000)
      child.on('error', (e) => {
        clearTimeout(timer)
        done({ ok: false, error: e.message })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const lastError = out.split('\n').find((l) => /error/i.test(l))?.trim()
        done(code === 0 ? { ok: true, value: undefined } : { ok: false, error: lastError || `Install failed (exit ${code})` })
      })
    })
  }
}
