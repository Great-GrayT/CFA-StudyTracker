import type { Progress } from "./types";

export type ExamPhase = "before" | "exam-day" | "after";

/** Compared as calendar days so the page never shows a negative countdown. */
export function examPhase(examDate: string, todayISO: string): ExamPhase {
  const exam = examDate.slice(0, 10);
  if (todayISO < exam) return "before";
  return todayISO === exam ? "exam-day" : "after";
}

export type StudyNextReason = "weak" | "stale" | "untouched" | "flagged";
export type StudyNextRow = { losId: string; reason: StudyNextReason; label: string };

const DAY_MS = 24 * 60 * 60 * 1000;
// Same threshold the old list used to swap the low-confidence flag for the stale one.
const STALE_DAYS = 30;

/**
 * The top of the backend's study-next list, in its order, with why each was
 * picked. A flagged outcome with no rating date has no age to judge, so it
 * says only that it is flagged.
 */
export function studyNextRows(p: Progress, limit = 5, nowMs = Date.now()): StudyNextRow[] {
  return p.studyNext.slice(0, limit).map((item) => {
    if (item.status !== "flagged") return { losId: item.losId, reason: "untouched", label: "Not started" };
    if (!item.lastRatedAt) return { losId: item.losId, reason: "flagged", label: "Flagged" };
    const days = Math.round((nowMs - new Date(item.lastRatedAt).getTime()) / DAY_MS);
    return days >= STALE_DAYS
      ? { losId: item.losId, reason: "stale", label: `Stale, rated ${days}d ago` }
      : { losId: item.losId, reason: "weak", label: `Weak, rated ${days}d ago` };
  });
}

/** "2h 10m", the header's compact form. */
export function minutesShort(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// The planner's closed vocabulary (PlanTask.kind), in the candidate's words.
const KIND_LABELS: Record<string, string> = {
  "content-notes": "Reading",
  "content-video": "Video",
  eocq: "Questions",
  questions: "Questions",
  "answer-review": "Answer review",
  seminar: "Seminar",
  review: "Review",
  mock: "Mock",
  "mock-review": "Mock review",
};

export function kindLabel(kind: string): string {
  if (KIND_LABELS[kind]) return KIND_LABELS[kind];
  const words = kind.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Whole calendar days from today to the exam, floored at 0. */
export function daysLeft(examDate: string, todayISO: string): number {
  const ms = Date.parse(`${examDate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${todayISO}T00:00:00Z`);
  return Math.max(0, Math.round(ms / DAY_MS));
}

/** Planned cells first; the candidate's own off-plan records follow. Stable. */
export function sortCells<T extends { offPlan: boolean }>(cells: T[]): T[] {
  return [...cells.filter((c) => !c.offPlan), ...cells.filter((c) => c.offPlan)];
}

// Calendar dates from the API are UTC midnights; format in UTC so the day
// never shifts west of Greenwich.
const shortDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "Postponed from Tue 10 Nov" for a cell carrying missed work. */
export function postponedLabel(iso: string): string {
  return `Postponed from ${shortDay.format(new Date(`${iso}T00:00:00Z`)).replace(",", "")}`;
}

/**
 * " EST" when the plan's zone differs from the device's, else "". The debrief
 * is plan-zone wall time, which reads as the wrong hour without it.
 */
export function zoneSuffix(planZone: string, deviceZone: string, nowMs = Date.now()): string {
  if (planZone === deviceZone) return "";
  const name = new Intl.DateTimeFormat("en-US", { timeZone: planZone, timeZoneName: "short" })
    .formatToParts(new Date(nowMs))
    .find((p) => p.type === "timeZoneName")?.value;
  return name ? ` ${name}` : "";
}

const VIDEO_KINDS = new Set(["content-video", "seminar", "eocq", "read"]);
const BASE_MIN_PER_QUESTION = 3;

/**
 * What the plan's speed-up means for this task, in the candidate's terms, or null at
 * normal pace. The engine shortens reading and video by the pace and questions by less.
 */
export function paceHint(kind: string, pace: number | null | undefined): { short: string; long: string } | null {
  if (!pace || pace < 1.1) return null;
  const x = `${pace}x`;
  const why = "The plan speeds this up so everything fits your hours.";
  if (VIDEO_KINDS.has(kind)) return { short: `Watch at ${x}`, long: `Watch or read this at ${x} speed. ${why}` };
  if (kind === "content-notes" || kind === "review") return { short: `Read at ${x}`, long: `Read at ${x} pace: skim what you already know. ${why}` };
  if (kind === "questions") {
    const per = Math.round((BASE_MIN_PER_QUESTION / pace) * 10) / 10;
    return { short: `${per} min a question`, long: `Answer faster: about ${per} min a question instead of ${BASE_MIN_PER_QUESTION}. ${why}` };
  }
  if (kind === "answer-review") return { short: `Review at ${x}`, long: `Review the worked answers faster, at ${x}. ${why}` };
  return { short: `${x} pace`, long: `This runs at ${x} your normal pace. ${why}` };
}
