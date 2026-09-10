import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MUSCLE_GROUPS } from "../lib/progression";
import { TrainingDb } from "./index";
import { SEED_EXERCISES } from "./seed";
import { DuplicateExerciseError, addCustomExercise, listCustomExercises, listExercisesForMuscle } from "./exercises";

let db: TrainingDb;
beforeEach(() => {
  db = new TrainingDb(`test-${Math.random().toString(36).slice(2)}`);
});
afterEach(async () => {
  await db.delete();
});

describe("seed", () => {
  it("loads the starter library on first open, all marked as seed", async () => {
    const rows = await db.exercises.toArray();
    expect(rows).toHaveLength(SEED_EXERCISES.length);
    expect(rows.every((r) => r.source === "seed")).toBe(true);
  });

  it("does not re-seed on a second open of the same database", async () => {
    await db.exercises.count();
    await db.close();
    const again = new TrainingDb(db.name);
    try {
      expect(await again.exercises.count()).toBe(SEED_EXERCISES.length);
    } finally {
      await again.close();
    }
  });

  it("has no duplicate names, ignoring case", () => {
    const names = SEED_EXERCISES.map((e) => e.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers every muscle group with at least one exercise", () => {
    for (const mg of MUSCLE_GROUPS) {
      expect(SEED_EXERCISES.some((e) => e.muscleGroup === mg), `no seed exercise for ${mg}`).toBe(true);
    }
  });
});

describe("addCustomExercise", () => {
  it("adds with source custom and a trimmed name", async () => {
    const id = await addCustomExercise(db, { name: "  Smith machine incline press ", muscleGroup: "chest", equipment: "machine" });
    const row = await db.exercises.get(id);
    expect(row).toMatchObject({ name: "Smith machine incline press", source: "custom", muscleGroup: "chest" });
  });

  it("rejects a name that matches a seed exercise, ignoring case", async () => {
    await expect(
      addCustomExercise(db, { name: "leg PRESS", muscleGroup: "quads", equipment: "machine" })
    ).rejects.toBeInstanceOf(DuplicateExerciseError);
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length);
  });

  it("rejects an empty name", async () => {
    await expect(
      addCustomExercise(db, { name: "   ", muscleGroup: "quads", equipment: "machine" })
    ).rejects.toThrow(/required/);
  });

  it("the unique index also blocks exact duplicates at the Dexie level", async () => {
    await expect(
      db.exercises.add({ name: "Leg press", muscleGroup: "quads", equipment: "machine", source: "custom" })
    ).rejects.toThrow();
  });
});

describe("listing", () => {
  it("lists a muscle's exercises with seed first, then custom, alphabetical", async () => {
    await addCustomExercise(db, { name: "Zercher squat", muscleGroup: "quads", equipment: "barbell" });
    await addCustomExercise(db, { name: "Belt squat", muscleGroup: "quads", equipment: "machine" });
    const rows = await listExercisesForMuscle(db, "quads");
    const names = rows.map((r) => r.name);
    expect(names.slice(-2)).toEqual(["Belt squat", "Zercher squat"]);
    expect(rows.slice(0, -2).every((r) => r.source === "seed")).toBe(true);
    expect(names.slice(0, -2)).toEqual([...names.slice(0, -2)].sort((a, b) => a.localeCompare(b)));
  });

  it("lists only custom exercises", async () => {
    await addCustomExercise(db, { name: "Belt squat", muscleGroup: "quads", equipment: "machine" });
    const rows = await listCustomExercises(db);
    expect(rows.map((r) => r.name)).toEqual(["Belt squat"]);
  });
});
