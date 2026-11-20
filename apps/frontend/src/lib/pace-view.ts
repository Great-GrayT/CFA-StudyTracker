import type { Projection, ProjectionExtra, ProjectionSection, PlanTotals, ProjectionWindow, StepNo, Tally } from "./types";

// Pure view helpers for the Pace page. Dates are YYYY-MM-DD in the plan's
// own calendar; they are compared as UTC midnights so no time zone shifts them.

export const DAY = 86_400_000;
export type PlanZoom = "exam" | "month" | "week";
export type TrackZoom = PlanZoom | "today";
export type Win = { start: number; end: number };

export const PLAN_ZOOMS: { value: PlanZoom; label: string }[] = [
  { value: "exam", label: "To exam" },
  { value: "month", label: "This month" },
  { value: "week", label: "This week" },
];
export const TRACK_ZOOMS: { value: TrackZoom; label: string }[] = [
  ...PLAN_ZOOMS,
  { value: "today", label: "Today" },
];
export const STEP_LABEL: Record<StepNo, string> = { 1: "Read", 2: "Questions", 3: "Review", 4: "Review Q" };
export const STEPS: StepNo[] = [1, 2, 3, 4];

export function day(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}
export function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The visible span of the plan timeline. Ends are exclusive. */
export function planWindow(zoom: PlanZoom, today: string, exam: string): Win {
  const t = day(today);
  if (zoom === "exam") return { start: t - 6 * DAY, end: Math.max(day(exam) + DAY, t + 7 * DAY) };
  if (zoom === "month") return { start: t - 3 * DAY, end: t + 28 * DAY };
  return { start: t - DAY, end: t + 7 * DAY };
}

/** Percent along the window; not clamped. */
export function pct(ms: number, w: Win): number {
  return ((ms - w.start) / (w.end - w.start)) * 100;
}
export function inWindow(ms: number, w: Win): boolean {
  return ms >= w.start && ms < w.end;
}

/** Left and width in percent of a bar covering start..due (both days inclusive), or null when outside. */
export function barGeometry(
  start: string | null,
  due: string | null,
  w: Win,
): { left: number; width: number } | null {
  if (!due && !start) return null;
  const e = day((due ?? start)!) + DAY;
  const s = start ? day(start) : e - DAY;
  const l = Math.max(0, pct(s, w));
  const r = Math.min(100, pct(e, w));
  if (r <= l) return null;
  return { left: l, width: r - l };
}

/** Where the deadline circle sits (end of the due day), or null when outside. */
export function circlePos(due: string | null, w: Win): number | null {
  if (!due) return null;
  const ms = day(due) + DAY;
  return ms > w.start && ms <= w.end ? pct(ms, w) : null;
}

const monthFmt = new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "short" });
const dayMonthFmt = new Intl.DateTimeFormat("en", { timeZone: "UTC", day: "numeric", month: "short" });
const weekdayFmt = new Intl.DateTimeFormat("en", { timeZone: "UTC", weekday: "short", day: "numeric" });

export function axisTicks(zoom: PlanZoom, w: Win): { pct: number; label: string }[] {
  const out: { pct: number; label: string }[] = [];
  if (zoom === "exam") {
    const d = new Date(w.start);
    d.setUTCDate(1);
    for (d.setUTCMonth(d.getUTCMonth() + 1); d.getTime() < w.end; d.setUTCMonth(d.getUTCMonth() + 1)) {
      out.push({ pct: pct(d.getTime(), w), label: monthFmt.format(d) });
    }
    return out;
  }
  const step = zoom === "month" ? 7 * DAY : DAY;
  const fmt = zoom === "month" ? dayMonthFmt : weekdayFmt;
  for (let t = w.start + DAY; t < w.end; t += step) out.push({ pct: pct(t, w), label: fmt.format(new Date(t)) });
  return out;
}

/** True when any window of the list is drawn inside the span. */
export function hasWorkIn(windows: ProjectionWindow[], w: Win): boolean {
  return windows.some((x) => barGeometry(x.start, x.due, w) !== null);
}

/** One bar per step across a section's modules: earliest start to latest due. */
export function sectionWindows(modules: { windows: ProjectionWindow[] }[]): ProjectionWindow[] {
  return STEPS.flatMap((step) => {
    const ws = modules.flatMap((m) => m.windows.filter((x) => x.step === step));
    if (ws.length === 0) return [];
    const starts = ws.map((x) => x.start ?? x.due).filter((x): x is string => !!x).sort();
    const dues = ws.map((x) => x.due).filter((x): x is string => !!x).sort();
    const last = dues[dues.length - 1] ?? null;
    const allDone = ws.every((x) => x.status === "done");
    const status: ProjectionWindow["status"] = allDone
      ? "done"
      : ws.some((x) => x.status === "overdue")
        ? "overdue"
        : ws.some((x) => x.status === "in-progress")
          ? "in-progress"
          : "planned";
    return [{ step, start: starts[0] ?? null, due: last, doneOn: allDone ? last : null, status }];
  });
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** 0..1 to "4.1%"; whole numbers drop the decimal; never NaN. */
export function formatReadiness(r: number): string {
  const p = Math.round(clamp01(r) * 1000) / 10;
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}
export function formatPercent(r: number): string {
  return `${Math.round(clamp01(r) * 100)}%`;
}
export function formatHours(min: number): string {
  const h = Math.round((Math.abs(min) / 60) * 10) / 10;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** Bar fractions for one step: done and passed, spent but not passed, plan today. */
export function stepFractions(s: ProjectionSection["steps"][number]): { done: number; spent: number; tick: number } {
  if (!(s.plannedMin > 0)) return { done: 0, spent: 0, tick: 0 };
  const done = clamp01(s.donePassedMin / s.plannedMin);
  return {
    done,
    spent: Math.min(1 - done, clamp01(s.spentUnpassedMin / s.plannedMin)),
    tick: clamp01(s.planTodayMin / s.plannedMin),
  };
}

/** Minutes the section trails its plan-today mark by; never negative. */
export function sectionBehindMin(sec: ProjectionSection): number {
  return Math.max(0, sec.steps.reduce((a, s) => a + s.planTodayMin - s.donePassedMin, 0));
}

export function accuracy(t: Tally | null): number | null {
  return t && t.answered > 0 ? t.correct / t.answered : null;
}

/** Lowest first-pass accuracy among sections with answers; null when none. */
export function weakestSection(
  secs: ProjectionSection[],
): { topicId: string; name: string; accuracy: number } | null {
  let best: { topicId: string; name: string; accuracy: number } | null = null;
  for (const s of secs) {
    const a = accuracy(s.performance.initial);
    if (a !== null && (best === null || a < best.accuracy)) best = { topicId: s.topicId, name: s.name, accuracy: a };
  }
  return best;
}

/** Minutes planned minus minutes done over days before today; never negative. */
export function owedMinutes(daily: Projection["daily"], today: string): number {
  let owed = 0;
  for (const d of daily) if (d.date < today) owed += d.plannedMin - d.doneMin;
  return Math.max(0, owed);
}

export type Bucket = {
  key: string;
  label: string;
  plannedMin: number;
  doneMin: number;
  owedMin: number;
  off: boolean;
  startMs: number;
};

function sum(days: Projection["daily"], today: string) {
  let plannedMin = 0;
  let doneMin = 0;
  let owedMin = 0;
  for (const x of days) {
    plannedMin += x.plannedMin;
    doneMin += x.doneMin;
    if (x.date < today) owedMin += Math.max(0, x.plannedMin - x.doneMin);
  }
  return { plannedMin, doneMin, owedMin };
}

const mondayOf = (ms: number) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY;

/** Tracking bars: months to the exam, weeks of this month, days of this week. */
export function trackingBuckets(
  zoom: Exclude<TrackZoom, "today">,
  daily: Projection["daily"],
  holidays: Projection["holidays"],
  today: string,
): Bucket[] {
  const t = day(today);
  const live = holidays.filter((h) => !h.cancelled);
  const isOff = (d: string) => live.some((h) => d >= h.start.slice(0, 10) && d <= h.end.slice(0, 10));
  if (zoom === "week") {
    const m = mondayOf(t);
    return Array.from({ length: 7 }, (_, i) => {
      const date = iso(m + i * DAY);
      const rows = daily.filter((x) => x.date === date);
      return {
        key: date,
        label: weekdayFmt.format(new Date(m + i * DAY)),
        ...sum(rows, today),
        off: isOff(date) || rows.every((r) => r.plannedMin === 0),
        startMs: m + i * DAY,
      };
    });
  }
  if (zoom === "month") {
    const first = new Date(t);
    first.setUTCDate(1);
    const next = new Date(first);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const out: Bucket[] = [];
    for (let w = mondayOf(first.getTime()); w < next.getTime(); w += 7 * DAY) {
      const from = Math.max(w, first.getTime());
      const lo = iso(from);
      const hi = iso(Math.min(w + 7 * DAY, next.getTime()) - DAY);
      out.push({
        key: lo,
        label: dayMonthFmt.format(new Date(from)),
        ...sum(daily.filter((x) => x.date >= lo && x.date <= hi), today),
        off: false,
        startMs: from,
      });
    }
    return out;
  }
  const byMonth = new Map<string, Projection["daily"]>();
  for (const d of daily) {
    const k = d.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), d]);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, rows]) => ({
      key: k,
      label: monthFmt.format(new Date(`${k}-01T00:00:00Z`)),
      ...sum(rows, today),
      off: false,
      startMs: day(`${k}-01`),
    }));
}

/** Running totals for the To exam lines. Done stops at the bucket after today. */
export function cumulative(buckets: Bucket[], todayMs: number): { planned: number[]; done: (number | null)[] } {
  let p = 0;
  let d = 0;
  const planned: number[] = [];
  const done: (number | null)[] = [];
  for (const b of buckets) {
    p += b.plannedMin;
    d += b.doneMin;
    planned.push(p);
    done.push(b.startMs > todayMs ? null : d);
  }
  return { planned, done };
}

export type Moduleish = { windows: ProjectionWindow[] };
/** Windows past their due date and not done, plus any marked overdue. */
export function behindCount(m: Moduleish, today: string): number {
  return m.windows.filter(
    (w) => w.status === "overdue" || (w.status !== "done" && w.due !== null && w.due < today),
  ).length;
}
export type SortMode = "curriculum" | "behind" | "only-behind";
export function sortModules<T extends Moduleish>(mods: T[], mode: SortMode, today: string): T[] {
  if (mode === "curriculum") return mods;
  const withN = mods.map((m, i) => ({ m, i, n: behindCount(m, today) }));
  const kept = mode === "only-behind" ? withN.filter((x) => x.n > 0) : withN;
  return kept.sort((a, b) => b.n - a.n || a.i - b.i).map((x) => x.m);
}

/** A fresh plan has sections but nothing done and nothing recorded. */
export function hasAnyProgress(p: Projection): boolean {
  return (
    p.sections.some((s) => s.steps.some((x) => x.donePassedMin > 0 || x.spentUnpassedMin > 0)) ||
    p.daily.some((d) => d.doneMin > 0)
  );
}

export function moduleHref(topicId: string, readingId: string): string {
  return `/syllabus/${encodeURIComponent(topicId)}?reading=${encodeURIComponent(readingId)}`;
}
export const sectionHref = (topicId: string) => `/syllabus/${encodeURIComponent(topicId)}`;
export const taskHref = (taskId: string) => `/today?task=${encodeURIComponent(taskId)}`;

const shortFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
export function shortDate(isoDate: string | null): string {
  return isoDate ? shortFmt.format(new Date(day(isoDate))) : "";
}

const REASONS: Record<string, string> = {
  "top-up-80": "Top-up to reach 80%",
  "top-up-adequacy": "Top-up for too little practice time",
  "exemption-review": "Review after an exemption from questions",
  "answer-review-owed": "Answer review you skipped",
  "mock-retest": "Retest after a weak mock topic",
  "mock-fail": "Mock below the bar",
};
/** Plain-language reason for an extra task; unknown slugs read as themselves. */
export function reasonText(reason: string): string {
  return REASONS[reason] ?? reason.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export type PerfRow = {
  key: string;
  readingId: string;
  topicId: string;
  label: string;
  step: 2 | 4;
  answered: number;
  correct: number;
  accuracy: number;
  /** Under the 80% bar. */
  low: boolean;
  enough: boolean;
  minutes: number;
  adequateMin: number;
  extras: { taskId: string | null; text: string; reason: string; date: string | null }[];
};

/**
 * One row per module and question step that has attempts. Extras follow their
 * module and step; an extra on another step (an exemption review, say) rides
 * on the module's first row so it is never dropped.
 */
export function perfRows(p: Projection): PerfRow[] {
  const rows: PerfRow[] = [];
  for (const sec of p.sections) {
    for (const m of sec.modules) {
      const first = rows.length;
      for (const step of [2, 4] as const) {
        const x = step === 2 ? m.performance.s2 : m.performance.s4;
        if (!x || x.answered <= 0) continue;
        const acc = x.correct / x.answered;
        rows.push({
          key: `${m.readingId}|${step}`,
          readingId: m.readingId,
          topicId: sec.topicId,
          label: `${sec.name} · ${m.name}`,
          step,
          answered: x.answered,
          correct: x.correct,
          accuracy: acc,
          low: acc * 100 < accuracyTarget(p),
          enough: x.minutes >= x.adequateMin,
          minutes: Math.round(x.minutes),
          adequateMin: Math.round(x.adequateMin),
          extras: p.extras
            .filter((e) => e.readingId === m.readingId && e.step === step)
            .map(extraCell),
        });
      }
      if (rows.length > first) {
        const shown = new Set(rows.slice(first).map((r) => r.step as number));
        const stray = p.extras.filter((e) => e.readingId === m.readingId && !shown.has(e.step));
        rows[first]!.extras.push(...stray.map(extraCell));
      }
    }
  }
  return rows;
}

function extraCell(e: ProjectionExtra) {
  const size = e.questions ? `+${e.questions} q` : `+${Math.round(e.minutes)} min`;
  return {
    taskId: e.taskId,
    text: e.date ? `${size}, due ${shortDate(e.date)}` : size,
    reason: reasonText(e.reason),
    date: e.date,
  };
}

// ---- Plan metrics ----------------------------------------------------------

const DEFAULT_TARGET = 80;
export const accuracyTarget = (p: Projection): number => p.rules?.accuracyTarget ?? DEFAULT_TARGET;

/** "412 h planned, 1,840 questions, 6 mock sessions"; null for an older server without totals. */
export function planTotalsLine(p: Projection): string | null {
  const t = p.totals;
  if (!t) return null;
  const mocks = p.mocks.done + p.mocks.planned;
  const parts = [`${formatHours(t.requiredMin)} planned`];
  if (t.questions.required > 0) parts.push(`${t.questions.required.toLocaleString("en-US")} questions`);
  if (mocks > 0) parts.push(`${mocks} mock session${mocks === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/** Hours per day needed against available; short when the need exceeds what the week allows. */
export function dailyNeed(t: PlanTotals): { needed: number; available: number; short: boolean } {
  return { needed: t.minPerDayNeeded, available: t.minPerDayAvailable, short: t.minPerDayNeeded > t.minPerDayAvailable };
}

export type StepSlice = { key: "1" | "2" | "3" | "4" | "5"; label: string; requiredMin: number; doneMin: number; width: number; done: number };
const SLICE_LABEL: Record<StepSlice["key"], string> = {
  "1": STEP_LABEL[1], "2": STEP_LABEL[2], "3": STEP_LABEL[3], "4": STEP_LABEL[4], "5": "Mocks",
};

/** Required hours by step as shares of the whole bar, with each step's done share of its own slice. */
export function stepSlices(t: PlanTotals): StepSlice[] {
  const keys = ["1", "2", "3", "4", "5"] as const;
  return keys.map((key) => {
    const { requiredMin, doneMin } = t.byStep[key];
    return {
      key, label: SLICE_LABEL[key], requiredMin, doneMin,
      width: t.requiredMin > 0 ? (requiredMin / t.requiredMin) * 100 : 0,
      done: requiredMin > 0 ? clamp01(doneMin / requiredMin) : 0,
    };
  });
}

export type TopicMetric = {
  topicId: string; name: string; examWeight: number;
  plannedMin: number; doneMin: number;
  required: number; answered: number; accuracy: number | null; below: boolean;
};

/** One row per topic. Done is passed plus spent-but-unpassed minutes, as the step bars show. */
export function topicMetrics(p: Projection): TopicMetric[] {
  const target = accuracyTarget(p);
  return p.sections.map((sec) => {
    const q = sec.questions ?? { required: 0, answered: 0, correct: 0 };
    const a = q.answered > 0 ? q.correct / q.answered : null;
    return {
      topicId: sec.topicId, name: sec.name, examWeight: sec.examWeight,
      plannedMin: sec.steps.reduce((x, st) => x + st.plannedMin, 0),
      doneMin: sec.steps.reduce((x, st) => x + st.donePassedMin + st.spentUnpassedMin, 0),
      required: q.required, answered: q.answered, accuracy: a,
      below: a !== null && q.correct * 100 < target * q.answered,
    };
  });
}

/** examWeight is a 0..1 fraction: 0.125 reads "12.5%", 0.08 reads "8%". */
export function formatWeight(w: number): string {
  const v = Math.round(clamp01(w) * 1000) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

export type HourFigures = {
  required: number; scheduled: number; done: number; left: number; unscheduled: number;
  workDays: number; available: number;
  /** Minutes per work day to finish what is scheduled, and to finish everything. */
  perDaySchedule: number; perDayAll: number;
  shortSchedule: boolean; shortAll: boolean;
  /** Why work is outside the schedule; null when none is. */
  reason: string | null;
};

/** Scheduled is the sum of daily rows, the same total Tracking shows as its "to exam" denominator. */
export function hourFigures(p: Projection): HourFigures | null {
  const t = p.totals;
  if (!t) return null;
  const scheduled = p.daily.reduce((a, d) => a + d.plannedMin, 0);
  const left = Math.max(0, scheduled - t.doneMin);
  const unscheduled = Math.max(0, t.requiredMin - t.doneMin - left);
  const wd = t.workDays ?? 0;
  const perDaySchedule = wd > 0 ? left / wd : 0;
  const perDayAll = wd > 0 ? Math.max(0, t.requiredMin - t.doneMin) / wd : 0;
  return {
    required: t.requiredMin, scheduled, done: t.doneMin, left, unscheduled, workDays: wd,
    available: t.minPerDayAvailable, perDaySchedule, perDayAll,
    shortSchedule: perDaySchedule > t.minPerDayAvailable, shortAll: perDayAll > t.minPerDayAvailable,
    reason: unscheduled <= 0 ? null : p.fit.belowPass
      ? "Below-pass plan: step 4 and mocks are trimmed to fit your hours"
      : "Does not fit your available hours",
  };
}

// ---- Plan days ------------------------------------------------------------

const dowFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const monthLongFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
const range = (a: string, b: string) => (a.slice(0, 10) === b.slice(0, 10) ? shortDate(a) : `${shortDate(a)} to ${shortDate(b)}`);
const STEP_KEYS = ["1", "2", "3", "4", "5"] as const;
const oneDp = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** Mock work is step 5 in the data; on screen a sitting and its review are told apart. */
export type SegKey = "1" | "2" | "3" | "4" | "5" | "5r";
export const SEG_LABEL: Record<SegKey, string> = {
  "1": "Read", "2": "Questions", "3": "Review", "4": "Review questions", "5": "Mock session", "5r": "Mock review",
};
const MOCK_SESSION_MIN = 132;
const MOCK_REVIEW_MIN = 66;
/** One full mock is two sessions, each a sitting plus its review. */
export const MOCK_FULL_MIN = 2 * (MOCK_SESSION_MIN + MOCK_REVIEW_MIN);

export type Seg = { key: SegKey; min: number };

/** A day's stack bottom-up. Daily data lumps mock work into step 5, so on a mock day the first 132 min are the sitting and the rest its review. */
export function daySegments(byStep: Partial<Record<string, number>>, mockDay: boolean): Seg[] {
  const out: Seg[] = [];
  for (const key of ["1", "2", "3", "4"] as const) {
    const min = byStep[key] ?? 0;
    if (min > 0) out.push({ key, min });
  }
  const m5 = byStep["5"] ?? 0;
  const sit = mockDay ? Math.min(m5, MOCK_SESSION_MIN) : 0;
  if (sit > 0) out.push({ key: "5", min: sit });
  if (m5 - sit > 0) out.push({ key: "5r", min: m5 - sit });
  return out;
}

export type MockSession = { n: number; s: number; done: boolean };

/** Sessions in date order, two per mock: the 3rd is mock 2 session 1. */
export function mockSessions(p: Projection): Map<string, MockSession> {
  const sorted = [...(p.calendar?.mocks ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  return new Map(sorted.map((m, k) => [m.date.slice(0, 10), { n: Math.floor(k / 2) + 1, s: (k % 2) + 1, done: m.done }]));
}

export type DayEvent = { kind: "today" | "exam" | "gate" | "holiday" | "mock"; text: string; short: string };

export type DayInfo = {
  date: string;
  label: string;
  plannedMin: number;
  /** Null for a future day, where nothing can be done yet. */
  doneMin: number | null;
  steps: { key: SegKey; label: string; min: number }[];
  /** Hours shown as the day's column: the stack total. */
  total: number;
  past: boolean;
  today: boolean;
  exam: boolean;
  /** Inside a live (not cancelled) holiday. */
  holiday: boolean;
  mock: MockSession | null;
  events: DayEvent[];
  /** Concise sentence for a screen reader. */
  text: string;
};
export type PlanDay = DayInfo & { idx: number };

/** Everything the day cursor shows for one day. */
export function dayInfo(p: Projection, isoDate: string, sessions: Map<string, MockSession> = mockSessions(p)): DayInfo {
  const date = isoDate.slice(0, 10);
  const today = p.asOf.slice(0, 10);
  const row = p.daily.find((d) => d.date.slice(0, 10) === date);
  const mock = sessions.get(date) ?? null;
  const steps = daySegments(row?.byStep ?? {}, mock !== null).map((x) => ({ ...x, label: SEG_LABEL[x.key] }));
  const events: DayEvent[] = [];
  const isExam = date === p.exam.slice(0, 10);
  if (date === today) events.push({ kind: "today", text: "Today", short: "Today" });
  if (isExam) events.push({ kind: "exam", text: "Exam day", short: "Exam" });
  if (date === p.gate.slice(0, 10)) events.push({ kind: "gate", text: "Mocks start", short: "Mocks start" });
  let holiday = false;
  for (const h of p.holidays) {
    if (date >= h.start.slice(0, 10) && date <= h.end.slice(0, 10)) {
      holiday ||= !h.cancelled;
      events.push({ kind: "holiday", text: `Holiday ${range(h.start, h.end)}${h.cancelled ? " (cancelled)" : ""}`, short: "Holiday" });
    }
  }
  if (mock) events.push({ kind: "mock", text: `Mock ${mock.n} session ${mock.s}${mock.done ? ", taken" : ""}`, short: "Mock" });
  const plannedMin = row?.plannedMin ?? 0;
  const doneMin = date <= today ? (row?.doneMin ?? 0) : null;
  const label = dowFmt.format(new Date(day(date))).replace(",", "");
  const bits = [
    plannedMin > 0 ? `${formatHours(plannedMin)} planned${steps.length ? `: ${steps.map((x) => `${x.label} ${formatHours(x.min)}`).join(", ")}` : ""}` : "Nothing planned",
    ...(doneMin !== null ? [`${formatHours(doneMin)} done`] : []),
    ...events.map((e) => e.text),
  ];
  return {
    date, label, plannedMin, doneMin, steps, total: steps.reduce((a, x) => a + x.min, 0),
    past: date < today, today: date === today, exam: isExam, holiday, mock, events,
    text: `${label}. ${bits.join(". ")}.`,
  };
}

/** One entry per calendar day from plan start (or the first planned day) to the exam, today always included. */
export function planDays(p: Projection): PlanDay[] {
  const today = day(p.asOf);
  const first = Math.min(day(p.calendar?.start ?? p.daily[0]?.date ?? p.asOf), today);
  const last = Math.max(day(p.exam), today);
  const sessions = mockSessions(p);
  const out: PlanDay[] = [];
  for (let t = first, idx = 0; t <= last; t += DAY, idx++) out.push({ ...dayInfo(p, iso(t), sessions), idx });
  return out;
}

export type MonthBlock = { key: string; label: string; /** Blank cells before day 1 in a Monday-first week. */ lead: number; days: PlanDay[] };

/** Days grouped by month for the calendar grid; a partial first or last month holds only its plan days. */
export function monthGrid(days: PlanDay[]): MonthBlock[] {
  const out: MonthBlock[] = [];
  for (const d of days) {
    const key = d.date.slice(0, 7);
    let m = out[out.length - 1];
    if (!m || m.key !== key) {
      m = { key, label: monthLongFmt.format(new Date(day(d.date))), lead: (new Date(day(d.date)).getUTCDay() + 6) % 7, days: [] };
      out.push(m);
    }
    m.days.push(d);
  }
  return out;
}

/** Month names along the ribbon axis, with the year on the first and on each January. */
export function monthMarks(days: PlanDay[]): { idx: number; label: string }[] {
  const out: { idx: number; label: string }[] = [];
  for (const d of days) {
    if (d.date.slice(8, 10) !== "01" && d.idx !== 0) continue;
    const mo = monthFmt.format(new Date(day(d.date)));
    out.push({ idx: d.idx, label: d.idx === 0 || d.date.slice(5, 7) === "01" ? `${mo} ${d.date.slice(0, 4)}` : mo });
  }
  return out;
}

/** Mock sessions a few days apart would overlap on the whole-plan ribbon, so they share one counted ring. */
export function clusterMocks(ms: { idx: number; done: boolean }[], span = 6): { idx: number; count: number; done: boolean }[] {
  const groups: { idx: number; done: boolean }[][] = [];
  for (const m of [...ms].sort((a, b) => a.idx - b.idx)) {
    const g = groups[groups.length - 1];
    if (g && m.idx - g[0]!.idx <= span) g.push(m);
    else groups.push([m]);
  }
  return groups.map((g) => ({ idx: g.reduce((a, x) => a + x.idx, 0) / g.length, count: g.length, done: g.every((x) => x.done) }));
}

// ---- Budget and ledger ----------------------------------------------------

export type Split = { doneMin: number; aheadMin: number; paceMin: number; cutMin: number };

/** Splits `required` into four parts that always add up to it: done, still ahead, cut, and the rest is the pace saving. */
export function splitMinutes(required: number, done: number, ahead: number, cut: number): Split {
  const cl = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const d = cl(done, required);
  const a = cl(ahead, required - d);
  const c = cl(cut, required - d - a);
  return { doneMin: d, aheadMin: a, cutMin: c, paceMin: required - d - a - c };
}

const aheadOf = (p: Projection, key?: "1" | "2" | "3" | "4" | "5") => {
  const today = p.asOf.slice(0, 10);
  return p.daily.reduce((a, d) => (d.date.slice(0, 10) >= today ? a + (key ? (d.byStep[key] ?? 0) : d.plannedMin) : a), 0);
};
const cutMocksOf = (p: Projection) => p.fit.trims.filter((x) => x.step === 5).length;
const cutReviewOf = (p: Projection) => p.fit.trims.filter((x) => x.step === 4).reduce((a, x) => a + x.minutes, 0);

export type Budget = Split & { requiredMin: number; cutMocks: number; cutReviewMin: number };

/** Where every hour of the full plan went. Only step 4 and mocks are ever cut; any other gap is the faster pace. */
export function budgetSplit(p: Projection): Budget | null {
  const t = p.totals;
  if (!t) return null;
  const cutMocks = cutMocksOf(p);
  const cutReviewMin = cutReviewOf(p);
  return {
    requiredMin: t.requiredMin, cutMocks, cutReviewMin,
    ...splitMinutes(t.requiredMin, t.doneMin, aheadOf(p), cutReviewMin + cutMocks * MOCK_FULL_MIN),
  };
}

/** Axis ticks in hours: round numbers, then the exact total. */
export function budgetTicks(totalMin: number): number[] {
  const h = totalMin / 60;
  if (!(h > 0)) return [0];
  const step = [10, 20, 25, 50, 100, 200, 500, 1000].find((s) => h / s <= 6) ?? 1000;
  const out = [0];
  for (let v = step; v < h * 0.94; v += step) out.push(v);
  out.push(h);
  return out;
}

export type LedgerRow = Split & { key: (typeof STEP_KEYS)[number]; label: string; fullMin: number; cutMocks: number; why: string };

/** One row per step: full plan, done, ahead, saved by pace and cut, with the reason in words. */
export function stepLedger(p: Projection): LedgerRow[] {
  const t = p.totals;
  if (!t) return [];
  const why = new Map((planVsSchedule(p)?.rows ?? []).map((r) => [r.key, r.text]));
  return STEP_KEYS.flatMap((key): LedgerRow[] => {
    const { requiredMin, doneMin } = t.byStep[key];
    const cutMocks = key === "5" ? cutMocksOf(p) : 0;
    if (requiredMin <= 0 && cutMocks === 0) return [];
    const cut = key === "4" ? cutReviewOf(p) : cutMocks * MOCK_FULL_MIN;
    return [{
      key, label: key === "5" ? "Mock exams" : SEG_LABEL[key], fullMin: requiredMin, cutMocks, why: why.get(key) ?? "",
      ...splitMinutes(requiredMin, doneMin, aheadOf(p, key), cut),
    }];
  });
}

/** The one-sentence headline: what the schedule holds of the full plan and what was cut. */
export function verdictLine(p: Projection): string | null {
  const b = budgetSplit(p);
  const f = hourFigures(p);
  if (!b || !f) return null;
  const h0 = (m: number) => (m >= 600 ? String(Math.round(m / 60)) : oneDp(Math.round(m / 6) / 10));
  const pace = p.fit.crash > 1.001 ? ` by studying at ${oneDp(p.fit.crash)}x pace` : "";
  const bits: string[] = [];
  if (b.cutReviewMin > 0) bits.push(`${formatHours(b.cutReviewMin)} of review questions`);
  if (b.cutMocks > 0) bits.push(`${b.cutMocks} ${b.cutMocks === 1 ? "mock" : "mocks"}`);
  const head = f.unscheduled <= 0
    ? `Your plan holds all ${h0(f.required)} hours before the exam${pace}.`
    : `Your plan holds ${h0(f.scheduled)} of ${h0(f.required)} hours${pace}.`;
  if (bits.length) return `${head} Reading and first questions stay whole. The cut is ${bits.join(" and ")}.`;
  return f.unscheduled > 0 ? `${head} The rest does not fit your available hours.` : head;
}

export type KeyFigure = { value: string; note: string; alarm?: boolean };

/** The figures under the ribbon. */
export function keyFigures(p: Projection): KeyFigure[] {
  const t = p.totals;
  const f = hourFigures(p);
  if (!t || !f) return [];
  const n = (x: number) => x.toLocaleString("en-US");
  const out: KeyFigure[] = [
    { value: formatHours(f.scheduled), note: `scheduled to the exam, of ${formatHours(f.required)} in the full plan` },
    { value: formatHours(f.done), note: `done so far, ${formatHours(f.left)} left on schedule` },
  ];
  if (f.workDays > 0) {
    const fit = (x: number) => (x > f.available ? `${formatHours(x - f.available)} more than you have` : `which fits your ${formatHours(f.available)}`);
    out.push(
      { value: `${formatHours(f.perDaySchedule)} a day`, note: `on schedule, ${fit(f.perDaySchedule)}`, alarm: f.shortSchedule },
      { value: `${formatHours(f.perDayAll)} a day`, note: `to finish everything, ${fit(f.perDayAll)}`, alarm: f.shortAll },
    );
  }
  const q = t.questions;
  const target = accuracyTarget(p);
  out.push({
    value: `${n(q.answered)} of ${n(q.required)}`,
    note: q.answered > 0
      ? `questions answered, ${formatPercent(q.correct / q.answered)} correct against a ${target}% target`
      : `questions answered, target accuracy ${target}%`,
    alarm: q.answered > 0 && q.correct * 100 < target * q.answered,
  });
  const sessions = p.calendar?.mocks.length ?? 0;
  const cut = cutMocksOf(p);
  const sched = sessions / 2;
  if (sched + cut > 0) {
    const reasons = [...new Set(p.fit.trims.filter((x) => x.step === 5).map((x) => lowerFirst(reasonText(x.reason))))].join(", ");
    out.push({
      value: `${oneDp(sched)} of ${oneDp(sched + cut)} mocks`,
      note: `scheduled as ${sessions} sessions${cut > 0 ? `, ${cut} cut${reasons ? ` (${reasons})` : ""}` : ""}`,
    });
  }
  return out;
}

// ---- Original plan vs schedule --------------------------------------------

export type PlanRow = {
  key: (typeof STEP_KEYS)[number];
  label: string;
  /** Share of the row's bar that is scheduled, 0..1. */
  kept: number;
  whole: boolean;
  text: string;
};

/** One row per step: the original requirement, what the schedule holds (done work included), and the cut. Null without totals. */
export function planVsSchedule(p: Projection): { rows: PlanRow[]; note: string | null } | null {
  const t = p.totals;
  if (!t) return null;
  const rows = STEP_KEYS.flatMap((key): PlanRow[] => {
    const original = t.byStep[key].requiredMin;
    const scheduled = p.daily.reduce((a, d) => a + (d.byStep[key] ?? 0), 0);
    const label = SLICE_LABEL[key];
    if (key === "5" && p.calendar) {
      // One full mock is two sessions on the calendar.
      const trims = p.fit.trims.filter((x) => x.step === 5);
      const sched = p.calendar.mocks.length / 2;
      const orig = sched + trims.length;
      if (orig <= 0) return [];
      const why = new Map<string, number>();
      for (const x of trims) why.set(x.reason, (why.get(x.reason) ?? 0) + 1);
      const reasons = [...why].map(([r, c]) => (why.size > 1 ? `${c} ${lowerFirst(reasonText(r))}` : lowerFirst(reasonText(r)))).join(", ");
      return [{
        key, label, kept: sched / orig, whole: trims.length === 0,
        text: trims.length === 0 ? "Kept whole" : `${oneDp(orig)} mocks, ${oneDp(sched)} scheduled, ${trims.length} cut (${reasons})`,
      }];
    }
    if (original <= 0) return [];
    // Only step 4 is ever trimmed (fit.trims, in full-pace minutes). Any other gap between
    // required and scheduled hours is the faster pace squeezing the same work into less time.
    const trimmed = key === "4" ? p.fit.trims.filter((x) => x.step === 4).reduce((a, x) => a + x.minutes, 0) : 0;
    const realCut = Math.min(original, trimmed);
    const whole = realCut < 0.5;
    const paced = p.fit.crash > 1.001 ? ` in ${formatHours(scheduled)} at ${oneDp(p.fit.crash)}x pace` : "";
    return [{
      key, label, kept: clamp01((original - realCut) / original), whole,
      text: whole
        ? `${formatHours(original)} kept whole${paced}`
        : `${formatHours(original)} planned, ${formatHours(realCut)} cut, the rest${paced || " scheduled"}`,
    }];
  });
  return {
    rows,
    note: p.fit.belowPass
      ? `Your hours cannot hold the full plan.${p.fit.crash > 1.001 ? ` Study runs at ${oneDp(p.fit.crash)}x your normal pace, so work takes less clock time.` : ""} Only review questions and mocks are cut; reading, first questions and review reading stay whole.`
      : p.fit.crash > 1.001 ? `Study runs at ${oneDp(p.fit.crash)}x your normal pace to fit your hours.` : null,
  };
}
