<script lang="ts">
  import type { PackageDetails } from '../../shared/protocol'

  type Props = { name: string; oninsert: (line: string) => void; onremove: (name: string) => void; onclose: () => void }
  let { name, oninsert, onremove, onclose }: Props = $props()

  let dialog: HTMLDialogElement
  let info = $state<PackageDetails | null>(null)
  let error = $state('')
  let copied = $state(false)

  $effect(() => {
    if (!name) return
    info = null
    error = ''
    if (!dialog.open) dialog.showModal()
    window.scriptty.packages.info(name).then((r) => (r.ok ? (info = r.value) : (error = r.error)))
  })

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

        <div class="use">
          <code>{info.importLine}</code>
          <button class="btn" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <button class="btn primary" onclick={() => (oninsert(info!.importLine), dialog.close())}>Add to file</button>
        </div>

        <dl>
          <dt>Version</dt><dd>{info.version}</dd>
          <dt>License</dt><dd>{info.license || '—'}</dd>
          <dt>Types</dt><dd>{typesLabel[info.types]}</dd>
          <dt>Links</dt>
          <dd class="links">
            <button class="link" onclick={() => window.scriptty.openExternal(info!.npm)}>npm</button>
            {#if info.homepage}<button class="link" onclick={() => window.scriptty.openExternal(info!.homepage)}>Homepage</button>{/if}
            {#if info.repository}<button class="link" onclick={() => window.scriptty.openExternal(info!.repository)}>Repository</button>{/if}
          </dd>
          <dt>Depends on</dt>
          <dd>{info.dependencies.length ? info.dependencies.join(', ') : 'Nothing'}</dd>
        </dl>

        {#if info.readme}
          <h4>README</h4>
          <pre class="readme">{info.readme}</pre>
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
  .readme {
    margin: 0;
    font: 12px/1.55 var(--mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px;
    background: var(--panel);
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
