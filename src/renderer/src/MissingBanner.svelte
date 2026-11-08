<script lang="ts">
  import { PACKAGES_CHANGED } from './missing'

  // `missing` comes from the last run of `file`. `onadded` runs after an install (reload types, run again).
  type Props = { file: string; missing: string[]; onadded: () => void }
  let { file, missing, onadded }: Props = $props()

  let busy = $state('')
  let error = $state('')
  // Packages the user dismissed, per file; a package that goes missing later shows again.
  let dismissed = $state<Record<string, string[]>>({})

  const shown = $derived(missing.filter((n) => !dismissed[file]?.includes(n)))

  /** Adds packages one by one with progress in the banner. Also used by the editor's quick fix. */
  export async function install(names: string[]): Promise<void> {
    if (busy || !names.length) return
    error = ''
    let added = 0
    for (const [i, name] of names.entries()) {
      busy = `Adding ${name}…` + (names.length > 1 ? ` (${i + 1}/${names.length})` : '')
      const r = await window.scriptty.packages.add(name)
      if (!r.ok) {
        error = `Could not add ${name}: ${r.error}`
        break
      }
      added++
    }
    busy = ''
    if (!added) return
    window.dispatchEvent(new Event(PACKAGES_CHANGED))
    onadded()
  }

  function dismiss(): void {
    error = ''
    dismissed[file] = [...(dismissed[file] ?? []), ...shown]
  }
</script>

{#if busy || error || shown.length}
  <div class="banner" class:err={!!error && !busy} role="status">
    {#if busy}
      <span class="spin" aria-hidden="true"></span><span class="msg">{busy}</span>
    {:else if error}
      <span class="msg" role="alert">{error}</span>
    {:else}
      <span class="msg">
        <code>{shown[0]}</code>
        {#if shown.length > 1}and {shown.length - 1} more aren't installed{:else}isn't installed{/if}
      </span>
      <span class="sep">—</span>
      <button class="link" onclick={() => install([shown[0]])}>Add</button>
      {#if shown.length > 1}
        <span class="sep">·</span>
        <button class="link" onclick={() => install(shown)}>Add all ({shown.length})</button>
      {/if}
    {/if}
    <span class="sp"></span>
    {#if !busy}<button class="x" aria-label="Dismiss" title="Dismiss for this file" onclick={dismiss}>×</button>{/if}
  </div>
{/if}

<style>
  .banner {
    height: 28px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px 0 12px;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--warn) 9%, var(--bg));
    font-size: 12px;
    white-space: nowrap;
    box-sizing: border-box;
  }
  .banner.err {
    background: color-mix(in srgb, var(--err) 9%, var(--bg));
    color: var(--err);
  }
  .msg {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    user-select: text;
  }
  code {
    font: 11.5px var(--mono);
    color: var(--warn);
  }
  .sep {
    color: var(--muted);
  }
  .link {
    border: 0;
    background: none;
    padding: 2px 2px;
    color: var(--accent);
    font-weight: 600;
    cursor: pointer;
    border-radius: 4px;
  }
  .link:hover {
    text-decoration: underline;
  }
  .x {
    border: 0;
    background: none;
    color: var(--muted);
    width: 20px;
    height: 20px;
    border-radius: 4px;
    cursor: pointer;
  }
  .x:hover {
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 8%, transparent);
  }
  .spin {
    width: 10px;
    height: 10px;
    border: 1.5px solid color-mix(in srgb, var(--warn) 35%, transparent);
    border-top-color: var(--warn);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
