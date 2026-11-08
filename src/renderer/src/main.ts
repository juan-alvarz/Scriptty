import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { setSnippets } from './monaco'

document.documentElement.dataset.platform = window.scriptty.platform

// The snippet completion provider follows the snippets file, whether edited in Settings or on disk.
window.scriptty.snippets.get().then((s) => setSnippets(s.snippets))
window.scriptty.snippets.onChange((s) => setSnippets(s.snippets))

export default mount(App, { target: document.getElementById('app')! })
