// Snippet JSON -> editor suggestions. Plain TS without Monaco, so it runs in the unit tests.
import type { Snippet } from '../../shared/protocol'

/** One suggestion; monaco.ts adds the kind, insert rules and line numbers. */
export type SnippetSuggestion = {
  label: { label: string; description: string }
  filterText: string
  insertText: string
  detail: string
  /** Markdown: the body as code, with placeholders filled in. */
  documentation: string
  sortText: string
  /** 1-based column where the typed prefix starts; the suggestion replaces from here to the cursor. */
  startColumn: number
}

/** VS Code's `scope` is a comma list of language ids; no scope means every language. */
export const inScope = (s: Snippet, language: string): boolean =>
  !s.scope || s.scope.split(',').some((l) => l.trim() === language)

/**
 * The body as it reads once inserted: placeholders and the first choice filled in, tab stops and
 * variables without a default left empty, escapes resolved.
 */
export function preview(body: string): string {
  let i = 0
  const read = (stopAt: string): string => {
    let out = ''
    while (i < body.length) {
      const c = body[i]
      if (c === '\\' && i + 1 < body.length && '$}\\,|'.includes(body[i + 1])) {
        out += body[i + 1]
        i += 2
      } else if (stopAt.includes(c)) {
        return out
      } else if (c === '$') {
        out += dollar()
      } else {
        out += c
        i++
      }
    }
    return out
  }
  const dollar = (): string => {
    const simple = /^\$(\d+|[A-Za-z_]\w*)/.exec(body.slice(i))
    if (simple) {
      i += simple[0].length
      return ''
    }
    const open = /^\$\{(\d+|[A-Za-z_]\w*)/.exec(body.slice(i))
    if (!open) {
      i++
      return '$'
    }
    i += open[0].length
    let text = ''
    if (body[i] === ':') {
      i++
      text = read('}')
    } else if (body[i] === '|') {
      i++
      const first = read(',|')
      while (i < body.length && body[i] !== '}') i++ // skip the other choices
      text = first
    } else {
      // ${1}, or a transform like ${TM_FILENAME/(.*)/$1/}: show nothing for it
      while (i < body.length && body[i] !== '}') i++
    }
    if (body[i] === '}') i++
    return text
  }
  return read('')
}

/** 1-based column where `prefix` starts in the text before the cursor, or 0 when no part of it was typed. */
export function prefixStart(lineBefore: string, prefix: string): number {
  const p = prefix.toLowerCase()
  const line = lineBefore.toLowerCase()
  for (let n = Math.min(p.length, line.length); n > 0; n--) {
    if (!line.endsWith(p.slice(0, n))) continue
    const at = line.length - n
    // Only from the start of a token, so `foo` + `oclg` never counts as a partial `clg`.
    if (at > 0 && /[\w$]/.test(lineBefore[at - 1]) && /[\w$]/.test(prefix[0])) continue
    return at + 1
  }
  return 0
}

/**
 * Suggestions for the snippets in scope. `wordStart` is Monaco's word start (1-based), used when
 * the typed text only matches a prefix fuzzily (`cg` for `clg`), so Monaco's filter decides.
 */
export function toSuggestions(snippets: Snippet[], language: string, lineBefore: string, wordStart: number): SnippetSuggestion[] {
  const out: SnippetSuggestion[] = []
  for (const s of snippets) {
    if (!inScope(s, language)) continue
    for (const prefix of s.prefix) {
      out.push({
        label: { label: prefix, description: s.name },
        filterText: prefix,
        insertText: s.body,
        detail: s.description || s.name,
        documentation: '```' + language + '\n' + preview(s.body) + '\n```',
        // "~" sorts after the TS service's sortTexts (digits, "z" for deprecated), so on a tie (nothing typed
        // yet, e.g. inside an object literal) properties and variables come first.
        sortText: '~' + prefix,
        startColumn: prefixStart(lineBefore, prefix) || wordStart
      })
    }
  }
  return out
}
