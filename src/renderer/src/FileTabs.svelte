<script lang="ts">
  type Props = { tabs: string[]; current: string; mod: string; onopen: (rel: string) => void; onclose: (rel: string) => void }
  let { tabs, current, mod, onopen, onclose }: Props = $props()

  let el: HTMLDivElement

  const nameOf = (path: string): string => path.split('/').pop() ?? path
  const parentOf = (path: string): string => path.split('/').slice(0, -1).join('/')
  /** Tab label; adds the folder when two open tabs share a file name. */
  const labelOf = (p: string): { name: string; dir: string } => ({
    name: nameOf(p),
    dir: tabs.filter((t) => nameOf(t) === nameOf(p)).length > 1 ? parentOf(p) || '/' : ''
  })

  $effect(() => {
    void current
    el.querySelector('.ftab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
</script>

<div class="colhead filetabs" role="tablist" aria-label="Open files" bind:this={el}>
  {#each tabs as t (t)}
    {@const l = labelOf(t)}
    <div class="ftab" class:on={t === current} title={t}>
      <button role="tab" class="fname" aria-selected={t === current} onclick={() => onopen(t)} onauxclick={(e) => e.button === 1 && onclose(t)}>
        {l.name}{#if l.dir}<span class="fdir">{l.dir}</span>{/if}
      </button>
      <button class="fx" aria-label="Close {t}" title="Close ({mod}W)" onclick={() => onclose(t)}>×</button>
    </div>
  {/each}
</div>

<style>
  .filetabs {
    background: var(--panel);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .filetabs::-webkit-scrollbar {
    display: none;
  }
  .ftab {
    flex: none;
    height: 100%;
    max-width: 220px;
    display: flex;
    align-items: center;
    border-right: 1px solid var(--line);
    border-bottom: 2px solid transparent;
    box-sizing: border-box;
    color: var(--muted);
  }
  .ftab:hover {
    color: var(--fg);
  }
  .ftab.on {
    background: var(--bg);
    color: var(--fg);
    border-bottom-color: var(--accent);
  }
  .fname {
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px 0 14px;
    border: 0;
    background: none;
    color: inherit;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .ftab.on .fname {
    font-weight: 600;
  }
  .fdir {
    color: var(--muted);
    font-weight: 400;
  }
  .fx {
    width: 20px;
    height: 20px;
    margin-right: 6px;
    flex: none;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
  }
  .ftab:hover .fx,
  .ftab.on .fx,
  .fx:focus-visible {
    opacity: 1;
  }
  .fx:hover {
    background: color-mix(in srgb, var(--fg) 10%, transparent);
    color: var(--fg);
  }
</style>
