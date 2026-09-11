import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrainingDb } from "./index";
import { createMesocycle } from "./mesocycles";
import {
  completeSession,
  currentBlockSummary,
  currentWeek,
  deleteSet,
  getSessionView,
  logSet,
  resolveTrainTarget,
  sessionStatusesForWeek,
  startSession,
  swapExercise,
  topSet,
} from "./sessions";

let db: TrainingDb;
let mesocycleId: number;
let dayIds: number[];
let benchId: number;

beforeEach(async () => {
  db = new TrainingDb(`test-${Math.random().toString(36).slice(2)}`);
  benchId = (await db.exercises.where("name").equals("Barbell bench press").first())!.id;
  const squatId = (await db.exercises.where("name").equals("Back squat").first())!.id;
  mesocycleId = await createMesocycle(db, {
    name: "Block",
    numWeeks: 3, // 2 accumulation + deload, keeps tests short
    startingRir: 2,
    startDate: "2026-09-14",
    days: [
      { name: "Push", exercises: [{ exerciseId: benchId, startingSets: 3 }] },
      { name: "Legs", exercises: [{ exerciseId: squatId, startingSets: 4 }] },
    ],
  });
  dayIds = (await db.mesocycleDays.where("mesocycleId").equals(mesocycleId).sortBy("dayIndex")).map((d) => d.id);
});
afterEach(async () => {
  await db.delete();
});

describe("startSession", () => {
  it("creates the session with slots from the template and the week's RIR", async () => {
    const id = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    const view = (await getSessionView(db, id))!;
    expect(view.session).toMatchObject({ weekNum: 1, status: "in_progress" });
    expect(view.exercises).toHaveLength(1);
    expect(view.exercises[0].slot).toMatchObject({ targetSets: 3, targetRir: 2 });
    expect(view.exercises[0].exercise.name).toBe("Barbell bench press");
  });

  it("is idempotent for the same week and day", async () => {
    const a = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    const b = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    expect(a).toBe(b);
    expect(await db.sessions.count()).toBe(1);
  });

  it("flips a planned block to active", async () => {
    expect((await db.mesocycles.get(mesocycleId))!.status).toBe("planned");
    await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    expect((await db.mesocycles.get(mesocycleId))!.status).toBe("active");
  });

  it("without feedback, carries last week's target forward and halves for the deload", async () => {
    const w1 = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[1] });
    const w1slot = (await db.sessionExercises.where("sessionId").equals(w1).first())!;
    await db.sessionExercises.update(w1slot.id, { targetSets: 6 }); // pretend the engine bumped it

    const w2 = await startSession(db, { mesocycleId, weekNum: 2, mesocycleDayId: dayIds[1] });
    expect((await db.sessionExercises.where("sessionId").equals(w2).first())!.targetSets).toBe(6);

    const w3 = await startSession(db, { mesocycleId, weekNum: 3, mesocycleDayId: dayIds[1] });
    const deload = (await db.sessionExercises.where("sessionId").equals(w3).first())!;
    expect(deload.targetSets).toBe(3);
    expect(deload.targetRir).toBe(3); // startingRir + 1
  });

  it("rejects weeks outside the block", async () => {
    await expect(startSession(db, { mesocycleId, weekNum: 4, mesocycleDayId: dayIds[0] })).rejects.toThrow(/outside/);
  });
});

describe("logging", () => {
  it("appends sets with dense indices and deletes close the gap", async () => {
    const sid = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    const slot = (await db.sessionExercises.where("sessionId").equals(sid).first())!;
    const s0 = await logSet(db, slot.id, { weight: 80, reps: 10, actualRir: 2 });
    await logSet(db, slot.id, { weight: 80, reps: 9, actualRir: 1 });
    await logSet(db, slot.id, { weight: 80, reps: 8, actualRir: 0 });

    let view = (await getSessionView(db, sid))!;
    expect(view.exercises[0].sets.map((s) => s.setIndex)).toEqual([0, 1, 2]);

    await deleteSet(db, s0);
    view = (await getSessionView(db, sid))!;
    expect(view.exercises[0].sets.map((s) => [s.setIndex, s.reps])).toEqual([[0, 9], [1, 8]]);
  });

  it("rejects nonsense", async () => {
    const sid = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    const slot = (await db.sessionExercises.where("sessionId").equals(sid).first())!;
    await expect(logSet(db, slot.id, { weight: 80, reps: 0, actualRir: 2 })).rejects.toThrow(/Invalid/);
    await expect(logSet(db, slot.id, { weight: -5, reps: 5, actualRir: 2 })).rejects.toThrow(/Invalid/);
  });
});

describe("getSessionView", () => {
  it("includes last week's sets for the same exercise", async () => {
    const w1 = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    const slot = (await db.sessionExercises.where("sessionId").equals(w1).first())!;
    await logSet(db, slot.id, { weight: 80, reps: 10, actualRir: 2 });
    await completeSession(db, w1);

    const w2 = await startSession(db, { mesocycleId, weekNum: 2, mesocycleDayId: dayIds[0] });
    const view = (await getSessionView(db, w2))!;
    expect(view.exercises[0].sets).toEqual([]);
    expect(view.exercises[0].lastWeekSets.map((s) => s.weight)).toEqual([80]);
  });

  it("returns undefined for a missing session", async () => {
    expect(await getSessionView(db, 999)).toBeUndefined();
  });
});

describe("week tracking", () => {
  it("statuses per week and currentWeek advance as days complete", async () => {
    const meso = (await db.mesocycles.get(mesocycleId))!;
    expect(await currentWeek(db, meso)).toBe(1);

    const a = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    let statuses = await sessionStatusesForWeek(db, mesocycleId, 1);
    expect(statuses.get(dayIds[0])?.status).toBe("in_progress");
    expect(statuses.has(dayIds[1])).toBe(false);
    expect(await currentWeek(db, meso)).toBe(1);

    await completeSession(db, a);
    const b = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[1] });
    await completeSession(db, b);
    expect(await currentWeek(db, meso)).toBe(2);

    statuses = await sessionStatusesForWeek(db, mesocycleId, 1);
    expect([...statuses.values()].every((s) => s.status === "completed")).toBe(true);
  });

  it("currentWeek settles on the last week when the block is done", async () => {
    const meso = (await db.mesocycles.get(mesocycleId))!;
    for (let w = 1; w <= 3; w++) {
      for (const d of dayIds) await completeSession(db, await startSession(db, { mesocycleId, weekNum: w, mesocycleDayId: d }));
    }
    expect(await currentWeek(db, meso)).toBe(3);
  });
});

describe("topSet", () => {
  it("picks heaviest, then most reps", () => {
    const mk = (weight: number, reps: number) => ({ id: 0, sessionExerciseId: 0, setIndex: 0, weight, reps, actualRir: 2, completedAt: "" });
    expect(topSet([mk(80, 10), mk(85, 6), mk(85, 8)])).toMatchObject({ weight: 85, reps: 8 });
    expect(topSet([])).toBeUndefined();
  });
});

describe("resolveTrainTarget", () => {
  it("prefers an in-progress session, then the active block, then a planned one", async () => {
    // Fresh block is "planned"
    expect(await resolveTrainTarget(db)).toEqual({ kind: "block", mesocycleId });

    const sid = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    expect(await resolveTrainTarget(db)).toEqual({ kind: "session", sessionId: sid, mesocycleId });

    await completeSession(db, sid);
    expect(await resolveTrainTarget(db)).toEqual({ kind: "block", mesocycleId }); // now active
  });

  it("is none with no blocks at all", async () => {
    await db.mesocycles.clear();
    expect(await resolveTrainTarget(db)).toEqual({ kind: "none" });
  });
});

describe("currentBlockSummary", () => {
  it("tracks week, progress, next day, and the open session", async () => {
    let s = (await currentBlockSummary(db))!;
    expect(s).toMatchObject({ weekNum: 1, deload: false, targetRir: 2, daysDone: 0, daysTotal: 2, inProgress: null });
    expect(s.nextDay).toMatchObject({ name: "Push", status: "not_started" });

    const sid = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    s = (await currentBlockSummary(db))!;
    expect(s.inProgress).toEqual({ sessionId: sid, dayName: "Push" });
    expect(s.nextDay).toMatchObject({ name: "Push", status: "in_progress", sessionId: sid });

    await completeSession(db, sid);
    s = (await currentBlockSummary(db))!;
    expect(s).toMatchObject({ daysDone: 1, inProgress: null });
    expect(s.nextDay).toMatchObject({ name: "Legs", status: "not_started" });

    await completeSession(db, await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[1] }));
    s = (await currentBlockSummary(db))!;
    expect(s).toMatchObject({ weekNum: 2, daysDone: 0, targetRir: 0 }); // 2 accumulation weeks from 2 RIR: 2, 0
  });

  it("flags the deload week", async () => {
    for (let w = 1; w <= 2; w++) for (const d of dayIds) await completeSession(db, await startSession(db, { mesocycleId, weekNum: w, mesocycleDayId: d }));
    expect(await currentBlockSummary(db)).toMatchObject({ weekNum: 3, deload: true, targetRir: 3 });
  });

  it("is null with no blocks", async () => {
    await db.mesocycles.clear();
    expect(await currentBlockSummary(db)).toBeNull();
  });
});

describe("swapExercise", () => {
  const exId = async (name: string) => (await db.exercises.where("name").equals(name).first())!.id;

  it("with no sets logged, the slot just points at the new exercise", async () => {
    const sid = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    const slot = (await db.sessionExercises.where("sessionId").equals(sid).first())!;
    const incline = await exId("Incline dumbbell press");
    const r = await swapExercise(db, slot.id, incline);
    expect(r.sessionExerciseId).toBe(slot.id);
    const after = (await db.sessionExercises.get(slot.id))!;
    expect(after).toMatchObject({ exerciseId: incline, targetSets: 3, templateSlotId: slot.templateSlotId });
    expect(await db.sessionExercises.where("sessionId").equals(sid).count()).toBe(1);
    // Template untouched
    const tpl = (await db.mesocycleDayExercises.get(slot.templateSlotId!))!;
    expect(tpl.exerciseId).toBe(benchId);
  });

  it("with sets logged, keeps them and inserts the replacement after with the remaining target", async () => {
    const sid = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    const slot = (await db.sessionExercises.where("sessionId").equals(sid).first())!;
    await logSet(db, slot.id, { weight: 80, reps: 10, actualRir: 2 });
    const incline = await exId("Incline dumbbell press");
    const r = await swapExercise(db, slot.id, incline);
    expect(r.sessionExerciseId).not.toBe(slot.id);

    const slots = await db.sessionExercises.where("sessionId").equals(sid).sortBy("order");
    expect(slots.map((s) => [s.exerciseId, s.order, s.targetSets])).toEqual([[benchId, 0, 1], [incline, 1, 2]]);
    expect(slots[1].rationale).toMatch(/Swapped in for Barbell bench press/);
    expect(slots[1].templateSlotId).toBe(slot.templateSlotId);
    expect(await db.sets.where("sessionExerciseId").equals(slot.id).count()).toBe(1);
  });

  it("applyToBlock updates the template so next week uses the replacement", async () => {
    const sid = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    const slot = (await db.sessionExercises.where("sessionId").equals(sid).first())!;
    const incline = await exId("Incline dumbbell press");
    await swapExercise(db, slot.id, incline, { applyToBlock: true });
    expect((await db.mesocycleDayExercises.get(slot.templateSlotId!))!.exerciseId).toBe(incline);
    await completeSession(db, sid);
    const w2 = await startSession(db, { mesocycleId, weekNum: 2, mesocycleDayId: dayIds[0] });
    expect((await db.sessionExercises.where("sessionId").equals(w2).first())!.exerciseId).toBe(incline);
  });

  it("refuses an exercise already in the session and is a no-op for the same one", async () => {
    const sid = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayIds[0] });
    const slot = (await db.sessionExercises.where("sessionId").equals(sid).first())!;
    await expect(swapExercise(db, slot.id, benchId)).resolves.toEqual({ sessionExerciseId: slot.id });
    const incline = await exId("Incline dumbbell press");
    await db.sessionExercises.add({ sessionId: sid, exerciseId: incline, order: 1, targetSets: 2, targetRir: 2 });
    await expect(swapExercise(db, slot.id, incline)).rejects.toThrow(/already in this session/);
  });
});
