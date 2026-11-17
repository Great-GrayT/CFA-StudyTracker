// The projection the Pace page draws: a dry run of the step engine joined with what
// the database already knows (frozen past days, credited minutes, logged answers,
// mock topic scores, holidays), so past and future share one shape.
import { db } from "./db";
import { generateHorizon, horizonVersion, type HorizonResult } from "./FUNC-schedule";
import { plannedMinutes } from "../core/steps/metrics";
import { gateDate } from "../core/steps/schedule";
import type { FitReport, ModuleWindow } from "../core/steps";
import type { StepNo } from "../core/steps/types";

type Counts = { answered: number; correct: number };
type StepKey = "1" | "2" | "3" | "4" | "5";

export type Projection = {
  asOf: string; exam: string; gate: string;
  fit: FitReport;
  sections: Array<{
    topicId: string; name: string; examWeight: number;
    steps: Array<{ step: 1 | 2 | 3 | 4; plannedMin: number; donePassedMin: number; spentUnpassedMin: number; planTodayMin: number }>;
    modules: Array<{ readingId: string; name: string; windows: ModuleWindow["steps"] }>;
    performance: {
      initial: Counts | null; review: Counts | null; mocks: Counts | null;
      extras: { tasks: number; minutes: number };
    };
  }>;
  readiness: number; readinessPlanToday: number;
  daily: Array<{ date: string; plannedMin: number; doneMin: number; byStep: Record<StepKey, number> }>;
  holidays: Array<{ id: string; start: string; end: string; cancelled: boolean }>;
  mocks: { done: number; planned: number; firstDate: string | null };
  extras: Array<{
    taskId: string | null; readingId: string; step: number; reason: string;
    questions: number | null; minutes: number; date: string | null;
  }>;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const STEPS: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];
const emptySteps = (): Record<StepKey, number> => ({ "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 });

// Tasks from before the engine carry no step; the kind says which one they were.
function stepOf(t: { step: number | null; kind: string }): number {
  if (t.step !== null) return t.step;
  if (["read", "content-notes", "content-video", "seminar", "eocq"].includes(t.kind)) return 1;
  if (t.kind === "review") return 3;
  if (t.kind === "questions" || t.kind === "answer-review") return 2;
  return 5;
}

const cache = new Map<string, { key: string; value: Projection }>();

/** Anything a record, declaration, holiday, mock or setting changes moves this string. */
async function fingerprint(planId: string, today: string): Promise<string | null> {
  const plan = await db.studyPlan.findUnique({
    where: { id: planId },
    select: {
      horizonGeneratedFor: true, examDate: true, weeklyAvailability: true, belowPassAccepted: true,
      stepPriority: true, lesReadingHours: true,
      _count: { select: { holidays: true, mockExams: true, stepDeclarations: true } },
    },
  });
  if (!plan) return null;
  const done = await db.planTask.aggregate({
    where: { planId, status: { in: ["done", "partial"] } },
    _count: true, _sum: { actualMinutes: true },
  });
  return JSON.stringify([
    horizonVersion(planId), today, plan.horizonGeneratedFor, plan.examDate, plan.weeklyAvailability,
    plan.belowPassAccepted, plan.stepPriority, plan.lesReadingHours, plan._count, done._count, done._sum.actualMinutes,
  ]);
}

export async function getProjection(planId: string, today: string): Promise<Projection> {
  const key = await fingerprint(planId, today);
  const hit = cache.get(planId);
  if (key && hit && hit.key === key) return hit.value;
  const value = await buildProjection(planId, today);
  if (key) cache.set(planId, { key, value });
  return value;
}

export async function buildProjection(planId: string, today: string): Promise<Projection> {
  const hz: HorizonResult = await generateHorizon(planId, today, { dryRun: true });
  const asOf = hz.today;

  const [readings, topics, holidays, tasks, logs, mockExams, stated] = await Promise.all([
    db.reading.findMany({ where: { id: { in: hz.catalog.map((m) => m.readingId) } }, select: { id: true, name: true } }),
    db.topic.findMany({ where: { id: { in: hz.catalog.map((m) => m.topicId) } }, select: { id: true, name: true } }),
    db.planHoliday.findMany({ where: { planId }, orderBy: { startDate: "asc" } }),
    db.planTask.findMany({ where: { planId }, orderBy: [{ date: "asc" }, { order: "asc" }] }),
    db.studyLogEntry.findMany({
      where: { planId, taskId: { not: null } },
      select: { questionsAnswered: true, questionsCorrect: true, los: { select: { readingId: true } }, task: { select: { step: true, kind: true } } },
    }),
    db.mockExam.findMany({ where: { planId }, select: { topicScores: true } }),
    db.stepDeclaration.findMany({ where: { planId, step: { in: [2, 4] } } }),
  ]);
  const readingName = new Map(readings.map((r) => [r.id, r.name]));
  const topicName = new Map(topics.map((t) => [t.id, t.name]));
  const topicOfReading = new Map(hz.catalog.map((m) => [m.readingId, m.topicId]));
  const windowOf = new Map(hz.windows.map((w) => [w.readingId, w]));

  // Credited minutes: what the candidate actually spent, never more than a done task was planned to take.
  const credit = (t: (typeof tasks)[number]) =>
    t.status === "done" ? (t.actualMinutes ?? t.estimatedMinutes) : t.status === "partial" ? (t.actualMinutes ?? 0) : 0;

  // ---- extras ----------------------------------------------------------------
  const extras: Projection["extras"] = tasks
    .filter((t) => t.extraReason !== null)
    .map((t) => ({
      taskId: t.id, readingId: t.readingIds[0] ?? "", step: stepOf(t), reason: t.extraReason!,
      questions: t.questionCount, minutes: t.estimatedMinutes, date: iso(t.date),
    }));
  // The persisted horizon is 14 days; extras planned beyond it exist only in the dry run.
  const have = new Set(extras.map((e) => `${e.date}|${e.readingId}|${e.step}|${e.reason}`));
  for (const t of hz.tasks) {
    if (t.item.extraReason === null) continue;
    const k = `${t.date}|${t.item.readingId}|${t.item.step}|${t.item.extraReason}`;
    if (have.has(k)) continue;
    extras.push({
      taskId: null, readingId: t.item.readingId, step: t.item.step, reason: t.item.extraReason,
      questions: t.item.questions ? Math.round(t.item.questions * Math.min(1, t.workMinutes / Math.max(1, t.item.minutes))) : null,
      minutes: Math.round(t.minutes), date: t.date,
    });
  }

  // ---- sections ----------------------------------------------------------------
  const spent = new Map<string, number>(); // readingId|step -> credited minutes
  for (const t of tasks) {
    const m = credit(t);
    if (m <= 0 || t.readingIds.length === 0) continue;
    for (const id of t.readingIds) {
      const k = `${id}|${stepOf(t)}`;
      spent.set(k, (spent.get(k) ?? 0) + m / t.readingIds.length);
    }
  }
  const perf = new Map<string, { initial: Counts; review: Counts; mocks: Counts }>();
  const perfOf = (topicId: string) => {
    let p = perf.get(topicId);
    if (!p) perf.set(topicId, (p = { initial: { answered: 0, correct: 0 }, review: { answered: 0, correct: 0 }, mocks: { answered: 0, correct: 0 } }));
    return p;
  };
  for (const l of logs) {
    const topicId = topicOfReading.get(l.los.readingId);
    if (!topicId || !l.task) continue;
    const step = stepOf(l.task);
    const bucket = step === 2 ? "initial" : step === 4 ? "review" : null;
    if (!bucket) continue;
    perfOf(topicId)[bucket].answered += l.questionsAnswered;
    perfOf(topicId)[bucket].correct += l.questionsCorrect;
  }
  for (const d of stated) {
    const topicId = topicOfReading.get(d.readingId);
    if (!topicId) continue;
    const bucket = d.step === 2 ? "initial" : "review";
    perfOf(topicId)[bucket].answered += d.answered ?? 0;
    perfOf(topicId)[bucket].correct += d.correct ?? 0;
  }
  for (const m of mockExams) for (const s of m.topicScores) {
    perfOf(s.topicId).mocks.answered += s.answered;
    perfOf(s.topicId).mocks.correct += s.correct;
  }
  const countsOrNull = (c: Counts) => (c.answered > 0 ? c : null);

  const byTopic = new Map<string, typeof hz.catalog>();
  for (const m of hz.catalog) byTopic.set(m.topicId, [...(byTopic.get(m.topicId) ?? []), m]);
  const sections: Projection["sections"] = [...byTopic.entries()]
    .sort(([, a], [, b]) => a[0]!.topicOrder - b[0]!.topicOrder)
    .map(([topicId, mods]) => {
      mods.sort((a, b) => a.readingOrder - b.readingOrder);
      const steps = STEPS.map((step) => {
        let plannedMin = 0, donePassedMin = 0, spentUnpassedMin = 0, planTodayMin = 0;
        for (const m of mods) {
          const pm = plannedMinutes(m, step as StepNo);
          const w = windowOf.get(m.readingId)?.steps.find((x) => x.step === step);
          plannedMin += pm;
          if (w?.status === "done") {
            donePassedMin += pm;
            planTodayMin += pm;
            continue;
          }
          spentUnpassedMin += Math.min(pm, spent.get(`${m.readingId}|${step}`) ?? 0);
          // Same rule as readinessPlanToday: overdue or due by today counts as owed so far.
          if (w && (w.status === "overdue" || (w.due !== null && w.due <= asOf))) planTodayMin += pm;
        }
        return {
          step, plannedMin: Math.round(plannedMin), donePassedMin: Math.round(donePassedMin),
          spentUnpassedMin: Math.round(spentUnpassedMin), planTodayMin: Math.round(planTodayMin),
        };
      });
      const mine = extras.filter((e) => topicOfReading.get(e.readingId) === topicId);
      const p = perf.get(topicId);
      return {
        topicId, name: topicName.get(topicId) ?? topicId, examWeight: mods[0]!.examWeight, steps,
        modules: mods.map((m) => ({
          readingId: m.readingId, name: readingName.get(m.readingId) ?? m.readingId,
          windows: windowOf.get(m.readingId)?.steps ?? [],
        })),
        performance: {
          initial: p ? countsOrNull(p.initial) : null,
          review: p ? countsOrNull(p.review) : null,
          mocks: p ? countsOrNull(p.mocks) : null,
          extras: { tasks: mine.length, minutes: mine.reduce((a, e) => a + e.minutes, 0) },
        },
      };
    });

  // ---- daily -----------------------------------------------------------------
  const rows = new Map<string, Projection["daily"][number]>();
  const row = (date: string) => {
    let r = rows.get(date);
    if (!r) rows.set(date, (r = { date, plannedMin: 0, doneMin: 0, byStep: emptySteps() }));
    return r;
  };
  // The engine plans only what is still owed, so today's finished work is added back to its plan.
  for (const t of tasks) {
    const date = iso(t.date);
    const finished = t.status === "done" || t.status === "partial";
    if (date < asOf || (date === asOf && finished)) {
      const r = row(date);
      r.plannedMin += t.estimatedMinutes;
      r.byStep[String(stepOf(t)) as StepKey] += t.estimatedMinutes;
    }
    if (finished) row(date).doneMin += credit(t);
  }
  for (const d of hz.metrics.daily) {
    const r = row(d.date);
    r.plannedMin += Math.round(d.minutes);
    for (const k of ["1", "2", "3", "4", "5"] as StepKey[]) r.byStep[k] += Math.round(d.byStep[Number(k) as 1 | 2 | 3 | 4 | 5]);
  }

  const mockTasks = hz.tasks.filter((t) => t.item.kind === "mock");
  return {
    asOf, exam: hz.exam, gate: gateDate(asOf, hz.exam), fit: hz.fit, sections,
    readiness: hz.metrics.readiness, readinessPlanToday: hz.metrics.readinessPlanToday,
    daily: [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)),
    holidays: holidays.map((h) => ({
      id: h.id, start: iso(h.startDate), end: iso(h.endDate), cancelled: hz.fit.cancelledHolidayIds.includes(h.id),
    })),
    mocks: {
      done: mockExams.length,
      planned: new Set(mockTasks.map((t) => t.item.id)).size,
      firstDate: mockTasks.length ? mockTasks.map((t) => t.date).sort()[0]! : null,
    },
    extras,
  };
}
