<script lang="ts">
  import { onMount } from 'svelte'
  import type { PackageInfo } from '../../shared/protocol'
  import PackageDetails from './PackageDetails.svelte'
  import { PACKAGES_CHANGED } from './missing'
  import { setPackageNames } from './monaco'

  let { onchange, oninsert }: { onchange: () => void; oninsert: (importLine: string) => void } = $props()

  let opened = $state('')

  let list = $state<PackageInfo[]>([])
  let typeLibraries = $state<PackageInfo[]>([])
  let typesOpen = $state(false)
  /** A package just added without types, and the @types package to offer for it. */
  let offer = $state<{ name: string; typesPackage: string } | null>(null)
  let spec = $state('')
  let busy = $state('')
  let error = $state('')

  const refresh = async (): Promise<void> => {
    const r = await window.scriptty.packages.list()
    list = r.packages
    typeLibraries = r.typeLibraries
    setPackageNames(list.map((p) => p.name))
  }
  onMount(() => {
    refresh()
    window.addEventListener(PACKAGES_CHANGED, refresh)
    return () => window.removeEventListener(PACKAGES_CHANGED, refresh)
  })

  /** Runs one install or removal at a time, then reloads the list and the editor's types. */
  async function run(label: string, task: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
    if (busy) return false
    busy = label
    error = ''
    const r = await task()
    busy = ''
    if (!r.ok) error = r.error ?? 'Failed'
    await refresh()
    onchange()
    return r.ok
  }

  async function add(e: SubmitEvent): Promise<void> {
    e.preventDefault()
    const s = spec.trim()
    if (!s) return
    offer = null
    await run(`Installing ${s}…`, async () => {
      const r = await window.scriptty.packages.add(s)
      if (r.ok) {
        spec = ''
        if (r.value.typesPackage) offer = { name: r.value.name, typesPackage: r.value.typesPackage }
      }
      return r
    })
  }

  function installTypes(name: string): Promise<boolean> {
    offer = null
    return run(`Installing types for ${name}…`, () => window.scriptty.packages.addTypes(name))
  }

  function remove(name: string): Promise<boolean> {
    if (offer?.name === name) offer = null
    return run(`Removing ${name}…`, () => window.scriptty.packages.remove(name))
  }
</script>

{#snippet row(p: PackageInfo)}
  <div class="pk">
    <button class="open" title="Details for {p.name}" onclick={() => (opened = p.name)}>
      <span class="nm">{p.name}</span>
      <span class="ver">{p.version}</span>
    </button>
    <button class="rm" title="Remove {p.name}" aria-label="Remove {p.name}" onclick={() => remove(p.name)} disabled={!!busy}>×</button>
  </div>
{/snippet}

<section>
  <h5>Packages</h5>
  {#each list as p (p.name)}
    {@render row(p)}
  {:else}
    {#if !busy}<p class="hint">No packages yet. Add one below, then import it by name.</p>{/if}
  {/each}
  {#if typeLibraries.length}
    <button class="group" aria-expanded={typesOpen} onclick={() => (typesOpen = !typesOpen)}>
      <span class="ic" aria-hidden="true">{typesOpen ? '▾' : '▸'}</span>
      <span class="nm">Type libraries</span>
      <span class="ver">{typeLibraries.length}</span>
    </button>
    {#if typesOpen}
      <div class="nested">
        {#each typeLibraries as p (p.name)}{@render row(p)}{/each}
      </div>
    {/if}
  {/if}
  {#if offer}
    <div class="offer" role="group" aria-label="Install types for {offer.name}">
      <p><b>{offer.name}</b> has no types. Install <code>{offer.typesPackage}</code> for autocomplete?</p>
      <div class="actions">
        <button class="btn" onclick={() => offer && installTypes(offer.name)} disabled={!!busy}>Install types</button>
        <button class="btn" onclick={() => (offer = null)}>No thanks</button>
      </div>
    </div>
  {/if}
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
  <PackageDetails name={opened} {oninsert} onremove={remove} oninstalltypes={installTypes} onclose={() => (opened = '')} />
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
  .group {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 4px;
    border: 0;
    background: none;
    text-align: left;
    padding: 3px 8px 3px 4px;
    border-radius: 6px;
    color: var(--muted);
    cursor: pointer;
  }
  .group:hover {
    background: color-mix(in srgb, var(--fg) 6%, transparent);
    color: var(--fg);
  }
  .ic {
    width: 12px;
    font-size: 10px;
  }
  .nested {
    padding-left: 12px;
  }
  .offer {
    margin: 6px 0 2px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    font-size: 12px;
  }
  .offer p {
    margin: 0 0 8px;
    overflow-wrap: anywhere;
  }
  .offer code {
    font: 11px var(--mono);
  }
  /* The sidebar can be 160px wide: buttons share the row and wrap rather than overflow. */
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .actions .btn {
    flex: 1 1 auto;
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
