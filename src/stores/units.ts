// stores/units.ts
//
// The display unit as a live store. Components read `$units`; it re-emits
// when the setting changes. Not canonical state — it mirrors the settings table.

import { liveQuery } from "dexie";
import { db } from "../db";
import { getUnits } from "../db/settings";

export const units = liveQuery(() => getUnits(db));
