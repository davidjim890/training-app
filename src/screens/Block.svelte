<!--
  One mesocycle: pick a week, see its template days and their status, tap a
  day to start or resume that session.
-->
<script lang="ts">
  import { liveQuery } from "dexie";
  import { db } from "../db";
  import { planWeek, type WeekPlan } from "../db/planning";
  import { currentWeek, sessionStatusesForWeek, startSession } from "../db/sessions";
  import { isDeloadWeek, targetRirForWeek } from "../lib/progression";

  let { mesocycleId, onOpenSession, onBack }: { mesocycleId: number; onOpenSession: (sessionId: number) => void; onBack: () => void } = $props();

  const meso = liveQuery(() => db.mesocycles.get(mesocycleId));
  const days = liveQuery(() => db.mesocycleDays.where("mesocycleId").equals(mesocycleId).sortBy("dayIndex"));

  // Week selection: follow the block's current week until the user picks one.
  let chosenWeek = $state<number | null>(null);
  const autoWeek = liveQuery(async () => {
    const m = await db.mesocycles.get(mesocycleId);
    return m ? currentWeek(db, m) : 1;
  });
  const week = $derived(chosenWeek ?? $autoWeek ?? 1);

  // Statuses depend on `week`, which is reactive, so the query is rebuilt
  // inside an effect instead of once at init.
  let statuses = $state(new Map<number, { sessionId: number; status: string }>());
  let plan = $state<WeekPlan | null>(null);
  $effect(() => {
    const w = week;
    const subs = [
      liveQuery(() => sessionStatusesForWeek(db, mesocycleId, w)).subscribe((m) => (statuses = m)),
      liveQuery(() => planWeek(db, mesocycleId, w)).subscribe((p) => (plan = p)),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  });
  const musclePlans = $derived(Object.entries(plan?.muscles ?? {}).filter(([, m]) => m !== undefined));
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  let error = $state("");
  async function open(dayId: number) {
    error = "";
    try {
      onOpenSession(await startSession(db, { mesocycleId, weekNum: week, mesocycleDayId: dayId }));
    } catch (e) {
      error = (e as Error).message;
    }
  }

  const statusLabel: Record<string, string> = { in_progress: "in progress", completed: "done", skipped: "skipped", planned: "planned" };
</script>

<div class="page stack">
  <div class="row between">
    <button type="button" class="btn ghost" onclick={onBack}>← Blocks</button>
    <span class="muted small">{$meso?.status ?? ""}</span>
  </div>

  {#if $meso}
    <h1>{$meso.name}</h1>
    <p class="muted small">{$meso.numWeeks} weeks · starting RIR {$meso.startingRir} · from {$meso.startDate}</p>

    <div class="chips" role="tablist" aria-label="Week">
      {#each Array.from({ length: $meso.numWeeks }, (_, i) => i + 1) as w (w)}
        <button type="button" class="chip" class:on={w === week} role="tab" aria-selected={w === week} onclick={() => (chosenWeek = w)}>
          {isDeloadWeek(w, $meso.numWeeks) ? "Deload" : `Wk ${w}`}
        </button>
      {/each}
    </div>
    <p class="muted small">Target RIR this week: <strong>{targetRirForWeek(week, $meso.numWeeks, $meso.startingRir)}</strong></p>

    <div class="list">
      {#each $days ?? [] as d (d.id)}
        {@const s = statuses.get(d.id)}
        <button type="button" class="btn" onclick={() => open(d.id)}>
          <span>{d.name}</span>
          <span class="muted small">{s ? statusLabel[s.status] ?? s.status : "not started"}</span>
        </button>
      {/each}
    </div>

    {#if error}<div class="error">{error}</div>{/if}

    {#if musclePlans.length}
      <h3>This week's volume</h3>
      <div class="list">
        {#each musclePlans as [muscle, m] (muscle)}
          <div class="card">
            <div class="row between">
              <strong>{muscle}</strong>
              <span class="tabular"><strong>{m!.sets}</strong> <span class="muted small">sets · {signed(m!.delta)}{m!.atMrv ? " · at MRV" : ""}</span></span>
            </div>
            <p class="small muted" style="margin:4px 0 0">{m!.rationale}</p>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <p class="muted">Loading…</p>
  {/if}
</div>

<style>
  .tabular { font-variant-numeric: tabular-nums; }
</style>
