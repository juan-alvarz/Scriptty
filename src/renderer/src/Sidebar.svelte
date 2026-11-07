<script lang="ts">
  import type { TreeNode } from '../../shared/protocol'
  import Tree from './Tree.svelte'
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
    aria-label="Scratches"
    oncontextmenu={(e) => {
      e.preventDefault()
      p.oncontext(null)
    }}
  >
    <div class="sh">
      <h5>Scratches</h5>
      <span class="sp"></span>
      <button class="mini" title="New file ({p.mod}N)" aria-label="New file" onclick={() => p.oncreate('file')}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h5l3 3v9H4z M9 2v3h3 M8 8v4 M6 10h4" /></svg>
      </button>
      <button class="mini" title="New folder (⇧{p.mod}N)" aria-label="New folder" onclick={() => p.oncreate('folder')}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h4l1.5 1.5H14V13H2z M8 7.5v4 M6 9.5h4" /></svg>
      </button>
    </div>
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
  </section>
  <Packages onchange={p.onpackageschange} oninsert={p.oninsert} />
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
  .sh h5 {
    margin-bottom: 0;
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
