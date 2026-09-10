// db/calendar.ts
//
// What happened on each day of a month: lifting sessions and cardio entries.

import { dayKey, monthBounds } from "../lib/dates";
import type { TrainingDb } from "./index";
import type { CardioSession, SessionStatus } from "./schema";

export interface LiftingActivity {
  sessionId: number;
  mesocycleId: number;
  blockName: string;
  dayName: string;
  weekNum: number;
  status: SessionStatus;
  setsLogged: number;
}

export interface DayActivity {
  lifting: LiftingActivity[];
  cardio: CardioSession[];
}

/** Keyed by local YYYY-MM-DD. Days with nothing logged are absent. */
export async function monthActivity(db: TrainingDb, year: number, month: number): Promise<Map<string, DayActivity>> {
  const { start, end } = monthBounds(year, month);
  const out = new Map<string, DayActivity>();
  const bucket = (key: string) => {
    let d = out.get(key);
    if (!d) out.set(key, (d = { lifting: [], cardio: [] }));
    return d;
  };

  // Sessions: filter by local day of startedAt. Skipped days aren't activity.
  const sessions = (await db.sessions.filter((s) => s.startedAt !== null && s.status !== "skipped").toArray()).filter((s) => {
    const k = dayKey(s.startedAt!);
    return k >= start && k <= end;
  });
  if (sessions.length) {
    const mesos = new Map((await db.mesocycles.where("id").anyOf([...new Set(sessions.map((s) => s.mesocycleId))]).toArray()).map((m) => [m.id, m]));
    const days = new Map((await db.mesocycleDays.where("id").anyOf([...new Set(sessions.map((s) => s.mesocycleDayId))]).toArray()).map((d) => [d.id, d]));
    const slots = await db.sessionExercises.where("sessionId").anyOf(sessions.map((s) => s.id)).toArray();
    const slotToSession = new Map(slots.map((s) => [s.id, s.sessionId]));
    const setsBySession = new Map<number, number>();
    for (const set of await db.sets.where("sessionExerciseId").anyOf(slots.map((s) => s.id)).toArray()) {
      const sid = slotToSession.get(set.sessionExerciseId)!;
      setsBySession.set(sid, (setsBySession.get(sid) ?? 0) + 1);
    }
    for (const s of sessions.sort((a, b) => a.startedAt!.localeCompare(b.startedAt!))) {
      bucket(dayKey(s.startedAt!)).lifting.push({
        sessionId: s.id,
        mesocycleId: s.mesocycleId,
        blockName: mesos.get(s.mesocycleId)?.name ?? "?",
        dayName: days.get(s.mesocycleDayId)?.name ?? "?",
        weekNum: s.weekNum,
        status: s.status,
        setsLogged: setsBySession.get(s.id) ?? 0,
      });
    }
  }

  const cardio = await db.cardioSessions.where("date").between(start, end, true, true).toArray();
  for (const c of cardio.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))) bucket(c.date).cardio.push(c);

  return out;
}
