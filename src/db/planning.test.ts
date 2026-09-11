import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrainingDb } from "./index";
import { createMesocycle } from "./mesocycles";
import { savePostSessionFeedback, savePreSessionFeedback } from "./feedback";
import { planWeek } from "./planning";
import { completeSession, logSet, startSession, swapExercise } from "./sessions";

let db: TrainingDb;
let mesocycleId: number;
let dayIds: number[];
let templateIds: { benchA: number; flyA: number; curlA: number; benchB: number };

const exId = async (name: string) => (await db.exercises.where("name").equals(name).first())!.id;

beforeEach(async () => {
  db = new TrainingDb(`test-${Math.random().toString(36).slice(2)}`);
  const bench = await exId("Barbell bench press");
  const fly = await exId("Cable fly");
  const curl = await exId("Barbell curl");
  mesocycleId = await createMesocycle(db, {
    name: "Block",
    numWeeks: 4,
    startingRir: 3,
    startDate: "2026-09-14",
    days: [
      { name: "A", exercises: [{ exerciseId: bench, startingSets: 3 }, { exerciseId: fly, startingSets: 2 }, { exerciseId: curl, startingSets: 3 }] },
      { name: "B", exercises: [{ exerciseId: bench, startingSets: 3 }] },
    ],
  });
  dayIds = (await db.mesocycleDays.where("mesocycleId").equals(mesocycleId).sortBy("dayIndex")).map((d) => d.id);
  const a = await db.mesocycleDayExercises.where("mesocycleDayId").equals(dayIds[0]).sortBy("order");
  const b = await db.mesocycleDayExercises.where("mesocycleDayId").equals(dayIds[1]).sortBy("order");
  templateIds = { benchA: a[0].id, flyA: a[1].id, curlA: a[2].id, benchB: b[0].id };
});
afterEach(async () => {
  await db.delete();
});

/** Run a full week 1: log exactly the target sets everywhere, answer feedback as given. */
async function completeWeek1(fb: { chest: Parameters<typeof savePostSessionFeedback>[2]["chest"] & { soreness: 0 | 1 | 2 | 3 }; biceps?: Parameters<typeof savePostSessionFeedback>[2]["biceps"] & { soreness: 0 | 1 | 2 | 3 } }) {
  for (const dayId of dayIds) {
    const sid = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayId });
    const slots = await db.sessionExercises.where("sessionId").equals(sid).toArray();
    for (const slot of slots) for (let i = 0; i < slot.targetSets; i++) await logSet(db, slot.id, { weight: 50, reps: 10, actualRir: 3 });
    const pre: Record<string, 0 | 1 | 2 | 3> = { chest: fb.chest.soreness };
    const post: Record<string, { pump: 0 | 1 | 2; jointPain: 0 | 1 | 2; workload: 0 | 1 | 2 | 3 }> = { chest: { pump: fb.chest.pump, jointPain: fb.chest.jointPain, workload: fb.chest.workload } };
    if (dayId === dayIds[0] && fb.biceps) {
      pre.biceps = fb.biceps.soreness;
      post.biceps = { pump: fb.biceps.pump, jointPain: fb.biceps.jointPain, workload: fb.biceps.workload };
    }
    await savePreSessionFeedback(db, sid, pre);
    await savePostSessionFeedback(db, sid, post);
    await completeSession(db, sid);
  }
}

describe("planWeek", () => {
  it("week 1 is the template", async () => {
    const plan = await planWeek(db, mesocycleId, 1);
    expect(plan.targetRir).toBe(3);
    expect(plan.deload).toBe(false);
    expect(plan.slots.get(templateIds.benchA)).toEqual({ targetSets: 3 });
    expect(plan.muscles).toEqual({});
  });

  it("easy week adds two chest sets, spread over the first slots in week order", async () => {
    await completeWeek1({ chest: { soreness: 0, pump: 0, jointPain: 0, workload: 0 }, biceps: { soreness: 0, pump: 2, jointPain: 0, workload: 2 } });
    const plan = await planWeek(db, mesocycleId, 2);

    expect(plan.targetRir).toBe(2);
    expect(plan.muscles.chest).toMatchObject({ currentSets: 8, sets: 10, delta: 2, hadFeedback: true });
    expect(plan.slots.get(templateIds.benchA)!.targetSets).toBe(4);
    expect(plan.slots.get(templateIds.flyA)!.targetSets).toBe(3);
    expect(plan.slots.get(templateIds.benchB)!.targetSets).toBe(3);
    expect(plan.slots.get(templateIds.benchA)!.rationale).toMatch(/adding two sets/);

    // biceps: pump 2 + workload 2 = score 4 -> hold
    expect(plan.muscles.biceps).toMatchObject({ currentSets: 3, sets: 3, delta: 0 });
    expect(plan.slots.get(templateIds.curlA)!.targetSets).toBe(3);
  });

  it("joint pain pulls chest back, one set off each slot from the end", async () => {
    await completeWeek1({ chest: { soreness: 0, pump: 2, jointPain: 2, workload: 1 } });
    const plan = await planWeek(db, mesocycleId, 2);
    expect(plan.muscles.chest).toMatchObject({ sets: 6, delta: -2 });
    expect(plan.slots.get(templateIds.benchA)!.targetSets).toBe(3);
    expect(plan.slots.get(templateIds.flyA)!.targetSets).toBe(1);
    expect(plan.slots.get(templateIds.benchB)!.targetSets).toBe(2);
  });

  it("a muscle with no feedback holds its volume with a rationale saying so", async () => {
    await completeWeek1({ chest: { soreness: 0, pump: 0, jointPain: 0, workload: 0 } }); // no biceps feedback
    const plan = await planWeek(db, mesocycleId, 2);
    expect(plan.muscles.biceps).toMatchObject({ sets: 3, delta: 0, hadFeedback: false });
    expect(plan.slots.get(templateIds.curlA)!.rationale).toMatch(/No feedback logged for biceps/);
  });

  it("uses personal landmarks from the table and caps at MRV", async () => {
    await db.volumeLandmarks.put({ muscleGroup: "chest", mev: 6, mrv: 9, updatedAt: "x" });
    await completeWeek1({ chest: { soreness: 0, pump: 0, jointPain: 0, workload: 0 } });
    const plan = await planWeek(db, mesocycleId, 2);
    expect(plan.muscles.chest).toMatchObject({ sets: 9, delta: 1, atMrv: true });
  });

  it("counts logged sets, not targets, for completed sessions", async () => {
    const sid = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    const slots = await db.sessionExercises.where("sessionId").equals(sid).sortBy("order");
    await logSet(db, slots[0].id, { weight: 50, reps: 10, actualRir: 3 }); // bench: 1 of 3
    await savePreSessionFeedback(db, sid, { chest: 0, biceps: 0 });
    await savePostSessionFeedback(db, sid, { chest: { pump: 2, jointPain: 0, workload: 2 }, biceps: { pump: 2, jointPain: 0, workload: 2 } });
    await completeSession(db, sid);
    // Day B never started -> planned target counts

    const plan = await planWeek(db, mesocycleId, 2);
    // chest: 1 (bench A logged) + 0 (fly A logged) + 3 (bench B planned) = 4, score 4 -> hold at 4
    expect(plan.muscles.chest).toMatchObject({ currentSets: 4, sets: 4 });
    expect(plan.slots.get(templateIds.benchA)!.targetSets).toBe(1);
    expect(plan.slots.get(templateIds.flyA)!.targetSets).toBe(0);
    expect(plan.slots.get(templateIds.benchB)!.targetSets).toBe(3);
  });

  it("deload halves everything regardless of feedback", async () => {
    await completeWeek1({ chest: { soreness: 0, pump: 0, jointPain: 0, workload: 0 } });
    // Skip to the deload by planning week 4 off week 3, which doesn't exist -> planned targets fall back to template
    const plan = await planWeek(db, mesocycleId, 4);
    expect(plan.deload).toBe(true);
    expect(plan.targetRir).toBe(4);
    expect(plan.muscles.chest).toMatchObject({ currentSets: 8, sets: 4 });
    expect(plan.slots.get(templateIds.curlA)!.targetSets).toBe(2);
  });

  it("startSession writes the plan's targets and rationale into the slots", async () => {
    await completeWeek1({ chest: { soreness: 0, pump: 0, jointPain: 0, workload: 0 } });
    const sid = await startSession(db, { mesocycleId, weekNum: 2, mesocycleDayId: dayIds[0] });
    const slots = await db.sessionExercises.where("sessionId").equals(sid).sortBy("order");
    expect(slots.map((s) => s.targetSets)).toEqual([4, 3, 3]);
    expect(slots[0].rationale).toMatch(/adding two sets/);
    expect(slots[2].rationale).toMatch(/No feedback/);
    expect(slots[0].targetRir).toBe(2);
  });
});

describe("planWeek after a swap", () => {
  it("a one-off swap still carries the slot's logged sets into next week's plan", async () => {
    const sid = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    const slots = await db.sessionExercises.where("sessionId").equals(sid).sortBy("order");
    // Bench: 1 set, then swap to incline for the remaining 2 (mid-session)
    await logSet(db, slots[0].id, { weight: 50, reps: 10, actualRir: 3 });
    const incline = (await db.exercises.where("name").equals("Incline dumbbell press").first())!.id;
    const { sessionExerciseId: newSlot } = await swapExercise(db, slots[0].id, incline);
    await logSet(db, newSlot, { weight: 20, reps: 10, actualRir: 3 });
    await logSet(db, newSlot, { weight: 20, reps: 10, actualRir: 3 });
    // Fly: swap before any sets (slot re-pointed), then log its 2
    const pecDeck = (await db.exercises.where("name").equals("Pec deck").first())!.id;
    await swapExercise(db, slots[1].id, pecDeck);
    for (let i = 0; i < 2; i++) await logSet(db, slots[1].id, { weight: 30, reps: 12, actualRir: 3 });
    for (let i = 0; i < 3; i++) await logSet(db, slots[2].id, { weight: 20, reps: 12, actualRir: 3 });
    await savePreSessionFeedback(db, sid, { chest: 0, biceps: 0 });
    await savePostSessionFeedback(db, sid, { chest: { pump: 2, jointPain: 0, workload: 2 }, biceps: { pump: 2, jointPain: 0, workload: 2 } });
    await completeSession(db, sid);

    const plan = await planWeek(db, mesocycleId, 2);
    // chest: benchA template slot = 1 + 2 = 3, flyA = 2, benchB (never done) = 3 -> 8, score 4 -> hold
    expect(plan.muscles.chest).toMatchObject({ currentSets: 8, sets: 8 });
    expect(plan.slots.get(templateIds.benchA)!.targetSets).toBe(3);
    expect(plan.slots.get(templateIds.flyA)!.targetSets).toBe(2);
  });
});
