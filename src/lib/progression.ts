// lib/progression.ts
//
// The engine. Every function here is PURE: no database, no Svelte, no I/O.
// That means you can unit-test the whole training algorithm in isolation and
// tune it without touching a single screen.
//
// NOTE: Renaissance Periodization's exact algorithm is proprietary. What
// follows is a reconstruction from their publicly described principles
// (MEV -> MRV volume ramping, RIR progression, feedback-driven set changes).
// Treat the constants as starting values and tune them against your own data.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Domain vocabulary lives here, not in the data layer. The Dexie schema should
 * import this type, never the other way round — the engine must stay pure.
 *
 * Defined as a runtime array first, then the type is derived from it. A plain
 * `type X = "a" | "b"` is erased at compile time, so a dropdown couldn't loop
 * over it. `as const` freezes the literal strings so TS keeps them exact
 * instead of widening to `string`. Order here is the display order.
 */
export const MUSCLE_GROUPS = [
  "chest",
  "lats",
  "mid-back",
  "traps",
  "rear-delts",
  // Front + side delts together — trained with movements that hit both.
  "shoulders",
  "biceps",
  "triceps",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "abs",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export interface MuscleFeedback {
  /** Recovery since last time you trained this muscle. Asked BEFORE the session. */
  soreness: 0 | 1 | 2 | 3;   // 0 never sore, 1 healed early, 2 healed on time, 3 still sore
  /** Asked AFTER the session. */
  pump: 0 | 1 | 2;           // 0 none, 1 moderate, 2 huge
  jointPain: 0 | 1 | 2;      // 0 none, 1 discomfort, 2 real pain
  workload: 0 | 1 | 2 | 3;   // 0 easy, 1 pretty good, 2 pushed limits, 3 too much
}

/** Answer labels for the feedback prompts, indexed by scale value. */
export const FEEDBACK_SCALES = {
  soreness: ["Never got sore", "Healed a while ago", "Healed just in time", "Still sore"],
  pump: ["None", "Moderate", "Huge"],
  jointPain: ["None", "Discomfort", "Real pain"],
  workload: ["Easy", "Pretty good", "Pushed limits", "Too much"],
} as const satisfies Record<keyof MuscleFeedback, readonly string[]>;

export const FEEDBACK_QUESTIONS: Record<keyof MuscleFeedback, string> = {
  soreness: "How sore was this muscle going into today?",
  pump: "How was the pump?",
  jointPain: "Any joint pain?",
  workload: "How hard was the workload?",
};

export interface VolumeLandmarks {
  mev: number; // sets/week
  mrv: number; // sets/week
}

/** Used for any muscle without a personal estimate yet. Deliberately generic. */
export const DEFAULT_LANDMARKS: VolumeLandmarks = { mev: 8, mrv: 20 };

export interface SetPrescription {
  sets: number;
  delta: number;
  /** Human-readable justification. Show this in the UI — it's most of the value. */
  rationale: string;
  /** Signals the muscle has hit its ceiling; a good moment to end the block. */
  atMrv: boolean;
}

// ---------------------------------------------------------------------------
// RIR progression
// ---------------------------------------------------------------------------

/**
 * Linear RIR ramp across the accumulation weeks, then a deload.
 *
 * A 5-week meso starting at 3 RIR gives: 3, 2, 1, 0, deload.
 * Deload returns a high RIR — you are backing off, not testing yourself.
 */
export function targetRirForWeek(
  weekNum: number,
  numWeeks: number,
  startingRir = 3
): number {
  if (isDeloadWeek(weekNum, numWeeks)) return startingRir + 1;

  const accumulationWeeks = numWeeks - 1;
  if (accumulationWeeks <= 1) return startingRir;

  // Step down evenly from startingRir to 0 across the accumulation weeks.
  const step = startingRir / (accumulationWeeks - 1);
  return Math.max(0, Math.round(startingRir - step * (weekNum - 1)));
}

export function isDeloadWeek(weekNum: number, numWeeks: number): boolean {
  return weekNum === numWeeks;
}

// ---------------------------------------------------------------------------
// Volume progression — the core rule
// ---------------------------------------------------------------------------

/**
 * Given last week's set count and feedback for one muscle group, decide this
 * week's set count.
 *
 * The logic, in plain terms:
 *   1. Joint pain overrides everything. Never add volume to an angry joint.
 *   2. If you're still sore from last time, you haven't recovered. Hold.
 *   3. Otherwise combine stimulus (pump) and fatigue (workload):
 *      low stimulus + low fatigue  -> add 2 sets
 *      some stimulus or some fatigue -> add 1 set
 *      high fatigue                -> add 0
 *      "too much"                  -> subtract
 *   4. Never exceed MRV.
 */
export function nextWeekSets(
  currentSets: number,
  fb: MuscleFeedback,
  landmarks: VolumeLandmarks
): SetPrescription {
  const clamp = (n: number, rationale: string, intendedDelta: number): SetPrescription => {
    const sets = Math.max(0, Math.min(n, landmarks.mrv));
    const delta = sets - currentSets;
    const wasCapped = intendedDelta > 0 && sets === landmarks.mrv;
    return {
      sets,
      delta,
      rationale: !wasCapped
        ? rationale
        : delta > 0
          ? `${rationale} Capped at your MRV of ${landmarks.mrv}.`
          : `Recovery says add more, but you're already at your MRV of ${landmarks.mrv} — holding. Consider ending the block soon.`,
      atMrv: sets >= landmarks.mrv,
    };
  };

  // 1. Joints first, always.
  if (fb.jointPain >= 2) {
    return clamp(
      currentSets - 2,
      "Significant joint pain — pulling volume back. Consider swapping this movement for a friendlier variation.",
      -2
    );
  }
  if (fb.jointPain === 1) {
    return clamp(currentSets, "Some joint discomfort — holding volume steady this week.", 0);
  }

  // 2. Genuinely too much work last week.
  if (fb.workload >= 3) {
    return clamp(
      currentSets - 1,
      "You reported the workload was too much — backing off one set to let performance recover.",
      -1
    );
  }

  // 3. Not recovered.
  if (fb.soreness >= 3) {
    return clamp(
      currentSets,
      "Still sore going into this session — holding volume until recovery catches up.",
      0
    );
  }

  // 4. Stimulus/fatigue score. Higher = you're already getting enough.
  const score = fb.pump + fb.workload + (fb.soreness >= 2 ? 1 : 0);

  if (score <= 1) {
    return clamp(
      currentSets + 2,
      "Low stimulus and easy recovery — adding two sets to push toward a productive dose.",
      2
    );
  }
  if (score <= 3) {
    return clamp(currentSets + 1, "Good stimulus with room to spare — adding one set.", 1);
  }
  return clamp(
    currentSets,
    "Strong stimulus and meaningful fatigue — holding volume; you're getting plenty from this dose.",
    0
  );
}

// ---------------------------------------------------------------------------
// Deload
// ---------------------------------------------------------------------------

/** Roughly half the volume of the last accumulation week, at high RIR. */
export function deloadSets(lastAccumulationSets: number): number {
  return Math.max(1, Math.round(lastAccumulationSets / 2));
}

// ---------------------------------------------------------------------------
// Load progression within an exercise
// ---------------------------------------------------------------------------

/** Smallest weight change achievable in the gym (kg). Swap for 5 if in lbs. */
export const PLATE_INCREMENT = 2.5;
/** Multiplier when you clearly overshot the RIR target. */
export const LOAD_BUMP_OVERSHOOT = 1.05;
/** Multiplier when you top out the rep range on target. */
export const LOAD_BUMP_TOP_OF_RANGE = 1.025;

/**
 * Suggest next week's working weight from last week's top set.
 * Conservative by design — the volume ramp is doing most of the work.
 */
export function suggestLoad(
  lastWeight: number,
  lastReps: number,
  lastActualRir: number,
  targetRir: number,
  repRange: { min: number; max: number } = { min: 5, max: 30 },
  increment = PLATE_INCREMENT
): { weight: number; reps: number; rationale: string } {
  // Overshot the target RIR — you left more in the tank than planned.
  // At light loads 5% rounds away to nothing, so always move at least one plate.
  if (lastActualRir > targetRir + 1) {
    return {
      weight: Math.max(roundToPlate(lastWeight * LOAD_BUMP_OVERSHOOT), lastWeight + increment),
      reps: lastReps,
      rationale: "You finished well short of the RIR target — bumping the load ~5%.",
    };
  }

  // Undershot — you went closer to failure than intended.
  if (lastActualRir < targetRir - 1) {
    return {
      weight: lastWeight,
      reps: Math.max(repRange.min, lastReps - 1),
      rationale: "You went past the RIR target — holding load and trimming a rep.",
    };
  }

  // On target. Add a rep until the top of the range, then add load and reset.
  if (lastReps < repRange.max) {
    return {
      weight: lastWeight,
      reps: lastReps + 1,
      rationale: "On target — add a rep at the same load.",
    };
  }
  return {
    weight: Math.max(roundToPlate(lastWeight * LOAD_BUMP_TOP_OF_RANGE), lastWeight + increment),
    reps: repRange.min,
    rationale: "Top of the rep range — adding load and resetting reps.",
  };
}

/** Round to the nearest achievable increment. Swap 2.5 for 5 if you're in lbs. */
export function roundToPlate(weight: number, increment = PLATE_INCREMENT): number {
  return Math.round(weight / increment) * increment;
}

// ---------------------------------------------------------------------------
// Weekly rollup
// ---------------------------------------------------------------------------

/**
 * Build the whole next week from last week's state. This is the function your
 * "finish week" button calls.
 */
export function planNextWeek(
  weekNum: number,
  numWeeks: number,
  startingRir: number,
  perMuscle: Record<string, { currentSets: number; feedback: MuscleFeedback }>,
  landmarks: Record<string, VolumeLandmarks>
): Record<string, SetPrescription & { targetRir: number }> {
  const nextWeek = weekNum + 1;
  const rir = targetRirForWeek(nextWeek, numWeeks, startingRir);
  const deload = isDeloadWeek(nextWeek, numWeeks);

  const out: Record<string, SetPrescription & { targetRir: number }> = {};

  for (const [muscle, state] of Object.entries(perMuscle)) {
    if (deload) {
      const sets = deloadSets(state.currentSets);
      out[muscle] = {
        sets,
        delta: sets - state.currentSets,
        rationale: "Deload week — roughly half volume at high RIR to dissipate fatigue.",
        atMrv: false,
        targetRir: rir,
      };
      continue;
    }

    const marks = landmarks[muscle] ?? DEFAULT_LANDMARKS;
    out[muscle] = { ...nextWeekSets(state.currentSets, state.feedback, marks), targetRir: rir };
  }

  return out;
}

// ---------------------------------------------------------------------------
// Bridging per-session data to the per-muscle weekly rule
// ---------------------------------------------------------------------------

/**
 * A muscle can be trained in several sessions a week, each with its own
 * feedback row. Collapse them to one reading: the WORST case on every scale.
 * Any joint pain counts, the sorest report counts, the hardest session
 * counts, and the biggest pump counts as "stimulus was reached".
 * Returns null if any session is missing the post-session half.
 */
export function aggregateWeekFeedback(rows: Partial<MuscleFeedback>[]): MuscleFeedback | null {
  if (rows.length === 0) return null;
  const complete = rows.filter(
    (r): r is MuscleFeedback =>
      r.soreness !== undefined && r.pump !== undefined && r.jointPain !== undefined && r.workload !== undefined
  );
  if (complete.length !== rows.length) return null;
  const max = <K extends keyof MuscleFeedback>(k: K) =>
    complete.reduce((m, r) => (r[k] > m ? r[k] : m), complete[0][k]);
  return { soreness: max("soreness"), pump: max("pump"), jointPain: max("jointPain"), workload: max("workload") };
}

/**
 * Spread a muscle's weekly set total across its exercise slots, starting from
 * each slot's current count. Extra sets go round-robin from the first slot
 * (first exercise of the week gets the first bump); removed sets come off
 * round-robin from the last slot backwards, never taking a slot below zero.
 */
export function distributeSets(total: number, bases: number[]): number[] {
  const out = bases.map((b) => Math.max(0, Math.round(b)));
  if (out.length === 0) return out;
  let diff = Math.max(0, Math.round(total)) - out.reduce((a, b) => a + b, 0);
  for (let i = 0; diff > 0; i = (i + 1) % out.length) {
    out[i]++;
    diff--;
  }
  for (let i = out.length - 1, guard = 0; diff < 0 && guard < 10_000; i = (i - 1 + out.length) % out.length, guard++) {
    if (out[i] > 0) {
      out[i]--;
      diff++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Landmark learning — where your stats brain gets to play
// ---------------------------------------------------------------------------

/**
 * After a completed mesocycle, revise your MRV estimate for a muscle.
 * If you hit a hard ceiling (repeated "too much" / persistent soreness), the
 * set count at which that happened IS your observed MRV.
 */
export function reviseMrv(
  current: number,
  setsAtBreakdown: number | null,
  completedWithoutBreakdown: boolean
): { mrv: number; rationale: string } {
  if (setsAtBreakdown !== null) {
    return {
      mrv: setsAtBreakdown,
      rationale: `Recovery broke down at ${setsAtBreakdown} sets/week — that's your observed ceiling.`,
    };
  }
  if (completedWithoutBreakdown) {
    return {
      mrv: current + 2,
      rationale: "Finished the block without hitting a wall — nudging the MRV estimate up.",
    };
  }
  return { mrv: current, rationale: "Not enough signal to revise." };
}
