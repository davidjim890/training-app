import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dayKey } from "../lib/dates";
import { addCardio } from "./cardio";
import { monthActivity } from "./calendar";
import { TrainingDb } from "./index";
import { createMesocycle } from "./mesocycles";
import { completeSession, logSet, skipSession, startSession } from "./sessions";

let db: TrainingDb;
beforeEach(() => {
  db = new TrainingDb(`test-${Math.random().toString(36).slice(2)}`);
});
afterEach(async () => {
  await db.delete();
});

describe("monthActivity", () => {
  it("groups lifting and cardio by local day with set counts", async () => {
    const bench = (await db.exercises.where("name").equals("Barbell bench press").first())!.id;
    const mesocycleId = await createMesocycle(db, {
      name: "Block", numWeeks: 4, startingRir: 3, startDate: "2026-09-01",
      days: [{ name: "Push", exercises: [{ exerciseId: bench, startingSets: 3 }] }, { name: "Legs", exercises: [{ exerciseId: bench, startingSets: 2 }] }],
    });
    const [push, legs] = (await db.mesocycleDays.where("mesocycleId").equals(mesocycleId).sortBy("dayIndex")).map((d) => d.id);

    const s1 = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: push });
    const slot = (await db.sessionExercises.where("sessionId").equals(s1).first())!;
    await logSet(db, slot.id, { weight: 60, reps: 8, actualRir: 2 });
    await logSet(db, slot.id, { weight: 60, reps: 8, actualRir: 2 });
    await completeSession(db, s1);
    // Pin the session to a known local day/time
    await db.sessions.update(s1, { startedAt: new Date(2026, 8, 10, 23, 30).toISOString() });

    const s2 = await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: legs });
    await skipSession(db, s2);
    await db.sessions.update(s2, { startedAt: new Date(2026, 8, 12, 9, 0).toISOString() });

    await addCardio(db, { date: "2026-09-10", kind: "run", durationMin: 30, intensity: 1 });
    await addCardio(db, { date: "2026-08-31", kind: "bike", durationMin: 45, intensity: 0 }); // previous month

    const sept = await monthActivity(db, 2026, 9);
    expect([...sept.keys()]).toEqual(["2026-09-10"]);
    const day = sept.get("2026-09-10")!;
    expect(day.lifting).toEqual([
      expect.objectContaining({ sessionId: s1, blockName: "Block", dayName: "Push", weekNum: 1, status: "completed", setsLogged: 2 }),
    ]);
    expect(day.cardio.map((c) => c.kind)).toEqual(["run"]);

    const aug = await monthActivity(db, 2026, 8);
    expect(aug.get("2026-08-31")!.cardio).toHaveLength(1);
    expect(aug.get("2026-08-31")!.lifting).toHaveLength(0);
  });

  it("is empty for a month with nothing", async () => {
    expect((await monthActivity(db, 2020, 1)).size).toBe(0);
  });

  it("today's fresh session shows up under today", async () => {
    const bench = (await db.exercises.where("name").equals("Barbell bench press").first())!.id;
    const mesocycleId = await createMesocycle(db, { name: "B", numWeeks: 4, startingRir: 3, startDate: "2026-09-01", days: [{ name: "A", exercises: [{ exerciseId: bench, startingSets: 3 }] }] });
    const dayId = (await db.mesocycleDays.where("mesocycleId").equals(mesocycleId).first())!.id;
    await startSession(db, { mesocycleId, weekNum: 1, mesocycleDayId: dayId });
    const now = new Date();
    const m = await monthActivity(db, now.getFullYear(), now.getMonth() + 1);
    expect(m.get(dayKey(now))!.lifting[0]).toMatchObject({ status: "in_progress", setsLogged: 0 });
  });
});
