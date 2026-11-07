import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import type { Result } from '../shared/protocol'

export type BundleOptions = { minify: boolean; inlinePackages: boolean }

/**
 * Builds a scratch with the bundled `bun build` and returns the JavaScript (TS types stripped, relative
 * imports inlined). Packages stay as imports unless `inlinePackages`. Reads the file from disk, so callers
 * save first.
 */
export function bundle(bun: string, file: string, packagesDir: string, o: BundleOptions): Promise<Result<string>> {
  const args = ['build', file, '--target=node', '--format=esm', ...(o.inlinePackages ? [] : ['--packages=external']), ...(o.minify ? ['--minify'] : [])]
  return new Promise((done) => {
    const child = spawn(bun, args, {
      cwd: dirname(file),
      env: { ...process.env, NODE_PATH: join(packagesDir, 'node_modules'), NO_COLOR: '1' },
      windowsHide: true
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
    child.on('error', (e) => {
      clearTimeout(timer)
      done({ ok: false, error: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done(code === 0 ? { ok: true, value: out } : { ok: false, error: err.trim() || `Build failed (exit ${code})` })
    })
  })
}
