<!--
  The gym screen. One card per exercise: target, last week's numbers, the
  engine's load suggestion, logged sets, and a stepper row to log the next.
  Everything is read via liveQuery so a logged set shows up the moment it's
  written; the only local state is the three numbers being entered.
-->
<script lang="ts">
  import { liveQuery } from "dexie";
  import ExercisePicker from "../components/ExercisePicker.svelte";
  import FeedbackPrompt from "../components/FeedbackPrompt.svelte";
  import Stepper from "../components/Stepper.svelte";
  import { db } from "../db";
  import { dismissPreFeedback, feedbackStage, getSessionFeedback, musclesInSession, savePostSessionFeedback, savePreSessionFeedback } from "../db/feedback";
  import { completeSession, deleteSet, getSessionView, logSet, swapExercise, topSet, type SessionExerciseView } from "../db/sessions";
  import { liftingEnergy, liftingSessionMinutes } from "../lib/energy";
  import { isDeloadWeek, suggestLoad } from "../lib/progression";
  import { PLATE_STEP, fmtWeight, plateStepKg, toDisplay, toKg, type WeightUnit } from "../lib/units";
  import { getSetting } from "../db/settings";
  import { units } from "../stores/units";

  let { sessionId, onBack }: { sessionId: number; onBack: () => void } = $props();

  const view = liveQuery(() => getSessionView(db, sessionId));

  // Feedback: which prompt (if any) is due right now.
  const feedback = liveQuery(async () => ({
    muscles: await musclesInSession(db, sessionId),
    rows: await getSessionFeedback(db, sessionId),
  }));
  const stage = $derived($feedback ? feedbackStage($feedback.muscles, $feedback.rows) : null);
  let preDismissed = $state(false);
  let showPost = $state(false);

  // Swapping an exercise (machine taken, etc.)
  const allExercises = liveQuery(() => db.exercises.toArray());
  let swapping = $state<SessionExerciseView | null>(null);
  let swapScope = $state(0); // 0 just today, 1 rest of block
  const SWAP_SCOPES = ["Just today", "Rest of block"] as const;
  async function doSwap(newExerciseId: number) {
    if (!swapping) return;
    error = "";
    try {
      await swapExercise(db, swapping.slot.id, newExerciseId, { applyToBlock: swapScope === 1 });
      swapping = null;
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const showPre = $derived(
    stage === "pre" && !preDismissed && !$view?.session.preFeedbackDismissed && $view?.session.status !== "completed"
  );

  // Per-exercise entry state, keyed by slot id. Seeded lazily from the best
  // available hint: last logged set → engine suggestion → last week → defaults.
  type Entry = { weight: number; reps: number; rir: number };
  let entries = $state<Record<number, Entry>>({});
  let busy = $state<number | null>(null);
  let error = $state("");

  // Entry weights are in the DISPLAY unit; everything else here is kg.
  const unit = $derived<WeightUnit>($units ?? "kg");

  function suggestion(ex: SessionExerciseView) {
    const top = topSet(ex.lastWeekSets);
    if (!top) return null;
    return suggestLoad(top.weight, top.reps, top.actualRir, ex.slot.targetRir, { min: 5, max: 30 }, plateStepKg(unit));
  }

  function seedEntry(ex: SessionExerciseView, u: WeightUnit): Entry {
    const last = ex.sets.at(-1);
    const sug = suggestion(ex);
    const prev = ex.lastWeekSets[0];
    if (last) return { weight: toDisplay(last.weight, u), reps: last.reps, rir: last.actualRir };
    if (sug) return { weight: toDisplay(sug.weight, u), reps: sug.reps, rir: ex.slot.targetRir };
    if (prev) return { weight: toDisplay(prev.weight, u), reps: prev.reps, rir: ex.slot.targetRir };
    return { weight: u === "kg" ? 20 : 45, reps: 10, rir: ex.slot.targetRir };
  }

  // State can't be written during render, so entries are seeded here, once
  // per exercise slot, whenever the view (re)loads. A unit change re-seeds
  // everything, since the numbers on screen would otherwise be in the old unit.
  let seededUnit = $state<WeightUnit | null>(null);
  $effect(() => {
    const u = unit;
    if (seededUnit !== u) {
      entries = {};
      seededUnit = u;
    }
    for (const ex of $view?.exercises ?? []) {
      if (!entries[ex.slot.id]) entries[ex.slot.id] = seedEntry(ex, u);
    }
  });

  async function log(ex: SessionExerciseView) {
    const e = entries[ex.slot.id];
    busy = ex.slot.id;
    error = "";
    try {
      await logSet(db, ex.slot.id, { weight: toKg(e.weight, unit), reps: e.reps, actualRir: e.rir });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = null;
    }
  }

  async function finish() {
    if ($view?.session.status === "completed") return onBack();
    if (stage !== "done") {
      showPost = true;
      return;
    }
    await completeSession(db, sessionId);
    onBack();
  }

  async function finishWithFeedback(answers: Parameters<typeof savePostSessionFeedback>[2]) {
    await savePostSessionFeedback(db, sessionId, answers);
    await completeSession(db, sessionId);
    onBack();
  }

  async function finishWithoutFeedback() {
    await completeSession(db, sessionId);
    onBack();
  }

  const fmt = (s: { weight: number; reps: number; actualRir: number }) => `${fmtWeight(s.weight, unit)} × ${s.reps} @ ${s.actualRir}`;

  const bodyWeight = liveQuery(() => getSetting(db, "bodyWeightKg"));
  const energy = $derived.by(() => {
    if (!$view || $bodyWeight === undefined) return null;
    const minutes = liftingSessionMinutes({
      startedAt: $view.session.startedAt,
      completedAt: $view.session.completedAt,
      setCompletedAts: $view.exercises.flatMap((e) => e.sets.map((s) => s.completedAt)),
    });
    return minutes === null ? null : { minutes: Math.round(minutes), kcal: liftingEnergy(minutes, $bodyWeight).kcal };
  });
  const totalLogged = $derived(($view?.exercises ?? []).reduce((n, ex) => n + ex.sets.length, 0));
</script>

<div class="page stack">
  <div class="row between">
    <button type="button" class="btn ghost" onclick={onBack}>← Block</button>
    {#if $view}
      <span class="muted small">
        {isDeloadWeek($view.session.weekNum, $view.mesocycle.numWeeks) ? "Deload" : `Week ${$view.session.weekNum}`} of {$view.mesocycle.numWeeks}
      </span>
    {/if}
  </div>

  {#if !$view}
    <p class="muted">Loading…</p>
  {:else}
    <div class="row between">
      <h1>{$view.day.name}</h1>
      {#if energy}
        <span class="muted small tabular">{energy.minutes} min · <strong>~{energy.kcal} kcal</strong></span>
      {/if}
    </div>
    {#if $view.session.status === "completed"}
      <p class="muted small">Completed. You can still edit sets.</p>
    {/if}

    {#each $view.exercises as ex (ex.slot.id)}
      {@const sug = suggestion(ex)}
      <section class="card stack">
        <div class="row between">
          <div class="grow">
            <h2>{ex.exercise.name}</h2>
            <div class="muted small">{ex.exercise.muscleGroup}</div>
          </div>
          <div class="target">
            <div class="big">{ex.sets.length}<span class="muted">/{ex.slot.targetSets}</span></div>
            <div class="muted small">sets @ {ex.slot.targetRir} RIR</div>
          </div>
        </div>
        {#if $view.session.status !== "completed"}
          <button type="button" class="btn ghost swap" onclick={() => { swapScope = 0; swapping = ex; }} aria-label="Swap {ex.exercise.name}">
            ⇄ Swap exercise{ex.sets.length ? ` (keep ${ex.sets.length} logged)` : ""}
          </button>
        {/if}
        {#if ex.slot.rationale}
          <p class="small muted rationale">{ex.slot.rationale}</p>
        {/if}

        {#if ex.lastWeekSets.length}
          <p class="small"><span class="muted">Last week:</span> {ex.lastWeekSets.map(fmt).join(" · ")}</p>
        {/if}
        {#if sug}
          <p class="small hint"><strong>Try {fmtWeight(sug.weight, unit)} × {sug.reps}.</strong> <span class="muted">{sug.rationale}</span></p>
        {/if}

        {#if ex.sets.length}
          <ol class="sets">
            {#each ex.sets as s (s.id)}
              <li class="row between">
                <span>{fmt(s)}</span>
                <button type="button" class="btn icon ghost danger" onclick={() => deleteSet(db, s.id)} aria-label="Delete set {s.setIndex + 1}">×</button>
              </li>
            {/each}
          </ol>
        {/if}

        {#if entries[ex.slot.id]}
          <div class="entry">
            <Stepper label="Weight ({unit})" bind:value={entries[ex.slot.id].weight} min={0} max={unit === "kg" ? 500 : 1100} step={PLATE_STEP[unit]} />
            <Stepper label="Reps" bind:value={entries[ex.slot.id].reps} min={1} max={50} />
            <Stepper label="RIR" bind:value={entries[ex.slot.id].rir} min={0} max={6} />
          </div>
        {/if}
        <button type="button" class="btn primary block" onclick={() => log(ex)} disabled={busy === ex.slot.id}>
          Log set {ex.sets.length + 1}
        </button>
      </section>
    {/each}

    {#if error}<div class="error">{error}</div>{/if}

    <div class="actions">
      <button type="button" class="btn block" onclick={finish} disabled={totalLogged === 0 && $view.session.status !== "completed"}>
        {$view.session.status === "completed" ? "Done" : "Finish session"}
      </button>
    </div>
  {/if}
</div>

{#if showPre && $feedback}
  <FeedbackPrompt
    mode="pre"
    muscles={$feedback.muscles}
    onsave={async (a) => { await savePreSessionFeedback(db, sessionId, a); preDismissed = true; }}
    onskip={async () => { preDismissed = true; await dismissPreFeedback(db, sessionId); }}
    onback={onBack}
  />
{/if}

{#if swapping && $view}
  <ExercisePicker
    title="Swap {swapping.exercise.name}"
    initialMuscle={swapping.exercise.muscleGroup}
    exercises={$allExercises ?? []}
    exclude={$view.exercises.map((e) => e.slot.exerciseId)}
    scopeLabels={SWAP_SCOPES}
    bind:scope={swapScope}
    onpick={doSwap}
    onclose={() => (swapping = null)}
  />
{/if}

{#if showPost && $feedback}
  <FeedbackPrompt mode="post" muscles={$feedback.muscles} onsave={finishWithFeedback} onskip={finishWithoutFeedback} onback={() => (showPost = false)} />
{/if}

<style>
  .rationale { border-left: 3px solid var(--accent); padding-left: 8px; }
  .tabular { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .swap { align-self: flex-start; min-height: 36px; padding: 4px 8px; margin-top: -4px; color: var(--muted); font-weight: 500; }
  .target { text-align: right; }
  .big { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
  .sets { list-style: none; margin: 0; padding: 0; }
  .sets li { padding: 4px 0; border-top: 1px solid var(--border); font-variant-numeric: tabular-nums; }
  .entry { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border); }
  .hint { padding: 8px 10px; border-radius: var(--radius); background: var(--bg); }
</style>
