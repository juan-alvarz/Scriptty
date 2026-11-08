import { mkdirSync, mkdtempSync, utimesSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EnvFiles, envDirs, parseEnv, resolveEnv } from './env'

const parse = (text: string, base: Record<string, string> = {}): Record<string, string> => resolveEnv([parseEnv(text)], base)

describe('parseEnv', () => {
  it('reads plain values, comments, export and empty values', () => {
    const text = [
      '# a comment',
      '',
      'A=1',
      '  B = two words  ',
      'export C=3',
      'D=',
      'E',
      'F=x # trailing comment',
      'G=no#comment',
      'H.dotted-name=ok',
      '1BAD=nope'
    ].join('\n')
    expect(parse(text)).toEqual({ A: '1', B: 'two words', C: '3', D: '', F: 'x', G: 'no#comment', 'H.dotted-name': 'ok' })
  })

  it('handles single, double and backtick quotes', () => {
    const text = [
      `S='keep \\n  # and $x ${'${A}'}'`,
      'D="line1\\nline2\\t\\"q\\" \\\\ \\$"  # after the quote',
      'B=`it\'s "both"`',
      'E=""',
      'M="multi',
      'line"',
      'U="unclosed'
    ].join('\n')
    expect(parse(text)).toEqual({
      S: 'keep \\n  # and $x ${A}',
      D: 'line1\nline2\t"q" \\ $',
      B: `it's "both"`,
      E: '',
      M: 'multi\nline',
      U: '"unclosed'
    })
  })

  it('handles CRLF line endings', () => {
    expect(parse('A=1\r\nB="x"\r\nC=\r\n')).toEqual({ A: '1', B: 'x', C: '' })
  })

  it('expands ${VAR} in unquoted and double-quoted values only', () => {
    const text = ['HOST=example.com', 'URL=https://${HOST}/api', 'Q="${HOST}:${PORT}"', "S='${HOST}'", 'E="\\${HOST}"', 'P=$HOST', 'X=${MISSING}!', 'H=${HOME}'].join('\n')
    expect(parse(text, { PORT: '8080', HOME: '/home/me' })).toEqual({
      HOST: 'example.com',
      URL: 'https://example.com/api',
      Q: 'example.com:8080',
      S: '${HOST}',
      E: '${HOST}',
      P: '$HOST',
      X: '!',
      H: '/home/me'
    })
  })

  it('lets a nearer file override and refer to a farther one', () => {
    const env = resolveEnv([parseEnv('A=root\nB=root\nURL=https://x'), parseEnv('B=near\nURL=${URL}/sub')])
    expect(env).toEqual({ A: 'root', B: 'near', URL: 'https://x/sub' })
  })
})

describe('envDirs', () => {
  it('lists folders from the root down to the scratch folder', () => {
    const root = join(tmpdir(), 'ws')
    expect(envDirs(root, root)).toEqual([root])
    expect(envDirs(root, join(root, 'a', 'b'))).toEqual([root, join(root, 'a'), join(root, 'a', 'b')])
    expect(envDirs(root, join(tmpdir(), 'elsewhere'))).toEqual([join(tmpdir(), 'elsewhere')])
  })
})

describe('EnvFiles', () => {
  it('merges the chain, nearer wins, and re-reads a file only when it changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scriptty-env-'))
    const sub = join(root, 'a', 'b')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(root, '.env'), 'FOO=root\nBAR=root')
    writeFileSync(join(root, 'a', 'b', '.env'), 'FOO=near')
    const files = new EnvFiles(root)
    expect(await files.load(sub, {})).toEqual({ FOO: 'near', BAR: 'root' })
    expect(await files.load(root, {})).toEqual({ FOO: 'root', BAR: 'root' })

    // Same mtime and size: the cached parse is used.
    const t = new Date(2026, 0, 1)
    utimesSync(join(root, '.env'), t, t)
    await files.load(root, {})
    writeFileSync(join(root, '.env'), 'FOO=ROOT\nBAR=ROOT')
    utimesSync(join(root, '.env'), t, t)
    expect(await files.load(root, {})).toEqual({ FOO: 'root', BAR: 'root' })
    // A new mtime: read again.
    utimesSync(join(root, '.env'), new Date(), new Date())
    expect(await files.load(root, {})).toEqual({ FOO: 'ROOT', BAR: 'ROOT' })

    rmSync(join(root, '.env'))
    expect(await files.load(sub, {})).toEqual({ FOO: 'near' })
  })
})
