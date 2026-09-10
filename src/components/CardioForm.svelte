<!-- Full-screen form for one cardio workout. Chips and steppers; typing only for notes. -->
<script lang="ts">
  import { untrack } from "svelte";
  import { db } from "../db";
  import { addCardio, CARDIO_LIMITS, validateCardioDraft, type CardioDraft } from "../db/cardio";
  import { CARDIO_INTENSITY_LABELS, CARDIO_KINDS, type CardioIntensity } from "../db/schema";
  import Choice from "./Choice.svelte";
  import Stepper from "./Stepper.svelte";

  let { onsaved, onclose }: { onsaved: () => void; onclose: () => void } = $props();

  let draft = $state<CardioDraft>(
    untrack(() => ({ date: new Date().toISOString().slice(0, 10), kind: "run", durationMin: 30, distanceKm: 0, inclinePct: 0, intensity: 1, notes: "" }))
  );
  let intensity = $state<CardioIntensity | undefined>(1);
  let problems = $state<string[]>([]);
  let saving = $state(false);

  async function save() {
    draft.intensity = intensity ?? 1;
    problems = validateCardioDraft(draft);
    if (problems.length) return;
    saving = true;
    try {
      await addCardio(db, $state.snapshot(draft));
      onsaved();
    } catch (e) {
      problems = [(e as Error).message];
    } finally {
      saving = false;
    }
  }
</script>

<div class="overlay">
  <div class="page stack">
    <div class="row between">
      <h1>Log cardio</h1>
      <button type="button" class="btn ghost" onclick={onclose}>Cancel</button>
    </div>

    <section class="card stack">
      <div class="chips" role="radiogroup" aria-label="Kind">
        {#each CARDIO_KINDS as k (k)}
          <button type="button" class="chip" class:on={draft.kind === k} role="radio" aria-checked={draft.kind === k} onclick={() => (draft.kind = k)}>{k}</button>
        {/each}
      </div>
      <label>
        <span>Date</span>
        <input type="date" bind:value={draft.date} />
      </label>
      <Stepper label="Duration (min)" bind:value={draft.durationMin} min={CARDIO_LIMITS.durationMin.min} max={CARDIO_LIMITS.durationMin.max} step={5} />
      <Stepper label="Distance (km, optional)" bind:value={draft.distanceKm as number} min={0} max={CARDIO_LIMITS.distanceKm.max} step={0.5} />
      {#if draft.kind === "treadmill"}
        <Stepper label="Incline (%)" bind:value={draft.inclinePct as number} min={CARDIO_LIMITS.inclinePct.min} max={CARDIO_LIMITS.inclinePct.max} step={0.5} />
      {/if}
      <p class="small muted" style="margin:0">Intensity</p>
      <Choice bind:value={intensity} options={CARDIO_INTENSITY_LABELS} label="Intensity" />
      <label>
        <span>Notes (optional)</span>
        <input type="text" bind:value={draft.notes} placeholder="e.g. intervals, 6 × 2 min" autocomplete="off" />
      </label>
    </section>

    <div class="actions stack">
      {#if problems.length}
        <div class="error"><ul>{#each problems as p (p)}<li>{p}</li>{/each}</ul></div>
      {/if}
      <button type="button" class="btn primary block" onclick={save} disabled={saving}>Save</button>
    </div>
  </div>
</div>
