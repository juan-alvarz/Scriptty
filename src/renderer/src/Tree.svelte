<script lang="ts">
  import type { TreeNode } from '../../shared/protocol'
  import Tree from './Tree.svelte'
  import { FILE_DRAG, type FileDrag } from './splits'
  import { mac } from './keys.svelte'

  type Props = {
    nodes: TreeNode[]
    depth?: number
    current: string
    selected: string
    renaming: string
    collapsed: Record<string, boolean>
    onopen: (n: TreeNode) => void
    oncontext: (n: TreeNode) => void
    ontrash: (n: TreeNode) => void
    onrename: (n: TreeNode, name: string) => void
    oncancel: () => void
  }
  let { nodes, depth = 0, current, selected, renaming, collapsed, onopen, oncontext, ontrash, onrename, oncancel }: Props = $props()

  // Select the base name (not the extension) when a rename starts, like Finder.
  function focusName(el: HTMLInputElement): void {
    el.focus()
    const dot = el.value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length)
  }

  /** Files drag onto an editor split: its edges open a new split, its middle opens the file there. */
  function drag(e: DragEvent, n: TreeNode): void {
    if (!e.dataTransfer) return
    e.dataTransfer.setData(FILE_DRAG, JSON.stringify({ path: n.path, from: null } satisfies FileDrag))
    e.dataTransfer.effectAllowed = 'copy'
  }

  // ⌘⌫ on macOS (as in Finder), Delete elsewhere; the app asks before trashing.
  function itemKey(e: KeyboardEvent, n: TreeNode): void {
    if (mac ? e.metaKey && e.key === 'Backspace' : e.key === 'Delete') {
      e.preventDefault()
      ontrash(n)
    }
  }

  function key(e: KeyboardEvent, n: TreeNode): void {
    const el = e.currentTarget as HTMLInputElement
    if (e.key === 'Enter') onrename(n, el.value)
    if (e.key === 'Escape') oncancel()
  }
</script>

{#each nodes as n (n.path)}
  {#if renaming === n.path}
    <div class="it" style="padding-left: {8 + depth * 14}px">
      <span class="ic" aria-hidden="true">{n.kind === 'folder' ? '▸' : ''}</span>
      <input
        class="rename"
        value={n.name}
        aria-label="New name"
        spellcheck="false"
        use:focusName
        onkeydown={(e) => key(e, n)}
        onblur={(e) => onrename(n, e.currentTarget.value)}
      />
    </div>
  {:else}
    <button
      class="it"
      class:on={current === n.path}
      class:sel={selected === n.path && current !== n.path}
      style="padding-left: {8 + depth * 14}px"
      onclick={() => onopen(n)}
      onkeydown={(e) => itemKey(e, n)}
      draggable={n.kind === 'file'}
      ondragstart={(e) => drag(e, n)}
      oncontextmenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        oncontext(n)
      }}
      aria-expanded={n.kind === 'folder' ? !collapsed[n.path] : undefined}
      title={n.path}
    >
      <span class="ic" aria-hidden="true">{n.kind === 'folder' ? (collapsed[n.path] ? '▸' : '▾') : ''}</span>
      <span class="nm">{n.name}</span>
      {#if current === n.path}<span class="tag">live</span>{/if}
    </button>
  {/if}
  {#if n.kind === 'folder' && !collapsed[n.path] && n.children?.length}
    <Tree nodes={n.children} depth={depth + 1} {current} {selected} {renaming} {collapsed} {onopen} {oncontext} {ontrash} {onrename} {oncancel} />
  {/if}
{/each}

<style>
  .it {
    width: 100%;
    background: none;
    border: 0;
    text-align: left;
    padding: 4px 8px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 24px;
    box-sizing: border-box;
  }
  .it.on {
    background: var(--sel);
    font-weight: 600;
  }
  .it.sel {
    background: color-mix(in srgb, var(--fg) 7%, transparent);
  }
  .ic {
    width: 12px;
    flex: none;
    color: var(--muted);
    font-size: 10px;
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    color: var(--muted);
    font: 11px var(--mono);
  }
  .rename {
    flex: 1;
    min-width: 0;
    font: inherit;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 1px 4px;
    outline: none;
    user-select: text;
  }
</style>
