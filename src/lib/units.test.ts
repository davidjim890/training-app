import { describe, expect, it } from "vitest";
import { roundToPlate, suggestLoad } from "./progression";
import { bodyWeightRange, fmtWeight, plateStepKg, toDisplay, toKg } from "./units";

describe("units", () => {
  it("kg is identity", () => {
    expect(toDisplay(82.5, "kg")).toBe(82.5);
    expect(toKg(82.5, "kg")).toBe(82.5);
    expect(fmtWeight(60, "kg")).toBe("60");
  });

  it("pounds round-trip as typed", () => {
    for (const lb of [45, 135, 137, 225.5, 176]) {
      expect(toDisplay(toKg(lb, "lb"), "lb")).toBe(lb);
    }
    expect(toKg(176, "lb")).toBe(79.832);
    expect(fmtWeight(toKg(135, "lb"), "lb")).toBe("135");
  });

  it("a 5 lb plate step in kg makes the engine round to 5 lb multiples", () => {
    const step = plateStepKg("lb");
    expect(step).toBeCloseTo(2.268, 3);
    // 137 lb rounded to plates -> 135 lb
    expect(toDisplay(roundToPlate(toKg(137, "lb"), step), "lb")).toBe(135);
    // 5% bump on 135 lb = 141.75 -> 140 lb
    const s = suggestLoad(toKg(135, "lb"), 10, 4, 2, { min: 5, max: 30 }, step);
    expect(toDisplay(s.weight, "lb")).toBe(140);
    // light dumbbell: 10 lb -> at least one plate step -> 15 lb
    expect(toDisplay(suggestLoad(toKg(10, "lb"), 10, 4, 2, { min: 5, max: 30 }, step).weight, "lb")).toBe(15);
  });

  it("body weight range converts", () => {
    expect(bodyWeightRange("kg", { min: 30, max: 250 })).toEqual({ min: 30, max: 250, step: 0.5 });
    expect(bodyWeightRange("lb", { min: 30, max: 250 })).toEqual({ min: 66, max: 552, step: 1 });
  });
});
