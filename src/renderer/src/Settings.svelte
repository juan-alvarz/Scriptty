<script lang="ts">
  import type { Settings } from '../../shared/protocol'

  type Props = { open: boolean; settings: Settings; root: string; onchange: (p: Partial<Settings>) => void; onclose: () => void }
  let { open, settings, root, onchange, onclose }: Props = $props()

  type Tab = 'general' | 'editor' | 'runtime'
  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'editor', label: 'Editor' },
    { id: 'runtime', label: 'Runtime' }
  ]
  let tab = $state<Tab>('general')
  let dialog: HTMLDialogElement

  // Native <dialog>: modal, focus trap and Esc to close come from the platform.
  $effect(() => {
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  })

  const num = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value)
</script>

<dialog bind:this={dialog} onclose={onclose} onclick={(e) => e.target === dialog && onclose()} aria-label="Settings">
  <div class="win">
    <header>
      <b>Settings</b>
      <button class="x" onclick={onclose} aria-label="Close settings">×</button>
    </header>
    <div class="body">
      <div class="nav" role="tablist" aria-label="Settings sections">
        {#each tabs as t (t.id)}
          <button role="tab" aria-selected={tab === t.id} onclick={() => (tab = t.id)}>
            {t.label}
          </button>
        {/each}
      </div>

      <div class="pane" role="tabpanel">
        {#if tab === 'general'}
          <h4>General</h4>
          <div class="grp">
            <div class="row">
              <span class="lbl">Appearance</span>
              <span class="seg" role="group" aria-label="Appearance">
                {#each ['system', 'light', 'dark'] as const as a (a)}
                  <button aria-pressed={settings.appearance === a} onclick={() => onchange({ appearance: a })}>
                    {a[0].toUpperCase() + a.slice(1)}
                  </button>
                {/each}
              </span>
            </div>
            <div class="row">
              <span class="lbl">Scratches folder<small class="path">{root}</small></span>
              <button class="btn" onclick={() => window.scriptty.fs.reveal('')}>
                {window.scriptty.platform === 'darwin' ? 'Show in Finder' : 'Show in Explorer'}
              </button>
            </div>
          </div>
        {:else if tab === 'editor'}
          <h4>Editor</h4>
          <div class="grp">
            <div class="row">
              <label for="s-font">Font size</label>
              <select id="s-font" value={settings.fontSize} onchange={(e) => onchange({ fontSize: num(e) })}>
                {#each [11, 12, 13, 14, 15, 16, 18, 20] as n (n)}<option value={n}>{n}</option>{/each}
              </select>
            </div>
            <div class="row">
              <label for="s-tab">Tab size</label>
              <select id="s-tab" value={settings.tabSize} onchange={(e) => onchange({ tabSize: num(e) })}>
                <option value={2}>2</option>
                <option value={4}>4</option>
              </select>
            </div>
            <div class="row">
              <label for="s-vim">Vim mode<small>Vim keybindings in the editor. Mode shows in the status bar.</small></label>
              <input id="s-vim" type="checkbox" class="tog" checked={settings.vim} onchange={(e) => onchange({ vim: e.currentTarget.checked })} />
            </div>
            <div class="row">
              <label for="s-auto">Run as you type<small>Off means ⌘↵ runs the file</small></label>
              <input id="s-auto" type="checkbox" class="tog" checked={settings.autoRun} onchange={(e) => onchange({ autoRun: e.currentTarget.checked })} />
            </div>
            <div class="row">
              <label for="s-delay">Run after a pause of<small>Milliseconds after the last keystroke</small></label>
              <input id="s-delay" type="number" min="0" max="2000" step="20" value={settings.runDelayMs} onchange={(e) => onchange({ runDelayMs: num(e) })} />
            </div>
          </div>
        {:else if tab === 'runtime'}
          <h4>Runtime</h4>
          <div class="grp">
            <div class="row">
              <label for="s-freeze">Stop code that freezes for<small>Seconds without a response. Servers and timers keep running.</small></label>
              <input id="s-freeze" type="number" min="1" max="120" value={settings.freezeSeconds} onchange={(e) => onchange({ freezeSeconds: num(e) })} />
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</dialog>

<style>
  dialog {
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg);
    color: var(--fg);
    width: 680px;
    max-width: calc(100vw - 40px);
    height: 460px;
    max-height: calc(100vh - 40px);
    box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
  dialog::backdrop {
    background: rgba(20, 22, 26, 0.32);
  }
  .win {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
  }
  header {
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .x {
    position: absolute;
    right: 8px;
    border: 0;
    background: none;
    font-size: 18px;
    color: var(--muted);
    cursor: pointer;
    width: 26px;
    height: 26px;
    border-radius: 6px;
  }
  .body {
    display: grid;
    grid-template-columns: 180px 1fr;
    min-height: 0;
  }
  .nav {
    background: var(--panel);
    border-right: 1px solid var(--line);
    padding: 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nav button {
    background: none;
    border: 0;
    text-align: left;
    padding: 6px 10px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    cursor: pointer;
  }
  .nav button[aria-selected='true'] {
    background: var(--sel);
    font-weight: 600;
  }
  .pane {
    padding: 20px 24px;
    overflow: auto;
  }
  h4 {
    margin: 0 0 14px;
    font-size: 15px;
  }
  .grp {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 11px 14px;
    border-top: 1px solid var(--line);
  }
  .row:first-child {
    border-top: 0;
  }
  label,
  .lbl {
    font-weight: 500;
    min-width: 0;
  }
  small {
    display: block;
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 400;
    margin-top: 1px;
  }
  .path {
    font-family: var(--mono);
    user-select: text;
    overflow-wrap: anywhere;
  }
  select,
  input[type='number'] {
    font: inherit;
    color: var(--fg);
    background: var(--field);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px 8px;
  }
  input[type='number'] {
    width: 70px;
  }
  .btn {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--field);
    white-space: nowrap;
    cursor: pointer;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: 7px;
    overflow: hidden;
    background: var(--field);
  }
  .seg button {
    font-size: 12px;
    background: none;
    border: 0;
    border-left: 1px solid var(--line);
    padding: 4px 10px;
    cursor: pointer;
  }
  .seg button:first-child {
    border-left: 0;
  }
  .seg button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--on-accent);
  }
  .tog {
    appearance: none;
    width: 34px;
    height: 20px;
    border-radius: 10px;
    background: var(--line);
    position: relative;
    cursor: pointer;
    flex: none;
    margin: 0;
  }
  .tog::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: transform 0.15s;
  }
  .tog:checked {
    background: var(--accent);
  }
  .tog:checked::after {
    transform: translateX(14px);
  }
  @media (prefers-reduced-motion: reduce) {
    .tog::after {
      transition: none;
    }
  }
</style>
