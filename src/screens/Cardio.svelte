<!-- Cardio tab: last-7-day totals, the log, and a button to add a workout. -->
<script lang="ts">
  import { liveQuery } from "dexie";
  import CardioForm from "../components/CardioForm.svelte";
  import { db } from "../db";
  import { cardioLast7Days, deleteCardio, listCardio } from "../db/cardio";
  import { CARDIO_INTENSITY_LABELS, type CardioSession } from "../db/schema";

  const rows = liveQuery(() => listCardio(db));
  const week = liveQuery(() => cardioLast7Days(db));
  let showForm = $state(false);

  const fmtDate = (iso: string) =>
    new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

  async function remove(r: CardioSession) {
    if (!confirm(`Delete the ${r.durationMin} min ${r.kind} on ${fmtDate(r.date)}?`)) return;
    await deleteCardio(db, r.id);
  }
</script>

<div class="page stack">
  <h1>Cardio</h1>

  {#if $week}
    <section class="card row between">
      <div><div class="big">{$week.sessions}</div><div class="muted small">sessions</div></div>
      <div><div class="big">{$week.minutes}</div><div class="muted small">minutes</div></div>
      <div><div class="big">{$week.km}</div><div class="muted small">km</div></div>
      <div class="muted small" style="align-self:flex-start">last 7 days</div>
    </section>
  {/if}

  {#if $rows === undefined}
    <p class="muted">Loading…</p>
  {:else if $rows.length === 0}
    <div class="card"><p class="muted">Nothing logged yet.</p></div>
  {:else}
    <div class="list">
      {#each $rows as r (r.id)}
        <div class="card row between">
          <div class="grow">
            <strong>{r.kind}</strong> <span class="muted">· {fmtDate(r.date)}</span>
            <div class="small">
              {r.durationMin} min{r.distanceKm ? ` · ${r.distanceKm} km` : ""}{r.inclinePct !== undefined ? ` · ${r.inclinePct}% incline` : ""} · {CARDIO_INTENSITY_LABELS[r.intensity].toLowerCase()}
            </div>
            {#if r.notes}<div class="small muted">{r.notes}</div>{/if}
          </div>
          <button type="button" class="btn icon ghost danger" onclick={() => remove(r)} aria-label="Delete {r.kind} on {r.date}">×</button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="actions">
    <button type="button" class="btn primary block" onclick={() => (showForm = true)}>Log cardio</button>
  </div>
</div>

{#if showForm}
  <CardioForm onsaved={() => (showForm = false)} onclose={() => (showForm = false)} />
{/if}

<style>
  .big { font-size: 1.4rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
</style>
