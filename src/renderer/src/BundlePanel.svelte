<script lang="ts">
  import { onMount } from 'svelte'
  import { createViewer, type monaco } from './monaco'
  import { copyText } from './clipboard'

  let { file, hidden }: { file: string; hidden: boolean } = $props()

  let viewerEl: HTMLDivElement
  let viewer: monaco.editor.IStandaloneCodeEditor | null = null
  let opts = $state({ minify: false, inlinePackages: false })
  let build = $state({ busy: false, error: '', bytes: 0 })
  let seq = 0

  /** Builds the saved file with bun; the newest request wins. */
  export async function refresh(): Promise<void> {
    if (!file || !viewer) return
    const mine = ++seq
    build = { ...build, busy: true }
    const r = await window.scriptty.bundle(file, { ...opts })
    if (mine !== seq) return
    if (r.ok) {
      viewer.setValue(r.value)
      build = { busy: false, error: '', bytes: new Blob([r.value]).size }
    } else {
      build = { busy: false, error: r.error, bytes: 0 }
    }
  }

  export function clear(): void {
    viewer?.setValue('')
  }

  onMount(() => {
    const v = createViewer(viewerEl)
    viewer = v
    return () => v.dispose()
  })
</script>

<div class="bundle" {hidden} aria-label="Bundle">
  <header>
    <label><input type="checkbox" bind:checked={opts.minify} onchange={refresh} /> Minify</label>
    <label title="Inline installed packages instead of leaving them as imports">
      <input type="checkbox" bind:checked={opts.inlinePackages} onchange={refresh} /> Include packages
    </label>
    <span class="sp"></span>
    <span class="muted">{build.busy ? 'Building…' : build.error ? 'Build failed' : `${(build.bytes / 1024).toFixed(1)} KB`}</span>
    <button class="tbtn" onclick={() => copyText(viewer?.getValue() ?? '')} disabled={!!build.error}>Copy</button>
  </header>
  {#if build.error}<pre class="berr" role="alert">{build.error}</pre>{/if}
  <div class="vhost" class:dim={!!build.error}><div class="host" bind:this={viewerEl}></div></div>
</div>

<style>
  .bundle {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .bundle[hidden] {
    display: none;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 10px 6px 14px;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }
  .vhost {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .vhost.dim {
    opacity: 0.4;
  }
  .berr {
    margin: 0;
    padding: 10px 14px;
    font: 12px/1.5 var(--mono);
    color: var(--err);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border-bottom: 1px solid var(--line);
    max-height: 40%;
    overflow: auto;
    user-select: text;
  }
</style>
