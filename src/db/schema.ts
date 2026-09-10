// db/schema.ts
//
// Record shapes for every table. Pure types — no Dexie, no runtime code — so
// the engine and the UI can both import from here without dragging in the
// database. The engine's domain vocabulary (MuscleGroup, feedback scales) is
// imported FROM progression.ts; this module never flows back into it.
//
// Conventions:
//   - `id` is an auto-incremented integer assigned by Dexie on insert. It is
//     declared required here; the `EntityTable<T, "id">` wrapper in index.ts
//     makes it optional for `add()` automatically. Foreign keys (`*Id`) are
//     always present.
//   - Dates are ISO-8601 strings, not Date objects. They index and export
//     cleanly and IndexedDB has no Date-specific advantages we need.
//   - Ordering within a parent is an explicit integer (`order`, `setIndex`,
//     `dayIndex`), never "whatever order the rows came back in".

import type { MuscleFeedback, MuscleGroup } from "../lib/progression";

export type { MuscleGroup };

export type Equipment =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "bodyweight"
  | "other";

export const EQUIPMENT: readonly Equipment[] = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
  "other",
];

export interface Exercise {
  id: number;
  /** Unique, case-insensitively. Enforced in `addCustomExercise`. */
  name: string;
  /** The ONLY muscle this exercise's sets count toward. */
  muscleGroup: MuscleGroup;
  /**
   * Informational only. Sets are never credited to the secondary muscle —
   * an incline press is a chest exercise, full stop. Kept so the exercise
   * picker can hint at overlap when you're building a day.
   */
  secondaryMuscleGroup?: MuscleGroup;
  equipment: Equipment;
  /** Seeded rows ship with the app; custom rows were added by you. */
  source: "seed" | "custom";
}

export type MesocycleStatus = "planned" | "active" | "completed" | "abandoned";

export interface Mesocycle {
  id: number;
  name: string;
  /** Total weeks INCLUDING the final deload week. */
  numWeeks: number;
  daysPerWeek: number;
  startingRir: number;
  /** ISO date (YYYY-MM-DD) of week 1 day 1. */
  startDate: string;
  status: MesocycleStatus;
}

/** One slot in the weekly template, e.g. "Push A". */
export interface MesocycleDay {
  id: number;
  mesocycleId: number;
  /** 0-based position within the week. */
  dayIndex: number;
  name: string;
}

/** A planned exercise on a template day. */
export interface MesocycleDayExercise {
  id: number;
  mesocycleDayId: number;
  exerciseId: number;
  /** 0-based position within the day. */
  order: number;
  startingSets: number;
}

export type SessionStatus = "planned" | "in_progress" | "completed" | "skipped";

/** An actual instance of a template day in a given week. */
export interface Session {
  id: number;
  mesocycleId: number;
  mesocycleDayId: number;
  /** 1-based, matches `targetRirForWeek`. */
  weekNum: number;
  /** ISO datetime when the session was started; null until then. */
  startedAt: string | null;
  completedAt: string | null;
  status: SessionStatus;
}

/** An exercise slot inside a session, carrying that week's prescription. */
export interface SessionExercise {
  id: number;
  sessionId: number;
  exerciseId: number;
  order: number;
  targetSets: number;
  targetRir: number;
  /** Why the engine chose targetSets. Absent in week 1. */
  rationale?: string;
}

export interface WorkSet {
  id: number;
  sessionExerciseId: number;
  /** 0-based position within the exercise. */
  setIndex: number;
  weight: number;
  reps: number;
  actualRir: number;
  completedAt: string;
}

/**
 * Per-session, per-muscle feedback. Soreness is asked BEFORE the session,
 * the rest AFTER, so the post-session fields are absent until answered.
 */
export interface MuscleFeedbackRecord {
  id: number;
  sessionId: number;
  /** Denormalised from the session so per-block trends are one indexed query. */
  mesocycleId: number;
  muscleGroup: MuscleGroup;
  soreness: MuscleFeedback["soreness"];
  pump?: MuscleFeedback["pump"];
  jointPain?: MuscleFeedback["jointPain"];
  workload?: MuscleFeedback["workload"];
}

/** Personal MEV/MRV estimate. Keyed by muscle group — exactly one row each. */
export interface VolumeLandmarkRecord {
  muscleGroup: MuscleGroup;
  mev: number;
  mrv: number;
  /** ISO datetime of the last revision, so you can see how stale a guess is. */
  updatedAt: string;
}
