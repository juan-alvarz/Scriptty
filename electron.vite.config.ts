import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [svelte()],
    resolve: {
      // monaco-vim imports Monaco's pre-0.57 deep paths, which Monaco's package exports no longer map.
      alias: [{ find: /^monaco-editor\/esm\/vs\/(.*?)(\.js)?$/, replacement: resolve('node_modules/monaco-editor/esm/vs/$1.js') }]
    }
  }
})
