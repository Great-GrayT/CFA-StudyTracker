// Loads a plan's rows, runs the pure step engine over the whole span to the exam,
// and writes only the next horizon (14 days) as PlanTask rows. Step state is derived
// from history on every call, so undo, edits and self-states can never drift.
import { db } from "./db";
import { parseTuning, rulesOf } from "../core/tuning";
import { OFF_PLAN } from "../core/task-credit";
import { buildCatalog } from "../core/steps/catalog";
import { addDays, diffDays } from "../core/steps/dates";
import { deriveDoneOn } from "../core/steps/done-on";
import { declaredMinutes } from "../core/steps/declared-credit";
import {
  planSteps,
  type DayCap, type FitReport, type Metrics, type MockSession, type ModuleWindow, type ScheduledTask,
} from "../core/steps";
import type { Declaration, HistoryTask, MockResult, ModuleState } from "../core/steps/state";
import type { StepRules } from "../core/steps/rules";
import type { ModuleCatalog } from "../core/steps/types";
import type { WorkItem } from "../core/steps/work";

const HORIZON_DAYS = 14;

type Db = Pick<typeof db, "$executeRaw" | "studyPlan" | "reading" | "planPackage" | "studyPackage" | "packageUnit" | "mockExam" | "packageResource" | "planTask" | "studyLogEntry" | "stepDeclaration" | "planHoliday">;

// Bumped by every real rebuild so cached projections of the plan are dropped.
const rebuilds = new Map<string, number>();
export const horizonVersion = (planId: string) => rebuilds.get(planId) ?? 0;

type StepKey = 1 | 2 | 3 | 4 | 5;
export const DEFAULT_STEP_PRIORITY: Record<StepKey, string[]> = {
  1: ["mm-l2", "kaplan-l2", "cfa-les"],
  2: ["uw-l2-2025", "kaplan-l2", "premium-l2", "cfa-les"],
  3: ["mm-l2", "kaplan-l2", "cfa-les"],
  4: ["premium-l2", "kaplan-l2", "uw-l2-2025", "cfa-les"],
  5: ["premium-l2", "cfa-les", "kaplan-l2"],
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const WEEKDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Plan packages not named in a step's list go last, so a custom or test package still takes part.
export function resolvePriority(raw: unknown, planSlugs: string[]): Record<StepKey, string[]> {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<StepKey, string[]>;
  for (const k of [1, 2, 3, 4, 5] as StepKey[]) {
    const given = src[String(k)];
    const base = Array.isArray(given) && given.every((x) => typeof x === "string")
      ? (given as string[]) : DEFAULT_STEP_PRIORITY[k];
    out[k] = [...base, ...planSlugs.filter((s) => !base.includes(s))];
  }
  return out;
}

/** A task represents real work the candidate already did, so regeneration
 * must never delete or silently overwrite it: a logged study entry, a
 * status that moved off "pending", recorded actual minutes, or a timer
 * that's currently running. */
function isProtectedWork(task: {
  logEntryId: string | null;
  status: string;
  actualMinutes: number | null;
  timerStartedAt: Date | null;
}): boolean {
  return (
    task.logEntryId !== null ||
    task.status !== "pending" ||
    task.actualMinutes !== null ||
    task.timerStartedAt !== null
  );
}

/**
 * The earliest missed day whose work a cell carries: same kind, a shared
 * reading. The engine reshapes work freely, so overlap is the only honest
 * link between a missed cell and the cells that now owe its material.
 */
export function missedOrigin(
  missed: Array<{ date: Date; kind: string; readingIds: string[] }>,
  cell: { kind: string; readingIds: string[] },
): Date | null {
  let earliest: Date | null = null;
  for (const m of missed) {
    if (m.kind !== cell.kind) continue;
    if (!m.readingIds.some((id) => cell.readingIds.includes(id))) continue;
    if (earliest === null || m.date < earliest) earliest = m.date;
  }
  return earliest;
}

type Planned = {
  date: string; kind: string; step: number; round: number; extraReason: string | null;
  mockRef: string | null; resourceIds: string[]; packageId: string | null; readingIds: string[];
  estimatedMinutes: number; workMinutes: number; questionCount: number | null; requiresConfidence: boolean;
};

const sameArr = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function taskMatchesPlan(e: {
  kind: string; step: number | null; round: number | null; extraReason: string | null; mockRef: string | null;
  resourceIds: string[]; packageId: string | null; readingIds: string[]; estimatedMinutes: number;
  workMinutes: number | null; questionCount: number | null; requiresConfidence: boolean;
}, p: Planned): boolean {
  return e.kind === p.kind && e.step === p.step && e.round === p.round && e.extraReason === p.extraReason
    && e.mockRef === p.mockRef && sameArr(e.resourceIds, p.resourceIds) && e.packageId === p.packageId
    && sameArr(e.readingIds, p.readingIds) && e.estimatedMinutes === p.estimatedMinutes
    && e.workMinutes === p.workMinutes && e.questionCount === p.questionCount
    && e.requiresConfidence === p.requiresConfidence;
}

// Pieces of one WorkItem share its question count; cumulative rounding keeps the sum exact.
function toPlanned(tasks: ScheduledTask[]): Planned[] {
  const done = new Map<string, { work: number; q: number }>();
  return tasks.map((t) => {
    const it = t.item;
    let questionCount: number | null = null;
    if (it.questions && it.minutes > 0) {
      const acc = done.get(it.id) ?? { work: 0, q: 0 };
      acc.work += t.workMinutes;
      const cum = Math.round(it.questions * Math.min(1, acc.work / it.minutes));
      questionCount = cum - acc.q;
      acc.q = cum;
      done.set(it.id, acc);
    }
    return {
      date: t.date, kind: it.kind, step: it.step, round: it.round, extraReason: it.extraReason,
      mockRef: it.mockRef ?? null, resourceIds: it.resourceIds, packageId: it.packageId || null,
      readingIds: [it.readingId], estimatedMinutes: Math.max(1, Math.round(t.minutes)),
      workMinutes: Math.max(1, Math.round(t.workMinutes)), questionCount,
      requiresConfidence: it.kind === "read" && it.step === 1,
    };
  });
}

export type HorizonResult = {
  created: number; frozen: number; kept: number; deleted: number;
  planMode: string; reviewPolicy: string;
  rejectedTuning: Array<{ field: string; reason: string }>;
  /** Effective planning date (never before the day the horizon was last built for). */
  today: string; exam: string;
  /** The whole schedule to the exam, not only the 14 persisted days. */
  tasks: ScheduledTask[];
  fit: FitReport; windows: ModuleWindow[]; metrics: Metrics; unplaced: WorkItem[]; load: number;
  relaxedPolicy: boolean;
  catalog: ModuleCatalog[];
  /** Step rules in force for this plan. */
  rules: StepRules;
  state: Map<string, ModuleState>;
  /** Every stated step the engine saw, stored and onboarding-derived, each with its date. */
  declarations: Declaration[];
};

/**
 * Plan a plan: freeze yesterday, replan everything from today with the step engine,
 * write the next `horizonDays` of it. The freeze/delete/write sequence runs in one
 * transaction so a crash can never leave a plan half-regenerated.
 */
export async function generateHorizon(
  planId: string,
  today: string,
  opts: {
    horizonDays?: number;
    /** Plan without writing; the full result comes back for projections. */
    dryRun?: boolean;
  } = {},
): Promise<HorizonResult> {
  if (opts.dryRun) return planAndWrite(db, planId, today, opts);
  // One writer per plan: the history is read inside the transaction, after the lock, so a
  // concurrent record or replan can never leave this run writing from a stale picture.
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${planId}))`;
    return planAndWrite(tx, planId, today, opts);
  }, { timeout: 60000, maxWait: 30000 });
  rebuilds.set(planId, horizonVersion(planId) + 1);
  return result;
}

async function planAndWrite(
  q: Db,
  planId: string,
  today: string,
  opts: {
    horizonDays?: number;
    /** Plan without writing; the full result comes back for projections. */
    dryRun?: boolean;
  } = {},
): Promise<HorizonResult> {
  const plan = await q.studyPlan.findUniqueOrThrow({ where: { id: planId } });

  // A later rebuild "from today" must not put fresh work back onto a day the
  // debrief has already closed.
  if (plan.horizonGeneratedFor && plan.horizonGeneratedFor > today) today = plan.horizonGeneratedFor;

  const parsed = parseTuning({
    ...(plan.tuning && typeof plan.tuning === "object" && !Array.isArray(plan.tuning)
      ? (plan.tuning as Record<string, unknown>) : {}),
    planMode: plan.planMode,
    reviewPolicy: plan.reviewPolicy,
    reviewStartDate: plan.reviewStartDate ? iso(plan.reviewStartDate) : null,
  });
  const tuning = parsed.tuning;
  const exam = iso(plan.examDate);
  const horizonDays = Math.max(1, Math.floor(opts.horizonDays ?? HORIZON_DAYS));
  const todayDate = new Date(`${today}T00:00:00Z`);
  const horizonEnd = new Date(todayDate);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + horizonDays - 1);

  // ---- catalogue ------------------------------------------------------------
  const readings = await q.reading.findMany({
    where: { topic: { levelId: plan.levelId } }, include: { topic: true },
  });
  const planPackages = await q.planPackage.findMany({ where: { planId }, include: { package: true } });
  let pkgs = planPackages.map((p) => p.package);
  // A plan with no packages attached still gets planned, from every catalogue on the level.
  if (pkgs.length === 0) {
    pkgs = await q.studyPackage.findMany({ where: { editions: { some: { levelId: plan.levelId } } } });
  }
  const slugOf = new Map(pkgs.map((p) => [p.id, p.slug ?? p.id]));
  const planSlugs = [...slugOf.values()];
  const priority = resolvePriority(plan.stepPriority, planSlugs);

  const unitRows = await q.packageUnit.findMany({
    where: { edition: { levelId: plan.levelId, packageId: { in: [...slugOf.keys()] } } },
    select: {
      id: true, notesPageCount: true, edition: { select: { packageId: true } },
      readings: { select: { readingId: true } },
      resources: {
        select: { id: true, unitId: true, kind: true, durationSeconds: true, questionCount: true, wordCount: true },
      },
    },
  });
  const catalog = buildCatalog({
    readings: readings.map((r) => ({
      id: r.id, topicId: r.topicId, order: r.order, topicOrder: r.topic.order,
      examWeightMin: r.topic.examWeightMin, examWeightMax: r.topic.examWeightMax,
    })),
    units: unitRows.map((u) => ({
      id: u.id, packageSlug: slugOf.get(u.edition.packageId)!, packageId: u.edition.packageId,
      notesPageCount: u.notesPageCount, readingIds: u.readings.map((x) => x.readingId),
    })),
    resources: unitRows.flatMap((u) => u.resources),
    planPackageSlugs: planSlugs, priority, lesHours: plan.lesReadingHours, rules: rulesOf(tuning),
  });

  // ---- mocks ---------------------------------------------------------------
  const mockExams = await q.mockExam.findMany({
    where: { planId }, include: { topicScores: true }, orderBy: { date: "asc" },
  });
  const doneRef = new Map<string, string>();
  for (const m of mockExams) if (m.sessionRef && !doneRef.has(m.sessionRef)) doneRef.set(m.sessionRef, iso(m.date));
  const mockRes = await q.packageResource.findMany({
    where: { kind: "mock_session", edition: { levelId: plan.levelId, packageId: { in: [...slugOf.keys()] } } },
    select: { id: true, ref: true, title: true, questionCount: true, topicMix: true, edition: { select: { packageId: true } } },
  });
  const rank = (packageId: string) => {
    const i = priority[5].indexOf(slugOf.get(packageId) ?? "");
    return i < 0 ? 99 : i;
  };
  const mockSessions: MockSession[] = mockRes
    .sort((a, b) => rank(a.edition.packageId) - rank(b.edition.packageId)
      || a.ref.localeCompare(b.ref, undefined, { numeric: true }))
    .map((r) => ({
      ref: r.ref, packageId: r.edition.packageId, resourceId: r.id, title: r.title ?? r.ref,
      questionCount: r.questionCount ?? 0,
      topicOrders: r.topicMix && typeof r.topicMix === "object" && !Array.isArray(r.topicMix)
        ? Object.keys(r.topicMix as Record<string, unknown>).map(Number).filter(Number.isFinite) : [],
      done: doneRef.has(r.ref), doneOn: doneRef.get(r.ref) ?? null,
    }));
  const mockResults: MockResult[] = mockExams.map((m) => ({
    date: iso(m.date),
    topicScores: m.topicScores.map((s) => ({ topicId: s.topicId, answered: s.answered, correct: s.correct })),
  }));

  // ---- history ---------------------------------------------------------------
  const taskRows = await q.planTask.findMany({
    where: { planId, status: { in: ["done", "partial"] } },
    include: { logs: { select: { questionsAnswered: true, questionsCorrect: true } } },
  });
  const history: HistoryTask[] = taskRows.map((t) => {
    // Credit = uncrashed work x share of the estimate actually spent (never above 1);
    // tasks from before the engine have no workMinutes, so their estimate stands in.
    const work = t.workMinutes ?? t.estimatedMinutes;
    const spent = t.actualMinutes === null ? null : t.actualMinutes + (t.answerReviewMinutes ?? 0);
    const ratio = spent === null
      ? (t.status === "done" ? 1 : 0)
      : Math.min(1, spent / Math.max(1, t.estimatedMinutes));
    return {
      id: t.id, date: iso(t.date), kind: t.kind, step: t.step, round: t.round, readingIds: t.readingIds,
      status: t.status as "done" | "partial", minutes: work * ratio, estimateMinutes: work,
      answered: t.logs.reduce((a, l) => a + l.questionsAnswered, 0),
      correct: t.logs.reduce((a, l) => a + l.questionsCorrect, 0),
      answerReviewDone: t.answerReviewDone, packageSlug: t.packageId ? slugOf.get(t.packageId) ?? null : null,
    };
  });

  // Prior work declared at onboarding: any read or watch is step 1, answered questions are step 2.
  const declared = await q.studyLogEntry.findMany({
    where: { planId, selfDeclared: true, taskId: null },
    select: {
      confidence: true, questionsAnswered: true, questionsCorrect: true, declaredRead: true,
      declaredWatched: true, date: true, los: { select: { readingId: true } },
    },
  });
  type Acc = { conf: number | null; read: boolean; answered: number; correct: number; readDate: string | null; qDate: string | null };
  const byReading = new Map<string, Acc>();
  const earliest = (cur: string | null, d: string) => (cur === null || d < cur ? d : cur);
  for (const d of declared) {
    const cur = byReading.get(d.los.readingId) ?? { conf: null, read: false, answered: 0, correct: 0, readDate: null, qDate: null };
    if (d.declaredRead || d.declaredWatched) {
      cur.read = true;
      cur.conf = cur.conf === null ? d.confidence : Math.min(cur.conf, d.confidence);
      cur.readDate = earliest(cur.readDate, iso(d.date));
    }
    if (d.questionsAnswered > 0) cur.qDate = earliest(cur.qDate, iso(d.date));
    cur.answered += d.questionsAnswered;
    cur.correct += d.questionsCorrect;
    byReading.set(d.los.readingId, cur);
  }
  const declarations: Declaration[] = [];
  for (const [readingId, d] of byReading) {
    if (d.read) declarations.push({ readingId, step: 1, confidence: d.conf, answered: null, correct: null, date: d.readDate! });
    if (d.answered > 0) {
      declarations.push({ readingId, step: 2, confidence: null, answered: d.answered, correct: d.correct, date: d.qDate! });
    }
  }
  const stated = await q.stepDeclaration.findMany({ where: { planId } });
  // A self-state row restates the form's log rows (prior-work maps one onto the other), so it wins over them.
  const statedKeys = new Set(stated.map((s) => `${s.readingId}|${s.step}`));
  for (let i = declarations.length - 1; i >= 0; i--) {
    if (statedKeys.has(`${declarations[i]!.readingId}|${declarations[i]!.step}`)) declarations.splice(i, 1);
  }
  for (const s of stated) {
    declarations.push({
      readingId: s.readingId, step: s.step as 1 | 2 | 3 | 4, confidence: s.confidence,
      answered: s.answered, correct: s.correct, date: iso(s.date),
    });
  }

  // ---- capacity -----------------------------------------------------------------
  const avail = plan.weeklyAvailability as Record<string, number>;
  // A non-numeric weekday would turn every cap into NaN and corrupt the whole schedule, so refuse it.
  for (const day of WEEKDAY) {
    if (!Number.isFinite(Number(avail?.[day] ?? 0))) {
      throw new Error(`weeklyAvailability.${day} must be hours as a number`);
    }
  }
  const holidays = await q.planHoliday.findMany({ where: { planId } });
  const windowTasks = await q.planTask.findMany({
    where: { planId, date: { gte: todayDate, lte: horizonEnd }, frozen: false },
  });
  // Work already done on a day uses that day's capacity.
  const usedByDate = new Map<string, number>();
  for (const t of windowTasks) {
    if (t.status !== "done" && t.status !== "partial") continue;
    const k = iso(t.date);
    usedByDate.set(k, (usedByDate.get(k) ?? 0) + (t.actualMinutes ?? t.estimatedMinutes) + (t.answerReviewMinutes ?? 0));
  }
  // Stated work counts as study on its day, so a self-state dated today uses today's capacity too.
  const catalogOf = new Map(catalog.map((m) => [m.readingId, m]));
  for (const d of declarations) {
    const m = catalogOf.get(d.readingId);
    if (!m || d.date < today || d.date > iso(horizonEnd)) continue;
    usedByDate.set(d.date, (usedByDate.get(d.date) ?? 0) + declaredMinutes(m, d));
  }
  const caps: DayCap[] = [];
  const nDays = Math.max(0, diffDays(today, exam));
  for (let i = 0; i < nDays; i++) {
    const date = addDays(today, i);
    const base = Math.max(0, Number(avail[WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]] ?? 0)) * 60;
    const hol = holidays.find((h) => iso(h.startDate) <= date && date <= iso(h.endDate));
    caps.push({ date, minutes: Math.max(0, base - (usedByDate.get(date) ?? 0)), holidayId: hol?.id ?? null });
  }

  const result = planSteps({
    today, exam, catalog, history, declarations, mockResults, caps, mockSessions,
    reviewPolicy: tuning.reviewPolicy, reviewStartDate: tuning.reviewStartDate,
    order: tuning.planMode === "curriculum-strict" ? "curriculum-strict" : "curriculum-topic",
    belowPassAccepted: plan.belowPassAccepted,
    doneOn: deriveDoneOn(catalog, history, declarations, mockResults),
  });

  // Only the horizon persists. Protected rows keep their slot and new work takes the free orders,
  // otherwise a recorded task would silently swallow the planned task sharing its order.
  const plannedWin = toPlanned(result.tasks).filter((p) => p.date <= iso(horizonEnd));
  const protectedOrders = new Map<string, Set<number>>();
  for (const t of windowTasks) {
    if (!isProtectedWork(t)) continue;
    const k = iso(t.date);
    if (!protectedOrders.has(k)) protectedOrders.set(k, new Set());
    protectedOrders.get(k)!.add(t.order);
  }
  const slots: Array<{ p: Planned; order: number }> = [];
  const nextOrder = new Map<string, number>();
  for (const p of plannedWin) {
    const taken = protectedOrders.get(p.date);
    let o = nextOrder.get(p.date) ?? 0;
    while (taken?.has(o)) o++;
    nextOrder.set(p.date, o + 1);
    slots.push({ p, order: o });
  }
  const newSlots = new Set(slots.map(({ p, order }) => `${new Date(`${p.date}T00:00:00Z`).getTime()}|${order}`));

  const reported = {
    planMode: tuning.planMode, reviewPolicy: tuning.reviewPolicy,
    rejectedTuning: parsed.rejected.map((r) => ({ field: r.field, reason: r.reason })),
    today, exam, tasks: result.tasks, fit: result.fit, windows: result.windows, metrics: result.metrics,
    unplaced: result.unplaced, load: result.load, relaxedPolicy: result.relaxedPolicy, catalog, rules: rulesOf(tuning), state: result.state, declarations,
  };
  if (opts.dryRun) return { created: 0, frozen: 0, kept: 0, deleted: 0, ...reported };

  const written = await (async (tx: Db) => {
    await tx.studyPlan.update({
      where: { id: planId },
      data: { horizonGeneratedFor: today, fitReport: result.fit as unknown as object },
    });

    let frozenCount = 0;
    const before = await tx.planTask.findMany({ where: { planId, date: { lt: todayDate } } });
    for (const task of before) {
      if (!task.frozen) {
        await tx.planTask.update({ where: { id: task.id }, data: { frozen: true } });
        frozenCount++;
      }
    }

    // Frozen cells left pending were missed; their material is still owed (history credits
    // only done and partial), so the plan below re-places it. This only says which cells carry it.
    const missedCells = await tx.planTask.findMany({
      where: {
        planId, date: { lt: todayDate }, frozen: true, status: "pending",
        OR: [{ insertedBecause: null }, { insertedBecause: { not: OFF_PLAN } }],
      },
      select: { date: true, kind: true, readingIds: true },
    });
    // A miss stays pending forever, so once a later cell of the same kind and module is worked it is settled.
    const worked = await tx.planTask.findMany({
      where: { planId, status: { in: ["done", "partial"] } },
      select: { date: true, kind: true, readingIds: true },
    });
    const missed = missedCells.filter(
      (m) => !worked.some(
        (w) => w.date > m.date && w.kind === m.kind && w.readingIds.some((id) => m.readingIds.includes(id)),
      ),
    );

    const tasksInWindow = await tx.planTask.findMany({
      where: { planId, date: { gte: todayDate, lte: horizonEnd }, frozen: false },
    });

    let deletedCount = 0;
    for (const task of tasksInWindow) {
      if (!newSlots.has(`${task.date.getTime()}|${task.order}`) && !isProtectedWork(task)) {
        await tx.planTask.delete({ where: { id: task.id } });
        deletedCount++;
      }
    }

    let createdCount = 0;
    for (const { p, order } of slots) {
      const date = new Date(`${p.date}T00:00:00Z`);
      const key = `${date.getTime()}|${order}`;
      const postponedFrom = missedOrigin(missed, { kind: p.kind, readingIds: p.readingIds });
      const fields = {
        kind: p.kind, step: p.step, round: p.round, extraReason: p.extraReason, mockRef: p.mockRef,
        resourceIds: p.resourceIds, packageId: p.packageId, readingIds: p.readingIds,
        estimatedMinutes: p.estimatedMinutes, workMinutes: p.workMinutes, questionCount: p.questionCount,
        questionTarget: p.questionCount, requiresConfidence: p.requiresConfidence,
      };
      const existing = tasksInWindow.find((t) => `${t.date.getTime()}|${t.order}` === key);
      if (existing) {
        if (isProtectedWork(existing)) continue;
        if (taskMatchesPlan(existing, p)) {
          if (existing.postponedFrom?.getTime() !== postponedFrom?.getTime()) {
            await tx.planTask.update({ where: { id: existing.id }, data: { postponedFrom } });
          }
          continue;
        }
        await tx.planTask.update({ where: { id: existing.id }, data: { ...fields, postponedFrom } });
        continue;
      }
      await tx.planTask.create({
        data: { planId, date, order, ...fields, postponedFrom, status: "pending", frozen: false },
      });
      createdCount++;
    }

    let keptCount = 0;
    for (const task of tasksInWindow) {
      if (newSlots.has(`${task.date.getTime()}|${task.order}`)) keptCount++;
    }
    return { created: createdCount, frozen: frozenCount, kept: keptCount, deleted: deletedCount };
  })(q);

  return { ...written, ...reported };
}
