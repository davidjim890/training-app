// db/sessions.ts
//
// Everything the session screen needs: starting a session for a template day
// in a given week, logging sets, and reading a session back with last week's
// numbers alongside for reference.

import type { TrainingDb } from "./index";
import { planWeek } from "./planning";
import type { Exercise, Mesocycle, MesocycleDay, Session, SessionExercise, SessionStatus, WorkSet } from "./schema";

// ---------------------------------------------------------------------------
// Starting a session
// ---------------------------------------------------------------------------

/**
 * Return the session for (mesocycle, week, day), creating it with its exercise
 * slots if it doesn't exist yet. Targets come from `planWeek`, which reads the
 * previous week's sets and feedback. Also flips a planned block to active.
 */
export async function startSession(
  db: TrainingDb,
  args: { mesocycleId: number; weekNum: number; mesocycleDayId: number }
): Promise<number> {
  const { mesocycleId, weekNum, mesocycleDayId } = args;
  return db.transaction(
    "rw",
    [db.mesocycles, db.mesocycleDays, db.mesocycleDayExercises, db.exercises, db.sessions, db.sessionExercises, db.sets, db.muscleFeedback, db.volumeLandmarks],
    async () => {
      const existing = await db.sessions
        .where("[mesocycleId+weekNum+mesocycleDayId]")
        .equals([mesocycleId, weekNum, mesocycleDayId])
        .first();
      if (existing) return existing.id;

      const meso = await db.mesocycles.get(mesocycleId);
      if (!meso) throw new Error("Block not found");
      if (weekNum < 1 || weekNum > meso.numWeeks) throw new Error(`Week ${weekNum} is outside this block`);

      const template = await db.mesocycleDayExercises.where("mesocycleDayId").equals(mesocycleDayId).sortBy("order");
      if (template.length === 0) throw new Error("This day has no exercises");

      const plan = await planWeek(db, mesocycleId, weekNum);

      const sessionId = await db.sessions.add({
        mesocycleId,
        mesocycleDayId,
        weekNum,
        startedAt: new Date().toISOString(),
        completedAt: null,
        status: "in_progress",
      });
      await db.sessionExercises.bulkAdd(
        template.map((t) => {
          const slot = plan.slots.get(t.id);
          return {
            sessionId,
            exerciseId: t.exerciseId,
            order: t.order,
            targetSets: slot?.targetSets ?? t.startingSets,
            targetRir: plan.targetRir,
            ...(slot?.rationale ? { rationale: slot.rationale } : {}),
          };
        })
      );

      if (meso.status === "planned") await db.mesocycles.update(mesocycleId, { status: "active" });
      return sessionId;
    }
  );
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export async function logSet(
  db: TrainingDb,
  sessionExerciseId: number,
  set: { weight: number; reps: number; actualRir: number }
): Promise<number> {
  if (!(set.weight >= 0) || !(set.reps > 0) || !(set.actualRir >= 0)) throw new Error("Invalid set");
  return db.transaction("rw", db.sets, async () => {
    const count = await db.sets.where("sessionExerciseId").equals(sessionExerciseId).count();
    return db.sets.add({ sessionExerciseId, setIndex: count, ...set, completedAt: new Date().toISOString() });
  });
}

/** Delete a set and close the gap in setIndex so ordering stays dense. */
export async function deleteSet(db: TrainingDb, setId: number): Promise<void> {
  await db.transaction("rw", db.sets, async () => {
    const victim = await db.sets.get(setId);
    if (!victim) return;
    await db.sets.delete(setId);
    const rest = await db.sets.where("sessionExerciseId").equals(victim.sessionExerciseId).sortBy("setIndex");
    await Promise.all(rest.map((s, i) => (s.setIndex === i ? null : db.sets.update(s.id, { setIndex: i }))));
  });
}

export async function completeSession(db: TrainingDb, sessionId: number): Promise<void> {
  await db.sessions.update(sessionId, { status: "completed", completedAt: new Date().toISOString() });
}

export async function skipSession(db: TrainingDb, sessionId: number): Promise<void> {
  await db.sessions.update(sessionId, { status: "skipped", completedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface SessionExerciseView {
  slot: SessionExercise;
  exercise: Exercise;
  sets: WorkSet[];
  /** Same exercise, same template day, previous week. Empty in week 1. */
  lastWeekSets: WorkSet[];
}

export interface SessionView {
  session: Session;
  day: MesocycleDay;
  mesocycle: Mesocycle;
  exercises: SessionExerciseView[];
}

export async function getSessionView(db: TrainingDb, sessionId: number): Promise<SessionView | undefined> {
  const session = await db.sessions.get(sessionId);
  if (!session) return undefined;
  const [day, mesocycle] = await Promise.all([db.mesocycleDays.get(session.mesocycleDayId), db.mesocycles.get(session.mesocycleId)]);
  if (!day || !mesocycle) return undefined;

  const slots = await db.sessionExercises.where("sessionId").equals(sessionId).sortBy("order");

  const previous = await db.sessions
    .where("[mesocycleId+weekNum+mesocycleDayId]")
    .equals([session.mesocycleId, session.weekNum - 1, session.mesocycleDayId])
    .first();
  const previousSlots = previous ? await db.sessionExercises.where("sessionId").equals(previous.id).toArray() : [];
  const previousSlotByExercise = new Map(previousSlots.map((s) => [s.exerciseId, s.id]));

  const exercises = await Promise.all(
    slots.map(async (slot) => {
      const exercise = await db.exercises.get(slot.exerciseId);
      if (!exercise) throw new Error(`Exercise ${slot.exerciseId} missing`);
      const sets = await db.sets.where("sessionExerciseId").equals(slot.id).sortBy("setIndex");
      const prevId = previousSlotByExercise.get(slot.exerciseId);
      const lastWeekSets = prevId === undefined ? [] : await db.sets.where("sessionExerciseId").equals(prevId).sortBy("setIndex");
      return { slot, exercise, sets, lastWeekSets };
    })
  );

  return { session, day, mesocycle, exercises };
}

/** Status of every template day in a given week; days with no session are absent. */
export async function sessionStatusesForWeek(
  db: TrainingDb,
  mesocycleId: number,
  weekNum: number
): Promise<Map<number, { sessionId: number; status: SessionStatus }>> {
  const rows = await db.sessions.where("[mesocycleId+weekNum]").equals([mesocycleId, weekNum]).toArray();
  return new Map(rows.map((s) => [s.mesocycleDayId, { sessionId: s.id, status: s.status }]));
}

/**
 * The week you're "on": the first week with a day that isn't completed or
 * skipped. Falls back to the final week once everything is done.
 */
export async function currentWeek(db: TrainingDb, mesocycle: Mesocycle): Promise<number> {
  const days = await db.mesocycleDays.where("mesocycleId").equals(mesocycle.id).count();
  for (let w = 1; w <= mesocycle.numWeeks; w++) {
    const finished = await db.sessions
      .where("[mesocycleId+weekNum]")
      .equals([mesocycle.id, w])
      .filter((s) => s.status === "completed" || s.status === "skipped")
      .count();
    if (finished < days) return w;
  }
  return mesocycle.numWeeks;
}

/** Heaviest set, ties broken by most reps — what `suggestLoad` should reason from. */
export function topSet(sets: WorkSet[]): WorkSet | undefined {
  return sets.reduce<WorkSet | undefined>(
    (best, s) => (!best || s.weight > best.weight || (s.weight === best.weight && s.reps > best.reps) ? s : best),
    undefined
  );
}

// ---------------------------------------------------------------------------
// "Train" shortcut
// ---------------------------------------------------------------------------

export type TrainTarget =
  | { kind: "session"; sessionId: number; mesocycleId: number }
  | { kind: "block"; mesocycleId: number }
  | { kind: "none" };

/**
 * Where the Train tab should land: an in-progress session if there is one,
 * else the block you're working through (active first, then the most
 * recently planned), else nowhere.
 */
export async function resolveTrainTarget(db: TrainingDb): Promise<TrainTarget> {
  const inProgress = await db.sessions.filter((s) => s.status === "in_progress").sortBy("startedAt");
  const latest = inProgress.at(-1);
  if (latest) return { kind: "session", sessionId: latest.id, mesocycleId: latest.mesocycleId };

  const active = await db.mesocycles.where("status").equals("active").first();
  if (active) return { kind: "block", mesocycleId: active.id };

  const planned = await db.mesocycles.where("status").equals("planned").reverse().sortBy("startDate");
  if (planned[0]) return { kind: "block", mesocycleId: planned[0].id };

  return { kind: "none" };
}
