// db/feedback.ts
//
// Per-session, per-muscle feedback. Soreness is asked before the session,
// pump / joint pain / workload after. One row per (session, muscle), filled
// in two steps.

import type { MuscleFeedback, MuscleGroup } from "../lib/progression";
import type { TrainingDb } from "./index";
import type { MuscleFeedbackRecord } from "./schema";

export type Soreness = MuscleFeedback["soreness"];
export type PostSessionAnswers = Pick<MuscleFeedback, "pump" | "jointPain" | "workload">;

/** Primary muscle groups trained in a session, in exercise order, deduplicated. */
export async function musclesInSession(db: TrainingDb, sessionId: number): Promise<MuscleGroup[]> {
  const slots = await db.sessionExercises.where("sessionId").equals(sessionId).sortBy("order");
  const out: MuscleGroup[] = [];
  for (const slot of slots) {
    const ex = await db.exercises.get(slot.exerciseId);
    if (ex && !out.includes(ex.muscleGroup)) out.push(ex.muscleGroup);
  }
  return out;
}

export function getSessionFeedback(db: TrainingDb, sessionId: number): Promise<MuscleFeedbackRecord[]> {
  return db.muscleFeedback.where("sessionId").equals(sessionId).toArray();
}

/**
 * Which prompt is due. "pre" until every trained muscle has a soreness row,
 * "post" until every row has the after-session answers, then "done".
 */
export function feedbackStage(muscles: MuscleGroup[], rows: MuscleFeedbackRecord[]): "pre" | "post" | "done" {
  const byMuscle = new Map(rows.map((r) => [r.muscleGroup, r]));
  if (muscles.some((m) => !byMuscle.has(m))) return "pre";
  if (muscles.some((m) => {
    const r = byMuscle.get(m)!;
    return r.pump === undefined || r.jointPain === undefined || r.workload === undefined;
  })) return "post";
  return "done";
}

export async function savePreSessionFeedback(
  db: TrainingDb,
  sessionId: number,
  soreness: Partial<Record<MuscleGroup, Soreness>>
): Promise<void> {
  await db.transaction("rw", [db.sessions, db.muscleFeedback], async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    for (const [muscle, value] of Object.entries(soreness) as [MuscleGroup, Soreness][]) {
      const existing = await db.muscleFeedback.where("[sessionId+muscleGroup]").equals([sessionId, muscle]).first();
      if (existing) await db.muscleFeedback.update(existing.id, { soreness: value });
      else await db.muscleFeedback.add({ sessionId, mesocycleId: session.mesocycleId, muscleGroup: muscle, soreness: value });
    }
  });
}

export async function savePostSessionFeedback(
  db: TrainingDb,
  sessionId: number,
  answers: Partial<Record<MuscleGroup, PostSessionAnswers>>
): Promise<void> {
  await db.transaction("rw", [db.sessions, db.muscleFeedback], async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    for (const [muscle, value] of Object.entries(answers) as [MuscleGroup, PostSessionAnswers][]) {
      const existing = await db.muscleFeedback.where("[sessionId+muscleGroup]").equals([sessionId, muscle]).first();
      if (existing) await db.muscleFeedback.update(existing.id, value);
      // No soreness row yet (pre-session prompt was skipped): store with
      // soreness 0 so the week still gets a reading rather than nothing.
      else await db.muscleFeedback.add({ sessionId, mesocycleId: session.mesocycleId, muscleGroup: muscle, soreness: 0, ...value });
    }
  });
}

/** Remember that the pre-session prompt was skipped for this session. */
export async function dismissPreFeedback(db: TrainingDb, sessionId: number): Promise<void> {
  await db.sessions.update(sessionId, { preFeedbackDismissed: true });
}
