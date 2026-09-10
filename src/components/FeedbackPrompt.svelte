<!--
  Full-screen prompt for per-muscle feedback. `mode="pre"` asks soreness only
  (before training); `mode="post"` asks pump, joint pain, and workload.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import type { PostSessionAnswers, Soreness } from "../db/feedback";
  import { FEEDBACK_QUESTIONS, FEEDBACK_SCALES, type MuscleGroup } from "../lib/progression";
  import Choice from "./Choice.svelte";

  type Props =
    | { mode: "pre"; muscles: MuscleGroup[]; onsave: (a: Record<MuscleGroup, Soreness>) => void; onskip: () => void; onback: () => void }
    | { mode: "post"; muscles: MuscleGroup[]; onsave: (a: Record<MuscleGroup, PostSessionAnswers>) => void; onskip: () => void; onback: () => void };
  let props: Props = $props();

  let soreness = $state<Partial<Record<MuscleGroup, Soreness>>>({});
  // The muscle list is fixed for the life of a prompt, so capturing it once is intended.
  let post = $state<Partial<Record<MuscleGroup, Partial<PostSessionAnswers>>>>(
    Object.fromEntries(untrack(() => props.muscles).map((m) => [m, {}]))
  );

  const complete = $derived(
    props.mode === "pre"
      ? props.muscles.every((m) => soreness[m] !== undefined)
      : props.muscles.every((m) => post[m]?.pump !== undefined && post[m]?.jointPain !== undefined && post[m]?.workload !== undefined)
  );

  function save() {
    if (props.mode === "pre") props.onsave(soreness as Record<MuscleGroup, Soreness>);
    else props.onsave(post as Record<MuscleGroup, PostSessionAnswers>);
  }
</script>

<div class="overlay">
  <div class="page stack">
    <div class="row between">
      <button type="button" class="btn ghost" onclick={props.onback}>← {props.mode === "pre" ? "Block" : "Session"}</button>
    </div>
    <h1>{props.mode === "pre" ? "Before you start" : "How did it go?"}</h1>
    <p class="muted small">
      {props.mode === "pre"
        ? "Recovery since you last trained each muscle. This shapes next week's volume."
        : "One answer per muscle. Joint pain overrides everything else."}
    </p>

    {#each props.muscles as m (m)}
      <section class="card stack">
        <h2>{m}</h2>
        {#if props.mode === "pre"}
          <p class="small muted">{FEEDBACK_QUESTIONS.soreness}</p>
          <Choice bind:value={soreness[m]} options={FEEDBACK_SCALES.soreness} label="{m} soreness" />
        {:else}
          <p class="small muted">{FEEDBACK_QUESTIONS.pump}</p>
          <Choice bind:value={post[m]!.pump} options={FEEDBACK_SCALES.pump} label="{m} pump" />
          <p class="small muted">{FEEDBACK_QUESTIONS.jointPain}</p>
          <Choice bind:value={post[m]!.jointPain} options={FEEDBACK_SCALES.jointPain} label="{m} joint pain" />
          <p class="small muted">{FEEDBACK_QUESTIONS.workload}</p>
          <Choice bind:value={post[m]!.workload} options={FEEDBACK_SCALES.workload} label="{m} workload" />
        {/if}
      </section>
    {/each}

    <div class="actions stack">
      <button type="button" class="btn primary block" onclick={save} disabled={!complete}>
        {props.mode === "pre" ? "Start session" : "Save & finish"}
      </button>
      <button type="button" class="btn ghost block" onclick={props.onskip}>
        {props.mode === "pre" ? "Skip for now" : "Finish without feedback"}
      </button>
    </div>
  </div>
</div>
