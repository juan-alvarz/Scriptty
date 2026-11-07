/// <reference types="svelte" />
/// <reference types="vite/client" />
import type { ScripttyApi } from '../../preload'

declare global {
  interface Window {
    scriptty: ScripttyApi
  }
}
