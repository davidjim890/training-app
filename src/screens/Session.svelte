<!--
  The gym screen. One card per exercise: target, last week's numbers, the
  engine's load suggestion, logged sets, and a stepper row to log the next.
  Everything is read via liveQuery so a logged set shows up the moment it's
  written; the only local state is the three numbers being entered.
-->
<script lang="ts">
  import { liveQuery } from "dexie";
  import FeedbackPrompt from "../components/FeedbackPrompt.svelte";
  import Stepper from "../components/Stepper.svelte";
  import { db } from "../db";
  import { feedbackStage, getSessionFeedback, musclesInSession, savePostSessionFeedback, savePreSessionFeedback } from "../db/feedback";
  import { completeSession, deleteSet, getSessionView, logSet, topSet, type SessionExerciseView } from "../db/sessions";
  import { PLATE_INCREMENT, isDeloadWeek, suggestLoad } from "../lib/progression";

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
  const showPre = $derived(stage === "pre" && !preDismissed && $view?.session.status !== "completed");

  // Per-exercise entry state, keyed by slot id. Seeded lazily from the best
  // available hint: last logged set → engine suggestion → last week → defaults.
  type Entry = { weight: number; reps: number; rir: number };
  let entries = $state<Record<number, Entry>>({});
  let busy = $state<number | null>(null);
  let error = $state("");

  function suggestion(ex: SessionExerciseView) {
    const top = topSet(ex.lastWeekSets);
    if (!top) return null;
    return suggestLoad(top.weight, top.reps, top.actualRir, ex.slot.targetRir);
  }

  function seedEntry(ex: SessionExerciseView): Entry {
    const last = ex.sets.at(-1);
    const sug = suggestion(ex);
    const prev = ex.lastWeekSets[0];
    if (last) return { weight: last.weight, reps: last.reps, rir: last.actualRir };
    if (sug) return { weight: sug.weight, reps: sug.reps, rir: ex.slot.targetRir };
    if (prev) return { weight: prev.weight, reps: prev.reps, rir: ex.slot.targetRir };
    return { weight: 20, reps: 10, rir: ex.slot.targetRir };
  }

  // State can't be written during render, so entries are seeded here, once
  // per exercise slot, whenever the view (re)loads.
  $effect(() => {
    for (const ex of $view?.exercises ?? []) {
      if (!entries[ex.slot.id]) entries[ex.slot.id] = seedEntry(ex);
    }
  });

  async function log(ex: SessionExerciseView) {
    const e = entries[ex.slot.id];
    busy = ex.slot.id;
    error = "";
    try {
      await logSet(db, ex.slot.id, { weight: e.weight, reps: e.reps, actualRir: e.rir });
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

  const fmt = (s: { weight: number; reps: number; actualRir: number }) => `${s.weight} × ${s.reps} @ ${s.actualRir}`;
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
    <h1>{$view.day.name}</h1>
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
        {#if ex.slot.rationale}
          <p class="small muted rationale">{ex.slot.rationale}</p>
        {/if}

        {#if ex.lastWeekSets.length}
          <p class="small"><span class="muted">Last week:</span> {ex.lastWeekSets.map(fmt).join(" · ")}</p>
        {/if}
        {#if sug}
          <p class="small hint"><strong>Try {sug.weight} × {sug.reps}.</strong> <span class="muted">{sug.rationale}</span></p>
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
            <Stepper label="Weight (kg)" bind:value={entries[ex.slot.id].weight} min={0} max={500} step={PLATE_INCREMENT} />
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
    onskip={() => (preDismissed = true)}
    onback={onBack}
  />
{/if}

{#if showPost && $feedback}
  <FeedbackPrompt mode="post" muscles={$feedback.muscles} onsave={finishWithFeedback} onskip={finishWithoutFeedback} onback={() => (showPost = false)} />
{/if}

<style>
  .rationale { border-left: 3px solid var(--accent); padding-left: 8px; }
  .target { text-align: right; }
  .big { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
  .sets { list-style: none; margin: 0; padding: 0; }
  .sets li { padding: 4px 0; border-top: 1px solid var(--border); font-variant-numeric: tabular-nums; }
  .entry { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border); }
  .hint { padding: 8px 10px; border-radius: var(--radius); background: var(--bg); }
</style>
