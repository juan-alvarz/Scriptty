<script lang="ts">
  import SidebarToggle from './SidebarToggle.svelte'

  type Props = {
    sidebarHidden: boolean
    autoRun: boolean
    /** A debug run is in progress: the Debug button becomes Stop. */
    debugging: boolean
    mod: string
    ontogglesidebar: () => void
    ontoggleautorun: () => void
    onrun: () => void
    ondebug: () => void
    onstopdebug: () => void
    onsettings: () => void
  }
  let { sidebarHidden, autoRun, debugging, mod, ontogglesidebar, ontoggleautorun, onrun, ondebug, onstopdebug, onsettings }: Props = $props()
</script>

<header class="tb drag" class:full={sidebarHidden}>
  {#if sidebarHidden}<SidebarToggle hidden {mod} ontoggle={ontogglesidebar} />{/if}
  <span class="sp"></span>
  <button class="tbtn" aria-pressed={autoRun} onclick={ontoggleautorun}>Auto-run</button>
  <button class="tbtn" onclick={() => onrun()}>Run {mod}↵</button>
  <!-- Debug is separate from the live run: only Debug runs stop at breakpoints. -->
  {#if debugging}
    <button class="tbtn debug on" title="Stop debugging (⇧F5)" onclick={onstopdebug}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
      Stop
    </button>
  {:else}
    <button class="tbtn debug" title="Run with the debugger: stops at breakpoints (F5)" onclick={ondebug}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7.5a3 3 0 0 1 6 0M7.5 10h9v4.5a4.5 4.5 0 0 1-9 0zM12 10v9M4 12h3.5M16.5 12H20M5 7.5l2.5 2.5M19 7.5 16.5 10M5 18.5l2.6-1.8M19 18.5l-2.6-1.8" /></svg>
      Debug F5
    </button>
  {/if}
  <button class="tbtn icon" title="Settings ({mod},)" aria-label="Settings" onclick={onsettings}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
  </button>
</header>

<style>
  .tb {
    height: 40px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    border-bottom: 1px solid var(--line);
    font-size: 12.5px;
  }
  :global(:root:not([data-platform='darwin'])) .tb {
    padding-right: 150px; /* room for the Windows caption buttons (titleBarOverlay) */
  }
  /* With the sidebar hidden, the toggle sits 80px from the window edge on macOS (right of the traffic lights), 10px elsewhere. */
  .tb.full {
    padding-left: 10px;
  }
  :global([data-platform='darwin']) .tb.full {
    padding-left: 80px;
  }
  .icon {
    padding: 3px 6px;
  }
  .debug {
    gap: 5px;
    color: var(--err);
    border-color: color-mix(in srgb, var(--err) 45%, var(--line));
  }
  .debug.on {
    background: var(--err);
    border-color: var(--err);
    color: #fff;
  }
  .debug svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .icon svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
</style>
