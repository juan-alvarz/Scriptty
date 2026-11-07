import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  BundleOptions,
  MenuAction,
  PackageInfo,
  PackageDetails,
  Result,
  RunResponse,
  RunnerEvent,
  Settings,
  TreeAction,
  TreeNode,
  TypeLib
} from '../shared/protocol'

function listen<T>(channel: string, cb: (m: T) => void): () => void {
  const h = (_e: IpcRendererEvent, m: T): void => cb(m)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api = {
  platform: process.platform,
  run: (code: string, file: string): Promise<RunResponse> => ipcRenderer.invoke('run', code, file),
  onEvent: (cb: (e: RunnerEvent) => void) => listen('runner:event', cb),
  onMenu: (cb: (a: MenuAction) => void) => listen('menu', cb),
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
    reveal: (rel: string): Promise<Result> => ipcRenderer.invoke('fs:reveal', rel),
    menu: (onItem: boolean): Promise<TreeAction | null> => ipcRenderer.invoke('fs:menu', onItem)
  },
  packages: {
    list: (): Promise<PackageInfo[]> => ipcRenderer.invoke('pkg:list'),
    add: (spec: string): Promise<Result> => ipcRenderer.invoke('pkg:add', spec),
    remove: (name: string): Promise<Result> => ipcRenderer.invoke('pkg:remove', name),
    types: (): Promise<TypeLib[]> => ipcRenderer.invoke('pkg:types'),
    info: (name: string): Promise<Result<PackageDetails>> => ipcRenderer.invoke('pkg:info', name)
  },
  bundle: (rel: string, o: BundleOptions): Promise<Result<string>> => ipcRenderer.invoke('bundle', rel, o),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url)
}

contextBridge.exposeInMainWorld('scriptty', api)

export type ScripttyApi = typeof api
