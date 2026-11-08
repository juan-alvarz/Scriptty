<script lang="ts">
  import type { PackageDetails } from '../../shared/protocol'
  import { renderMarkdown } from './markdown'
  import { colorizeCode } from './monaco'

  type Props = {
    name: string
    oninsert: (line: string) => void
    onremove: (name: string) => void
    /** Installs the package's @types; resolves true when it worked. */
    oninstalltypes: (name: string) => Promise<boolean>
    onclose: () => void
  }
  let { name, oninsert, onremove, oninstalltypes, onclose }: Props = $props()

  let dialog: HTMLDialogElement
  let info = $state<PackageDetails | null>(null)
  let error = $state('')
  let copied = $state(false)
  let readmeEl = $state<HTMLElement>()
  const readme = $derived(info?.readme ? renderMarkdown(info.readme, info.repository) : '')

  // README links never navigate the window: in-page anchors scroll, https links open in the browser.
  $effect(() => {
    const el = readmeEl
    if (!el || !readme) return
    colorizeCode(el)
    const follow = (e: MouseEvent): void => {
      const a = (e.target as Element).closest('a')
      if (!a || (e.type === 'auxclick' && e.button !== 1)) return
      e.preventDefault()
      const href = a.getAttribute('href') ?? ''
      if (href.startsWith('#')) {
        let slug = href.slice(1)
        try {
          slug = decodeURIComponent(slug)
        } catch {
          // keep it encoded
        }
        el.querySelector(`[data-slug="${CSS.escape(slug)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      } else if (href.startsWith('https://')) window.scriptty.openExternal(href)
    }
    el.addEventListener('click', follow)
    el.addEventListener('auxclick', follow)
    return () => {
      el.removeEventListener('click', follow)
      el.removeEventListener('auxclick', follow)
    }
  })

  $effect(() => {
    if (!name) return
    info = null
    error = ''
    if (!dialog.open) dialog.showModal()
    load(name)
  })

  function load(n: string): void {
    window.scriptty.packages.info(n).then((r) => (r.ok ? (info = r.value) : (error = r.error)))
  }

  let installing = $state(false)
  async function installTypes(): Promise<void> {
    installing = true
    if (await oninstalltypes(name)) load(name)
    installing = false
  }

  async function copy(): Promise<void> {
    if (!info) return
    try {
      await navigator.clipboard.writeText(info.importLine)
      copied = true
      setTimeout(() => (copied = false), 1200)
    } catch {
      // clipboard unavailable: the line is selectable
    }
  }

  const typesLabel = { bundled: 'Included', '@types': 'From @types', none: 'None (imports are untyped)' }
</script>

<dialog bind:this={dialog} onclose={onclose} onclick={(e) => e.target === dialog && dialog.close()} aria-label="Package details">
  <div class="win">
    <header>
      <b>{name}</b>
      {#if info}<span class="ver">{info.version}</span>{/if}
      <button class="x" onclick={() => dialog.close()} aria-label="Close package details">×</button>
    </header>
    <div class="body">
      {#if error}
        <p class="err" role="alert">{error}</p>
      {:else if !info}
        <p class="muted">Loading…</p>
      {:else}
        {#if info.description}<p class="desc">{info.description}</p>{/if}

        {#if info.importLine}
        <div class="use">
          <code>{info.importLine}</code>
          <button class="btn" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <button class="btn primary" onclick={() => (oninsert(info!.importLine), dialog.close())}>Add to file</button>
        </div>
        {/if}

        <dl>
          <dt>Version</dt><dd>{info.version}</dd>
          <dt>License</dt><dd>{info.license || '—'}</dd>
          <dt>Types</dt>
          <dd>
            {typesLabel[info.types]}
            {#if info.types === 'none'}
              <button class="link" onclick={installTypes} disabled={installing}>{installing ? 'Installing…' : 'Install types'}</button>
            {/if}
          </dd>
          <dt>Links</dt>
          <dd class="links">
            <button class="link" onclick={() => window.scriptty.openExternal(info!.npm)}>npm</button>
            {#if info.homepage}<button class="link" onclick={() => window.scriptty.openExternal(info!.homepage)}>Homepage</button>{/if}
            {#if info.repository}<button class="link" onclick={() => window.scriptty.openExternal(info!.repository)}>Repository</button>{/if}
          </dd>
          <dt>Depends on</dt>
          <dd>{info.dependencies.length ? info.dependencies.join(', ') : 'Nothing'}</dd>
        </dl>

        {#if readme}
          <h4>README</h4>
          <!-- Sanitized by renderMarkdown: allowlisted tags only, https links, images shown as alt text. -->
          <div class="readme" bind:this={readmeEl}>{@html readme}</div>
        {/if}
      {/if}
    </div>
    <footer>
      <button class="btn danger" onclick={() => (onremove(name), dialog.close())} disabled={!info}>Remove package</button>
    </footer>
  </div>
</dialog>

<style>
  dialog {
    width: 640px;
    height: 560px;
  }
  .win {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    height: 100%;
  }
  header {
    height: 42px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px 0 18px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    font-size: 14px;
  }
  .ver {
    font: 12px var(--mono);
    color: var(--muted);
  }
  .x {
    margin-left: auto;
    border: 0;
    background: none;
    font-size: 18px;
    color: var(--muted);
    cursor: pointer;
    width: 26px;
    height: 26px;
    border-radius: 6px;
  }
  .body {
    overflow: auto;
    padding: 16px 18px;
    display: grid;
    gap: 14px;
    align-content: start;
    user-select: text;
  }
  .desc {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
  .err {
    color: var(--err);
    margin: 0;
  }
  .use {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
  }
  .use code {
    flex: 1;
    min-width: 0;
    font: 12.5px var(--mono);
    overflow-x: auto;
    white-space: nowrap;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 6px 12px;
    font-size: 13px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .links {
    display: flex;
    gap: 12px;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font-size: 13px;
  }
  .link:hover {
    text-decoration: underline;
  }
  h4 {
    margin: 4px 0 0;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  /* Rendered README (markdown.ts). Its HTML is injected, so rules reach it through :global. */
  .readme {
    min-width: 0;
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .readme > :global(:first-child) {
    margin-top: 0;
  }
  .readme > :global(:last-child) {
    margin-bottom: 0;
  }
  .readme :global(:is(h1, h2, h3, h4, h5, h6)) {
    margin: 1.4em 0 0.5em;
    line-height: 1.3;
    font-weight: 600;
    scroll-margin-top: 8px;
  }
  .readme :global(h1) {
    font-size: 20px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line);
  }
  .readme :global(h2) {
    font-size: 16px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--line);
  }
  .readme :global(h3) {
    font-size: 14px;
  }
  .readme :global(:is(h4, h5, h6)) {
    font-size: 13px;
  }
  .readme :global(h6) {
    color: var(--muted);
  }
  .readme :global(:is(p, ul, ol, dl, blockquote, pre, table, details)) {
    margin: 0 0 0.9em;
  }
  .readme :global(:is(ul, ol)) {
    padding-left: 1.6em;
  }
  .readme :global(li + li),
  .readme :global(li > :is(ul, ol)) {
    margin-top: 0.25em;
  }
  .readme :global(li > :is(ul, ol)) {
    margin-bottom: 0;
  }
  .readme :global(li:has(> input[type='checkbox'])) {
    list-style: none;
  }
  .readme :global(input[type='checkbox']) {
    margin: 0 0.4em 0 -1.3em;
    vertical-align: -2px;
  }
  .readme :global(a) {
    color: var(--accent);
    text-decoration: none;
    cursor: pointer;
  }
  .readme :global(a[href]:hover) {
    text-decoration: underline;
  }
  .readme :global(a:not([href])) {
    color: inherit;
    cursor: text;
  }
  .readme :global(:is(code, kbd, samp)) {
    font: 0.92em var(--mono);
  }
  .readme :global(:not(pre) > code),
  .readme :global(kbd) {
    padding: 0.1em 0.35em;
    border-radius: 4px;
    background: var(--panel);
    border: 1px solid var(--line);
    overflow-wrap: anywhere;
  }
  .readme :global(pre) {
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    overflow-x: auto;
    overflow-wrap: normal;
  }
  .readme :global(pre code) {
    font: 12px/1.55 var(--mono);
    white-space: pre;
  }
  .readme :global(blockquote) {
    padding: 0 0 0 12px;
    border-left: 3px solid var(--line);
    color: var(--muted);
  }
  .readme :global(hr) {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 1.2em 0;
  }
  .readme :global(table) {
    display: block;
    max-width: 100%;
    width: max-content;
    overflow-x: auto;
    border-collapse: collapse;
    font-size: 12.5px;
    overflow-wrap: normal;
  }
  .readme :global(:is(th, td)) {
    padding: 5px 10px;
    border: 1px solid var(--line);
    text-align: left;
    vertical-align: top;
  }
  .readme :global(th) {
    background: var(--panel);
    font-weight: 600;
  }
  .readme :global(:is(th, td)[align='center']) {
    text-align: center;
  }
  .readme :global(:is(th, td)[align='right']) {
    text-align: right;
  }
  .readme :global(summary) {
    cursor: pointer;
  }
  /* Images are not loaded (CSP img-src 'self' data:): markdown.ts leaves their alt text in this chip. */
  .readme :global(.md-img) {
    display: inline-block;
    padding: 0 6px;
    margin: 1px 0;
    border: 1px dashed var(--line);
    border-radius: 4px;
    font-size: 11.5px;
    line-height: 18px;
    color: var(--muted);
  }
  .readme :global(a[href] .md-img) {
    color: var(--accent);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    padding: 10px 14px;
    border-top: 1px solid var(--line);
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .danger {
    color: var(--err);
  }
</style>
