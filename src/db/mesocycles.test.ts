import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrainingDb } from "./index";
import {
  createMesocycle,
  deleteMesocycle,
  emptyMesocycleDraft,
  mesocycleFootprint,
  listMesocycles,
  validateMesocycleDraft,
  type MesocycleDraft,
} from "./mesocycles";
import { savePreSessionFeedback } from "./feedback";
import { logSet, startSession } from "./sessions";

let db: TrainingDb;
beforeEach(() => {
  db = new TrainingDb(`test-${Math.random().toString(36).slice(2)}`);
});
afterEach(async () => {
  await db.delete();
});

async function validDraft(): Promise<MesocycleDraft> {
  const bench = await db.exercises.where("name").equals("Barbell bench press").first();
  const row = await db.exercises.where("name").equals("Barbell row").first();
  const squat = await db.exercises.where("name").equals("Back squat").first();
  return {
    name: "  Block 1 ",
    numWeeks: 5,
    startingRir: 3,
    startDate: "2026-09-14",
    days: [
      { name: "Push", exercises: [{ exerciseId: bench!.id, startingSets: 3 }] },
      { name: "", exercises: [{ exerciseId: row!.id, startingSets: 3 }, { exerciseId: squat!.id, startingSets: 2 }] },
    ],
  };
}

describe("validateMesocycleDraft", () => {
  it("accepts a valid draft", async () => {
    expect(validateMesocycleDraft(await validDraft())).toEqual([]);
  });

  it("reports each problem", async () => {
    const d = await validDraft();
    d.name = " ";
    d.numWeeks = 1;
    d.startingRir = 5;
    d.startDate = "next monday";
    d.days[0].exercises = [];
    d.days[1].exercises.push({ exerciseId: d.days[1].exercises[0].exerciseId, startingSets: 0 });
    const problems = validateMesocycleDraft(d);
    expect(problems).toHaveLength(7);
    expect(problems.join("\n")).toMatch(/Push has no exercises/);
    expect(problems.join("\n")).toMatch(/Day 2 lists the same exercise twice/);
  });

  it("rejects an empty week", () => {
    const d = emptyMesocycleDraft();
    d.name = "x";
    d.days = [];
    expect(validateMesocycleDraft(d)).toContainEqual(expect.stringMatching(/training days/));
  });
});

describe("createMesocycle", () => {
  it("writes block, days, and exercises with correct ordering and defaults", async () => {
    const id = await createMesocycle(db, await validDraft());

    const meso = await db.mesocycles.get(id);
    expect(meso).toMatchObject({ name: "Block 1", daysPerWeek: 2, status: "planned" });

    const days = await db.mesocycleDays.where("mesocycleId").equals(id).sortBy("dayIndex");
    expect(days.map((d) => d.name)).toEqual(["Push", "Day 2"]);

    const day2 = await db.mesocycleDayExercises.where("mesocycleDayId").equals(days[1].id).sortBy("order");
    expect(day2.map((e) => e.startingSets)).toEqual([3, 2]);
  });

  it("refuses an invalid draft and writes nothing", async () => {
    const d = await validDraft();
    d.name = "";
    await expect(createMesocycle(db, d)).rejects.toThrow(/name/);
    expect(await db.mesocycles.count()).toBe(0);
    expect(await db.mesocycleDays.count()).toBe(0);
  });

  it("refuses a draft pointing at a missing exercise, atomically", async () => {
    const d = await validDraft();
    d.days[1].exercises[0].exerciseId = 999_999;
    await expect(createMesocycle(db, d)).rejects.toThrow(/no longer exists/);
    expect(await db.mesocycles.count()).toBe(0);
  });
});

describe("listMesocycles", () => {
  it("returns newest start date first", async () => {
    const a = await validDraft();
    const b = await validDraft();
    b.name = "Block 2";
    b.startDate = "2026-11-02";
    await createMesocycle(db, a);
    await createMesocycle(db, b);
    expect((await listMesocycles(db)).map((m) => m.name)).toEqual(["Block 2", "Block 1"]);
  });
});

describe("emptyMesocycleDraft", () => {
  it("starts with one empty day and today's date", () => {
    const d = emptyMesocycleDraft(new Date("2026-09-10T12:00:00Z"));
    expect(d).toMatchObject({ numWeeks: 5, startingRir: 3, startDate: "2026-09-10" });
    expect(d.days).toHaveLength(1);
  });
});

describe("deleteMesocycle", () => {
  it("removes the block and everything under it, leaving other blocks and exercises alone", async () => {
    const a = await createMesocycle(db, await validDraft());
    const bDraft = await validDraft();
    bDraft.name = "Keep me";
    const b = await createMesocycle(db, bDraft);

    // Put real data under block A: a session with sets and feedback
    const dayA = (await db.mesocycleDays.where("mesocycleId").equals(a).first())!.id;
    const sid = await startSession(db, { mesocycleId: a, weekNum: 1, mesocycleDayId: dayA });
    const slot = (await db.sessionExercises.where("sessionId").equals(sid).first())!;
    await logSet(db, slot.id, { weight: 60, reps: 8, actualRir: 2 });
    await logSet(db, slot.id, { weight: 60, reps: 8, actualRir: 1 });
    await savePreSessionFeedback(db, sid, { chest: 1 });
    expect(await mesocycleFootprint(db, a)).toEqual({ sessions: 1, sets: 2 });

    const exercisesBefore = await db.exercises.count();
    await deleteMesocycle(db, a);

    expect(await db.mesocycles.get(a)).toBeUndefined();
    expect(await db.mesocycleDays.where("mesocycleId").equals(a).count()).toBe(0);
    expect(await db.sessions.where("mesocycleId").equals(a).count()).toBe(0);
    expect(await db.sessionExercises.count()).toBe(0);
    expect(await db.sets.count()).toBe(0);
    expect(await db.muscleFeedback.count()).toBe(0);
    expect(await db.mesocycleDayExercises.count()).toBe(3); // block B's three slots survive

    expect((await db.mesocycles.get(b))!.name).toBe("Keep me");
    expect(await db.mesocycleDays.where("mesocycleId").equals(b).count()).toBe(2);
    expect(await db.exercises.count()).toBe(exercisesBefore);
  });

  it("is a no-op for an unknown id", async () => {
    await createMesocycle(db, await validDraft());
    await deleteMesocycle(db, 999);
    expect(await db.mesocycles.count()).toBe(1);
  });
});
