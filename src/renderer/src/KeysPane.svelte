<script lang="ts">
  import { ACTIONS, assignable, conflicts, defaultFor, label, resolve, type ActionId, type Overrides } from '../../shared/keybindings'
  import { mac } from './keys.svelte'

  type Props = { open: boolean; overrides: Overrides; onchange: (o: Overrides) => void }
  let { open, overrides, onchange }: Props = $props()

  const keys = $derived(resolve(overrides, mac))
  const clashes = $derived(conflicts(keys))
  const nameOf = (id: ActionId): string => ACTIONS.find((a) => a.id === id)!.label
  let recording = $state<ActionId | null>(null)
  let error = $state('')

  /** Main catches the next key press (app shortcuts are off meanwhile) and hands it back here. */
  async function record(id: ActionId): Promise<void> {
    if (recording === id) return cancel()
    recording = id
    error = ''
    const k = await window.scriptty.keys.record()
    if (recording !== id) return // cancelled, or another row started recording
    recording = null
    if (k === null) return
    if (!assignable(k, mac)) error = `${label(k, mac)} would get in the way of typing. Use ${mac ? '⌘, ⌃ or ⌥' : 'Ctrl or Alt'}, or a function key.`
    else set(id, k)
  }

  function cancel(): void {
    recording = null
    window.scriptty.keys.cancel()
  }

  function set(id: ActionId, k: string): void {
    const next = { ...overrides }
    if (k === defaultFor(id, mac)) delete next[id]
    else next[id] = k
    onchange(next)
  }

  // Closing Settings mid-recording gives the keys back to the app.
  $effect(() => {
    if (!open && recording) cancel()
  })
  $effect(() => () => {
    if (recording) cancel()
  })
</script>

<h4>Keyboard Shortcuts</h4>
<p class="hint">Click a shortcut, then press the new keys. Esc cancels.</p>
{#if error}<p class="err" role="alert">{error}</p>{/if}
<div class="grp">
  {#each ACTIONS as a (a.id)}
    {@const k = keys[a.id]}
    {@const others = (clashes.get(k) ?? []).filter((id) => id !== a.id)}
    <div class="row">
      <span class="lbl">
        {a.label}
        {#if others.length}
          {@const winner = clashes.get(k)![0]}
          <small class="warn">Also bound to {others.map(nameOf).join(', ')}; {winner === a.id ? 'this one runs' : `${nameOf(winner)} runs instead`}</small>
        {/if}
      </span>
      <span class="ctl">
        <button class="key" class:rec={recording === a.id} class:unset={!k} aria-label="Change shortcut for {a.label}" onclick={() => record(a.id)}>
          {recording === a.id ? 'Press keys…' : label(k, mac) || 'None'}
        </button>
        <button class="mini" title="Remove shortcut" aria-label="Remove shortcut for {a.label}" disabled={!k} onclick={() => set(a.id, '')}>×</button>
        <button class="mini" title="Reset to {label(defaultFor(a.id, mac), mac)}" aria-label="Reset shortcut for {a.label}" disabled={!(a.id in overrides)} onclick={() => set(a.id, defaultFor(a.id, mac))}>↺</button>
      </span>
    </div>
  {/each}
</div>
<div class="foot">
  <button class="btn" disabled={!Object.keys(overrides).length} onclick={() => onchange({})}>Reset all</button>
</div>

<style>
  h4 {
    margin: 0 0 6px;
    font-size: 15px;
  }
  .hint,
  .err {
    margin: 0 0 12px;
    font-size: 12px;
    color: var(--muted);
  }
  .err {
    color: var(--err);
  }
  .warn {
    color: var(--warn);
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
    padding: 7px 10px 7px 14px;
    border-top: 1px solid var(--line);
  }
  .row:first-child {
    border-top: 0;
  }
  .lbl {
    font-weight: 500;
    min-width: 0;
  }
  small {
    display: block;
    font-size: 11.5px;
    font-weight: 400;
  }
  .ctl {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }
  .key {
    min-width: 96px;
    padding: 3px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--field);
    color: var(--fg);
    font: 12px var(--mono);
    cursor: pointer;
  }
  .key.unset {
    color: var(--muted);
  }
  .key.rec {
    border-color: var(--accent);
    color: var(--accent);
  }
  .mini {
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .mini:hover:not(:disabled) {
    background: color-mix(in srgb, var(--fg) 10%, transparent);
    color: var(--fg);
  }
  .mini:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }
</style>
