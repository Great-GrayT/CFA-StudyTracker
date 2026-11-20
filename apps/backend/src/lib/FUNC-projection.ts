// The projection the Pace page draws: a dry run of the step engine joined with what
// the database already knows (frozen past days, credited minutes, logged answers,
// mock topic scores, holidays), so past and future share one shape.
import { db } from "./db";
import { generateHorizon, horizonVersion, type HorizonResult } from "./FUNC-schedule";
import { adequateMinutes } from "../core/steps/catalog";
import { MIN_PER_QUESTION, DEFAULT_RULES, type StepRules } from "../core/steps/rules";
import { adequacyNeeded, adequateQuestionCount } from "../core/steps/work";
import type { ModuleState } from "../core/steps/state";
import { declaredMinutes } from "../core/steps/declared-credit";
import { plannedMinutes } from "../core/steps/metrics";
import { EXTRA_REASONS } from "../core/steps/work";
import { gateDate } from "../core/steps/schedule";
import { addDays, diffDays } from "../core/steps/dates";
import type { FitReport, ModuleWindow } from "../core/steps";
import type { StepNo } from "../core/steps/types";

type Counts = { answered: number; correct: number };
export type StepPerformance = {
  round: number; answered: number; correct: number; minutes: number; adequateMin: number; passed: boolean;
  /** Adequate question count at the first option's rate, 0 with no option. */
  adequateQ: number;
  /** Questions of still-owed top-up work in the current round. */
  extraPendingQ: number;
  /** Minutes per question including answer review, the rate the engine sizes with. */
  perQ: number;
};
type StepKey = "1" | "2" | "3" | "4" | "5";

export type Projection = {
  asOf: string; exam: string; gate: string;
  fit: FitReport;
  rules: StepRules;
  /** Whole-plan figures: steps 1-4 planned minutes plus mock minutes, questions over steps 2 and 4. */
  totals: {
    requiredMin: number; doneMin: number; leftMin: number;
    byStep: Record<StepKey, { requiredMin: number; doneMin: number }>;
    questions: { required: number; answered: number; correct: number };
    daysLeft: number; minPerDayNeeded: number; minPerDayAvailable: number;
    /** Days from today to the exam that are not holidays; the divisor of both per-day figures. */
    workDays: number;
  };
  /** Timeline inputs: plan start and each mock (done or planned) by date. */
  calendar: { start: string; mocks: Array<{ date: string; done: boolean; title: string | null }> };
  sections: Array<{
    topicId: string; name: string; examWeight: number;
    questions: { required: number; answered: number; correct: number };
    steps: Array<{ step: 1 | 2 | 3 | 4; plannedMin: number; donePassedMin: number; spentUnpassedMin: number; planTodayMin: number }>;
    modules: Array<{
      readingId: string; name: string; windows: ModuleWindow["steps"];
      performance: { s2: StepPerformance | null; s4: StepPerformance | null };
      /** Steps 2 and 4, every round, recorded plus stated; mock part is the whole topic's. */
      totals: { answered: number; correct: number; mockAnswered: number; mockCorrect: number };
    }>;
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
export function stepOf(t: { step: number | null; kind: string }): number {
  if (t.step !== null) return t.step;
  if (["read", "content-notes", "content-video", "seminar", "eocq"].includes(t.kind)) return 1;
  if (t.kind === "review") return 3;
  if (t.kind === "questions" || t.kind === "answer-review") return 2;
  return 5;
}

const PENALTY_REASONS: ReadonlySet<string> = new Set(["top-up-80", "exemption-review", "mock-retest"]);

/**
 * Still-owed penalty questions keyed readingId|step|round: planned and unplaced question items
 * tagged top-up-80, exemption-review or mock-retest. top-up-adequacy is part of m, not a penalty.
 * One item can span several days, so each id is counted once.
 */
export function owedExtraQuestions(hz: HorizonResult): Map<string, number> {
  const owedQ = new Map<string, number>();
  const seen = new Set<string>();
  for (const it of [...hz.tasks.map((t) => t.item), ...hz.unplaced]) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    if (!it.extraReason || !PENALTY_REASONS.has(it.extraReason) || it.kind !== "questions" || (it.step !== 2 && it.step !== 4)) continue;
    const k = `${it.readingId}|${it.step}|${it.round}`;
    owedQ.set(k, (owedQ.get(k) ?? 0) + (it.questions ?? 0));
  }
  return owedQ;
}

/**
 * m: questions the round needs for adequacy (shared with the engine's sizing). q: owed penalty
 * questions beyond the adequacy part, since one item covers both when accuracy sets the count.
 */
export function questionStats(
  m: HorizonResult["catalog"][number], step: 2 | 4, st: ModuleState, owedQ: Map<string, number>,
): { adequateQ: number; extraPendingQ: number; perQ: number } {
  const o = m.options[step][0];
  const perQ = o ? (o.minutesPerQuestion ?? MIN_PER_QUESTION) + (o.answerReviewPerQuestion ?? MIN_PER_QUESTION / 3) : 0;
  const r = step === 2 ? st.s2 : st.s4;
  const owed = owedQ.get(`${m.readingId}|${step}|${r.round}`) ?? 0;
  return {
    adequateQ: adequateQuestionCount(m, step, st),
    extraPendingQ: Math.max(0, owed - adequacyNeeded(m, step, st)),
    perQ,
  };
}

const CACHE_MAX = 200;
// Map keeps insertion order, so re-inserting on a hit makes the first key the least recently used.
const cache = new Map<string, { key: string; value: Projection }>();
function remember(planId: string, entry: { key: string; value: Projection }) {
  cache.delete(planId);
  cache.set(planId, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/**
 * Anything a record, declaration, holiday, mock or setting changes moves this string. Each table
 * contributes its row count, newest updatedAt and the sums an edit-in-place moves, so an upsert that
 * keeps the count (or lands in the same clock tick) still changes the key. Read from the database, so
 * every server process agrees.
 */
async function fingerprint(planId: string, today: string): Promise<string | null> {
  const [plan, tasks, logs, decls, holidays, mocks, scores] = await Promise.all([
    db.studyPlan.findUnique({
      where: { id: planId },
      select: {
        horizonGeneratedFor: true, examDate: true, weeklyAvailability: true, belowPassAccepted: true,
        stepPriority: true, lesReadingHours: true, updatedAt: true,
      },
    }),
    db.planTask.aggregate({
      where: { planId, status: { in: ["done", "partial"] } },
      _count: true, _max: { updatedAt: true }, _sum: { actualMinutes: true, answerReviewMinutes: true },
    }),
    db.studyLogEntry.aggregate({
      where: { planId },
      _count: true, _max: { updatedAt: true }, _sum: { questionsAnswered: true, questionsCorrect: true, confidence: true },
    }),
    db.stepDeclaration.aggregate({
      where: { planId },
      _count: true, _max: { updatedAt: true }, _sum: { answered: true, correct: true, confidence: true },
    }),
    db.planHoliday.aggregate({ where: { planId }, _count: true, _max: { updatedAt: true } }),
    db.mockExam.aggregate({ where: { planId }, _count: true, _max: { updatedAt: true }, _sum: { scorePercent: true } }),
    db.mockTopicScore.aggregate({
      where: { mockExam: { planId } },
      _count: true, _max: { updatedAt: true }, _sum: { answered: true, correct: true },
    }),
  ]);
  if (!plan) return null;
  const holidayDates = await db.planHoliday.findMany({
    where: { planId }, select: { startDate: true, endDate: true }, orderBy: { startDate: "asc" },
  });
  return JSON.stringify([
    "projection-v3", horizonVersion(planId), today, plan, tasks, logs, decls, holidays, mocks, scores,
    holidayDates.map((h) => [h.startDate, h.endDate]),
  ]);
}

export async function getProjection(planId: string, today: string): Promise<Projection> {
  const key = await fingerprint(planId, today);
  const hit = cache.get(planId);
  if (key && hit && hit.key === key) {
    remember(planId, hit);
    return hit.value;
  }
  const value = await buildProjection(planId, today);
  if (key) remember(planId, { key, value });
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
      where: { planId, OR: [{ taskId: { not: null } }, { selfDeclared: true }] },
      select: {
        taskId: true, questionsAnswered: true, questionsCorrect: true,
        los: { select: { readingId: true } }, task: { select: { step: true, kind: true } },
      },
    }),
    db.mockExam.findMany({ where: { planId }, select: { topicScores: true, date: true, sessionRef: true, note: true } }),
    db.stepDeclaration.findMany({ where: { planId, step: { in: [2, 4] } } }),
  ]);
  const readingName = new Map(readings.map((r) => [r.id, r.name]));
  const topicName = new Map(topics.map((t) => [t.id, t.name]));
  const topicOfReading = new Map(hz.catalog.map((m) => [m.readingId, m.topicId]));
  const windowOf = new Map(hz.windows.map((w) => [w.readingId, w]));

  // Credited minutes: what the candidate actually spent, never more than a done task was planned to take.
  const credit = (t: (typeof tasks)[number]) =>
    t.status === "done" ? (t.actualMinutes ?? t.estimatedMinutes) + (t.answerReviewMinutes ?? 0)
      : t.status === "partial" ? (t.actualMinutes ?? 0) : 0;

  // ---- extras ----------------------------------------------------------------
  // Work added by under-performance or owed answer review, one entry per work item. Finished extras
  // come from the rows (the engine plans only what is still owed); everything still owed comes from
  // the dry run, which covers the persisted horizon as well, so no piece is counted twice.
  const extras: Projection["extras"] = tasks
    .filter((t) => EXTRA_REASONS.has(t.extraReason ?? "") && (t.status === "done" || t.status === "partial"))
    .map((t) => ({
      taskId: t.id, readingId: t.readingIds[0] ?? "", step: stepOf(t), reason: t.extraReason!,
      questions: t.questionCount, minutes: t.estimatedMinutes, date: iso(t.date),
    }));
  const owed = new Map<string, Projection["extras"][number]>();
  for (const t of hz.tasks) {
    const it = t.item;
    if (!EXTRA_REASONS.has(it.extraReason ?? "")) continue;
    const e = owed.get(it.id);
    if (e) { e.minutes += Math.round(t.minutes); continue; }
    owed.set(it.id, {
      taskId: null, readingId: it.readingId, step: it.step, reason: it.extraReason!,
      questions: it.questions ?? null, minutes: Math.round(t.minutes), date: t.date,
    });
  }
  for (const u of hz.unplaced) {
    if (!EXTRA_REASONS.has(u.extraReason ?? "") || owed.has(u.id)) continue;
    owed.set(u.id, {
      taskId: null, readingId: u.readingId, step: u.step, reason: u.extraReason!,
      questions: u.questions ?? null, minutes: Math.round(u.minutes), date: null,
    });
  }
  extras.push(...owed.values());

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
  const readingTotals = new Map<string, Counts>();
  const totalsOf = (readingId: string) => {
    let c = readingTotals.get(readingId);
    if (!c) readingTotals.set(readingId, (c = { answered: 0, correct: 0 }));
    return c;
  };
  // Prior-work writes a self-declared log row and a StepDeclaration for the same answers; the
  // declaration wins, as in the engine, so those answers are counted once.
  const statedStep = new Set(stated.map((d) => `${d.readingId}|${d.step}`));
  for (const l of logs) {
    const topicId = topicOfReading.get(l.los.readingId);
    if (!topicId) continue;
    // A taskId-null selfDeclared row is a step 2 prior-work answer.
    if (!l.task && statedStep.has(`${l.los.readingId}|2`)) continue;
    const step = l.task ? stepOf(l.task) : 2;
    const bucket = step === 2 ? "initial" : step === 4 ? "review" : null;
    if (!bucket) continue;
    const rt = totalsOf(l.los.readingId);
    rt.answered += l.questionsAnswered;
    rt.correct += l.questionsCorrect;
    perfOf(topicId)[bucket].answered += l.questionsAnswered;
    perfOf(topicId)[bucket].correct += l.questionsCorrect;
  }
  for (const d of stated) {
    const topicId = topicOfReading.get(d.readingId);
    if (!topicId) continue;
    const bucket = d.step === 2 ? "initial" : "review";
    const rt = totalsOf(d.readingId);
    rt.answered += d.answered ?? 0;
    rt.correct += d.correct ?? 0;
    perfOf(topicId)[bucket].answered += d.answered ?? 0;
    perfOf(topicId)[bucket].correct += d.correct ?? 0;
  }
  for (const m of mockExams) for (const s of m.topicScores) {
    perfOf(s.topicId).mocks.answered += s.answered;
    perfOf(s.topicId).mocks.correct += s.correct;
  }
  const countsOrNull = (c: Counts) => (c.answered > 0 ? c : null);

  const owedQ = owedExtraQuestions(hz);

  // Null until the step has an attempt or is passed, so the table shows a dash rather than 0 of 0.
  const stepPerf = (m: (typeof hz.catalog)[number], step: 2 | 4): StepPerformance | null => {
    const st = hz.state.get(m.readingId);
    const r = st?.[step === 2 ? "s2" : "s4"];
    if (!st || !r) return null;
    const { adequateQ, extraPendingQ, perQ } = questionStats(m, step, st, owedQ);
    // Shown from the start when the step has a question option, so Today can say 0 of m.
    if ((adequateQ <= 0 && !r.passed && r.answered === 0 && r.minutes === 0)) return null;
    return {
      round: r.round, answered: r.answered, correct: r.correct, minutes: Math.round(r.minutes),
      adequateMin: Math.round(adequateMinutes(m, step)), passed: r.passed,
      adequateQ, extraPendingQ, perQ,
    };
  };

  // Questions the plan asks for over steps 2 and 4, at the first option's rate; 0 without an option.
  const requiredQ = (m: (typeof hz.catalog)[number]) => ([2, 4] as const).reduce((a, step) => {
    const o = m.options[step][0];
    const perQ = o ? (o.minutesPerQuestion ?? MIN_PER_QUESTION) + (o.answerReviewPerQuestion ?? MIN_PER_QUESTION / 3) : 0;
    return a + (perQ > 0 ? Math.ceil(adequateMinutes(m, step) / perQ - 1e-9) : 0);
  }, 0);

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
        questions: {
          required: mods.reduce((a, m) => a + requiredQ(m), 0),
          answered: mods.reduce((a, m) => a + (readingTotals.get(m.readingId)?.answered ?? 0), 0),
          correct: mods.reduce((a, m) => a + (readingTotals.get(m.readingId)?.correct ?? 0), 0),
        },
        modules: mods.map((m) => ({
          readingId: m.readingId, name: readingName.get(m.readingId) ?? m.readingId,
          windows: windowOf.get(m.readingId)?.steps ?? [],
          performance: {
            s2: stepPerf(m, 2),
            s4: stepPerf(m, 4),
          },
          totals: {
            answered: readingTotals.get(m.readingId)?.answered ?? 0,
            correct: readingTotals.get(m.readingId)?.correct ?? 0,
            mockAnswered: p?.mocks.answered ?? 0,
            mockCorrect: p?.mocks.correct ?? 0,
          },
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
  // Stated work counts as study on its date, at the minutes the engine credits it with.
  const catalogOf = new Map(hz.catalog.map((m) => [m.readingId, m]));
  for (const d of hz.declarations) {
    const m = catalogOf.get(d.readingId);
    const min = m ? Math.round(declaredMinutes(m, d)) : 0;
    if (min > 0) row(d.date).doneMin += min;
  }
  for (const d of hz.metrics.daily) {
    const r = row(d.date);
    r.plannedMin += Math.round(d.minutes);
    for (const k of ["1", "2", "3", "4", "5"] as StepKey[]) r.byStep[k] += Math.round(d.byStep[Number(k) as 1 | 2 | 3 | 4 | 5]);
  }

  // ---- totals ----------------------------------------------------------------
  // Done minutes follow the daily rows (credited plus stated), split by step.
  const doneByStep = emptySteps();
  for (const t of tasks) if (t.status === "done" || t.status === "partial") doneByStep[String(stepOf(t)) as StepKey] += credit(t);
  for (const d of hz.declarations) {
    const m = catalogOf.get(d.readingId);
    if (m) doneByStep[String(d.step) as StepKey] += Math.round(declaredMinutes(m, d));
  }
  const reqByStep = emptySteps();
  for (const s of sections) for (const st of s.steps) reqByStep[String(st.step) as StepKey] += st.plannedMin;
  for (const d of rows.values()) reqByStep["5"] += d.byStep["5"];
  const byStep = Object.fromEntries((["1", "2", "3", "4", "5"] as StepKey[]).map((k) => [k, {
    requiredMin: Math.round(reqByStep[k]), doneMin: Math.round(doneByStep[k]),
  }])) as Projection["totals"]["byStep"];
  const requiredMin = Object.values(byStep).reduce((a, x) => a + x.requiredMin, 0);
  const doneMin = Object.values(byStep).reduce((a, x) => a + x.doneMin, 0);
  // The engine's own remaining work, so penalty extras and unplaced work count as left.
  const leftMin = Math.round(hz.metrics.requiredMinutes);
  // Same day arithmetic as the scheduler's caps: weekday hours, none on a holiday that still stands.
  const plan = await db.studyPlan.findUnique({ where: { id: planId }, select: { weeklyAvailability: true, startDate: true } });
  const avail = (plan?.weeklyAvailability ?? {}) as Record<string, number>;
  const WEEKDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const live = holidays.filter((h) => !hz.fit.cancelledHolidayIds.includes(h.id));
  const daysLeft = Math.max(0, diffDays(asOf, hz.exam));
  let workDays = 0, availMin = 0;
  for (let i = 0; i < daysLeft; i++) {
    const date = addDays(asOf, i);
    if (live.some((h) => iso(h.startDate) <= date && date <= iso(h.endDate))) continue;
    workDays++;
    availMin += Math.max(0, Number(avail[WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]!] ?? 0) || 0) * 60;
  }
  const allMods = sections.flatMap((s) => s.questions);
  const questions = {
    required: allMods.reduce((a, q) => a + q.required, 0),
    answered: allMods.reduce((a, q) => a + q.answered, 0),
    correct: allMods.reduce((a, q) => a + q.correct, 0),
  };

  const mockTasks = hz.tasks.filter((t) => t.item.kind === "mock");
  return {
    asOf, exam: hz.exam, gate: gateDate(asOf, hz.exam), fit: hz.fit, sections,
    rules: hz.rules ?? DEFAULT_RULES,
    totals: {
      requiredMin, doneMin, leftMin, byStep, questions, daysLeft,
      minPerDayNeeded: workDays > 0 ? Math.round(leftMin / workDays) : 0,
      minPerDayAvailable: workDays > 0 ? Math.round(availMin / workDays) : 0,
      workDays,
    },
    calendar: {
      start: plan ? iso(plan.startDate) : asOf,
      mocks: [
        ...mockExams.map((m) => ({ date: iso(m.date), done: true, title: m.sessionRef ?? m.note ?? null })),
        // One dot per planned mock day; a mock split over days keeps its first.
        ...[...new Map([...mockTasks].sort((a, b) => a.date.localeCompare(b.date)).map((t) => [t.date, t])).values()]
          .map((t) => ({ date: t.date, done: false, title: t.item.label || null })),
      ].sort((a, b) => a.date.localeCompare(b.date)),
    },
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
