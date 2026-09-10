<script lang="ts">
  import { liveQuery } from "dexie";
  import { db } from "../db";
  import { listMesocycles } from "../db/mesocycles";

  let { onNewBlock, onOpenBlock }: { onNewBlock: () => void; onOpenBlock: (mesocycleId: number) => void } = $props();

  // liveQuery re-runs whenever the tables it read from change, so this list
  // updates by itself after the builder saves. The `$` prefix in the markup
  // subscribes to it like a Svelte store.
  const mesocycles = liveQuery(() => listMesocycles(db));
</script>

<div class="page stack">
  <h1>Blocks</h1>

  {#if $mesocycles === undefined}
    <p class="muted">Loading…</p>
  {:else if $mesocycles.length === 0}
    <div class="card stack">
      <p>No blocks yet.</p>
      <p class="muted small">A block is a mesocycle: a few weeks of ramping volume, then a deload.</p>
    </div>
  {:else}
    <div class="list">
      {#each $mesocycles as m (m.id)}
        <button type="button" class="btn" onclick={() => onOpenBlock(m.id)}>
          <span>
            <strong>{m.name}</strong>
            <span class="muted small" style="display:block">{m.numWeeks} weeks · {m.daysPerWeek} days/wk · starts {m.startDate}</span>
          </span>
          <span class="muted small">{m.status}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="actions">
    <button type="button" class="btn primary block" onclick={onNewBlock}>New block</button>
  </div>
</div>
