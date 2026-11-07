import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_SETTINGS, WIDTH_LIMITS, type Settings } from '../shared/protocol'

const clamp = (n: unknown, lo: number, hi: number, d: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d

/** Validates every field, so a hand-edited or old settings.json can never break the app. */
export function sanitize(input: Partial<Settings>, base: Settings = DEFAULT_SETTINGS): Settings {
  const s = { ...base, ...input }
  return {
    appearance: ['system', 'light', 'dark'].includes(s.appearance) ? s.appearance : base.appearance,
    fontSize: clamp(s.fontSize, 10, 24, base.fontSize),
    tabSize: [2, 4].includes(s.tabSize) ? s.tabSize : base.tabSize,
    vim: typeof s.vim === 'boolean' ? s.vim : base.vim,
    autoRun: typeof s.autoRun === 'boolean' ? s.autoRun : base.autoRun,
    runDelayMs: clamp(s.runDelayMs, 0, 2000, base.runDelayMs),
    freezeSeconds: clamp(s.freezeSeconds, 1, 120, base.freezeSeconds),
    lastFile: typeof s.lastFile === 'string' ? s.lastFile : base.lastFile,
    openFiles: Array.isArray(s.openFiles) ? [...new Set(s.openFiles.filter((f) => typeof f === 'string'))].slice(0, 30) : base.openFiles,
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
