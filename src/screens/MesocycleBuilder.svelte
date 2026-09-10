<!--
  Builds a mesocycle draft, then saves it in one transaction. The draft is
  component-local state on purpose: it isn't canonical until you tap Save.
-->
<script lang="ts">
  import { liveQuery } from "dexie";
  import ExercisePicker from "../components/ExercisePicker.svelte";
  import Stepper from "../components/Stepper.svelte";
  import { db } from "../db";
  import { createMesocycle, emptyMesocycleDraft, MESOCYCLE_LIMITS, validateMesocycleDraft } from "../db/mesocycles";
  import type { Exercise } from "../db/schema";

  let { onSaved, onCancel }: { onSaved: (id: number) => void; onCancel: () => void } = $props();

  const L = MESOCYCLE_LIMITS;
  const exercises = liveQuery(() => db.exercises.toArray());
  const byId = $derived(new Map(($exercises ?? []).map((e) => [e.id, e] as const)));

  let draft = $state(emptyMesocycleDraft());
  let pickingForDay = $state<number | null>(null);
  let problems = $state<string[]>([]);
  let saving = $state(false);

  const nameOf = (id: number) => byId.get(id)?.name ?? "…";
  const muscleOf = (id: number) => byId.get(id)?.muscleGroup ?? "";

  function addDay() {
    if (draft.days.length >= L.daysPerWeek.max) return;
    draft.days.push({ name: `Day ${draft.days.length + 1}`, exercises: [] });
  }
  function removeDay(i: number) {
    draft.days.splice(i, 1);
  }
  function pick(exerciseId: number) {
    if (pickingForDay === null) return;
    draft.days[pickingForDay].exercises.push({ exerciseId, startingSets: 2 });
    pickingForDay = null;
  }
  function removeExercise(dayIdx: number, exIdx: number) {
    draft.days[dayIdx].exercises.splice(exIdx, 1);
  }
  function move(dayIdx: number, exIdx: number, dir: -1 | 1) {
    const list = draft.days[dayIdx].exercises;
    const j = exIdx + dir;
    if (j < 0 || j >= list.length) return;
    [list[exIdx], list[j]] = [list[j], list[exIdx]];
  }

  async function save() {
    problems = validateMesocycleDraft(draft);
    if (problems.length) return;
    saving = true;
    try {
      onSaved(await createMesocycle(db, $state.snapshot(draft)));
    } catch (e) {
      problems = [(e as Error).message];
    } finally {
      saving = false;
    }
  }

  const exerciseList = $derived($exercises ?? [] as Exercise[]);
</script>

<div class="page stack">
  <div class="row between">
    <h1>New block</h1>
    <button type="button" class="btn ghost" onclick={onCancel}>Cancel</button>
  </div>

  <section class="card stack">
    <label>
      <span>Name</span>
      <input type="text" bind:value={draft.name} placeholder="e.g. Autumn block 1" autocomplete="off" />
    </label>
    <label>
      <span>Start date</span>
      <input type="date" bind:value={draft.startDate} />
    </label>
    <Stepper label="Weeks (incl. deload)" bind:value={draft.numWeeks} min={L.numWeeks.min} max={L.numWeeks.max} />
    <Stepper label="Starting RIR" bind:value={draft.startingRir} min={L.startingRir.min} max={L.startingRir.max} />
  </section>

  {#each draft.days as day, di (di)}
    <section class="card stack">
      <div class="row">
        <input class="grow" type="text" bind:value={day.name} placeholder="Day {di + 1}" aria-label="Day {di + 1} name" />
        <button type="button" class="btn icon danger" onclick={() => removeDay(di)} disabled={draft.days.length <= L.daysPerWeek.min} aria-label="Remove day">×</button>
      </div>

      {#each day.exercises as ex, ei (ex.exerciseId)}
        <div class="exercise">
          <div class="row between">
            <div class="grow">
              <strong>{nameOf(ex.exerciseId)}</strong>
              <div class="muted small">{muscleOf(ex.exerciseId)}</div>
            </div>
            <button type="button" class="btn icon ghost" onclick={() => move(di, ei, -1)} disabled={ei === 0} aria-label="Move up">↑</button>
            <button type="button" class="btn icon ghost" onclick={() => move(di, ei, 1)} disabled={ei === day.exercises.length - 1} aria-label="Move down">↓</button>
            <button type="button" class="btn icon danger ghost" onclick={() => removeExercise(di, ei)} aria-label="Remove exercise">×</button>
          </div>
          <Stepper label="Starting sets" bind:value={ex.startingSets} min={L.startingSets.min} max={L.startingSets.max} />
        </div>
      {:else}
        <p class="muted small">No exercises yet.</p>
      {/each}

      <button type="button" class="btn block" onclick={() => (pickingForDay = di)}>+ Add exercise</button>
    </section>
  {/each}

  <button type="button" class="btn block" onclick={addDay} disabled={draft.days.length >= L.daysPerWeek.max}>+ Add day</button>

  <!-- Problems live inside the sticky bar so they're visible wherever you tapped Save from. -->
  <div class="actions stack">
    {#if problems.length}
      <div class="error"><ul>{#each problems as p (p)}<li>{p}</li>{/each}</ul></div>
    {/if}
    <button type="button" class="btn primary block" onclick={save} disabled={saving}>{saving ? "Saving…" : "Save block"}</button>
  </div>
</div>

{#if pickingForDay !== null}
  <ExercisePicker
    exercises={exerciseList}
    exclude={draft.days[pickingForDay].exercises.map((e) => e.exerciseId)}
    onpick={pick}
    onclose={() => (pickingForDay = null)}
  />
{/if}

<style>
  .exercise { padding: 10px 0; border-top: 1px solid var(--border); }
  .exercise + .exercise { margin-top: 0; }
</style>
