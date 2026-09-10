// db/index.ts
//
// The Dexie database. This is the only module that knows table names and
// indexes; everything else goes through the exported `db` instance.
//
// A frontend note for the stats-minded: the string passed to `stores()` is
// NOT a column list. IndexedDB stores whole objects; the string only declares
// the primary key and which fields get an index. Un-indexed fields are stored
// fine — you just can't `where()` on them efficiently. So the rule is: index
// what you query by, nothing more. Every index costs write time on a phone.
//
// Key syntax:  ++id      auto-increment primary key
//              name      plain index
//              [a+b]     compound index — lets you query on a AND b together
//              &name     unique index — inserts with a duplicate value throw
//              (bare)    first entry is always the primary key

import Dexie, { type EntityTable } from "dexie";
import { seedExercises } from "./seed";
import type {
  Exercise,
  Mesocycle,
  MesocycleDay,
  MesocycleDayExercise,
  MuscleFeedbackRecord,
  Session,
  SessionExercise,
  VolumeLandmarkRecord,
  WorkSet,
} from "./schema";

export class TrainingDb extends Dexie {
  exercises!: EntityTable<Exercise, "id">;
  mesocycles!: EntityTable<Mesocycle, "id">;
  mesocycleDays!: EntityTable<MesocycleDay, "id">;
  mesocycleDayExercises!: EntityTable<MesocycleDayExercise, "id">;
  sessions!: EntityTable<Session, "id">;
  sessionExercises!: EntityTable<SessionExercise, "id">;
  sets!: EntityTable<WorkSet, "id">;
  muscleFeedback!: EntityTable<MuscleFeedbackRecord, "id">;
  volumeLandmarks!: EntityTable<VolumeLandmarkRecord, "muscleGroup">;

  constructor(name = "training") {
    super(name);

    // Never edit a shipped version in place. To change the schema, add
    // `this.version(2).stores({...}).upgrade(...)` below it. Dexie runs the
    // migrations in order on devices that are behind.
    this.version(1).stores({
      exercises: "++id, &name, muscleGroup, source",
      mesocycles: "++id, status, startDate",
      mesocycleDays: "++id, mesocycleId, [mesocycleId+dayIndex]",
      mesocycleDayExercises: "++id, mesocycleDayId, exerciseId, [mesocycleDayId+order]",
      sessions: "++id, mesocycleId, [mesocycleId+weekNum], [mesocycleId+weekNum+mesocycleDayId]",
      sessionExercises: "++id, sessionId, exerciseId, [sessionId+order]",
      sets: "++id, sessionExerciseId, [sessionExerciseId+setIndex]",
      muscleFeedback: "++id, sessionId, [sessionId+muscleGroup], [mesocycleId+muscleGroup]",
      volumeLandmarks: "muscleGroup",
    });

    // Fires exactly once, when the database is first created on a device.
    // It runs inside the same transaction as the schema creation, so a
    // failed seed leaves no half-made database behind.
    this.on("populate", () => seedExercises(this));
  }
}

/** The app-wide singleton. Tests construct their own `new TrainingDb(name)`. */
export const db = new TrainingDb();
