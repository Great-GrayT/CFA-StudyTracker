// Pure pairing engine. No DB, no HTTP, no framework.
// Turns a sequence of units into days where every minute of reading is
// followed, in the same sitting, by a candidate-set multiple of question
// minutes. Mark Meldrum's ratio, enforced by the scheduler rather than left
// as advice the candidate is expected to apply themselves.

import type { MasteryObservation } from "./mastery";
import { masteryOfUnit } from "./mastery";
import type { Calendar, PackableGroup, PlannedDay, PlannedTask } from "./packing";
import { MIN_TASK_MINUTES } from "./packing";
import type { Tuning } from "./tuning";
import { questionsIn, splitPractice } from "./question-pace";

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

export type SolvedRatio = {
  /** Question minutes per minute of reading, within a single sitting. */
  pacing: number;
  /** Question minutes per minute of reading, as a ceiling on the whole plan. */
  budget: number;
  /** What the candidate asked for, for display when the budget falls short. */
  requested: number;
  /** True when even questionMultipleFloor cannot be afforded. */
  calendarTooShort: boolean;
};

/**
 * Two multiples, not one.
 *
 * The spec conflated these and the candidate's own worked example proves they
 * are different. Topic 1 holds 56 minutes of reading against 140 of questions,
 * a ratio of 2.5, and their three days consume all 140. A single multiple
 * capped at the requested 2.0 would have scheduled 112 and silently abandoned
 * 28 minutes of the bank.
 *
 * `pacing` is the rule inside a sitting: read for a while, then answer
 * questions for twice that long. It is the candidate's preference and the
 * calendar never changes it.
 *
 * `budget` is how much of the question bank the calendar can reach at all.
 * Reading minutes R are fixed by the curriculum and the plan costs R plus its
 * question minutes, so the calendar affords (A - R) / R question minutes per
 * minute of reading. On a roomy calendar this exceeds the requested pacing and
 * the whole bank is reachable. On a tight one it falls below, and each unit's
 * question target is trimmed to fit: the ratio bends rather than the coverage,
 * because finishing the plan having never opened Derivatives is worse than
 * practising everything slightly less.
 *
 * `budget` is clamped below at questionMultipleFloor, beneath which a plan is
 * not a study plan and the candidate needs to be told the calendar is too
 * short rather than handed a ratio that pretends otherwise.
 */
export function solveQuestionMultiple(
  readingMinutes: number,
  availableMinutes: number,
  t: Tuning,
): SolvedRatio {
  const requested = t.firstPassQuestionMultiple;

  // No reading at all means nothing to pair against, so there is no ratio to
  // solve and no division to attempt.
  if (readingMinutes <= 0) {
    return { pacing: requested, budget: requested, requested, calendarTooShort: false };
  }

  const affordable = (availableMinutes - readingMinutes) / readingMinutes;
  if (affordable < t.questionMultipleFloor) {
    return {
      pacing: requested,
      budget: t.questionMultipleFloor,
      requested,
      calendarTooShort: true,
    };
  }

  return { pacing: requested, budget: affordable, requested, calendarTooShort: false };
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
  budgetMultiple: number,
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

    // The budget allows budgetMultiple * readingTotal minutes of practice. The
    // stock is a hard ceiling: the engine does not invent questions, and does
    // not borrow another unit's. On a roomy calendar the budget exceeds the
    // stock and the whole bank is owed; on a tight one it trims the target.
    const wanted = budgetMultiple * readingTotal;
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

// ---------------------------------------------------------------------------
// Rule A: the first-pass packer
// ---------------------------------------------------------------------------

type ReadingKind = "content-notes" | "content-video" | "seminar";
type QuestionKind = "questions" | "eocq";

type UnitState = {
  unit: ReconciledUnit;
  started: boolean;
  readingLeft: number;
  questionsLeft: number;
  // Per-kind remainders, drained in reading order, so a slice that straddles
  // two kinds emits one task for each rather than mislabelling both.
  readingByKind: Array<{ kind: ReadingKind; left: number }>;
  questionsByKind: Array<{ kind: QuestionKind; left: number }>;
  questionMinutesDone: number;
  questionMinutesTotal: number;
};

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fromISODate(s: string): Date {
  return new Date(s + "T00:00:00Z");
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function availableMinutesOn(cal: Calendar, date: string): number {
  if (cal.holidays.includes(date)) return 0;
  return cal.weeklyAvailability[WEEKDAY_KEYS[fromISODate(date).getUTCDay()]] ?? 0;
}

function initState(unit: ReconciledUnit): UnitState {
  // The debts are the authority, not the raw per-kind minutes: a reconciled
  // unit may owe less reading than it holds, because the candidate read some of
  // it off plan. Scale the kind remainders to the debt so the two agree.
  const readingTotal = readingMinutesOf(unit);
  const readScale = readingTotal > 0 ? unit.readingDebt / readingTotal : 0;
  const questionTotal = questionMinutesOf(unit);
  const questionScale = questionTotal > 0 ? unit.questionDebt / questionTotal : 0;

  const readingKinds: Array<[ReadingKind, number]> = [
    ["content-notes", unit.noteMinutes],
    ["content-video", unit.videoMinutes],
    ["seminar", unit.seminarMinutes ?? 0],
  ];
  const questionKinds: Array<[QuestionKind, number]> = [
    ["questions", unit.questionMinutes],
    ["eocq", unit.eocqMinutes],
  ];

  return {
    unit,
    started: false,
    readingLeft: unit.readingDebt,
    questionsLeft: unit.questionDebt,
    readingByKind: readingKinds
      .map(([kind, raw]) => ({ kind, left: raw * readScale }))
      .filter((k) => k.left > 0),
    questionsByKind: questionKinds
      .map(([kind, raw]) => ({ kind, left: raw * questionScale }))
      .filter((k) => k.left > 0),
    questionMinutesDone: 0,
    questionMinutesTotal: unit.questionDebt,
  };
}

/**
 * Draw `minutes` from a per-kind remainder list, one chunk per kind touched.
 *
 * Rounded so the chunks sum to exactly `minutes`: a day whose tasks do not add
 * up to the slice it was given is a day the candidate cannot reconcile against
 * the clock.
 *
 * A sub-floor chunk folds into its neighbour WITHIN the same bucket, never
 * across. Folding an eight minute read into the question task beside it would
 * report the reading as done under a question label, and the whole point of
 * Rule A is that the pairing stays visible.
 */
function drawChunks<K extends string>(
  byKind: Array<{ kind: K; left: number }>,
  minutes: number,
): Array<{ kind: K; minutes: number }> {
  if (minutes <= 0) return [];

  const taken: Array<{ kind: K; minutes: number }> = [];
  let want = minutes;
  for (const entry of byKind) {
    if (want <= 0) break;
    if (entry.left <= 0) continue;
    const take = Math.min(entry.left, want);
    entry.left -= take;
    want -= take;
    taken.push({ kind: entry.kind, minutes: take });
  }
  if (taken.length === 0) return [];

  const rounded = taken.map((c) => ({ ...c, minutes: Math.round(c.minutes) }));
  const drift = minutes - rounded.reduce((sum, c) => sum + c.minutes, 0);
  if (drift !== 0) {
    let largest = 0;
    for (let i = 1; i < rounded.length; i++) {
      if (rounded[i].minutes > rounded[largest].minutes) largest = i;
    }
    rounded[largest].minutes += drift;
  }

  const merged: Array<{ kind: K; minutes: number }> = [];
  for (const chunk of rounded) {
    if (chunk.minutes <= 0) continue;
    const prev = merged[merged.length - 1];
    if (chunk.minutes < MIN_TASK_MINUTES && prev) {
      prev.minutes += chunk.minutes;
    } else {
      merged.push({ ...chunk });
    }
  }
  return merged;
}

/**
 * Collapse neighbouring tasks that are the same kind on the same unit.
 *
 * One pass over a unit can place reading twice in a day: once paired with its
 * questions, then again to mop up once the bank is dry. Both are correct
 * scheduling and both are confusing to read, because "watch the Equity video
 * for 40 minutes" twice in one evening looks like a duplicated row rather than
 * eighty minutes of video. Only ADJACENT tasks merge, so a genuine
 * reading, questions, reading sequence keeps its shape.
 */
function collapseAdjacent(tasks: PlannedTask[]): PlannedTask[] {
  const out: PlannedTask[] = [];
  for (const task of tasks) {
    const prev = out[out.length - 1];
    const sameUnit = prev && prev.readingIds[0] === task.readingIds[0];
    if (prev && sameUnit && prev.kind === task.kind) {
      prev.estimatedMinutes += task.estimatedMinutes;
      prev.requiresConfidence = prev.requiresConfidence || task.requiresConfidence;
      if (task.vignetteTo !== undefined) {
        prev.vignetteTo = Math.max(prev.vignetteTo ?? 0, task.vignetteTo);
      }
      continue;
    }
    out.push({ ...task });
  }
  return out;
}

/**
 * Pack the first pass under Rule A: a slice of reading, then the pacing
 * multiple times that slice in questions, same unit, same sitting.
 *
 * `multiple` is the PACING multiple, not the budget one. The budget already
 * shaped each unit's questionDebt back in reconcile; this is the rhythm inside
 * the day, and it is why a 120 minute evening opens with 40 minutes of reading.
 *
 * Keeps packDays's weekly carry: an underfilled day lends its unused minutes to
 * the days after it, because the budget that has to hold is the WEEK's, reset
 * every seventh day so a quiet week cannot fund a brutal one a fortnight later.
 * A day may reach at most twice its own nominal figure, since lending is meant
 * to smooth a lumpy unit across a week, not turn a two hour Tuesday into a six
 * hour one.
 *
 * Unlike packDays this needs no indivisible-task escape and no vignette
 * boundary splitting, because every slice is computed to fit the room left.
 * Vignette ranges are derived from the minute fraction and a vignette may
 * therefore span two days, which is what the candidate asked for when they
 * wrote "one third of the questions".
 */
export function packFirstPass(
  units: ReconciledUnit[],
  cal: Calendar,
  multiple: number,
  t: Tuning,
): PlannedDay[] {
  const states = units.map(initState);
  const days: PlannedDay[] = [];

  const startDate = fromISODate(cal.startDate);
  const endDate = addDays(startDate, cal.horizonDays - 1);

  let cursor = 0;
  let carry = 0;
  let dayIndex = 0;
  let current = startDate;

  while (current <= endDate) {
    const date = toISODate(current);
    const available = availableMinutesOn(cal, date);

    if (dayIndex % 7 === 0) carry = 0;
    dayIndex++;

    if (available <= 0) {
      // A day the candidate said they cannot study is not an underfilled one,
      // so it lends nothing.
      days.push({ date, tasks: [] });
      current = addDays(current, 1);
      continue;
    }

    const capacity = Math.max(0, Math.min(available + carry, available * 2));
    const tasks: PlannedTask[] = [];
    let remaining = capacity;

    while (cursor < states.length && remaining >= MIN_TASK_MINUTES) {
      const s = states[cursor];

      if (s.readingLeft <= 0 && s.questionsLeft <= 0) {
        cursor++;
        continue;
      }

      // --- the reading slice ---
      let readSlice = 0;
      if (s.readingLeft > 0) {
        readSlice = Math.min(s.readingLeft, Math.floor(remaining / (1 + multiple)));

        // The mirror of the flush below, and the fix for a defect found by
        // reading a real generated plan rather than by any assertion: a 108
        // minute Wednesday held six reading tasks for one reading, at 40, 24,
        // 16, 10, 7 and 3 minutes.
        //
        // The cause is that reserving (multiple / (1 + multiple)) of the day
        // for questions only makes sense while there are questions to put
        // there. Once the bank cannot fill the paired share, the reserved room
        // goes back to reading, and the loop would otherwise come round to the
        // same unit and take a third of what was left, again and again.
        //
        // So when this unit's remaining questions cannot fill the slice's
        // paired share, reading takes everything the day has except those
        // questions, in one task. A day then reads as one sitting on one piece
        // of material instead of a shrinking series that looks like noise.
        if (s.questionsLeft <= multiple * readSlice) {
          readSlice = Math.min(s.readingLeft, Math.max(readSlice, remaining - s.questionsLeft));
        }

        if (!s.started && readSlice < t.minNewUnitReadMinutes) {
          if (s.unit.readingDebt >= t.minNewUnitReadMinutes) {
            // A bigger day can open this properly, and waiting one day is
            // cheaper than starting a unit on four minutes of reading.
            break;
          }
          // The unit's ENTIRE reading is under the floor, so waiting cannot
          // help it and it has to go somewhere. Place it whole.
          readSlice = s.readingLeft;
        }

        readSlice = Math.min(readSlice, remaining);
      }

      // --- the question slice ---
      let questionSlice = 0;
      if (s.questionsLeft > 0) {
        const closesReading = readSlice >= s.readingLeft;
        questionSlice = closesReading
          ? // Flush: a closing unit empties its bank in the same sitting rather
            // than leaving a stub to orphan a later day.
            Math.min(s.questionsLeft, remaining - readSlice)
          : Math.min(s.questionsLeft, Math.round(multiple * readSlice));
        questionSlice = Math.max(0, Math.min(questionSlice, remaining - readSlice));
      }

      if (readSlice <= 0 && questionSlice <= 0) {
        // Nothing placeable in the room left, and no progress is possible on
        // this unit today. Advancing the cursor here would skip a unit that
        // still owes work, so leave the day instead.
        break;
      }

      // --- emit, reading before its questions, always ---
      for (const chunk of drawChunks(s.readingByKind, readSlice)) {
        tasks.push({
          kind: chunk.kind,
          readingIds: s.unit.readingRefs,
          estimatedMinutes: chunk.minutes,
          requiresConfidence: false,
        });
      }

      if (questionSlice > 0) {
        const count = Math.max(1, s.unit.vignetteCount);
        const perVignette = s.questionMinutesTotal / count;
        const from = perVignette > 0
          ? Math.min(count - 1, Math.floor(s.questionMinutesDone / perVignette))
          : 0;
        const to = perVignette > 0
          ? Math.min(
              count - 1,
              Math.max(
                from,
                Math.ceil((s.questionMinutesDone + questionSlice) / perVignette) - 1,
              ),
            )
          : count - 1;
        const isLast = questionSlice >= s.questionsLeft;

        for (const chunk of drawChunks(s.questionsByKind, questionSlice)) {
          const mode = s.unit.calculationShare >= 0.35 ? "timed-drill" : "untimed-review";
          if (chunk.kind !== "questions") {
            tasks.push({
              kind: chunk.kind,
              readingIds: s.unit.readingRefs,
              estimatedMinutes: chunk.minutes,
              requiresConfidence: isLast,
              mode,
              vignetteFrom: from,
              vignetteTo: to,
            });
            continue;
          }
          // Budgeted as one block so both land today; shown as two tasks.
          const split = splitPractice(chunk.minutes, s.unit.answeringShare ?? 1);
          const questionTarget = questionsIn(
            chunk.minutes,
            s.unit.questionCount ?? 0,
            s.unit.questionMinutes,
          );
          tasks.push({
            kind: "questions",
            readingIds: s.unit.readingRefs,
            estimatedMinutes: split.answering,
            questionTarget,
            requiresConfidence: isLast && split.review === 0,
            mode,
            vignetteFrom: from,
            vignetteTo: to,
          });
          if (split.review > 0) {
            tasks.push({
              kind: "answer-review",
              readingIds: s.unit.readingRefs,
              estimatedMinutes: split.review,
              questionTarget,
              requiresConfidence: isLast,
              vignetteFrom: from,
              vignetteTo: to,
            });
          }
        }
        s.questionMinutesDone += questionSlice;
      }

      s.readingLeft -= readSlice;
      s.questionsLeft -= questionSlice;
      s.started = true;
      remaining -= readSlice + questionSlice;

      if (s.readingLeft <= 0 && s.questionsLeft <= 0) cursor++;
    }

    const collapsed = collapseAdjacent(tasks);
    const used = collapsed.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    carry = carry + available - used;
    days.push({ date, tasks: collapsed });
    current = addDays(current, 1);
  }

  return days;
}
