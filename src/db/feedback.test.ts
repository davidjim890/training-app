import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrainingDb } from "./index";
import { createMesocycle } from "./mesocycles";
import { dismissPreFeedback, feedbackStage, getSessionFeedback, musclesInSession, savePostSessionFeedback, savePreSessionFeedback } from "./feedback";
import { startSession } from "./sessions";

let db: TrainingDb;
let sessionId: number;

beforeEach(async () => {
  db = new TrainingDb(`test-${Math.random().toString(36).slice(2)}`);
  const bench = (await db.exercises.where("name").equals("Barbell bench press").first())!.id;
  const fly = (await db.exercises.where("name").equals("Cable fly").first())!.id;
  const curl = (await db.exercises.where("name").equals("Barbell curl").first())!.id;
  const mesocycleId = await createMesocycle(db, {
    name: "Block", numWeeks: 4, startingRir: 3, startDate: "2026-09-14",
    days: [{ name: "A", exercises: [{ exerciseId: bench, startingSets: 3 }, { exerciseId: curl, startingSets: 3 }, { exerciseId: fly, startingSets: 2 }] }],
  });
  const dayId = (await db.mesocycleDays.where("mesocycleId").equals(mesocycleId).first())!.id;
  sessionId = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayId });
});
afterEach(async () => {
  await db.delete();
});

describe("musclesInSession", () => {
  it("lists primary muscles in exercise order without duplicates", async () => {
    expect(await musclesInSession(db, sessionId)).toEqual(["chest", "biceps"]);
  });
});

describe("feedback flow", () => {
  it("moves pre -> post -> done as answers arrive", async () => {
    const muscles = await musclesInSession(db, sessionId);
    expect(feedbackStage(muscles, await getSessionFeedback(db, sessionId))).toBe("pre");

    await savePreSessionFeedback(db, sessionId, { chest: 1, biceps: 0 });
    expect(feedbackStage(muscles, await getSessionFeedback(db, sessionId))).toBe("post");

    await savePostSessionFeedback(db, sessionId, { chest: { pump: 2, jointPain: 0, workload: 2 } });
    expect(feedbackStage(muscles, await getSessionFeedback(db, sessionId))).toBe("post"); // biceps missing

    await savePostSessionFeedback(db, sessionId, { biceps: { pump: 1, jointPain: 0, workload: 1 } });
    expect(feedbackStage(muscles, await getSessionFeedback(db, sessionId))).toBe("done");

    const rows = await getSessionFeedback(db, sessionId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.muscleGroup === "chest")).toMatchObject({ soreness: 1, pump: 2, jointPain: 0, workload: 2 });
  });

  it("re-saving updates rather than duplicating", async () => {
    await savePreSessionFeedback(db, sessionId, { chest: 1 });
    await savePreSessionFeedback(db, sessionId, { chest: 3 });
    const rows = await getSessionFeedback(db, sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].soreness).toBe(3);
  });

  it("post answers without a pre row create one with soreness 0", async () => {
    await savePostSessionFeedback(db, sessionId, { chest: { pump: 1, jointPain: 1, workload: 1 } });
    expect((await getSessionFeedback(db, sessionId))[0]).toMatchObject({ soreness: 0, jointPain: 1 });
  });
});

describe("dismissPreFeedback", () => {
  it("persists the skip on the session without creating feedback rows", async () => {
    await dismissPreFeedback(db, sessionId);
    expect((await db.sessions.get(sessionId))!.preFeedbackDismissed).toBe(true);
    expect(await getSessionFeedback(db, sessionId)).toEqual([]);
  });
});
