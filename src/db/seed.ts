// db/seed.ts
//
// Starter exercise library. Loaded once via Dexie's `populate` hook when the
// database is first created; after that it's just rows you can edit or
// ignore. Custom exercises live alongside these with `source: "custom"`.
//
// Editing this list does NOT touch devices that already have a database —
// populate only fires on creation. To push new seed rows to an existing
// install you'd write a `version(n).upgrade()` migration.

import type { Exercise } from "./schema";
import type { TrainingDb } from "./index";

export type SeedExercise = Omit<Exercise, "id" | "source">;

export const SEED_EXERCISES: readonly SeedExercise[] = [
  // Chest
  { name: "Barbell bench press", muscleGroup: "chest", secondaryMuscleGroup: "triceps", equipment: "barbell" },
  { name: "Incline dumbbell press", muscleGroup: "chest", secondaryMuscleGroup: "shoulders", equipment: "dumbbell" },
  { name: "Machine chest press", muscleGroup: "chest", secondaryMuscleGroup: "triceps", equipment: "machine" },
  { name: "Pec deck", muscleGroup: "chest", equipment: "machine" },
  { name: "Cable fly", muscleGroup: "chest", equipment: "cable" },
  { name: "Dip", muscleGroup: "chest", secondaryMuscleGroup: "triceps", equipment: "bodyweight" },

  // Lats
  { name: "Pull-up", muscleGroup: "lats", secondaryMuscleGroup: "biceps", equipment: "bodyweight" },
  { name: "Lat pulldown", muscleGroup: "lats", secondaryMuscleGroup: "biceps", equipment: "cable" },
  { name: "Single-arm dumbbell row", muscleGroup: "lats", secondaryMuscleGroup: "mid-back", equipment: "dumbbell" },
  { name: "Straight-arm pulldown", muscleGroup: "lats", equipment: "cable" },
  { name: "Assisted pull-up", muscleGroup: "lats", secondaryMuscleGroup: "biceps", equipment: "machine" },
  { name: "Close-grip pull-down", muscleGroup: "lats", secondaryMuscleGroup: "biceps", equipment: "cable" },

  // Mid-back
  { name: "Barbell row", muscleGroup: "mid-back", secondaryMuscleGroup: "lats", equipment: "barbell" },
  { name: "Chest-supported row", muscleGroup: "mid-back", secondaryMuscleGroup: "rear-delts", equipment: "machine" },
  { name: "Seated cable row", muscleGroup: "mid-back", secondaryMuscleGroup: "lats", equipment: "cable" },
  { name: "T-bar row", muscleGroup: "mid-back", secondaryMuscleGroup: "lats", equipment: "machine" },

  // Traps
  { name: "Barbell shrug", muscleGroup: "traps", equipment: "barbell" },
  { name: "Dumbbell shrug", muscleGroup: "traps", equipment: "dumbbell" },

  // Rear delts
  { name: "Reverse pec deck", muscleGroup: "rear-delts", equipment: "machine" },
  { name: "Face pull", muscleGroup: "rear-delts", secondaryMuscleGroup: "traps", equipment: "cable" },
  { name: "Rear delt fly", muscleGroup: "rear-delts", equipment: "dumbbell" },

  // Shoulders (front + side delts)
  { name: "Overhead press", muscleGroup: "shoulders", secondaryMuscleGroup: "triceps", equipment: "barbell" },
  { name: "Seated dumbbell shoulder press", muscleGroup: "shoulders", secondaryMuscleGroup: "triceps", equipment: "dumbbell" },
  { name: "Machine shoulder press", muscleGroup: "shoulders", secondaryMuscleGroup: "triceps", equipment: "machine" },
  { name: "Dumbbell lateral raise", muscleGroup: "shoulders", equipment: "dumbbell" },
  { name: "Cable lateral raise", muscleGroup: "shoulders", equipment: "cable" },
  { name: "Barbell upright row", muscleGroup: "shoulders", secondaryMuscleGroup: "traps", equipment: "barbell" },

  // Biceps
  { name: "Barbell curl", muscleGroup: "biceps", equipment: "barbell" },
  { name: "Dumbbell curl", muscleGroup: "biceps", equipment: "dumbbell" },
  { name: "Hammer curl", muscleGroup: "biceps", equipment: "dumbbell" },
  { name: "Preacher curl", muscleGroup: "biceps", equipment: "machine" },
  { name: "Cable curl", muscleGroup: "biceps", equipment: "cable" },

  // Triceps
  { name: "Cable pushdown", muscleGroup: "triceps", equipment: "cable" },
  { name: "Overhead cable extension", muscleGroup: "triceps", equipment: "cable" },
  { name: "Skull crusher", muscleGroup: "triceps", equipment: "barbell" },
  { name: "Close-grip bench press", muscleGroup: "triceps", secondaryMuscleGroup: "chest", equipment: "barbell" },

  // Quads
  { name: "Back squat", muscleGroup: "quads", secondaryMuscleGroup: "glutes", equipment: "barbell" },
  { name: "Leg press", muscleGroup: "quads", secondaryMuscleGroup: "glutes", equipment: "machine" },
  { name: "Hack squat", muscleGroup: "quads", equipment: "machine" },
  { name: "Leg extension", muscleGroup: "quads", equipment: "machine" },
  { name: "Bulgarian split squat", muscleGroup: "quads", secondaryMuscleGroup: "glutes", equipment: "dumbbell" },
  { name: "Dumbbell walking lunges", muscleGroup: "quads", secondaryMuscleGroup: "glutes", equipment: "dumbbell" },

  // Hamstrings
  { name: "Romanian deadlift", muscleGroup: "hamstrings", secondaryMuscleGroup: "glutes", equipment: "barbell" },
  { name: "Seated leg curl", muscleGroup: "hamstrings", equipment: "machine" },
  { name: "Lying leg curl", muscleGroup: "hamstrings", equipment: "machine" },

  // Glutes
  { name: "Hip thrust", muscleGroup: "glutes", secondaryMuscleGroup: "hamstrings", equipment: "barbell" },
  { name: "Cable pull-through", muscleGroup: "glutes", secondaryMuscleGroup: "hamstrings", equipment: "cable" },

  // Calves
  { name: "Standing calf raise", muscleGroup: "calves", equipment: "machine" },
  { name: "Seated calf raise", muscleGroup: "calves", equipment: "machine" },

  // Abs
  { name: "Cable crunch", muscleGroup: "abs", equipment: "cable" },
  { name: "Hanging leg raise", muscleGroup: "abs", equipment: "bodyweight" },
  { name: "Machine crunch", muscleGroup: "abs", equipment: "machine" },
];

export function seedExercises(db: TrainingDb) {
  return db.exercises.bulkAdd(SEED_EXERCISES.map((e) => ({ ...e, source: "seed" as const })));
}
