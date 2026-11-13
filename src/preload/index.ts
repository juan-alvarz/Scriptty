import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  Added,
  Breakpoints,
  BundleOptions,
  DebugCommand,
  DebugEvent,
  DebugScope,
  DebugValue,
  DebugVar,
  PackageList,
  PackageDetails,
  Result,
  RunResponse,
  RunnerEvent,
  SearchOptions,
  SearchResult,
  Settings,
  Snippet,
  SnippetsState,
  TreeAction,
  TreeNode,
  TypeLib
} from '../shared/protocol'
import type { ActionId } from '../shared/keybindings'

function listen<T>(channel: string, cb: (m: T) => void): () => void {
  const h = (_e: IpcRendererEvent, m: T): void => cb(m)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api = {
  platform: process.platform,
  run: (code: string, file: string): Promise<RunResponse> => ipcRenderer.invoke('run', code, file),
  /** Stops the active run. Resolves false if nothing was running. */
  stop: (): Promise<boolean> => ipcRenderer.invoke('stop'),
  onEvent: (cb: (e: RunnerEvent) => void) => listen('runner:event', cb),
  /** App actions, from a shortcut (matched in main) or the menu. */
  onMenu: (cb: (a: ActionId) => void) => listen('menu', cb),
  debug: {
    /** Runs `code` as `file` with the debugger attached; it stops at `breakpoints` and `debugger;` statements. */
    start: (code: string, file: string, breakpoints: Breakpoints): Promise<RunResponse> => ipcRenderer.invoke('debug:start', code, file, breakpoints),
    command: (c: DebugCommand): Promise<void> => ipcRenderer.invoke('debug:command', c),
    stop: (): Promise<void> => ipcRenderer.invoke('debug:stop'),
    setBreakpoints: (file: string, lines: number[]): Promise<void> => ipcRenderer.invoke('debug:breakpoints', file, lines),
    scopes: (frame: number): Promise<Result<DebugScope[]>> => ipcRenderer.invoke('debug:scopes', frame),
    /** Watch: evaluates expressions in a frame of the current pause, one value per expression. */
    watch: (frame: number, expressions: string[]): Promise<Result<DebugValue[]>> => ipcRenderer.invoke('debug:watch', frame, expressions),
    props: (objectId: string, type: string): Promise<Result<DebugVar[]>> => ipcRenderer.invoke('debug:props', objectId, type),
    onEvent: (cb: (e: DebugEvent) => void) => listen('debug:event', cb)
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch)
  },
  fs: {
    root: (): Promise<string> => ipcRenderer.invoke('fs:root'),
    tree: (): Promise<Result<TreeNode[]>> => ipcRenderer.invoke('fs:tree'),
    read: (rel: string): Promise<Result<string>> => ipcRenderer.invoke('fs:read', rel),
    readAll: (): Promise<Result<{ path: string; content: string }[]>> => ipcRenderer.invoke('fs:read-all'),
    write: (rel: string, content: string): Promise<Result> => ipcRenderer.invoke('fs:write', rel, content),
    create: (dirRel: string, kind: 'file' | 'folder'): Promise<Result<string>> => ipcRenderer.invoke('fs:create', dirRel, kind),
    rename: (rel: string, name: string): Promise<Result<string>> => ipcRenderer.invoke('fs:rename', rel, name),
    trash: (rel: string): Promise<Result> => ipcRenderer.invoke('fs:trash', rel),
    confirmTrash: (name: string, folder: boolean): Promise<boolean> => ipcRenderer.invoke('fs:confirm-trash', name, folder),
    reveal: (rel: string): Promise<Result> => ipcRenderer.invoke('fs:reveal', rel),
    search: (query: string, o: SearchOptions): Promise<SearchResult> => ipcRenderer.invoke('fs:search', query, o),
    menu: (onItem: boolean): Promise<TreeAction | null> => ipcRenderer.invoke('fs:menu', onItem)
  },
  packages: {
    list: (): Promise<PackageList> => ipcRenderer.invoke('pkg:list'),
    add: (spec: string): Promise<Result<Added>> => ipcRenderer.invoke('pkg:add', spec),
    addTypes: (name: string): Promise<Result> => ipcRenderer.invoke('pkg:add-types', name),
    remove: (name: string): Promise<Result> => ipcRenderer.invoke('pkg:remove', name),
    types: (): Promise<TypeLib[]> => ipcRenderer.invoke('pkg:types'),
    info: (name: string): Promise<Result<PackageDetails>> => ipcRenderer.invoke('pkg:info', name)
  },
  snippets: {
    get: (): Promise<SnippetsState> => ipcRenderer.invoke('snippets:get'),
    /** Adds a snippet, or replaces the one called `oldName`. */
    put: (oldName: string | null, s: Snippet): Promise<Result<SnippetsState>> => ipcRenderer.invoke('snippets:put', oldName, s),
    remove: (name: string): Promise<Result<SnippetsState>> => ipcRenderer.invoke('snippets:remove', name),
    restore: (): Promise<Result<SnippetsState>> => ipcRenderer.invoke('snippets:restore'),
    /** Opens snippets.json in the system's default app for JSON. */
    open: (): Promise<void> => ipcRenderer.invoke('snippets:open'),
    reveal: (): Promise<void> => ipcRenderer.invoke('snippets:reveal'),
    onChange: (cb: (s: SnippetsState) => void) => listen('snippets:changed', cb)
  },
  keys: {
    /** Resolves with the next shortcut pressed, or null for Esc or cancel(). App shortcuts do nothing meanwhile. */
    record: (): Promise<string | null> => ipcRenderer.invoke('keys:record'),
    cancel: (): Promise<void> => ipcRenderer.invoke('keys:cancel')
  },
  bundle: (rel: string, o: BundleOptions): Promise<Result<string>> => ipcRenderer.invoke('bundle', rel, o),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url)
}

contextBridge.exposeInMainWorld('scriptty', api)

export type ScripttyApi = typeof api
