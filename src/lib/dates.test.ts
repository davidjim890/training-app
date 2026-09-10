import { describe, expect, it } from "vitest";
import { addMonths, dayKey, monthBounds, monthGrid } from "./dates";

describe("dayKey", () => {
  it("uses local time", () => {
    const late = new Date(2026, 8, 10, 23, 30); // local Sep 10, 23:30
    expect(dayKey(late)).toBe("2026-09-10");
    expect(dayKey(late.toISOString())).toBe("2026-09-10");
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("monthGrid", () => {
  it("September 2026 starts on a Tuesday and spans five rows", () => {
    const rows = monthGrid(2026, 9);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.length === 7)).toBe(true);
    expect(rows[0].map((c) => c.dayOfMonth)).toEqual([31, 1, 2, 3, 4, 5, 6]);
    expect(rows[0][0]).toMatchObject({ key: "2026-08-31", inMonth: false });
    expect(rows[0][1]).toMatchObject({ key: "2026-09-01", inMonth: true });
    expect(rows[4].map((c) => c.dayOfMonth)).toEqual([28, 29, 30, 1, 2, 3, 4]);
  });

  it("a month starting on Monday has no leading padding", () => {
    const rows = monthGrid(2026, 6); // June 1 2026 is a Monday
    expect(rows[0][0]).toMatchObject({ key: "2026-06-01", inMonth: true });
  });

  it("February 2027 fits in four rows", () => {
    expect(monthGrid(2027, 2)).toHaveLength(4); // Feb 1 2027 is a Monday, 28 days
  });

  it("covers every day of the month exactly once", () => {
    for (const [y, m] of [[2026, 1], [2026, 2], [2026, 12], [2024, 2]] as const) {
      const days = monthGrid(y, m).flat().filter((c) => c.inMonth).map((c) => c.dayOfMonth);
      expect(days).toEqual(Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => i + 1));
    }
  });
});

describe("monthBounds / addMonths", () => {
  it("bounds", () => {
    expect(monthBounds(2026, 2)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthBounds(2024, 2)).toEqual({ start: "2024-02-01", end: "2024-02-29" });
  });
  it("wraps years", () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});
