// db/settings.ts
//
// Typed access to the key/value settings table.

import type { TrainingDb } from "./index";
import type { Settings } from "./schema";

export async function getSetting<K extends keyof Settings>(db: TrainingDb, key: K): Promise<Settings[K] | undefined> {
  const row = await db.settings.get(key);
  return row?.value as Settings[K] | undefined;
}

export async function setSetting<K extends keyof Settings>(db: TrainingDb, key: K, value: Settings[K]): Promise<void> {
  await db.settings.put({ key, value, updatedAt: new Date().toISOString() });
}

export const BODY_WEIGHT_LIMITS = { min: 30, max: 250 } as const;

export async function setBodyWeightKg(db: TrainingDb, kg: number): Promise<void> {
  if (!(kg >= BODY_WEIGHT_LIMITS.min && kg <= BODY_WEIGHT_LIMITS.max)) throw new Error("Body weight looks wrong");
  await setSetting(db, "bodyWeightKg", Math.round(kg * 10) / 10);
}
