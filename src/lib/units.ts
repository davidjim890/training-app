// lib/units.ts
//
// Unit conversion for display. Everything in the database and the engine is
// kilograms; only the screens speak pounds. PURE.

export type WeightUnit = "kg" | "lb";

export const KG_PER_LB = 0.45359237;

/** Smallest plate step in each unit — what the steppers and load rounding use. */
export const PLATE_STEP: Record<WeightUnit, number> = { kg: 2.5, lb: 5 };

/** Plate step expressed in kg, for the engine's `roundToPlate` / `suggestLoad`. */
export function plateStepKg(unit: WeightUnit): number {
  return unit === "kg" ? PLATE_STEP.kg : PLATE_STEP.lb * KG_PER_LB;
}

/** kg → display unit, rounded to 0.1 so typed pounds come back as typed. */
export function toDisplay(kg: number, unit: WeightUnit): number {
  const v = unit === "kg" ? kg : kg / KG_PER_LB;
  return Math.round(v * 10) / 10;
}

/** display unit → kg, kept to 3 decimals so it round-trips through toDisplay. */
export function toKg(value: number, unit: WeightUnit): number {
  const kg = unit === "kg" ? value : value * KG_PER_LB;
  return Math.round(kg * 1000) / 1000;
}

/** "132.5" / "60" — number only, for compact set lists. */
export function fmtWeight(kg: number, unit: WeightUnit): string {
  return String(toDisplay(kg, unit));
}

/** Body-weight stepper bounds in the display unit. */
export function bodyWeightRange(unit: WeightUnit, kgRange: { min: number; max: number }): { min: number; max: number; step: number } {
  return unit === "kg"
    ? { min: kgRange.min, max: kgRange.max, step: 0.5 }
    : { min: Math.floor(toDisplay(kgRange.min, "lb")), max: Math.ceil(toDisplay(kgRange.max, "lb")), step: 1 };
}
