<script lang="ts">
  import { onMount } from 'svelte'
  import type { PackageInfo } from '../../shared/protocol'
  import PackageDetails from './PackageDetails.svelte'
  import { setPackageNames } from './monaco'

  let { onchange, oninsert }: { onchange: () => void; oninsert: (importLine: string) => void } = $props()

  let opened = $state('')

  let list = $state<PackageInfo[]>([])
  let spec = $state('')
  let busy = $state('')
  let error = $state('')

  const refresh = async (): Promise<void> => {
    list = await window.scriptty.packages.list()
    setPackageNames(list.map((p) => p.name))
  }
  onMount(refresh)

  async function add(e: SubmitEvent): Promise<void> {
    e.preventDefault()
    const s = spec.trim()
    if (!s || busy) return
    busy = `Installing ${s}…`
    error = ''
    const r = await window.scriptty.packages.add(s)
    busy = ''
    if (r.ok) spec = ''
    else error = r.error
    await refresh()
    onchange()
  }

  async function remove(name: string): Promise<void> {
    if (busy) return
    busy = `Removing ${name}…`
    error = ''
    const r = await window.scriptty.packages.remove(name)
    busy = ''
    if (!r.ok) error = r.error
    await refresh()
    onchange()
  }
</script>

<section>
  <h5>Packages</h5>
  {#each list as p (p.name)}
    <div class="pk">
      <button class="open" title="Details for {p.name}" onclick={() => (opened = p.name)}>
        <span class="nm">{p.name}</span>
        <span class="ver">{p.version}</span>
      </button>
      <button class="rm" title="Remove {p.name}" aria-label="Remove {p.name}" onclick={() => remove(p.name)} disabled={!!busy}>×</button>
    </div>
  {:else}
    {#if !busy}<p class="hint">No packages yet. Add one below, then import it by name.</p>{/if}
  {/each}
  {#if busy}<p class="hint busy">{busy}</p>{/if}
  {#if error}<p class="hint err" role="alert">{error}</p>{/if}
  <form onsubmit={add}>
    <input
      id="add-package"
      bind:value={spec}
      placeholder="Add package…"
      aria-label="Add package by name, for example zod or lodash@4"
      autocomplete="off"
      spellcheck="false"
      disabled={!!busy}
    />
  </form>
</section>

{#if opened}
  <PackageDetails name={opened} {oninsert} onremove={remove} onclose={() => (opened = '')} />
{/if}

<style>
  .pk {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px 0 0;
    border-radius: 6px;
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: none;
    text-align: left;
    padding: 3px 0 3px 8px;
    cursor: pointer;
  }
  .pk:hover {
    background: color-mix(in srgb, var(--fg) 6%, transparent);
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ver {
    color: var(--muted);
    font: 11px var(--mono);
  }
  .rm {
    border: 0;
    background: none;
    color: var(--muted);
    width: 18px;
    height: 18px;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
  }
  .pk:hover .rm,
  .rm:focus-visible {
    opacity: 1;
  }
  .rm:hover {
    color: var(--err);
  }
  .hint {
    margin: 2px 8px 6px;
    color: var(--muted);
    font-size: 12px;
  }
  .busy {
    color: var(--warn);
  }
  .err {
    color: var(--err);
    user-select: text;
  }
  input {
    margin-top: 4px;
    width: 100%;
    box-sizing: border-box;
    font: 12px var(--mono);
    color: var(--fg);
    background: var(--field);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 5px 8px;
    user-select: text;
  }
</style>
