import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_SETTINGS, MAX_SPLITS, WIDTH_LIMITS, type Settings, type Split } from '../shared/protocol'
import { sanitizeOverrides } from '../shared/keybindings'

const isMac = process.platform === 'darwin'

const clamp = (n: unknown, lo: number, hi: number, d: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d

const paths = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((f) => typeof f === 'string'))].slice(0, 30) : [])

/** Up to MAX_SPLITS splits with at least one tab each. Settings from before splits (`openFiles`, `lastFile`) become one split. */
function splitsOf(input: Partial<Settings> & { openFiles?: unknown; lastFile?: unknown }, base: Split[]): Split[] {
  const raw = input.splits ?? ('openFiles' in input ? [{ files: input.openFiles, current: input.lastFile }] : base)
  if (!Array.isArray(raw)) return base
  return raw
    .map((g: { files?: unknown; current?: unknown }) => {
      const files = paths(g?.files)
      const current = typeof g?.current === 'string' && files.includes(g.current) ? g.current : (files[0] ?? '')
      return { files, current }
    })
    .filter((g) => g.files.length)
    .slice(0, MAX_SPLITS)
}

/** Validates every field, so a hand-edited or old settings.json can never break the app. */
export function sanitize(input: Partial<Settings>, base: Settings = DEFAULT_SETTINGS, mac = isMac): Settings {
  const s = { ...base, ...input }
  const splits = splitsOf(input, base.splits)
  return {
    appearance: ['system', 'light', 'dark'].includes(s.appearance) ? s.appearance : base.appearance,
    fontSize: clamp(s.fontSize, 10, 24, base.fontSize),
    tabSize: [2, 4].includes(s.tabSize) ? s.tabSize : base.tabSize,
    vim: typeof s.vim === 'boolean' ? s.vim : base.vim,
    autoRun: typeof s.autoRun === 'boolean' ? s.autoRun : base.autoRun,
    runDelayMs: clamp(s.runDelayMs, 0, 2000, base.runDelayMs),
    freezeSeconds: clamp(s.freezeSeconds, 1, 120, base.freezeSeconds),
    splits,
    activeSplit: clamp(s.activeSplit, 0, Math.max(0, splits.length - 1), 0),
    keybindings: 'keybindings' in input ? sanitizeOverrides(input.keybindings, mac) : base.keybindings,
    sidebarHidden: typeof s.sidebarHidden === 'boolean' ? s.sidebarHidden : base.sidebarHidden,
    sidebarWidth: clamp(s.sidebarWidth, ...WIDTH_LIMITS.sidebar, base.sidebarWidth),
    resultsWidth: clamp(s.resultsWidth, ...WIDTH_LIMITS.results, base.resultsWidth)
  }
}

export function loadSettings(file: string): Settings {
  try {
    return sanitize(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(file: string, s: Settings): void {
  writeFileSync(file, JSON.stringify(s, null, 2))
}
