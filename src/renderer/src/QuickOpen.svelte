<script lang="ts">
  import { rank, segments, type Hit } from './fuzzy'
  import type { TreeNode } from '../../shared/protocol'

  type Props = { open: boolean; tree: TreeNode[]; current: string; tabs: string[]; onopen: (rel: string) => void }
  let { open = $bindable(), tree, current, tabs, onopen }: Props = $props()

  const LIMIT = 200
  const mac = window.scriptty.platform === 'darwin'
  let dialog: HTMLDialogElement
  let list = $state<HTMLUListElement>()
  let query = $state('')
  let active = $state(0)
  // Files in the order they were last shown in the editor, most recent first. Not reactive on purpose:
  // it only changes while the palette is closed and is read when it opens.
  let recent: string[] = []

  $effect(() => {
    if (current) recent = [current, ...recent.filter((p) => p !== current)].slice(0, 100)
  })

  const flatten = (nodes: TreeNode[], out: string[] = []): string[] => {
    for (const n of nodes) {
      if (n.kind === 'file') out.push(n.path)
      else if (n.children) flatten(n.children, out)
    }
    return out
  }
  const files = $derived(flatten(tree))
  const hits = $derived<Hit[]>(open ? rank(query, files, [...recent, ...tabs]).slice(0, LIMIT) : [])

  // Native <dialog>: modal, focus trap and Esc come from the platform (decision 15).
  $effect(() => {
    if (open && !dialog.open) {
      query = ''
      // With no query the current file is first; start on the one before it, so ⌘P Enter switches back.
      active = hits.length > 1 && hits[0].path === current ? 1 : 0
      dialog.showModal()
    }
    if (!open && dialog.open) dialog.close()
  })

  $effect(() => {
    list?.children[active]?.scrollIntoView({ block: 'nearest' })
  })

  // ⌘P / Ctrl+P from anywhere, caught before Monaco (and vim mode, where Ctrl+P is a motion) sees it.
  // The File menu item has the same accelerator; either path only opens the palette.
  $effect(() => {
    const onkey = (e: KeyboardEvent): void => {
      const modOnly = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (!modOnly || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'p') return
      e.preventDefault()
      e.stopPropagation()
      open = true
    }
    window.addEventListener('keydown', onkey, true)
    return () => window.removeEventListener('keydown', onkey, true)
  })

  function choose(i: number): void {
    const h = hits[i]
    if (!h) return
    open = false
    onopen(h.path)
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.isComposing) return
    const n = hits.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (n) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(active)
    }
  }

  const split = (path: string): { name: string; dir: string; cut: number } => {
    const cut = path.lastIndexOf('/') + 1
    return { name: path.slice(cut), dir: path.slice(0, Math.max(cut - 1, 0)), cut }
  }
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} onclick={(e) => e.target === dialog && (open = false)} aria-label="Go to file">
  <input
    type="text"
    role="combobox"
    aria-expanded="true"
    aria-controls="qo-list"
    aria-activedescendant={hits[active] ? `qo-${active}` : undefined}
    aria-autocomplete="list"
    placeholder="Go to file…"
    spellcheck="false"
    autocomplete="off"
    bind:value={query}
    oninput={() => (active = 0)}
    {onkeydown}
  />
  {#if hits.length}
    <ul id="qo-list" role="listbox" aria-label="Files" bind:this={list}>
      {#each hits as h, i (h.path)}
        {@const p = split(h.path)}
        <li
          id="qo-{i}"
          role="option"
          aria-selected={i === active}
          class:on={i === active}
          title={h.path}
          onmousemove={() => (active = i)}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => choose(i)}
          onkeydown={onkeydown}
        >
          <span class="name">
            {#each segments(p.name, h.ranges, p.cut) as s, k (k)}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}
          </span>
          {#if p.dir}
            <span class="dir">
              {#each segments(p.dir, h.ranges, 0) as s, k (k)}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty muted">{files.length ? 'No matching files' : 'No files yet'}</p>
  {/if}
</dialog>

<style>
  dialog {
    width: 560px;
    margin: 12vh auto auto;
  }
  input {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 42px;
    padding: 0 14px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    color: var(--fg);
    font: 14px var(--ui);
    outline: none;
  }
  input::placeholder {
    color: var(--muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
    max-height: min(360px, 60vh);
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    padding: 5px 10px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }
  li.on {
    background: var(--sel);
  }
  .name {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
  }
  .dir {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--muted);
    font-size: 12px;
  }
  mark {
    background: none;
    color: var(--accent);
    font-weight: 700;
  }
  .empty {
    margin: 0;
    padding: 14px;
    text-align: center;
  }
</style>
