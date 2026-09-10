<!--
  Backup and restore. Export prefers the share sheet (on iOS that's how you
  get "Save to Files"); otherwise it falls back to a download link. Import
  replaces everything, so it confirms first.
-->
<script lang="ts">
  import { liveQuery } from "dexie";
  import { db } from "../db";
  import { exportBackup, importBackup, parseBackup, serializeBackup } from "../db/backup";

  let { onBack }: { onBack: () => void } = $props();

  const counts = liveQuery(async () => ({
    blocks: await db.mesocycles.count(),
    sessions: await db.sessions.count(),
    sets: await db.sets.count(),
    exercises: await db.exercises.count(),
  }));

  let message = $state("");
  let error = $state("");
  let busy = $state(false);

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
  <div class="row between">
    <button type="button" class="btn ghost" onclick={onBack}>← Home</button>
  </div>
  <h1>Settings</h1>

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
