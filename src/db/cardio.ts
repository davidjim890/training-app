// db/cardio.ts
//
// Standalone cardio log. Not linked to blocks or sessions and not (yet) an
// input to the volume engine.

import type { TrainingDb } from "./index";
import type { CardioIntensity, CardioKind, CardioSession } from "./schema";

export interface CardioDraft {
  date: string;
  kind: CardioKind;
  durationMin: number;
  distanceKm?: number;
  /** Only stored when kind is "treadmill". */
  inclinePct?: number;
  intensity: CardioIntensity;
  notes?: string;
}

export const CARDIO_LIMITS = {
  durationMin: { min: 1, max: 600 },
  distanceKm: { min: 0, max: 200 },
  inclinePct: { min: 0, max: 40 },
} as const;

export function validateCardioDraft(d: CardioDraft): string[] {
  const problems: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) problems.push("Pick a date.");
  if (!(d.durationMin >= CARDIO_LIMITS.durationMin.min && d.durationMin <= CARDIO_LIMITS.durationMin.max))
    problems.push(`Duration must be between ${CARDIO_LIMITS.durationMin.min} and ${CARDIO_LIMITS.durationMin.max} minutes.`);
  if (d.distanceKm !== undefined && !(d.distanceKm >= CARDIO_LIMITS.distanceKm.min && d.distanceKm <= CARDIO_LIMITS.distanceKm.max))
    problems.push("Distance looks wrong.");
  if (d.kind === "treadmill" && d.inclinePct !== undefined && !(d.inclinePct >= CARDIO_LIMITS.inclinePct.min && d.inclinePct <= CARDIO_LIMITS.inclinePct.max))
    problems.push(`Incline must be between ${CARDIO_LIMITS.inclinePct.min} and ${CARDIO_LIMITS.inclinePct.max}%.`);
  return problems;
}

export async function addCardio(db: TrainingDb, draft: CardioDraft): Promise<number> {
  const problems = validateCardioDraft(draft);
  if (problems.length) throw new Error(problems.join(" "));
  const notes = draft.notes?.trim();
  return db.cardioSessions.add({
    date: draft.date,
    kind: draft.kind,
    durationMin: Math.round(draft.durationMin),
    intensity: draft.intensity,
    loggedAt: new Date().toISOString(),
    ...(draft.distanceKm !== undefined && draft.distanceKm > 0 ? { distanceKm: Math.round(draft.distanceKm * 100) / 100 } : {}),
    // 0% is a real treadmill setting, so it's kept; other kinds never carry an incline.
    ...(draft.kind === "treadmill" && draft.inclinePct !== undefined ? { inclinePct: Math.round(draft.inclinePct * 10) / 10 } : {}),
    ...(notes ? { notes } : {}),
  });
}

export function deleteCardio(db: TrainingDb, id: number): Promise<void> {
  return db.cardioSessions.delete(id);
}

/** Newest first; same-day entries ordered by when they were logged. */
export async function listCardio(db: TrainingDb, limit = 100): Promise<CardioSession[]> {
  const rows = await db.cardioSessions.orderBy("date").reverse().limit(limit).toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.loggedAt.localeCompare(a.loggedAt));
}

export interface CardioSummary {
  sessions: number;
  minutes: number;
  km: number;
}

/** Totals for the 7 days ending today (inclusive). */
export async function cardioLast7Days(db: TrainingDb, today = new Date()): Promise<CardioSummary> {
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.cardioSessions.where("date").between(start, end, true, true).toArray();
  return {
    sessions: rows.length,
    minutes: rows.reduce((n, r) => n + r.durationMin, 0),
    km: Math.round(rows.reduce((n, r) => n + (r.distanceKm ?? 0), 0) * 10) / 10,
  };
}
