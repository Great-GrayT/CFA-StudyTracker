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

/** "412 h planned, 1,840 questions, 6 mocks"; null for an older server without totals. */
export function planTotalsLine(p: Projection): string | null {
  const t = p.totals;
  if (!t) return null;
  const mocks = p.mocks.done + p.mocks.planned;
  const parts = [`${formatHours(t.requiredMin)} planned`];
  if (t.questions.required > 0) parts.push(`${t.questions.required.toLocaleString("en-US")} questions`);
  if (mocks > 0) parts.push(`${mocks} mock${mocks === 1 ? "" : "s"}`);
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
