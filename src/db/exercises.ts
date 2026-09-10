// db/exercises.ts
//
// Read/write helpers for the exercise library. Components call these rather
// than touching `db.exercises` directly, so the rules (name uniqueness,
// trimming, what "custom" means) live in one place.

import type { TrainingDb } from "./index";
import type { Equipment, Exercise, MuscleGroup } from "./schema";

export class DuplicateExerciseError extends Error {
  constructor(name: string) {
    super(`An exercise named "${name}" already exists`);
    this.name = "DuplicateExerciseError";
  }
}

/**
 * Create a user-defined exercise. The name is trimmed and must not collide
 * with an existing one, ignoring case — "leg press" and "Leg press" are the
 * same thing and you don't want both in a dropdown.
 */
export async function addCustomExercise(
  db: TrainingDb,
  input: { name: string; muscleGroup: MuscleGroup; equipment: Equipment; secondaryMuscleGroup?: MuscleGroup }
): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new Error("Exercise name is required");

  return db.transaction("rw", db.exercises, async () => {
    const clash = await db.exercises.where("name").equalsIgnoreCase(name).first();
    if (clash) throw new DuplicateExerciseError(clash.name);
    return db.exercises.add({ ...input, name, source: "custom" });
  });
}

/** Exercises for one muscle, seeded first then custom, alphabetical within. */
export async function listExercisesForMuscle(db: TrainingDb, muscleGroup: MuscleGroup): Promise<Exercise[]> {
  const rows = await db.exercises.where("muscleGroup").equals(muscleGroup).toArray();
  const rank = (e: Exercise) => (e.source === "seed" ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function listCustomExercises(db: TrainingDb): Promise<Exercise[]> {
  return db.exercises.where("source").equals("custom").sortBy("name");
}
