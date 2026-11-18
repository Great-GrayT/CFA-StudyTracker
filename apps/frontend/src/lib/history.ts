import { minutesShort } from "./today";
import { ratePercent, rateMet, type Stat } from "./question-stats";
import type { HistoryDeclarationRecord, HistoryQuestions, HistoryRecord, HistoryStep, HistoryTaskRecord, StepNo } from "./types";
import type { TaskSubmission } from "./hooks";

// Pure half of the topic page's step drill-down and its edit dialogs.

export const STEP_TITLES: Record<StepNo, string> = {
  1: "Read",
  2: "Initial questions",
  3: "Review",
  4: "Review questions",
};

export const STEP_STATUS_WORD: Record<HistoryStep["status"], string> = {
  done: "Done",
  "in-progress": "In progress",
  "not-started": "Not started",
};

export const CONF_WORD = ["Shaky", "Unsure", "Fair", "Solid", "Sure"];

export const isQuestionStep = (step: number) => step === 2 || step === 4;

export type SourceKind = "recorded" | "self" | "off-plan" | "extra";

/** Where a record came from, as the badge shows it. */
export function sourceOf(rec: HistoryRecord): { kind: SourceKind; label: string } {
  if (rec.type === "declaration") return { kind: "self", label: "Self-stated" };
  if (rec.offPlan) return { kind: "off-plan", label: "Off plan" };
  if (rec.extraReason) return { kind: "extra", label: `Extra: ${rec.extraReason}` };
  return { kind: "recorded", label: "Recorded" };
}

/** "n / m" with the extra pool when there is one: "10 / 15 + 3". */
export function questionProgress(q: Pick<HistoryQuestions, "n" | "m" | "q">): string {
  return `${q.n} / ${q.m}${q.q > 0 ? ` + ${q.q}` : ""}`;
}

/** Minutes line of a step: "45m of 60m", or just the target when nothing is done. */
export function stepMinutes(s: Pick<HistoryStep, "doneMin" | "targetMin">): string {
  return `${minutesShort(Math.round(s.doneMin))} of ${minutesShort(Math.round(s.targetMin))}`;
}

export function roundWord(s: Pick<HistoryStep, "round">): string | null {
  return s.round ? `Round ${s.round}` : null;
}

/** "75%" or null with nothing answered. */
export function rateText(correct: number, answered: number): string | null {
  const p = ratePercent(correct, answered);
  return p === null ? null : `${p}%`;
}

export function rateIsMet(correct: number, answered: number): boolean | null {
  return rateMet(correct, answered);
}

/** Round and overall rate of a question step, over its records of every round. */
export function stepRates(s: HistoryStep): { round: string | null; overall: string | null } {
  if (!s.questions) return { round: null, overall: null };
  let answered = 0;
  let correct = 0;
  for (const r of s.records) {
    if (r.type === "task") {
      answered += r.answered;
      correct += r.correct;
    } else if (r.answered) {
      answered += r.answered;
      correct += r.correct ?? 0;
    }
  }
  return {
    round: rateText(s.questions.correct, s.questions.answered),
    overall: rateText(correct, answered),
  };
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayOnlyOf = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** Calendar day of a record, "Tue 18 Nov". Dates are UTC midnights so the day never shifts. */
export function dayText(date: string): string {
  return dayFmt.format(dayOnlyOf(date));
}

/** Day plus the local time it was recorded: "Tue 18 Nov, 14:32". Time omitted when unparsable. */
export function recordedText(date: string, recordedAt: string | undefined): string {
  const t = recordedAt ? new Date(recordedAt) : null;
  return t && !Number.isNaN(t.getTime()) ? `${dayText(date)}, ${timeFmt.format(t)}` : dayText(date);
}

export function recordWhen(rec: HistoryRecord): string {
  // A self-state has a stated day, not a moment it happened.
  return rec.type === "task" ? recordedText(rec.date, rec.recordedAt) : dayText(rec.date);
}

/** "est 30m, actual 28m", with a missing actual shown as "not timed". */
export function minutesText(rec: Pick<HistoryTaskRecord, "estimatedMinutes" | "actualMinutes">): string {
  return `est ${minutesShort(rec.estimatedMinutes)}, ${
    rec.actualMinutes === null ? "not timed" : `actual ${minutesShort(rec.actualMinutes)}`
  }`;
}

export function answersText(rec: { answered: number | null; correct: number | null }): string | null {
  if (!rec.answered) return null;
  const correct = rec.correct ?? 0;
  return `${rec.answered} answered, ${correct} correct, ${rateText(correct, rec.answered)}`;
}

/** Stable key for a record row: tasks have ids, declarations are one per step. */
export const recordKey = (rec: HistoryRecord) => (rec.type === "task" ? rec.id : `decl-${rec.step}`);

/** What deleting does, so the dialog never leaves the replan a surprise. */
export function deleteEffect(rec: HistoryRecord): string {
  if (rec.type === "declaration") {
    return "A self-state counts as real study on its date. Deleting it removes that work and the plan is rebuilt from today to include the step again. It is refused while a later step relies on it.";
  }
  if (rec.offPlan) {
    return "The session and its study log entries are removed, and the coming days are rebuilt.";
  }
  return "The task goes back to your plan as pending, its study log entries are removed, and the coming days are rebuilt.";
}

export type TaskForm = {
  date: string;
  packageId: string;
  status: "done" | "partial";
  minutes: string;
  answered: string;
  correct: string;
  reviewed: boolean;
  reviewMinutes: string;
  confidence: number;
  note: string;
};

export function taskFormOf(rec: HistoryTaskRecord): TaskForm {
  return {
    date: rec.date.slice(0, 10),
    packageId: rec.packageId ?? "",
    status: rec.status,
    minutes: rec.actualMinutes === null ? "" : String(rec.actualMinutes),
    answered: rec.answered > 0 ? String(rec.answered) : "",
    correct: rec.answered > 0 ? String(rec.correct) : "",
    reviewed: rec.answerReviewDone,
    reviewMinutes: rec.answerReviewMinutes === null ? "" : String(rec.answerReviewMinutes),
    confidence: rec.confidence ?? 3,
    note: rec.note ?? "",
  };
}

/** Whether the record counts questions, so the form shows those fields. */
export function asksQuestions(rec: Pick<HistoryTaskRecord, "kind" | "answered">): boolean {
  return rec.kind === "questions" || rec.kind === "eocq" || rec.answered > 0;
}

const WHOLE = /^\d+$/;

/** First problem with the form, or null when it can be saved. `today` is YYYY-MM-DD. */
export function taskFormError(f: TaskForm, rec: Pick<HistoryTaskRecord, "kind" | "answered">, today: string): string | null {
  if (!f.date) return "Pick a date.";
  if (f.date > today) return "A record cannot be dated in the future.";
  if (f.minutes !== "") {
    if (!WHOLE.test(f.minutes) || Number(f.minutes) < 1 || Number(f.minutes) > 600) return "Minutes must be a whole number from 1 to 600.";
  } else if (f.status === "partial") {
    return "A partial record needs the minutes you spent.";
  }
  if (asksQuestions(rec)) {
    if ((f.answered !== "" && !WHOLE.test(f.answered)) || (f.correct !== "" && !WHOLE.test(f.correct))) {
      return "Use whole numbers for questions.";
    }
    if (Number(f.correct) > Number(f.answered || 0)) return "Correct answers cannot exceed questions answered.";
    if (f.reviewed) {
      if (!WHOLE.test(f.reviewMinutes) || Number(f.reviewMinutes) < 1 || Number(f.reviewMinutes) > 600) {
        return "Minutes on the answer review must be a whole number from 1 to 600.";
      }
    }
  }
  return null;
}

/** The PATCH body: date and package only when changed, as the server validates both. */
export function taskPatch(f: TaskForm, rec: HistoryTaskRecord): TaskSubmission & { taskId?: never } {
  const base = {
    confidence: f.confidence,
    note: f.note.trim(),
    ...(f.date !== rec.date.slice(0, 10) ? { date: f.date } : {}),
    ...(f.packageId && f.packageId !== (rec.packageId ?? "") ? { packageId: f.packageId } : {}),
    ...(asksQuestions(rec)
      ? {
          questionsAnswered: Number(f.answered || 0),
          questionsCorrect: Number(f.correct || 0),
          answerReviewDone: f.reviewed,
          ...(f.reviewed ? { answerReviewMinutes: Number(f.reviewMinutes) } : {}),
        }
      : {}),
  };
  return f.status === "partial"
    ? { ...base, status: "partial", actualMinutes: Number(f.minutes) }
    : { ...base, status: "done", ...(f.minutes !== "" ? { actualMinutes: Number(f.minutes) } : {}) };
}

export type MockForm = { date: string; score: string; answered: string; correct: string };

export function mockFormError(f: MockForm, today: string): string | null {
  if (!f.date) return "Pick a date.";
  if (f.date > today) return "A mock cannot be dated in the future.";
  const score = Number(f.score);
  if (f.score === "" || !Number.isFinite(score) || score < 0 || score > 100) return "Score must be a number from 0 to 100.";
  if ((f.answered !== "" && !WHOLE.test(f.answered)) || (f.correct !== "" && !WHOLE.test(f.correct))) {
    return "Use whole numbers for this topic's questions.";
  }
  if (Number(f.correct || 0) > Number(f.answered || 0)) return "Correct answers cannot exceed questions answered.";
  return null;
}

export type DeclarationLike = Pick<HistoryDeclarationRecord, "step" | "date" | "confidence" | "answered" | "correct">;


/**
 * The step header's numbers as Stats, so the topic page and Today colour them
 * with one rule. Round comes from the engine; overall spans every round's records.
 */
export function stepStats(s: HistoryStep): { progress: Stat; round: Stat | null; overall: Stat | null } | null {
  const q = s.questions;
  if (!q) return null;
  const metTime = q.minutes >= q.adequateMin - 1e-6;
  const progress: Stat = {
    text: questionProgress(q),
    met: metTime,
    hint: `${q.n} answered this round of ${q.m} needed${q.q > 0 ? `, plus ${q.q} extra` : ""}. ${
      metTime ? "Enough time spent" : "Not yet enough time spent"
    }: adequate means ${q.adequateMin} minutes of questions and answer review.`,
  };
  const rate = (label: string, correct: number, answered: number, scope: string): Stat | null => {
    const p = ratePercent(correct, answered);
    if (p === null) return null;
    const met = rateMet(correct, answered) as boolean;
    return {
      text: `${label} ${p}%`,
      met,
      hint: `${scope}: ${correct} of ${answered} correct. ${met ? "Meets" : "Below"} the 80% target.`,
    };
  };
  let answered = 0;
  let correct = 0;
  for (const r of s.records) {
    if (r.type === "task") {
      answered += r.answered;
      correct += r.correct;
    } else if (r.answered) {
      answered += r.answered;
      correct += r.correct ?? 0;
    }
  }
  return {
    progress,
    round: rate("this round", q.correct, q.answered, `Round ${s.round ?? 1}`),
    overall: rate("overall", correct, answered, "Every round"),
  };
}
