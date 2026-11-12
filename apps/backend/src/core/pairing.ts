// Pure pairing engine. No DB, no HTTP, no framework.
// Turns a sequence of units into days where every minute of reading is
// followed, in the same sitting, by a candidate-set multiple of question
// minutes. Mark Meldrum's ratio, enforced by the scheduler rather than left
// as advice the candidate is expected to apply themselves.

import type { MasteryObservation } from "./mastery";
import { masteryOfUnit } from "./mastery";
import type { PackableGroup } from "./packing";
import type { Tuning } from "./tuning";

export type PairingTag = "paired" | "questions-only" | "reading-only";

export type ReconciledUnit = PackableGroup & {
  readingDebt: number;
  questionDebt: number;
  pairing: PairingTag;
};

export type WriteOff = {
  ref: string;
  mastery: number;
  readingMinutesDropped: number;
};

export type UnderPractised = {
  ref: string;
  shortfallMinutes: number;
};

/**
 * The reading bucket: notes, lecture video and seminar.
 *
 * Review video is deliberately absent. The first pass never touches it, so
 * that the review phase has reading material of its own and a 1 to 4 ratio is
 * reachable without re-reading the original notes end to end.
 */
export function readingMinutesOf(g: PackableGroup): number {
  return g.noteMinutes + g.videoMinutes + (g.seminarMinutes ?? 0);
}

/** The question bucket: question sets and end-of-chapter questions. */
export function questionMinutesOf(g: PackableGroup): number {
  return g.questionMinutes + g.eocqMinutes;
}

/**
 * The largest practice multiple this calendar can actually afford.
 *
 * Reading minutes R are fixed by the curriculum and a unit costs R + m*R, so
 * the calendar affords m = (A - R) / R. The ratio bends rather than the
 * coverage: trimming units would finish the plan having never opened
 * Derivatives, which is worse than practising everything slightly less.
 *
 * Clamped below at questionMultipleFloor, beneath which a plan is not a study
 * plan and the candidate needs to be told the calendar is too short rather
 * than handed a ratio that pretends otherwise.
 */
export function solveQuestionMultiple(
  readingMinutes: number,
  availableMinutes: number,
  t: Tuning,
): { effective: number; requested: number; calendarTooShort: boolean } {
  const requested = t.firstPassQuestionMultiple;

  // No reading at all means nothing to pair against, so there is no ratio to
  // solve and no division to attempt.
  if (readingMinutes <= 0) {
    return { effective: requested, requested, calendarTooShort: false };
  }

  const affordable = (availableMinutes - readingMinutes) / readingMinutes;
  if (affordable < t.questionMultipleFloor) {
    return {
      effective: t.questionMultipleFloor,
      requested,
      calendarTooShort: true,
    };
  }

  return {
    effective: Math.min(requested, affordable),
    requested,
    calendarTooShort: false,
  };
}

/**
 * Work out what each unit still owes, given everything the candidate has
 * already done, on plan or off it.
 *
 * Rule A alone assumes every unit begins owing its full reading and its full
 * practice, which is true only of a plan nobody has deviated from. A candidate
 * arrives having read three topic areas on their own, or spends a fortnight
 * ignoring the schedule and grinding question banks, and the planner's job is
 * to fold that in rather than pretend it did not happen.
 *
 * Four outcomes, matching the spec:
 *   both debts open                              -> paired, Rule A as written
 *   reading done, questions owed                 -> questions-only, a pure question day
 *   questions done, reading owed, weak           -> reading-only, a pure reading day
 *   questions done, reading owed, proficient     -> reading written off
 *
 * Debts are strictly per unit. Over-practising one unit earns no credit
 * against the next, which is why each clamps at zero independently.
 */
export function reconcile(
  seq: PackableGroup[],
  logsByRef: Map<string, MasteryObservation[]>,
  readingDoneByRef: Map<string, number>,
  questionsDoneByRef: Map<string, number>,
  multiple: number,
  asOf: Date,
  t: Tuning,
): {
  units: ReconciledUnit[];
  writeOffs: WriteOff[];
  underPractised: UnderPractised[];
} {
  const units: ReconciledUnit[] = [];
  const writeOffs: WriteOff[] = [];
  const underPractised: UnderPractised[] = [];

  for (const g of seq) {
    const readingTotal = readingMinutesOf(g);
    const questionStock = questionMinutesOf(g);

    const readingDebt = Math.max(0, readingTotal - (readingDoneByRef.get(g.ref) ?? 0));

    // The ratio wants multiple * readingTotal minutes of practice. The stock is
    // a hard ceiling: the engine does not invent questions, and does not borrow
    // another unit's.
    const wanted = multiple * readingTotal;
    const target = Math.min(questionStock, wanted);
    const questionDebt = Math.max(0, target - (questionsDoneByRef.get(g.ref) ?? 0));

    if (readingDebt <= 0 && questionDebt <= 0) continue;

    if (readingDebt > 0 && questionDebt <= 0) {
      // The practice is spent and the reading is not done. Either the questions
      // proved the material is known, in which case reading it would teach
      // nothing and the honest reading is that the candidate read it and did
      // not log it, or they did not, in which case the reading still stands but
      // has no practice left to pair with.
      const m = masteryOfUnit(logsByRef.get(g.ref) ?? [], asOf, t);
      if (m >= t.readingWriteOffBar) {
        writeOffs.push({ ref: g.ref, mastery: m, readingMinutesDropped: readingDebt });
        continue;
      }
      units.push({ ...g, readingDebt, questionDebt, pairing: "reading-only" });
    } else if (readingDebt <= 0) {
      units.push({ ...g, readingDebt, questionDebt, pairing: "questions-only" });
    } else {
      units.push({ ...g, readingDebt, questionDebt, pairing: "paired" });
    }

    // A thin bank is a real shortfall and gets recorded rather than papered
    // over. It shows up in mastery too, since coverage is answered over
    // available, so the unit carries a low M and the review queue collects it
    // without anyone having to notice this list.
    if (wanted > questionStock) {
      underPractised.push({ ref: g.ref, shortfallMinutes: wanted - questionStock });
    }
  }

  return { units, writeOffs, underPractised };
}
