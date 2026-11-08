<script lang="ts">
  import type { SearchMatch, TreeNode } from '../../shared/protocol'
  import Tree from './Tree.svelte'
  import Search from './Search.svelte'
  import Packages from './Packages.svelte'
  import SidebarToggle from './SidebarToggle.svelte'

  type Props = {
    tree: TreeNode[]
    current: string
    selected: string
    renaming: string
    collapsed: Record<string, boolean>
    notice: string
    mod: string
    mode: 'files' | 'search'
    /** Bumped to focus the search box (⇧⌘F). */
    searchFocus: number
    onmode: (m: 'files' | 'search') => void
    onflush: () => Promise<void>
    onreveal: (m: SearchMatch) => void
    ontoggle: () => void
    oncreate: (kind: 'file' | 'folder') => void
    onopen: (n: TreeNode) => void
    /** `null` when the empty area below the tree was right-clicked. */
    oncontext: (n: TreeNode | null) => void
    onrename: (n: TreeNode, name: string) => void
    oncancel: () => void
    ondismiss: () => void
    onpackageschange: () => void
    oninsert: (importLine: string) => void
  }
  let p: Props = $props()
</script>

<aside class="side">
  <div class="drag traffic"><SidebarToggle hidden={false} mod={p.mod} ontoggle={p.ontoggle} /></div>
  <section
    class="scratches"
    role="group"
    aria-label={p.mode === 'files' ? 'Scratches' : 'Search'}
    oncontextmenu={(e) => {
      if (p.mode !== 'files') return
      e.preventDefault()
      p.oncontext(null)
    }}
  >
    <div class="sh">
      <div class="modes" role="tablist" aria-label="Sidebar">
        <button role="tab" aria-selected={p.mode === 'files'} onclick={() => p.onmode('files')}>Scratches</button>
        <button role="tab" aria-selected={p.mode === 'search'} title="Search all scratches (⇧{p.mod}F)" onclick={() => p.onmode('search')}>Search</button>
      </div>
      <span class="sp"></span>
      {#if p.mode === 'files'}
        <button class="mini" title="New file ({p.mod}N)" aria-label="New file" onclick={() => p.oncreate('file')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h5l3 3v9H4z M9 2v3h3 M8 8v4 M6 10h4" /></svg>
        </button>
        <button class="mini" title="New folder (⇧{p.mod}N)" aria-label="New folder" onclick={() => p.oncreate('folder')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h4l1.5 1.5H14V13H2z M8 7.5v4 M6 9.5h4" /></svg>
        </button>
      {/if}
    </div>
    {#if p.mode === 'files'}
      <Tree
        nodes={p.tree}
        current={p.current}
        selected={p.selected}
        renaming={p.renaming}
        collapsed={p.collapsed}
        onopen={p.onopen}
        oncontext={p.oncontext}
        onrename={p.onrename}
        oncancel={p.oncancel}
      />
    {/if}
    <!-- Stays mounted while hidden, so the query and results survive a trip to the file tree. -->
    <Search active={p.mode === 'search'} focusSignal={p.searchFocus} onflush={p.onflush} onreveal={p.onreveal} />
  </section>
  {#if p.mode === 'files'}
    <Packages onchange={p.onpackageschange} oninsert={p.oninsert} />
  {/if}
  {#if p.notice}
    <p class="notice" role="alert">{p.notice}<button aria-label="Dismiss" onclick={p.ondismiss}>×</button></p>
  {/if}
</aside>

<style>
  .side {
    position: relative;
    min-height: 0;
    background: var(--side);
    border-right: 1px solid var(--line);
    padding: 0 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    font-size: 12.5px;
    overflow: auto;
  }
  :global([data-platform='darwin']) .side {
    background: transparent;
  }
  /* The toggle sits 80px from the window edge on macOS (right of the traffic lights), 10px elsewhere (the side padding). */
  .traffic {
    height: 40px;
    flex: none;
    display: flex;
    align-items: center;
  }
  :global([data-platform='darwin']) .traffic {
    padding-left: 70px;
  }
  .scratches {
    flex: 1 0 auto;
    min-height: 80px;
  }
  .sh {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 6px;
  }
  /* Mode tabs look like the section headings (h5) they replace. */
  .modes {
    display: flex;
    gap: 10px;
    margin-left: 8px;
  }
  .modes button {
    border: 0;
    background: none;
    padding: 2px 0;
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    border-bottom: 1.5px solid transparent;
  }
  .modes button:hover {
    color: var(--fg);
  }
  .modes button[aria-selected='true'] {
    color: var(--fg);
    border-bottom-color: var(--accent);
  }
  .mini {
    width: 22px;
    height: 22px;
    border: 0;
    background: none;
    border-radius: 5px;
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--muted);
  }
  .mini:hover {
    background: color-mix(in srgb, var(--fg) 8%, transparent);
    color: var(--fg);
  }
  .mini svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .notice {
    margin: 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--err) 12%, transparent);
    color: var(--err);
    display: flex;
    gap: 8px;
    align-items: start;
    user-select: text;
  }
  .notice button {
    margin-left: auto;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
  }
</style>
