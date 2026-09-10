<!--
  Full-screen exercise chooser: pick a muscle group, tap an exercise. Has an
  inline "custom exercise" form that writes to the database and immediately
  picks the new row. Receives the exercise list from the parent so the parent
  stays the single subscriber to the exercises table.
-->
<script lang="ts">
  import { db } from "../db";
  import { addCustomExercise, DuplicateExerciseError } from "../db/exercises";
  import { EQUIPMENT, type Equipment, type Exercise, type MuscleGroup } from "../db/schema";
  import { MUSCLE_GROUPS } from "../lib/progression";

  let {
    exercises,
    exclude = [],
    onpick,
    onclose,
  }: {
    exercises: Exercise[];
    /** Ids already on the day, shown but not tappable. */
    exclude?: number[];
    onpick: (exerciseId: number) => void;
    onclose: () => void;
  } = $props();

  let muscle = $state<MuscleGroup>("chest");
  let showCustom = $state(false);
  let customName = $state("");
  let customEquipment = $state<Equipment>("machine");
  let customError = $state("");
  let saving = $state(false);

  const forMuscle = $derived(
    exercises
      .filter((e) => e.muscleGroup === muscle)
      .sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === "seed" ? -1 : 1))
  );
  const excluded = $derived(new Set(exclude));

  async function saveCustom() {
    customError = "";
    saving = true;
    try {
      const id = await addCustomExercise(db, { name: customName, muscleGroup: muscle, equipment: customEquipment });
      customName = "";
      showCustom = false;
      onpick(id);
    } catch (e) {
      customError = e instanceof DuplicateExerciseError ? e.message : (e as Error).message || "Couldn't save.";
    } finally {
      saving = false;
    }
  }
</script>

<div class="overlay">
  <div class="page stack">
    <div class="row between">
      <h2>Add exercise</h2>
      <button type="button" class="btn ghost" onclick={onclose}>Cancel</button>
    </div>

    <div class="chips" role="tablist" aria-label="Muscle group">
      {#each MUSCLE_GROUPS as mg (mg)}
        <button type="button" class="chip" class:on={mg === muscle} role="tab" aria-selected={mg === muscle} onclick={() => (muscle = mg)}>
          {mg}
        </button>
      {/each}
    </div>

    <div class="list">
      {#each forMuscle as ex (ex.id)}
        <button type="button" class="btn" disabled={excluded.has(ex.id)} onclick={() => onpick(ex.id)}>
          <span>{ex.name}</span>
          <span class="muted small">{ex.equipment}{ex.source === "custom" ? " · custom" : ""}</span>
        </button>
      {:else}
        <p class="muted">No exercises for {muscle} yet.</p>
      {/each}
    </div>

    {#if showCustom}
      <form class="card stack" onsubmit={(e) => { e.preventDefault(); void saveCustom(); }}>
        <h3>Custom exercise · {muscle}</h3>
        <label>
          <span>Name</span>
          <input type="text" bind:value={customName} placeholder="e.g. Smith machine incline press" autocomplete="off" required />
        </label>
        <label>
          <span>Equipment</span>
          <select bind:value={customEquipment}>
            {#each EQUIPMENT as eq (eq)}<option value={eq}>{eq}</option>{/each}
          </select>
        </label>
        {#if customError}<div class="error">{customError}</div>{/if}
        <div class="row">
          <button type="button" class="btn grow" onclick={() => (showCustom = false)}>Back</button>
          <button type="submit" class="btn primary grow" disabled={saving || !customName.trim()}>Save & add</button>
        </div>
      </form>
    {:else}
      <button type="button" class="btn block" onclick={() => (showCustom = true)}>+ Custom exercise for {muscle}</button>
    {/if}
  </div>
</div>
