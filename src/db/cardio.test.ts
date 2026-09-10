import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrainingDb } from "./index";
import { addCardio, cardioLast7Days, deleteCardio, listCardio, validateCardioDraft } from "./cardio";

let db: TrainingDb;
beforeEach(() => {
  db = new TrainingDb(`test-${Math.random().toString(36).slice(2)}`);
});
afterEach(async () => {
  await db.delete();
});

describe("schema v2 migration", () => {
  it("upgrades a v1 database in place, keeping its rows and adding cardio", async () => {
    const name = `test-migrate-${Math.random().toString(36).slice(2)}`;
    // A database as shipped in v1: same stores, no cardio table.
    const v1 = new Dexie(name);
    v1.version(1).stores({
      exercises: "++id, &name, muscleGroup, source",
      mesocycles: "++id, status, startDate",
      mesocycleDays: "++id, mesocycleId, [mesocycleId+dayIndex]",
      mesocycleDayExercises: "++id, mesocycleDayId, exerciseId, [mesocycleDayId+order]",
      sessions: "++id, mesocycleId, [mesocycleId+weekNum], [mesocycleId+weekNum+mesocycleDayId]",
      sessionExercises: "++id, sessionId, exerciseId, [sessionId+order]",
      sets: "++id, sessionExerciseId, [sessionExerciseId+setIndex]",
      muscleFeedback: "++id, sessionId, [sessionId+muscleGroup], [mesocycleId+muscleGroup]",
      volumeLandmarks: "muscleGroup",
    });
    await v1.table("mesocycles").add({ name: "Old block", numWeeks: 5, daysPerWeek: 3, startingRir: 3, startDate: "2026-08-01", status: "completed" });
    await v1.table("exercises").add({ name: "Legacy row", muscleGroup: "lats", equipment: "cable", source: "custom" });
    v1.close();

    const upgraded = new TrainingDb(name);
    try {
      await upgraded.open();
      expect(upgraded.verno).toBe(2);
      expect((await upgraded.mesocycles.toArray())[0].name).toBe("Old block");
      expect(await upgraded.exercises.count()).toBe(1); // populate does NOT re-run on upgrade
      await upgraded.cardioSessions.add({ date: "2026-09-10", kind: "run", durationMin: 30, intensity: 1, loggedAt: "x" });
      expect(await upgraded.cardioSessions.count()).toBe(1);
    } finally {
      await upgraded.delete();
    }
  });

  it("a fresh database is v2 with the cardio table and the seed", async () => {
    await db.open();
    expect(db.verno).toBe(2);
    expect(db.tables.map((t) => t.name)).toContain("cardioSessions");
    expect(await db.exercises.count()).toBeGreaterThan(0);
  });
});

describe("cardio log", () => {
  it("validates", () => {
    expect(validateCardioDraft({ date: "2026-09-10", kind: "run", durationMin: 30, intensity: 1 })).toEqual([]);
    expect(validateCardioDraft({ date: "today", kind: "run", durationMin: 0, intensity: 1, distanceKm: -1 })).toHaveLength(3);
  });

  it("adds, rounds, drops empty optionals, lists newest first, deletes", async () => {
    const a = await addCardio(db, { date: "2026-09-08", kind: "bike", durationMin: 45.4, intensity: 0, distanceKm: 20.126, notes: "  " });
    const b = await addCardio(db, { date: "2026-09-10", kind: "run", durationMin: 30, intensity: 2, distanceKm: 0, notes: " hills " });
    const rows = await listCardio(db);
    expect(rows.map((r) => r.id)).toEqual([b, a]);
    expect(rows[1]).toMatchObject({ durationMin: 45, distanceKm: 20.13 });
    expect(rows[1].notes).toBeUndefined();
    expect(rows[0].distanceKm).toBeUndefined();
    expect(rows[0].notes).toBe("hills");
    await deleteCardio(db, a);
    expect(await db.cardioSessions.count()).toBe(1);
  });

  it("rejects an invalid draft", async () => {
    await expect(addCardio(db, { date: "2026-09-10", kind: "run", durationMin: 0, intensity: 1 })).rejects.toThrow(/Duration/);
  });

  it("sums the last 7 days inclusive", async () => {
    const today = new Date("2026-09-10T12:00:00Z");
    await addCardio(db, { date: "2026-09-04", kind: "run", durationMin: 30, intensity: 1, distanceKm: 5 }); // day 7 -> in
    await addCardio(db, { date: "2026-09-03", kind: "run", durationMin: 99, intensity: 1 }); // day 8 -> out
    await addCardio(db, { date: "2026-09-10", kind: "walk", durationMin: 20, intensity: 0, distanceKm: 1.5 });
    expect(await cardioLast7Days(db, today)).toEqual({ sessions: 2, minutes: 50, km: 6.5 });
  });
});
