<script lang="ts">
  import { onMount } from 'svelte'
  import FileTabs from './FileTabs.svelte'
  import { withKey } from './keys.svelte'
  import { dropZone, FILE_DRAG, readDrag, type FileDrag, type Zone } from './splits'

  type Props = {
    id: number
    tabs: string[]
    current: string
    /** Another split has focus: the accent under this one's active tab goes away. */
    dimmed: boolean
    canSplit: boolean
    ready: boolean
    /** Creates this split's editor in `el`; returns its cleanup. */
    mount: (id: number, el: HTMLElement) => () => void
    onfocus: () => void
    onopen: (rel: string) => void
    onclose: (rel: string) => void
    oncreate: () => void
    ondrop: (zone: Zone, d: FileDrag) => void
  }
  let { id, tabs, current, dimmed, canSplit, ready, mount, onfocus, onopen, onclose, oncreate, ondrop }: Props = $props()

  let hostEl: HTMLDivElement
  let zone = $state<Zone | null>(null)

  onMount(() => mount(id, hostEl))

  const ours = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes(FILE_DRAG)
  const zoneOf = (e: DragEvent): Zone => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return dropZone(e.clientX - r.left, r.width, canSplit)
  }

  // Capture phase, and stopped there: Monaco would otherwise take the drop and insert text.
  function over(e: DragEvent): void {
    if (!ours(e)) return
    e.preventDefault()
    e.stopPropagation()
    zone = zoneOf(e)
  }
  function leave(e: DragEvent): void {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) zone = null
  }
  function drop(e: DragEvent): void {
    if (!ours(e)) return
    e.preventDefault()
    e.stopPropagation()
    const z = zoneOf(e)
    zone = null
    const d = readDrag(e.dataTransfer!.getData(FILE_DRAG))
    if (d) ondrop(z, d)
  }

  function dragTab(e: DragEvent, rel: string): void {
    if (!e.dataTransfer) return
    e.dataTransfer.setData(FILE_DRAG, JSON.stringify({ path: rel, from: id } satisfies FileDrag))
    e.dataTransfer.effectAllowed = 'move'
  }
</script>

<section class="group" class:dimmed onpointerdowncapture={onfocus} aria-label="Editor split">
  <FileTabs {tabs} {current} {onopen} {onclose} ondragtab={dragTab} />
  <div class="editor" role="presentation" ondragentercapture={over} ondragovercapture={over} ondragleavecapture={leave} ondropcapture={drop}>
    <div class="host" bind:this={hostEl}></div>
    {#if ready && !current}
      <div class="noeditor">
        <p>No file open</p>
        <p class="muted">Pick a scratch in the sidebar, or start a new one.</p>
        <button class="tbtn" onclick={oncreate}>{withKey('New file', 'new-file')}</button>
      </div>
    {/if}
    {#if zone}<div class="drop {zone}" aria-hidden="true"></div>{/if}
  </div>
</section>

<style>
  .group {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .group + :global(.group) {
    border-left: 1px solid var(--line);
  }
  .dimmed :global(.ftab.on) {
    border-bottom-color: var(--line);
  }
  .editor {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .noeditor {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 6px;
    background: var(--bg);
    text-align: center;
  }
  .noeditor p {
    margin: 0;
  }
  .noeditor p:first-child {
    font-size: 15px;
    font-weight: 600;
  }
  .noeditor .tbtn {
    margin-top: 8px;
  }
  .drop {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 5;
    pointer-events: none;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    border: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
    box-sizing: border-box;
  }
  .drop.left {
    left: 0;
    width: 50%;
  }
  .drop.right {
    right: 0;
    width: 50%;
  }
  .drop.center {
    left: 0;
    right: 0;
  }
</style>
