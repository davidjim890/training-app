// db/planning.ts
//
// The bridge from logged data to the engine. `planWeek` gathers the previous
// week's per-slot set counts and per-muscle feedback, asks the engine what
// each muscle should do, and spreads the answer back across exercise slots.
//
// Called when a session is created, so week N's plan reflects whatever of
// week N-1 was logged at that moment. Finish the week before starting the
// next one and it's exact; start early and it plans from a partial week.

import {
  DEFAULT_LANDMARKS,
  aggregateWeekFeedback,
  deloadSets,
  distributeSets,
  isDeloadWeek,
  planNextWeek,
  targetRirForWeek,
  type MuscleFeedback,
  type MuscleGroup,
  type VolumeLandmarks,
} from "../lib/progression";
import type { TrainingDb } from "./index";
import type { MesocycleDayExercise } from "./schema";

export interface SlotPlan {
  targetSets: number;
  rationale?: string;
}

export interface MusclePlan {
  currentSets: number;
  sets: number;
  delta: number;
  rationale: string;
  atMrv: boolean;
  hadFeedback: boolean;
}

export interface WeekPlan {
  weekNum: number;
  targetRir: number;
  deload: boolean;
  /** Keyed by mesocycleDayExercises.id. */
  slots: Map<number, SlotPlan>;
  muscles: Partial<Record<MuscleGroup, MusclePlan>>;
}

export async function planWeek(db: TrainingDb, mesocycleId: number, weekNum: number): Promise<WeekPlan> {
  const meso = await db.mesocycles.get(mesocycleId);
  if (!meso) throw new Error("Block not found");
  if (weekNum < 1 || weekNum > meso.numWeeks) throw new Error(`Week ${weekNum} is outside this block`);

  const targetRir = targetRirForWeek(weekNum, meso.numWeeks, meso.startingRir);
  const deload = isDeloadWeek(weekNum, meso.numWeeks);

  // Template, in week order: day 0's exercises first, then day 1's, ...
  const days = await db.mesocycleDays.where("mesocycleId").equals(mesocycleId).sortBy("dayIndex");
  const template: MesocycleDayExercise[] = [];
  for (const d of days) template.push(...(await db.mesocycleDayExercises.where("mesocycleDayId").equals(d.id).sortBy("order")));

  const exerciseIds = [...new Set(template.map((t) => t.exerciseId))];
  const muscleOf = new Map<number, MuscleGroup>();
  for (const ex of await db.exercises.where("id").anyOf(exerciseIds).toArray()) muscleOf.set(ex.id, ex.muscleGroup);

  const slots = new Map<number, SlotPlan>();
  const muscles: WeekPlan["muscles"] = {};

  if (weekNum === 1) {
    for (const t of template) slots.set(t.id, { targetSets: t.startingSets });
    return { weekNum, targetRir, deload, slots, muscles };
  }

  // --- What happened last week, per template slot ---
  const prevWeek = weekNum - 1;
  const prevSessions = await db.sessions.where("[mesocycleId+weekNum]").equals([mesocycleId, prevWeek]).toArray();
  const prevSessionByDay = new Map(prevSessions.map((s) => [s.mesocycleDayId, s]));
  const prevSlots = await db.sessionExercises.where("sessionId").anyOf(prevSessions.map((s) => s.id)).toArray();
  const prevSlotByKey = new Map(prevSlots.map((s) => [`${s.sessionId}:${s.exerciseId}`, s]));
  // A swapped slot keeps its templateSlotId; several session slots may share
  // one (mid-session swap), so their logged sets are summed.
  const prevSlotsByTemplate = new Map<number, typeof prevSlots>();
  for (const s of prevSlots) if (s.templateSlotId !== undefined) prevSlotsByTemplate.set(s.templateSlotId, [...(prevSlotsByTemplate.get(s.templateSlotId) ?? []), s]);
  const loggedBySlot = new Map<number, number>();
  for (const set of await db.sets.where("sessionExerciseId").anyOf(prevSlots.map((s) => s.id)).toArray()) {
    loggedBySlot.set(set.sessionExerciseId, (loggedBySlot.get(set.sessionExerciseId) ?? 0) + 1);
  }

  const base = (t: MesocycleDayExercise): number => {
    const session = prevSessionByDay.get(t.mesocycleDayId);
    if (!session) return t.startingSets;
    const byTemplate = (prevSlotsByTemplate.get(t.id) ?? []).filter((s) => s.sessionId === session.id);
    const slots = byTemplate.length ? byTemplate : [prevSlotByKey.get(`${session.id}:${t.exerciseId}`)].filter((s): s is NonNullable<typeof s> => !!s);
    if (slots.length === 0) return t.startingSets;
    if (session.status === "completed") return slots.reduce((n, s) => n + (loggedBySlot.get(s.id) ?? 0), 0);
    return slots.reduce((n, s) => n + s.targetSets, 0); // not done (yet): count what was planned
  };
  const bases = new Map(template.map((t) => [t.id, base(t)] as const));

  // --- Last week's feedback, one reading per muscle ---
  const rows = await db.muscleFeedback.where("sessionId").anyOf(prevSessions.map((s) => s.id)).toArray();
  const rowsByMuscle = new Map<MuscleGroup, Partial<MuscleFeedback>[]>();
  for (const r of rows) rowsByMuscle.set(r.muscleGroup, [...(rowsByMuscle.get(r.muscleGroup) ?? []), r]);

  const landmarks: Record<string, VolumeLandmarks> = {};
  for (const l of await db.volumeLandmarks.toArray()) landmarks[l.muscleGroup] = { mev: l.mev, mrv: l.mrv };

  // --- Ask the engine, muscle by muscle ---
  const slotsByMuscle = new Map<MuscleGroup, MesocycleDayExercise[]>();
  for (const t of template) {
    const m = muscleOf.get(t.exerciseId);
    if (m) slotsByMuscle.set(m, [...(slotsByMuscle.get(m) ?? []), t]);
  }

  const perMuscle: Record<string, { currentSets: number; feedback: MuscleFeedback }> = {};
  const noFeedback: MuscleGroup[] = [];
  for (const [m, ts] of slotsByMuscle) {
    const currentSets = ts.reduce((n, t) => n + (bases.get(t.id) ?? 0), 0);
    const fb = aggregateWeekFeedback(rowsByMuscle.get(m) ?? []);
    if (fb) perMuscle[m] = { currentSets, feedback: fb };
    else noFeedback.push(m);
  }
  const engine = planNextWeek(prevWeek, meso.numWeeks, meso.startingRir, perMuscle, landmarks);

  for (const [m, ts] of slotsByMuscle) {
    const currentSets = ts.reduce((n, t) => n + (bases.get(t.id) ?? 0), 0);
    let plan: MusclePlan;
    if (engine[m]) {
      plan = { currentSets, ...engine[m], hadFeedback: true };
    } else if (deload) {
      const sets = deloadSets(currentSets);
      plan = { currentSets, sets, delta: sets - currentSets, rationale: "Deload week — roughly half volume at high RIR to dissipate fatigue.", atMrv: false, hadFeedback: false };
    } else {
      const mrv = (landmarks[m] ?? DEFAULT_LANDMARKS).mrv;
      const sets = Math.min(currentSets, mrv);
      plan = { currentSets, sets, delta: sets - currentSets, rationale: `No feedback logged for ${m} last week — holding volume.`, atMrv: sets >= mrv, hadFeedback: false };
    }
    muscles[m] = plan;
    const dist = distributeSets(plan.sets, ts.map((t) => bases.get(t.id) ?? 0));
    ts.forEach((t, i) => slots.set(t.id, { targetSets: dist[i], rationale: plan.rationale }));
  }

  return { weekNum, targetRir, deload, slots, muscles };
}
