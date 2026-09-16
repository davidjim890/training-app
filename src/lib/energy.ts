// lib/energy.ts
//
// Caloric expenditure estimates. PURE — numbers in, numbers out.
//
// Two methods, both standard:
//   1. ACSM metabolic equations (walking / running) when speed and grade are
//      known. VO2 in ml/kg/min → kcal via ~5 kcal per litre of O2.
//   2. MET × body weight × hours for everything else (Compendium of Physical
//      Activities values, rounded).
//
// All results are GROSS (they include resting expenditure), which is what
// watches report. Treat the constants as tunable — a heart-rate strap would
// beat any of this.

import type { CardioIntensity, CardioKind } from "../db/schema";

/** kcal per litre of oxygen consumed (≈4.8–5.0 depending on fuel mix). */
export const KCAL_PER_LITRE_O2 = 5.0;

/** Below this speed the ACSM walking equation applies; above it, running. */
export const WALK_RUN_THRESHOLD_KMH = 7.0;

/** MET by cardio kind and intensity [easy, moderate, hard]. */
export const CARDIO_METS: Record<CardioKind, readonly [number, number, number]> = {
  run: [8.0, 9.8, 11.5],
  treadmill: [4.5, 7.0, 9.8],
  bike: [5.5, 7.5, 10.5],
  row: [4.8, 7.0, 10.0],
  swim: [6.0, 8.3, 10.0],
  walk: [3.0, 3.8, 5.0],
  stairs: [4.0, 6.0, 9.0],
  elliptical: [4.5, 5.5, 7.0],
  other: [4.0, 6.0, 8.0],
};

/**
 * Resistance training MET. Compendium lists 3.5 (light/moderate) to 6.0
 * (vigorous); hypertrophy sets near failure with normal rest sit between.
 */
export const LIFTING_MET = 4.5;

/** Minutes credited after the last logged set (racking, stretching). */
export const POST_LAST_SET_GRACE_MIN = 8;

/** Cap on a lifting session's counted duration, in case Finish was forgotten. */
export const MAX_LIFTING_SESSION_MIN = 180;

export type EnergyMethod = "acsm-walk" | "acsm-run" | "met";

export interface EnergyEstimate {
  kcal: number;
  method: EnergyMethod;
  /** Effective MET used (derived for ACSM methods, so it's comparable). */
  met: number;
}

export interface CardioInput {
  kind: CardioKind;
  durationMin: number;
  distanceKm?: number;
  inclinePct?: number;
  intensity: CardioIntensity;
}

const KINDS_WITH_LOCOMOTION_EQUATIONS: ReadonlySet<CardioKind> = new Set(["run", "treadmill", "walk"]);

/** VO2 in ml/kg/min from speed (m/min) and grade (fraction). */
function acsmVo2(speedMPerMin: number, grade: number, running: boolean): number {
  return running
    ? 3.5 + 0.2 * speedMPerMin + 0.9 * speedMPerMin * grade
    : 3.5 + 0.1 * speedMPerMin + 1.8 * speedMPerMin * grade;
}

export function cardioEnergy(input: CardioInput, bodyWeightKg: number): EnergyEstimate {
  const hours = input.durationMin / 60;

  if (KINDS_WITH_LOCOMOTION_EQUATIONS.has(input.kind) && input.distanceKm && input.distanceKm > 0 && input.durationMin > 0) {
    const kmh = input.distanceKm / hours;
    const mPerMin = (input.distanceKm * 1000) / input.durationMin;
    const grade = (input.inclinePct ?? 0) / 100;
    const running = kmh >= WALK_RUN_THRESHOLD_KMH;
    const vo2 = acsmVo2(mPerMin, grade, running);
    const kcal = (vo2 * bodyWeightKg * input.durationMin * KCAL_PER_LITRE_O2) / 1000;
    return { kcal: Math.round(kcal), method: running ? "acsm-run" : "acsm-walk", met: Math.round((vo2 / 3.5) * 10) / 10 };
  }

  let met = CARDIO_METS[input.kind][input.intensity];
  // Treadmill without distance: still credit the incline (≈ +0.5 MET per %,
  // a linearisation of the walking equation at ~5 km/h).
  if (input.kind === "treadmill" && input.inclinePct) met += 0.5 * input.inclinePct;
  return { kcal: Math.round(met * bodyWeightKg * hours), method: "met", met };
}

export interface LiftingSessionTiming {
  /** ISO datetimes. */
  startedAt: string | null;
  completedAt: string | null;
  setCompletedAts: string[];
}

/**
 * Minutes of a lifting session worth counting: start → last set + grace,
 * never past Finish, never past the cap. Null when nothing was logged.
 */
export function liftingSessionMinutes(t: LiftingSessionTiming): number | null {
  if (!t.startedAt || t.setCompletedAts.length === 0) return null;
  const start = Date.parse(t.startedAt);
  const lastSet = Math.max(...t.setCompletedAts.map((s) => Date.parse(s)));
  let end = lastSet + POST_LAST_SET_GRACE_MIN * 60_000;
  if (t.completedAt) end = Math.min(end, Date.parse(t.completedAt));
  end = Math.max(end, lastSet); // grace can't make it end before the last set
  const minutes = (end - start) / 60_000;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.min(minutes, MAX_LIFTING_SESSION_MIN);
}

export function liftingEnergy(durationMin: number, bodyWeightKg: number): EnergyEstimate {
  return { kcal: Math.round(LIFTING_MET * bodyWeightKg * (durationMin / 60)), method: "met", met: LIFTING_MET };
}
