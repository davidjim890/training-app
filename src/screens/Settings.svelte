<!--
  Backup and restore. Export prefers the share sheet (on iOS that's how you
  get "Save to Files"); otherwise it falls back to a download link. Import
  replaces everything, so it confirms first.
-->
<script lang="ts">
  import { liveQuery } from "dexie";
  import { db } from "../db";
  import { exportBackup, importBackup, parseBackup, serializeBackup } from "../db/backup";
  import { BODY_WEIGHT_LIMITS, getSetting, setBodyWeightKg } from "../db/settings";
  import Stepper from "../components/Stepper.svelte";


  const counts = liveQuery(async () => ({
    blocks: await db.mesocycles.count(),
    sessions: await db.sessions.count(),
    sets: await db.sets.count(),
    exercises: await db.exercises.count(),
  }));

  let message = $state("");
  let error = $state("");
  let busy = $state(false);

  // Body weight: edit locally, save on tap. Seeded from the stored value once.
  const storedWeight = liveQuery(() => getSetting(db, "bodyWeightKg"));
  let weight = $state(80);
  let weightSeeded = $state(false);
  let weightMsg = $state("");
  $effect(() => {
    if (!weightSeeded && $storedWeight !== undefined) {
      weight = $storedWeight;
      weightSeeded = true;
    }
  });
  async function saveWeight() {
    weightMsg = "";
    try {
      await setBodyWeightKg(db, weight);
      weightMsg = "Saved.";
    } catch (e) {
      weightMsg = (e as Error).message;
    }
  }

  async function doExport() {
    error = message = "";
    busy = true;
    try {
      const json = serializeBackup(await exportBackup(db));
      const name = `training-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File([json], name, { type: "application/json" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: name });
          message = "Shared.";
          return;
        } catch (e) {
          if ((e as Error).name === "AbortError") return; // user closed the sheet
          // Sharing refused (some desktop browsers): fall through to download.
        }
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      message = `Downloaded ${name}.`;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function doImport(ev: Event) {
    error = message = "";
    const input = ev.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    busy = true;
    try {
      const backup = parseBackup(await file.text());
      const rows = Object.values(backup.tables).reduce((n, t) => n + t.length, 0);
      if (!confirm(`Replace everything in this app with the backup from ${backup.exportedAt.slice(0, 10)} (${rows} rows)?`)) return;
      await importBackup(db, backup);
      message = "Restored.";
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="page stack">
  <h1>Settings</h1>

  <section class="card stack">
    <h3>You</h3>
    <Stepper label="Body weight (kg)" bind:value={weight} min={BODY_WEIGHT_LIMITS.min} max={BODY_WEIGHT_LIMITS.max} step={0.5} />
    <p class="small muted">Used to estimate calories for sessions and cardio. {$storedWeight === undefined ? "Not set yet — no estimates until it is." : `Currently ${$storedWeight} kg.`}</p>
    <button type="button" class="btn block" onclick={saveWeight} disabled={$storedWeight === weight}>Save body weight</button>
    {#if weightMsg}<p class="small">{weightMsg}</p>{/if}
  </section>

  <section class="card stack">
    <h3>Backup</h3>
    {#if $counts}
      <p class="small muted">{$counts.blocks} blocks · {$counts.sessions} sessions · {$counts.sets} sets · {$counts.exercises} exercises</p>
    {/if}
    <p class="small">Safari can evict this app's storage under disk pressure. Export regularly and keep the file somewhere else.</p>
    <button type="button" class="btn primary block" onclick={doExport} disabled={busy}>Export backup</button>
    <label class="btn block" style="display:flex;align-items:center;justify-content:center">
      Restore from backup…
      <input type="file" accept="application/json,.json" onchange={doImport} disabled={busy} hidden />
    </label>
    {#if message}<p class="small">{message}</p>{/if}
    {#if error}<div class="error">{error}</div>{/if}
  </section>
</div>
