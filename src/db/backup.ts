// db/backup.ts
//
// Whole-database export/import as one JSON document. This exists because iOS
// Safari can evict IndexedDB under disk pressure and there is no server copy.
// The format is deliberately dumb — a map of table name to array of rows —
// so it can be inspected, diffed, or read into R without any tooling.

import type { TrainingDb } from "./index";

export interface Backup {
  /** Bump when the row shapes change incompatibly. */
  formatVersion: 1;
  exportedAt: string;
  /** Dexie schema version at export time, for diagnosing old files. */
  dbVersion: number;
  tables: Record<string, unknown[]>;
}

export async function exportBackup(db: TrainingDb): Promise<Backup> {
  const tables: Record<string, unknown[]> = {};
  await db.transaction("r", db.tables, async () => {
    for (const table of db.tables) {
      tables[table.name] = await table.toArray();
    }
  });
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    dbVersion: db.verno,
    tables,
  };
}

/**
 * Replace the entire database with the contents of a backup. Runs in one
 * transaction so a failure part-way leaves the existing data untouched.
 * Rows keep their original ids, so foreign keys survive the round trip.
 */
export async function importBackup(db: TrainingDb, backup: Backup): Promise<void> {
  if (backup.formatVersion !== 1) {
    throw new Error(`Unsupported backup format version ${String(backup.formatVersion)}`);
  }
  const known = new Set(db.tables.map((t) => t.name));
  const unknown = Object.keys(backup.tables).filter((n) => !known.has(n));
  if (unknown.length) {
    throw new Error(`Backup contains unknown tables: ${unknown.join(", ")}`);
  }

  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
      const rows = backup.tables[table.name];
      if (rows?.length) await table.bulkAdd(rows as never[]);
    }
  });
}

export function serializeBackup(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}

export function parseBackup(json: string): Backup {
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("formatVersion" in parsed) ||
    !("tables" in parsed) ||
    typeof (parsed as Backup).tables !== "object" ||
    (parsed as Backup).tables === null
  ) {
    throw new Error("Not a training-app backup file");
  }
  return parsed as Backup;
}
