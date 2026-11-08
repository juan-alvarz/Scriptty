<script lang="ts">
  import { onMount } from 'svelte'
  import type { Result, Snippet, SnippetsState } from '../../shared/protocol'

  const api = window.scriptty.snippets
  const reveal = window.scriptty.platform === 'darwin' ? 'Show in Finder' : 'Show in Explorer'

  let data = $state<SnippetsState>({ snippets: [], error: '', file: '' })
  /** The snippet being edited: its original name, or null for a new one. */
  let editing = $state<{ from: string | null; name: string; prefix: string; description: string; body: string } | null>(null)
  let armed = $state('') // name of the row whose delete button asks for a second click
  let error = $state('')

  onMount(() => {
    const set = (s: SnippetsState): void => {
      data = s
    }
    api.get().then(set)
    // The callback must return nothing: the bridge would try to clone the returned state proxy.
    return api.onChange(set)
  })

  function apply(r: Result<SnippetsState>): boolean {
    if (!r.ok) {
      error = r.error
      return false
    }
    data = r.value
    error = ''
    return true
  }

  function edit(s: Snippet | null): void {
    error = ''
    armed = ''
    editing = s
      ? { from: s.name, name: s.name, prefix: s.prefix.join(', '), description: s.description, body: s.body }
      : { from: null, name: '', prefix: '', description: '', body: '' }
  }

  async function save(e: SubmitEvent): Promise<void> {
    e.preventDefault()
    if (!editing) return
    const prefix = editing.prefix.split(',').map((p) => p.trim()).filter(Boolean)
    const old = editing.from ? data.snippets.find((s) => s.name === editing!.from) : undefined
    const snippet: Snippet = { name: editing.name.trim() || prefix[0] || '', prefix, description: editing.description, body: editing.body, scope: old?.scope }
    if (apply(await api.put(editing.from, snippet))) editing = null
  }

  async function remove(name: string): Promise<void> {
    if (armed !== name) {
      armed = name
      return
    }
    armed = ''
    if (apply(await api.remove(name)) && editing?.from === name) editing = null
  }
</script>

<h4>Snippets</h4>

{#if data.error}<p class="note err" role="alert">{data.error}</p>{/if}

{#if editing}
  <form class="grp form" onsubmit={save}>
    <div class="two">
      <label>Prefix<input bind:value={editing.prefix} placeholder="clg" spellcheck="false" autocomplete="off" /></label>
      <label>Name<input bind:value={editing.name} placeholder="Log to console" autocomplete="off" /></label>
    </div>
    <label><span>Description <span class="muted">(optional)</span></span><input bind:value={editing.description} autocomplete="off" /></label>
    <label>Body<textarea bind:value={editing.body} rows="6" spellcheck="false" placeholder="console.log($1)"></textarea></label>
    <p class="help">
      <code>$1</code>, <code>$2</code> are tab stops (Tab moves to the next). <code>{'${1:name}'}</code> adds placeholder text,
      <code>{'${1|a,b|}'}</code> a list of choices, <code>$0</code> is where the cursor ends. Separate several prefixes with commas.
    </p>
    {#if error}<p class="note err" role="alert">{error}</p>{/if}
    <div class="actions">
      {#if editing.from}
        <button type="button" class="btn danger" onclick={() => remove(editing!.from!)}>{armed === editing.from ? 'Click again to delete' : 'Delete'}</button>
      {/if}
      <span class="sp"></span>
      <button type="button" class="btn" onclick={() => ((editing = null), (error = ''))}>Cancel</button>
      <button type="submit" class="btn primary">{editing.from ? 'Save' : 'Add snippet'}</button>
    </div>
  </form>
{:else}
  <p class="intro">Type a prefix in the editor and press Tab or Enter on the suggestion to insert the snippet.</p>
  <div class="grp list">
    {#each data.snippets as s (s.name)}
      <div class="item">
        <button class="open" onclick={() => edit(s)} title="Edit {s.name}">
          <code class="pfx">{s.prefix.join(', ')}</code>
          <span class="nm">{s.name}{#if s.description}<small>{s.description}</small>{/if}</span>
        </button>
        <button
          class="rm"
          class:armed={armed === s.name}
          onclick={() => remove(s.name)}
          onblur={() => armed === s.name && (armed = '')}
          aria-label={armed === s.name ? `Confirm delete ${s.name}` : `Delete ${s.name}`}
          title={armed === s.name ? 'Click again to delete' : 'Delete'}>{armed === s.name ? 'Delete' : '×'}</button
        >
      </div>
    {:else}
      <p class="empty muted">No snippets. Add one, or restore the starter set.</p>
    {/each}
  </div>
  {#if error}<p class="note err" role="alert">{error}</p>{/if}
  <div class="actions">
    <button class="btn primary" onclick={() => edit(null)}>New snippet</button>
    <span class="sp"></span>
    <button class="btn" onclick={() => api.open()}>Open snippets file</button>
    <button class="btn" onclick={() => api.reveal()}>{reveal}</button>
  </div>
  <div class="grp restore">
    <span>Restore starter snippets<small>Puts back clg, con, afn, imp and tryc. Your own snippets stay.</small></span>
    <button class="btn" onclick={async () => apply(await api.restore())}>Restore</button>
  </div>
  <p class="help">
    The file uses VS Code's snippet format, so snippets from VS Code can be pasted in. Edits made there show up here right away.
    <small class="path">{data.file}</small>
  </p>
{/if}

<style>
  h4 {
    margin: 0 0 10px;
    font-size: 15px;
  }
  .grp {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
  }
  .intro,
  .help {
    color: var(--muted);
    font-size: 11.5px;
    margin: 0 0 10px;
  }
  .help {
    margin: 10px 0 0;
  }
  .note {
    font-size: 12px;
    margin: 0 0 10px;
    overflow-wrap: anywhere;
  }
  .err {
    color: var(--err);
  }
  code {
    font: 11.5px var(--mono);
  }
  small {
    display: block;
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 400;
  }
  .path {
    font-family: var(--mono);
    user-select: text;
    overflow-wrap: anywhere;
    margin-top: 4px;
  }
  .item {
    display: flex;
    align-items: center;
    border-top: 1px solid var(--line);
    padding-right: 8px;
  }
  .item:first-child {
    border-top: 0;
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 12px;
    border: 0;
    background: none;
    text-align: left;
    padding: 8px 14px;
    cursor: pointer;
  }
  .item:hover {
    background: color-mix(in srgb, var(--fg) 4%, transparent);
  }
  .pfx {
    flex: none;
    width: 64px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--val);
  }
  .nm {
    flex: 1;
    min-width: 0;
    font-weight: 500;
  }
  .nm small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rm {
    flex: none;
    border: 0;
    background: none;
    color: var(--muted);
    min-width: 22px;
    height: 22px;
    border-radius: 5px;
    cursor: pointer;
    opacity: 0;
  }
  .item:hover .rm,
  .rm:focus-visible,
  .rm.armed {
    opacity: 1;
  }
  .rm.armed {
    color: var(--on-accent);
    background: var(--err);
    font-size: 11.5px;
    padding: 0 8px;
  }
  .empty {
    margin: 0;
    padding: 12px 14px;
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-top: 10px;
    align-items: center;
  }
  .sp {
    flex: 1;
  }
  .restore {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 11px 14px;
    margin-top: 14px;
    font-weight: 500;
  }
  .form {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 10px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 500;
    font-size: 12px;
  }
  input,
  textarea {
    font: inherit;
    font-weight: 400;
    color: var(--fg);
    background: var(--field);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 5px 8px;
    user-select: text;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }
  textarea {
    font: 12px/1.5 var(--mono);
    resize: vertical;
    tab-size: 2;
  }
  .form .help {
    margin: 0;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .danger {
    color: var(--err);
  }
</style>
