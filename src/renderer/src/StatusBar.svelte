<script lang="ts">
  import { languageOf } from './monaco'

  type Status = { mode: 'live' | 'running' | 'paused' | 'stopped'; info: string }
  type Props = { status: Status; file: string; tabSize: number; vimEl?: HTMLSpanElement }
  let { status, file, tabSize, vimEl = $bindable() }: Props = $props()

  const modeLabel = { live: 'Live', running: 'Running', paused: 'Paused', stopped: 'Stopped' }
</script>

<footer class="sb">
  <span><i class="dot {status.mode}"></i>{modeLabel[status.mode]}</span>
  <span class="info">{status.info}</span>
  <span class="sp"></span>
  <!-- monaco-vim writes the mode and the command line into this span. -->
  <span class="vim" bind:this={vimEl}></span>
  <span>{languageOf(file) === 'javascript' ? 'JavaScript' : 'TypeScript'}</span>
  <span>Spaces: {tabSize}</span>
</footer>

<style>
  .sb {
    height: 26px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 12px;
    border-top: 1px solid var(--line);
    font-size: 11.5px;
    color: var(--muted);
    white-space: nowrap;
  }
  .info {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vim {
    font-family: var(--mono);
    color: var(--accent);
  }
  .vim :global(input) {
    font: inherit;
    color: var(--fg);
    background: none;
    border: 0;
    outline: none;
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
    margin-right: 6px;
    vertical-align: 1px;
  }
  .dot.paused {
    background: var(--err);
  }
  .dot.stopped {
    background: var(--muted);
  }
  .dot.running {
    background: var(--warn);
  }
</style>
