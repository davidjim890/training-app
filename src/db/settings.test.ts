import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrainingDb } from "./index";
import { getSetting, setBodyWeightKg } from "./settings";

let db: TrainingDb;
beforeEach(() => {
  db = new TrainingDb(`test-${Math.random().toString(36).slice(2)}`);
});
afterEach(async () => {
  await db.delete();
});

describe("settings", () => {
  it("schema is v3 with a settings table", async () => {
    await db.open();
    expect(db.verno).toBe(3);
    expect(db.tables.map((t) => t.name)).toContain("settings");
  });

  it("body weight round-trips, rounds, and validates", async () => {
    expect(await getSetting(db, "bodyWeightKg")).toBeUndefined();
    await setBodyWeightKg(db, 82.44);
    expect(await getSetting(db, "bodyWeightKg")).toBe(82.4);
    await setBodyWeightKg(db, 83);
    expect(await db.settings.count()).toBe(1);
    await expect(setBodyWeightKg(db, 5)).rejects.toThrow(/looks wrong/);
  });
});
