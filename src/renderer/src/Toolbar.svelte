<script lang="ts">
  import SidebarToggle from './SidebarToggle.svelte'
  import { shortcut, withKey } from './keys.svelte'

  type Props = {
    sidebarHidden: boolean
    autoRun: boolean
    ontogglesidebar: () => void
    ontoggleautorun: () => void
    onrun: () => void
    running: boolean
    onstop: () => void
    onsettings: () => void
  }
  let { sidebarHidden, autoRun, ontogglesidebar, ontoggleautorun, onrun, running, onstop, onsettings }: Props = $props()
</script>

<header class="tb drag" class:full={sidebarHidden}>
  {#if sidebarHidden}<SidebarToggle hidden ontoggle={ontogglesidebar} />{/if}
  <span class="sp"></span>
  <button class="tbtn" aria-pressed={autoRun} onclick={ontoggleautorun}>Auto-run</button>
  {#if running}<button class="tbtn" title="Stop timers and servers this run started" onclick={onstop}>Stop {shortcut('stop')}</button>{/if}
  <button class="tbtn" onclick={() => onrun()}>Run {shortcut('run')}</button>
  <button class="tbtn icon" title={withKey('Settings', 'settings')} aria-label="Settings" onclick={onsettings}>
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
