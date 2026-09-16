import { describe, expect, it } from "vitest";
import { cardioEnergy, liftingEnergy, liftingSessionMinutes, LIFTING_MET, MAX_LIFTING_SESSION_MIN, POST_LAST_SET_GRACE_MIN } from "./energy";

describe("cardioEnergy", () => {
  it("uses the ACSM running equation when distance is known and speed is fast", () => {
    // 10 km in 50 min = 12 km/h = 200 m/min. VO2 = 3.5 + 0.2*200 = 43.5 ml/kg/min
    // kcal = 43.5 * 80 kg * 50 min * 5 / 1000 = 870
    const e = cardioEnergy({ kind: "run", durationMin: 50, distanceKm: 10, intensity: 2 }, 80);
    expect(e).toEqual({ kcal: 870, method: "acsm-run", met: 12.4 });
  });

  it("uses the walking equation at walking speeds and credits incline", () => {
    // 5 km in 60 min = 5 km/h = 83.33 m/min, 10% grade
    // VO2 = 3.5 + 0.1*83.33 + 1.8*83.33*0.1 = 3.5 + 8.33 + 15 = 26.83
    // kcal = 26.83 * 70 * 60 * 5 / 1000 = 563.5 → 564; flat: 11.83 → 248.5 → 249
    const flat = cardioEnergy({ kind: "treadmill", durationMin: 60, distanceKm: 5, inclinePct: 0, intensity: 1 }, 70);
    const hill = cardioEnergy({ kind: "treadmill", durationMin: 60, distanceKm: 5, inclinePct: 10, intensity: 1 }, 70);
    expect(flat.method).toBe("acsm-walk");
    expect(flat.kcal).toBe(249); // 248.5 rounds up
    expect(hill.kcal).toBe(564);
    expect(hill.kcal).toBeGreaterThan(flat.kcal);
  });

  it("falls back to METs without distance, and intensity matters", () => {
    const easy = cardioEnergy({ kind: "bike", durationMin: 60, intensity: 0 }, 80);
    const hard = cardioEnergy({ kind: "bike", durationMin: 60, intensity: 2 }, 80);
    expect(easy).toEqual({ kcal: 440, method: "met", met: 5.5 });
    expect(hard).toEqual({ kcal: 840, method: "met", met: 10.5 });
  });

  it("non-locomotion kinds ignore distance and use METs", () => {
    const e = cardioEnergy({ kind: "row", durationMin: 30, distanceKm: 6, intensity: 1 }, 80);
    expect(e).toEqual({ kcal: 280, method: "met", met: 7.0 });
  });

  it("treadmill without distance still credits incline", () => {
    const flat = cardioEnergy({ kind: "treadmill", durationMin: 30, intensity: 1 }, 80);
    const hill = cardioEnergy({ kind: "treadmill", durationMin: 30, intensity: 1, inclinePct: 6 }, 80);
    expect(flat.met).toBe(7.0);
    expect(hill.met).toBe(10.0);
    expect(hill.kcal).toBe(400);
  });

  it("scales linearly with body weight and duration", () => {
    const a = cardioEnergy({ kind: "swim", durationMin: 30, intensity: 1 }, 60).kcal;
    const b = cardioEnergy({ kind: "swim", durationMin: 60, intensity: 1 }, 120).kcal;
    expect(b).toBe(a * 4);
  });
});

describe("liftingSessionMinutes", () => {
  const t0 = new Date("2026-09-16T17:00:00Z").getTime();
  const iso = (min: number) => new Date(t0 + min * 60_000).toISOString();

  it("is null with no sets or no start", () => {
    expect(liftingSessionMinutes({ startedAt: iso(0), completedAt: null, setCompletedAts: [] })).toBeNull();
    expect(liftingSessionMinutes({ startedAt: null, completedAt: null, setCompletedAts: [iso(10)] })).toBeNull();
  });

  it("counts start → last set + grace while in progress", () => {
    expect(liftingSessionMinutes({ startedAt: iso(0), completedAt: null, setCompletedAts: [iso(10), iso(40), iso(25)] })).toBe(40 + POST_LAST_SET_GRACE_MIN);
  });

  it("never runs past Finish, and a forgotten Finish doesn't inflate it", () => {
    expect(liftingSessionMinutes({ startedAt: iso(0), completedAt: iso(43), setCompletedAts: [iso(40)] })).toBe(43);
    expect(liftingSessionMinutes({ startedAt: iso(0), completedAt: iso(300), setCompletedAts: [iso(40)] })).toBe(40 + POST_LAST_SET_GRACE_MIN);
  });

  it("caps very long sessions", () => {
    expect(liftingSessionMinutes({ startedAt: iso(0), completedAt: null, setCompletedAts: [iso(400)] })).toBe(MAX_LIFTING_SESSION_MIN);
  });
});

describe("liftingEnergy", () => {
  it("is MET × kg × hours", () => {
    expect(liftingEnergy(60, 80)).toEqual({ kcal: LIFTING_MET * 80, method: "met", met: LIFTING_MET });
    expect(liftingEnergy(45, 80).kcal).toBe(270);
  });
});
