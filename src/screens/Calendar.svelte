<!--
  Landing screen: a month of what you've done. Green dot = lifting session,
  orange dot = cardio. Tap a day for the details; tap a session to open it.
-->
<script lang="ts">
  import { liveQuery } from "dexie";
  import { db } from "../db";
  import { monthActivity, type DayActivity } from "../db/calendar";
  import { CARDIO_INTENSITY_LABELS } from "../db/schema";
  import { resolveTrainTarget, type TrainTarget } from "../db/sessions";
  import { addMonths, dayKey, monthGrid, monthLabel, WEEKDAY_LABELS } from "../lib/dates";

  let { onOpenSession, onOpenBlock }: { onOpenSession: (sessionId: number, mesocycleId: number) => void; onOpenBlock: (mesocycleId: number) => void } = $props();

  const today = dayKey(new Date());
  let year = $state(new Date().getFullYear());
  let month = $state(new Date().getMonth() + 1);
  let selected = $state<string>(today);

  // Month data is re-queried whenever year/month change (they're reactive),
  // and re-emitted whenever the underlying tables change.
  let activity = $state(new Map<string, DayActivity>());
  $effect(() => {
    const y = year, m = month;
    const sub = liveQuery(() => monthActivity(db, y, m)).subscribe((a) => (activity = a));
    return () => sub.unsubscribe();
  });

  const grid = $derived(monthGrid(year, month));
  const day = $derived(activity.get(selected));
  const inThisMonth = $derived(selected.startsWith(`${year}-${String(month).padStart(2, "0")}`));

  const target = liveQuery(() => resolveTrainTarget(db));
  const continueLabel = (t: TrainTarget) => (t.kind === "session" ? "Continue session" : "Open current block");

  function shift(delta: number) {
    ({ year, month } = addMonths(year, month, delta));
  }
  function goToday() {
    year = Number(today.slice(0, 4));
    month = Number(today.slice(5, 7));
    selected = today;
  }
  const fmtSelected = (key: string) =>
    new Date(key + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
</script>

<div class="page stack">
  <h1>Calendar</h1>

  {#if $target && $target.kind !== "none"}
    {@const t = $target}
    <button
      type="button"
      class="btn primary block"
      onclick={() => (t.kind === "session" ? onOpenSession(t.sessionId, t.mesocycleId) : t.kind === "block" ? onOpenBlock(t.mesocycleId) : null)}
    >
      {continueLabel(t)} →
    </button>
  {/if}

  <section class="card">
    <div class="row between">
      <button type="button" class="btn icon ghost" onclick={() => shift(-1)} aria-label="Previous month">‹</button>
      <strong>{monthLabel(year, month)}</strong>
      <button type="button" class="btn icon ghost" onclick={() => shift(1)} aria-label="Next month">›</button>
    </div>

    <div class="grid weekdays">
      {#each WEEKDAY_LABELS as w (w)}<span class="muted small">{w}</span>{/each}
    </div>
    {#each grid as row, i (i)}
      <div class="grid">
        {#each row as cell (cell.key)}
          {@const a = activity.get(cell.key)}
          <button
            type="button"
            class="day"
            class:out={!cell.inMonth}
            class:today={cell.key === today}
            class:selected={cell.key === selected}
            onclick={() => (selected = cell.key)}
            aria-label={cell.key}
            aria-pressed={cell.key === selected}
          >
            <span class="num">{cell.dayOfMonth}</span>
            <span class="dots">
              {#if a?.lifting.length}<span class="dot lift"></span>{/if}
              {#if a?.cardio.length}<span class="dot cardio"></span>{/if}
            </span>
          </button>
        {/each}
      </div>
    {/each}

    <div class="row between" style="margin-top:8px">
      <span class="small muted"><span class="dot lift inline"></span> lifting &nbsp; <span class="dot cardio inline"></span> cardio</span>
      {#if !inThisMonth || selected !== today}
        <button type="button" class="btn ghost small" onclick={goToday}>Today</button>
      {/if}
    </div>
  </section>

  <h3>{fmtSelected(selected)}</h3>
  {#if !day}
    <div class="card"><p class="muted">Nothing logged.</p></div>
  {:else}
    <div class="list">
      {#each day.lifting as l (l.sessionId)}
        <button type="button" class="btn" onclick={() => onOpenSession(l.sessionId, l.mesocycleId)}>
          <span>
            <strong>{l.dayName}</strong> <span class="muted">· {l.blockName}</span>
            <span class="muted small" style="display:block">Week {l.weekNum} · {l.setsLogged} set{l.setsLogged === 1 ? "" : "s"}{l.status === "in_progress" ? " · in progress" : ""}</span>
          </span>
          <span class="dot lift inline"></span>
        </button>
      {/each}
      {#each day.cardio as c (c.id)}
        <div class="card row between">
          <span>
            <strong>{c.kind}</strong>
            <span class="muted small" style="display:block">
              {c.durationMin} min{c.distanceKm ? ` · ${c.distanceKm} km` : ""}{c.inclinePct !== undefined ? ` · ${c.inclinePct}% incline` : ""} · {CARDIO_INTENSITY_LABELS[c.intensity].toLowerCase()}
            </span>
          </span>
          <span class="dot cardio inline"></span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .weekdays { text-align: center; margin: 8px 0 4px; }
  .day {
    display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 2px;
    min-height: 46px; padding: 4px 0; border: 1px solid transparent; border-radius: 10px;
    background: none; color: inherit; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
  }
  .day.out { color: var(--muted); opacity: 0.5; }
  .day.today .num { color: var(--accent); font-weight: 700; }
  .day.selected { border-color: var(--accent); background: var(--bg); }
  .num { font-size: 0.95rem; line-height: 1.2; }
  .dots { display: flex; gap: 3px; height: 6px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
  .dot.inline { vertical-align: middle; }
  .dot.lift { background: var(--accent); }
  .dot.cardio { background: #e8842c; }
  .btn.small { min-height: 36px; padding: 4px 10px; }
</style>
