import { dirname, join } from 'node:path'
import type { BundleOptions, Result } from '../shared/protocol'
import { exec } from './exec'

/**
 * Builds a scratch with the bundled `bun build` and returns the JavaScript (TS types stripped, relative
 * imports inlined). Packages stay as imports unless `inlinePackages`. Reads the file from disk, so callers
 * save first.
 */
export async function bundle(bun: string, file: string, packagesDir: string, o: BundleOptions): Promise<Result<string>> {
  const args = ['build', file, '--target=node', '--format=esm', ...(o.inlinePackages ? [] : ['--packages=external']), ...(o.minify ? ['--minify'] : [])]
  const r = await exec(bun, args, { cwd: dirname(file), env: { ...process.env, NODE_PATH: join(packagesDir, 'node_modules'), NO_COLOR: '1' } }, 30_000)
  if (!r.ok) return r
  const { code, stdout, stderr } = r.value
  return code === 0 ? { ok: true, value: stdout } : { ok: false, error: stderr.trim() || `Build failed (exit ${code})` }
}
