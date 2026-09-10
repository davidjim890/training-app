import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANDMARKS,
  PLATE_INCREMENT,
  aggregateWeekFeedback,
  deloadSets,
  distributeSets,
  isDeloadWeek,
  nextWeekSets,
  planNextWeek,
  reviseMrv,
  roundToPlate,
  suggestLoad,
  targetRirForWeek,
  type MuscleFeedback,
  type VolumeLandmarks,
} from "./progression";

const landmarks: VolumeLandmarks = { mev: 8, mrv: 20 };

/** All-clear feedback, overridable per field. */
const fb = (overrides: Partial<MuscleFeedback> = {}): MuscleFeedback => ({
  soreness: 0,
  pump: 0,
  jointPain: 0,
  workload: 0,
  ...overrides,
});

const rirRamp = (numWeeks: number, startingRir = 3) =>
  Array.from({ length: numWeeks }, (_, i) => targetRirForWeek(i + 1, numWeeks, startingRir));

describe("targetRirForWeek", () => {
  it("ramps 3 → 0 across a 5-week block then deloads high", () => {
    expect(rirRamp(5)).toEqual([3, 2, 1, 0, 4]);
  });

  it("deload week is always startingRir + 1", () => {
    expect(targetRirForWeek(6, 6, 3)).toBe(4);
    expect(targetRirForWeek(4, 4, 2)).toBe(3);
  });

  it("never goes below 0 in accumulation", () => {
    for (const rir of rirRamp(8)) expect(rir).toBeGreaterThanOrEqual(0);
  });

  // Documented behaviour, not necessarily desired: rounding means short
  // blocks can skip a value and longer ones can repeat one. Revisit if the
  // ramp should instead be piecewise (hold at start, then drop 1/week).
  it("rounds evenly on blocks that don't divide cleanly", () => {
    expect(rirRamp(4)).toEqual([3, 2, 0, 4]);
    expect(rirRamp(6)).toEqual([3, 2, 2, 1, 0, 4]);
  });

  it("degenerate blocks", () => {
    expect(rirRamp(2)).toEqual([3, 4]);
    expect(rirRamp(1)).toEqual([4]);
  });
});

describe("isDeloadWeek", () => {
  it("is only the final week", () => {
    expect(isDeloadWeek(5, 5)).toBe(true);
    expect(isDeloadWeek(4, 5)).toBe(false);
    expect(isDeloadWeek(6, 5)).toBe(false);
  });
});

describe("nextWeekSets", () => {
  it("joint pain overrides everything, including easy recovery", () => {
    const r = nextWeekSets(10, fb({ jointPain: 2 }), landmarks);
    expect(r.sets).toBe(8);
    expect(r.delta).toBe(-2);
  });

  it("mild joint discomfort holds even when everything else says add", () => {
    expect(nextWeekSets(10, fb({ jointPain: 1 }), landmarks).delta).toBe(0);
  });

  it("'too much' workload backs off one set", () => {
    expect(nextWeekSets(10, fb({ workload: 3 }), landmarks).delta).toBe(-1);
  });

  it("still sore holds volume", () => {
    expect(nextWeekSets(10, fb({ soreness: 3, pump: 0, workload: 0 }), landmarks).delta).toBe(0);
  });

  it("scores stimulus + fatigue", () => {
    expect(nextWeekSets(10, fb(), landmarks).delta).toBe(2); // score 0
    expect(nextWeekSets(10, fb({ pump: 1 }), landmarks).delta).toBe(2); // score 1
    expect(nextWeekSets(10, fb({ workload: 2 }), landmarks).delta).toBe(1); // score 2
    expect(nextWeekSets(10, fb({ pump: 1, workload: 1, soreness: 2 }), landmarks).delta).toBe(1); // 3
    expect(nextWeekSets(10, fb({ pump: 2, workload: 2 }), landmarks).delta).toBe(0); // score 4
  });

  it("caps at MRV and says so", () => {
    const r = nextWeekSets(19, fb(), landmarks);
    expect(r.sets).toBe(20);
    expect(r.delta).toBe(1);
    expect(r.atMrv).toBe(true);
    expect(r.rationale).toMatch(/Capped at your MRV of 20/);
  });

  it("at MRV with easy recovery, the rationale doesn't claim to add sets", () => {
    const r = nextWeekSets(20, fb(), landmarks);
    expect(r.delta).toBe(0);
    expect(r.atMrv).toBe(true);
    expect(r.rationale).not.toMatch(/adding/i);
    expect(r.rationale).toMatch(/already at your MRV/);
  });

  it("pulls back to MRV if somehow above it", () => {
    const r = nextWeekSets(25, fb({ jointPain: 1 }), landmarks);
    expect(r.sets).toBe(20);
    expect(r.delta).toBe(-5);
  });

  it("never goes negative", () => {
    const r = nextWeekSets(1, fb({ jointPain: 2 }), landmarks);
    expect(r.sets).toBe(0);
    expect(r.delta).toBe(-1);
  });

  it("delta always equals sets - currentSets", () => {
    const feedbacks: MuscleFeedback[] = [];
    for (const soreness of [0, 1, 2, 3] as const)
      for (const pump of [0, 1, 2] as const)
        for (const jointPain of [0, 1, 2] as const)
          for (const workload of [0, 1, 2, 3] as const)
            feedbacks.push({ soreness, pump, jointPain, workload });
    for (const current of [0, 1, 8, 19, 20, 25]) {
      for (const f of feedbacks) {
        const r = nextWeekSets(current, f, landmarks);
        expect(r.delta).toBe(r.sets - current);
        expect(r.sets).toBeGreaterThanOrEqual(0);
        expect(r.sets).toBeLessThanOrEqual(landmarks.mrv);
      }
    }
  });
});

describe("deloadSets", () => {
  it("is roughly half, never below one", () => {
    expect(deloadSets(16)).toBe(8);
    expect(deloadSets(15)).toBe(8);
    expect(deloadSets(1)).toBe(1);
    expect(deloadSets(0)).toBe(1);
  });
});

describe("suggestLoad", () => {
  it("bumps ~5% when you clearly overshot the RIR target", () => {
    expect(suggestLoad(100, 12, 4, 2)).toMatchObject({ weight: 105, reps: 12 });
  });

  it("always moves at least one plate increment at light loads", () => {
    // 5% of 20 is 1kg, which rounds back to 20 — the bump must still happen.
    expect(suggestLoad(20, 10, 4, 2).weight).toBe(20 + PLATE_INCREMENT);
    expect(suggestLoad(10, 10, 4, 2).weight).toBe(10 + PLATE_INCREMENT);
    // Same for the smaller top-of-range bump.
    expect(suggestLoad(40, 30, 2, 2).weight).toBe(40 + PLATE_INCREMENT);
  });

  it("honours a custom increment (e.g. lbs)", () => {
    expect(suggestLoad(20, 10, 4, 2, { min: 5, max: 30 }, 5).weight).toBe(25);
  });

  it("trims a rep when you went past the target", () => {
    expect(suggestLoad(100, 12, 0, 2)).toMatchObject({ weight: 100, reps: 11 });
    expect(suggestLoad(100, 5, 0, 2).reps).toBe(5); // floor at repRange.min
  });

  it("adds a rep when on target, then adds load and resets at the top", () => {
    expect(suggestLoad(100, 12, 2, 2)).toMatchObject({ weight: 100, reps: 13 });
    expect(suggestLoad(100, 30, 2, 2)).toMatchObject({ weight: 102.5, reps: 5 });
  });

  it("treats ±1 RIR as on target", () => {
    expect(suggestLoad(100, 12, 3, 2).reps).toBe(13);
    expect(suggestLoad(100, 12, 1, 2).reps).toBe(13);
  });
});

describe("roundToPlate", () => {
  it("rounds to the nearest increment", () => {
    expect(roundToPlate(101)).toBe(100);
    expect(roundToPlate(101.3)).toBe(102.5);
    expect(roundToPlate(101, 5)).toBe(100);
  });
});

describe("planNextWeek", () => {
  const perMuscle = {
    chest: { currentSets: 16, feedback: fb() },
    back: { currentSets: 12, feedback: fb({ jointPain: 2 }) },
  };

  it("prescribes per muscle with the next week's RIR", () => {
    const plan = planNextWeek(2, 5, 3, perMuscle, { chest: landmarks, back: landmarks });
    expect(plan.chest).toMatchObject({ sets: 18, targetRir: 1 });
    expect(plan.back).toMatchObject({ sets: 10, targetRir: 1 });
  });

  it("uses fallback landmarks for muscles with none", () => {
    const plan = planNextWeek(1, 5, 3, { chest: { currentSets: 19, feedback: fb() } }, {});
    expect(plan.chest.sets).toBe(20);
    expect(plan.chest.atMrv).toBe(true);
  });

  it("halves everything going into the deload, ignoring feedback", () => {
    const plan = planNextWeek(4, 5, 3, perMuscle, { chest: landmarks, back: landmarks });
    expect(plan.chest).toMatchObject({ sets: 8, delta: -8, targetRir: 4, atMrv: false });
    expect(plan.back).toMatchObject({ sets: 6, delta: -6, targetRir: 4 });
  });
});

describe("reviseMrv", () => {
  it("observed breakdown is the new ceiling", () => {
    expect(reviseMrv(20, 18, false).mrv).toBe(18);
  });
  it("clean completion nudges up", () => {
    expect(reviseMrv(20, null, true).mrv).toBe(22);
  });
  it("no signal holds", () => {
    expect(reviseMrv(20, null, false).mrv).toBe(20);
  });
});

describe("aggregateWeekFeedback", () => {
  it("takes the worst case on every scale", () => {
    expect(
      aggregateWeekFeedback([
        { soreness: 0, pump: 2, jointPain: 0, workload: 1 },
        { soreness: 2, pump: 0, jointPain: 1, workload: 3 },
      ])
    ).toEqual({ soreness: 2, pump: 2, jointPain: 1, workload: 3 });
  });

  it("returns null when any row is missing the post-session half, or there are no rows", () => {
    expect(aggregateWeekFeedback([{ soreness: 1 }, { soreness: 0, pump: 1, jointPain: 0, workload: 1 }])).toBeNull();
    expect(aggregateWeekFeedback([])).toBeNull();
  });
});

describe("distributeSets", () => {
  it("adds to slots in order", () => {
    expect(distributeSets(8, [3, 3])).toEqual([4, 4]);
    expect(distributeSets(7, [3, 3])).toEqual([4, 3]);
    expect(distributeSets(9, [2, 2, 2])).toEqual([3, 3, 3]);
    expect(distributeSets(10, [2, 2, 2])).toEqual([4, 3, 3]);
  });

  it("removes from the last slots first and never goes below zero", () => {
    expect(distributeSets(5, [3, 3])).toEqual([3, 2]);
    expect(distributeSets(1, [3, 3])).toEqual([1, 0]);
    expect(distributeSets(0, [3, 3])).toEqual([0, 0]);
  });

  it("returns bases unchanged when the total already matches, and handles no slots", () => {
    expect(distributeSets(6, [3, 3])).toEqual([3, 3]);
    expect(distributeSets(6, [])).toEqual([]);
  });

  it("always sums to the total", () => {
    for (let total = 0; total <= 30; total++) {
      for (const bases of [[1], [2, 2], [3, 1, 4], [0, 0, 0, 0]]) {
        expect(distributeSets(total, bases).reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });
});

describe("DEFAULT_LANDMARKS", () => {
  it("is what planNextWeek falls back to", () => {
    const plan = planNextWeek(1, 5, 3, { chest: { currentSets: DEFAULT_LANDMARKS.mrv - 1, feedback: fb() } }, {});
    expect(plan.chest.sets).toBe(DEFAULT_LANDMARKS.mrv);
  });
});
