// Runs against an in-memory IndexedDB. The import below must come first: it
// installs the global `indexedDB` that Dexie looks for at construction time.
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrainingDb } from "./index";
import { exportBackup, importBackup, parseBackup, serializeBackup } from "./backup";

let db: TrainingDb;
beforeEach(() => {
  db = new TrainingDb(`test-${Math.random().toString(36).slice(2)}`);
});
afterEach(async () => {
  await db.delete();
});

/** Seed a small but fully-linked block: 1 meso, 1 day, 1 exercise, 1 session, 2 sets. */
async function seed(d: TrainingDb) {
  const exerciseId = await d.exercises.add({
    name: "Incline DB press",
    muscleGroup: "chest",
    secondaryMuscleGroup: "triceps",
    equipment: "dumbbell",
    source: "custom",
  });
  const mesocycleId = await d.mesocycles.add({
    name: "Block 1",
    numWeeks: 5,
    daysPerWeek: 4,
    startingRir: 3,
    startDate: "2026-09-14",
    status: "active",
  });
  const mesocycleDayId = await d.mesocycleDays.add({ mesocycleId, dayIndex: 0, name: "Push A" });
  await d.mesocycleDayExercises.add({ mesocycleDayId, exerciseId, order: 0, startingSets: 3 });
  const sessionId = await d.sessions.add({
    mesocycleId,
    mesocycleDayId,
    weekNum: 1,
    startedAt: "2026-09-14T17:00:00Z",
    completedAt: null,
    status: "in_progress",
  });
  const sessionExerciseId = await d.sessionExercises.add({
    sessionId,
    exerciseId,
    order: 0,
    targetSets: 3,
    targetRir: 3,
  });
  await d.sets.bulkAdd([
    { sessionExerciseId, setIndex: 0, weight: 30, reps: 10, actualRir: 3, completedAt: "2026-09-14T17:05:00Z" },
    { sessionExerciseId, setIndex: 1, weight: 30, reps: 9, actualRir: 2, completedAt: "2026-09-14T17:08:00Z" },
  ]);
  await d.muscleFeedback.add({ sessionId, mesocycleId, muscleGroup: "chest", soreness: 0 });
  await d.volumeLandmarks.put({ muscleGroup: "chest", mev: 8, mrv: 20, updatedAt: "2026-09-01T00:00:00Z" });
  return { exerciseId, mesocycleId, mesocycleDayId, sessionId, sessionExerciseId };
}

describe("schema", () => {
  it("opens and exposes all nine tables", async () => {
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      "exercises",
      "mesocycleDayExercises",
      "mesocycleDays",
      "mesocycles",
      "muscleFeedback",
      "sessionExercises",
      "sessions",
      "sets",
      "volumeLandmarks",
    ]);
  });

  it("assigns integer ids on insert", async () => {
    const { exerciseId } = await seed(db);
    expect(typeof exerciseId).toBe("number");
    expect((await db.exercises.get(exerciseId))?.name).toBe("Incline DB press");
  });

  it("volumeLandmarks is keyed by muscle group, so put() upserts", async () => {
    await db.volumeLandmarks.put({ muscleGroup: "lats", mev: 10, mrv: 22, updatedAt: "a" });
    await db.volumeLandmarks.put({ muscleGroup: "lats", mev: 10, mrv: 24, updatedAt: "b" });
    expect(await db.volumeLandmarks.count()).toBe(1);
    expect((await db.volumeLandmarks.get("lats"))?.mrv).toBe(24);
  });
});

describe("queries the app will need", () => {
  it("finds the active mesocycle by status index", async () => {
    await seed(db);
    await db.mesocycles.add({
      name: "Old", numWeeks: 5, daysPerWeek: 4, startingRir: 3, startDate: "2026-01-01", status: "completed",
    });
    const active = await db.mesocycles.where("status").equals("active").toArray();
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe("Block 1");
  });

  it("finds a session by meso + week + day via the compound index", async () => {
    const { mesocycleId, mesocycleDayId, sessionId } = await seed(db);
    const s = await db.sessions
      .where("[mesocycleId+weekNum+mesocycleDayId]")
      .equals([mesocycleId, 1, mesocycleDayId])
      .first();
    expect(s?.id).toBe(sessionId);
  });

  it("returns sets in setIndex order via the compound index", async () => {
    const { sessionExerciseId } = await seed(db);
    const sets = await db.sets
      .where("[sessionExerciseId+setIndex]")
      .between([sessionExerciseId, Dexie.minKey], [sessionExerciseId, Dexie.maxKey])
      .toArray();
    expect(sets.map((s) => s.setIndex)).toEqual([0, 1]);
    expect(sets.map((s) => s.reps)).toEqual([10, 9]);
  });

  it("pulls a muscle's feedback across a whole block in one query", async () => {
    const { mesocycleId } = await seed(db);
    const rows = await db.muscleFeedback
      .where("[mesocycleId+muscleGroup]")
      .equals([mesocycleId, "chest"])
      .toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].pump).toBeUndefined(); // post-session half not answered yet
  });
});

describe("backup", () => {
  it("round-trips every table through JSON with ids and links intact", async () => {
    const ids = await seed(db);
    const json = serializeBackup(await exportBackup(db));

    const fresh = new TrainingDb(`test-restore-${Math.random().toString(36).slice(2)}`);
    try {
      await importBackup(fresh, parseBackup(json));

      expect(await fresh.sets.count()).toBe(2);
      const se = await fresh.sessionExercises.get(ids.sessionExerciseId);
      expect(se?.exerciseId).toBe(ids.exerciseId);
      const link = await fresh.sets.where("sessionExerciseId").equals(ids.sessionExerciseId).count();
      expect(link).toBe(2);
      expect((await fresh.volumeLandmarks.get("chest"))?.mrv).toBe(20);
    } finally {
      await fresh.delete();
    }
  });

  it("import replaces existing data rather than merging", async () => {
    await seed(db);
    const before = await db.exercises.count();
    const backup = await exportBackup(db);
    await db.exercises.add({ name: "Extra", muscleGroup: "mid-back", equipment: "cable", source: "custom" });
    expect(await db.exercises.count()).toBe(before + 1);

    await importBackup(db, backup);
    expect(await db.exercises.count()).toBe(before);
    expect(await db.exercises.where("name").equals("Extra").count()).toBe(0);
  });

  it("rejects files that aren't backups", () => {
    expect(() => parseBackup("{}")).toThrow(/Not a training-app backup/);
    expect(() => parseBackup('{"formatVersion":1,"tables":null}')).toThrow();
  });

  it("rejects unknown tables and unknown format versions without touching data", async () => {
    await seed(db);
    const backup = await exportBackup(db);

    await expect(
      importBackup(db, { ...backup, tables: { ...backup.tables, bogus: [] } })
    ).rejects.toThrow(/unknown tables: bogus/);
    await expect(
      importBackup(db, { ...backup, formatVersion: 2 as never })
    ).rejects.toThrow(/format version 2/);

    expect(await db.sets.count()).toBe(2);
  });
});
