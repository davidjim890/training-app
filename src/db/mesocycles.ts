// db/mesocycles.ts
//
// Creating and listing training blocks. The builder screen assembles a
// `MesocycleDraft` in memory, then hands it here to be validated and written
// atomically across three tables.

import type { TrainingDb } from "./index";
import type { Mesocycle } from "./schema";

export interface DayExerciseDraft {
  exerciseId: number;
  startingSets: number;
}

export interface DayDraft {
  name: string;
  exercises: DayExerciseDraft[];
}

export interface MesocycleDraft {
  name: string;
  numWeeks: number;
  startingRir: number;
  /** ISO date, YYYY-MM-DD. */
  startDate: string;
  days: DayDraft[];
}

export const MESOCYCLE_LIMITS = {
  numWeeks: { min: 2, max: 8 },
  startingRir: { min: 0, max: 4 },
  daysPerWeek: { min: 1, max: 7 },
  startingSets: { min: 1, max: 10 },
} as const;

/** Returns a list of human-readable problems; empty means the draft is valid. */
export function validateMesocycleDraft(draft: MesocycleDraft): string[] {
  const problems: string[] = [];
  const L = MESOCYCLE_LIMITS;

  if (!draft.name.trim()) problems.push("Give the block a name.");
  if (!Number.isInteger(draft.numWeeks) || draft.numWeeks < L.numWeeks.min || draft.numWeeks > L.numWeeks.max)
    problems.push(`Weeks must be between ${L.numWeeks.min} and ${L.numWeeks.max} (including the deload).`);
  if (!Number.isInteger(draft.startingRir) || draft.startingRir < L.startingRir.min || draft.startingRir > L.startingRir.max)
    problems.push(`Starting RIR must be between ${L.startingRir.min} and ${L.startingRir.max}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)) problems.push("Pick a start date.");
  if (draft.days.length < L.daysPerWeek.min || draft.days.length > L.daysPerWeek.max)
    problems.push(`A week needs between ${L.daysPerWeek.min} and ${L.daysPerWeek.max} training days.`);

  draft.days.forEach((day, i) => {
    const label = day.name.trim() || `Day ${i + 1}`;
    if (day.exercises.length === 0) problems.push(`${label} has no exercises.`);
    const seen = new Set<number>();
    for (const ex of day.exercises) {
      if (seen.has(ex.exerciseId)) problems.push(`${label} lists the same exercise twice.`);
      seen.add(ex.exerciseId);
      if (!Number.isInteger(ex.startingSets) || ex.startingSets < L.startingSets.min || ex.startingSets > L.startingSets.max)
        problems.push(`${label}: starting sets must be between ${L.startingSets.min} and ${L.startingSets.max}.`);
    }
  });

  return problems;
}

/**
 * Write the block, its template days, and their exercises in one transaction.
 * Throws with the validation problems joined if the draft is invalid.
 */
export async function createMesocycle(db: TrainingDb, draft: MesocycleDraft): Promise<number> {
  const problems = validateMesocycleDraft(draft);
  if (problems.length) throw new Error(problems.join(" "));

  return db.transaction("rw", [db.mesocycles, db.mesocycleDays, db.mesocycleDayExercises, db.exercises], async () => {
    const wanted = new Set(draft.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)));
    const found = await db.exercises.where("id").anyOf([...wanted]).primaryKeys();
    if (found.length !== wanted.size) throw new Error("A chosen exercise no longer exists.");

    const mesocycleId = await db.mesocycles.add({
      name: draft.name.trim(),
      numWeeks: draft.numWeeks,
      daysPerWeek: draft.days.length,
      startingRir: draft.startingRir,
      startDate: draft.startDate,
      status: "planned",
    });

    for (const [dayIndex, day] of draft.days.entries()) {
      const mesocycleDayId = await db.mesocycleDays.add({
        mesocycleId,
        dayIndex,
        name: day.name.trim() || `Day ${dayIndex + 1}`,
      });
      await db.mesocycleDayExercises.bulkAdd(
        day.exercises.map((ex, order) => ({ mesocycleDayId, exerciseId: ex.exerciseId, order, startingSets: ex.startingSets }))
      );
    }
    return mesocycleId;
  });
}

/** Newest first. */
export function listMesocycles(db: TrainingDb): Promise<Mesocycle[]> {
  return db.mesocycles.orderBy("startDate").reverse().toArray();
}

/** Fresh draft with sensible defaults for the builder to start from. */
export function emptyMesocycleDraft(today = new Date()): MesocycleDraft {
  return {
    name: "",
    numWeeks: 5,
    startingRir: 3,
    startDate: today.toISOString().slice(0, 10),
    days: [{ name: "Day 1", exercises: [] }],
  };
}

/** How much logged data hangs off a block — shown before deleting it. */
export async function mesocycleFootprint(db: TrainingDb, mesocycleId: number): Promise<{ sessions: number; sets: number }> {
  const sessionIds = await db.sessions.where("mesocycleId").equals(mesocycleId).primaryKeys();
  const slotIds = await db.sessionExercises.where("sessionId").anyOf(sessionIds).primaryKeys();
  const sets = await db.sets.where("sessionExerciseId").anyOf(slotIds).count();
  return { sessions: sessionIds.length, sets };
}

/**
 * Delete a block and everything under it: template days and their exercises,
 * sessions, session exercises, sets, and feedback. Exercises themselves are
 * untouched. One transaction, so it's all or nothing.
 */
export async function deleteMesocycle(db: TrainingDb, mesocycleId: number): Promise<void> {
  await db.transaction(
    "rw",
    [db.mesocycles, db.mesocycleDays, db.mesocycleDayExercises, db.sessions, db.sessionExercises, db.sets, db.muscleFeedback],
    async () => {
      const dayIds = await db.mesocycleDays.where("mesocycleId").equals(mesocycleId).primaryKeys();
      const sessionIds = await db.sessions.where("mesocycleId").equals(mesocycleId).primaryKeys();
      const slotIds = await db.sessionExercises.where("sessionId").anyOf(sessionIds).primaryKeys();

      await db.sets.where("sessionExerciseId").anyOf(slotIds).delete();
      await db.muscleFeedback.where("sessionId").anyOf(sessionIds).delete();
      await db.sessionExercises.bulkDelete(slotIds);
      await db.sessions.bulkDelete(sessionIds);
      await db.mesocycleDayExercises.where("mesocycleDayId").anyOf(dayIds).delete();
      await db.mesocycleDays.bulkDelete(dayIds);
      await db.mesocycles.delete(mesocycleId);
    }
  );
}
