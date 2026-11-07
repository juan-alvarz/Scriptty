import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process'
import type { Result } from '../shared/protocol'

export type ExecOutput = { code: number | null; stdout: string; stderr: string }

/** Runs a command to completion and collects its output. Kills it after `timeoutMs`. Fails only if it cannot start. */
export function exec(cmd: string, args: string[], options: SpawnOptionsWithoutStdio, timeoutMs: number): Promise<Result<ExecOutput>> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { windowsHide: true, ...options })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      done({ ok: false, error: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ ok: true, value: { code, stdout, stderr } })
    })
  })
}
