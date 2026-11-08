<script lang="ts">
  import { withKey } from './keys.svelte'
  let { hidden, ontoggle }: { hidden: boolean; ontoggle: () => void } = $props()
</script>

<!-- Lives inside the drag strips (like the toolbar buttons) so its no-drag reliably wins.
     Rendered in the sidebar strip or the toolbar, both 80px from the window edge, so it never moves. -->
<button class="sidetoggle" title={withKey(`${hidden ? 'Show' : 'Hide'} sidebar`, 'toggle-sidebar')} aria-label="Toggle sidebar" aria-pressed={!hidden} onclick={ontoggle}>
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M9.5 4.5v15" /></svg>
</button>

<style>
  .sidetoggle {
    flex: none;
    width: 28px;
    height: 26px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .sidetoggle:hover {
    background: color-mix(in srgb, var(--fg) 9%, transparent);
    color: var(--fg);
  }
  svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
  }
</style>
