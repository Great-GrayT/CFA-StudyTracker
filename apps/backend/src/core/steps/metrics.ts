import { adequateMinutes, step1Minutes } from "./catalog";
import { addDays, diffDays } from "./dates";
import { GATE_DAYS, type ScheduledTask } from "./schedule";
import type { ModuleState } from "./state";
import type { ModuleCatalog, StepNo } from "./types";
import type { WorkItem } from "./work";

export type WindowStatus = "done" | "planned" | "overdue" | "in-progress";
export type ModuleWindow = {
  readingId: string;
  steps: Array<{
    step: StepNo; start: string | null; due: string | null; doneOn: string | null; status: WindowStatus;
  }>;
};
export type DoneOn = Record<string, Partial<Record<StepNo, string>>>;
export type DayPlan = { date: string; minutes: number; byStep: Record<1 | 2 | 3 | 4 | 5, number> };
export type Metrics = {
  readiness: number; readinessPlanToday: number;
  extras: { tasks: number; minutes: number };
  requiredMinutes: number;
  daily: DayPlan[];
};

const STEPS: StepNo[] = [1, 2, 3, 4];

// Full planned minutes of a step for a module; 0 means the step does not apply.
export function plannedMinutes(m: ModuleCatalog, step: StepNo): number {
  if (step === 1) return step1Minutes(m);
  if (step === 3) return m.options[3][0]?.minutes ?? 0;
  return m.options[step].length ? adequateMinutes(m, step) : 0;
}

function passed(st: ModuleState, step: StepNo): boolean {
  return step === 1 ? st.s1.done : step === 2 ? st.s2.passed : step === 3 ? st.s3.done : st.s4.passed;
}
function progressed(st: ModuleState, step: StepNo): boolean {
  return step === 1 ? st.s1.doneMin > 0 : step === 2 ? st.s2.answered > 0
    : step === 3 ? st.s3.doneMin > 0 : st.s4.answered > 0;
}

export function buildWindows(p: {
  cat: ModuleCatalog[]; state: Map<string, ModuleState>; tasks: ScheduledTask[];
  today: string; exam: string; doneOn?: DoneOn;
}): ModuleWindow[] {
  const span = new Map<string, { start: string; due: string }>();
  for (const t of p.tasks) {
    if (t.item.step > 4) continue;
    const key = `${t.item.readingId}|${t.item.step}`;
    const cur = span.get(key);
    if (!cur) span.set(key, { start: t.date, due: t.date });
    else {
      if (t.date < cur.start) cur.start = t.date;
      if (t.date > cur.due) cur.due = t.date;
    }
  }
  const gate = addDays(p.exam, -GATE_DAYS);
  return p.cat.map((m) => {
    const st = p.state.get(m.readingId);
    return {
      readingId: m.readingId,
      steps: STEPS.map((step) => {
        const sp = span.get(`${m.readingId}|${step}`);
        const start = sp?.start ?? null, due = sp?.due ?? null;
        const doneOn = p.doneOn?.[m.readingId]?.[step] ?? null;
        let status: WindowStatus = "planned";
        if (!st) return { step, start, due, doneOn, status };
        if (passed(st, step) || (plannedMinutes(m, step) <= 0 && !sp)) {
          status = "done";
        } else {
          // Past the step's deadline (gate for 1-2, exam for 3-4) or already past its due day.
          const late = (due !== null && due < p.today) || (step <= 2 ? p.today > gate : p.today >= p.exam);
          if (late) status = "overdue";
          else if (progressed(st, step)) status = "in-progress";
        }
        return { step, start, due, doneOn, status };
      }),
    };
  });
}

// Topic completion = sum of done-and-passed step minutes / sum of planned step minutes,
// i.e. each step weighted by its share of the topic's planned minutes. Effort on a step
// that has not passed counts for nothing.
function readiness(cat: ModuleCatalog[], isDone: (id: string, step: StepNo) => boolean): number {
  const topics = new Map<number, { w: number; done: number; plan: number }>();
  for (const m of cat) {
    const t = topics.get(m.topicOrder) ?? { w: m.examWeight, done: 0, plan: 0 };
    for (const s of STEPS) {
      const pm = plannedMinutes(m, s);
      t.plan += pm;
      if (isDone(m.readingId, s)) t.done += pm;
    }
    topics.set(m.topicOrder, t);
  }
  let wSum = 0, acc = 0;
  for (const t of topics.values()) {
    if (t.plan <= 0) continue;
    wSum += t.w;
    acc += t.w * (t.done / t.plan);
  }
  return wSum > 0 ? acc / wSum : 0;
}

export function computeMetrics(p: {
  cat: ModuleCatalog[]; state: Map<string, ModuleState>; windows: ModuleWindow[];
  tasks: ScheduledTask[]; work: WorkItem[]; unplaced: WorkItem[]; today: string; exam: string;
}): Metrics {
  const win = new Map(p.windows.map((w) => [w.readingId, w]));
  const stOf = (id: string, s: StepNo) => {
    const st = p.state.get(id);
    return !!st && passed(st, s);
  };
  const planToday = (id: string, s: StepNo) => {
    if (stOf(id, s)) return true;
    const w = win.get(id)?.steps.find((x) => x.step === s);
    return !!w && (w.status === "overdue" || (w.due !== null && w.due <= p.today));
  };

  const daily: DayPlan[] = [];
  const byDate = new Map<string, DayPlan>();
  for (let d = p.today, n = diffDays(p.today, p.exam); n > 0; n--, d = addDays(d, 1)) {
    const row: DayPlan = { date: d, minutes: 0, byStep: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    daily.push(row);
    byDate.set(d, row);
  }
  let required = 0;
  for (const t of p.tasks) {
    required += t.workMinutes;
    const row = byDate.get(t.date);
    if (!row) continue;
    row.minutes += t.minutes;
    row.byStep[t.item.step] += t.minutes;
  }
  for (const u of p.unplaced) required += u.minutes;

  const extraItems = [...p.work, ...p.unplaced.filter((u) => u.step === 5)].filter((w) => w.extraReason !== null);
  return {
    readiness: readiness(p.cat, stOf),
    readinessPlanToday: readiness(p.cat, planToday),
    extras: { tasks: extraItems.length, minutes: extraItems.reduce((a, w) => a + w.minutes, 0) },
    requiredMinutes: required,
    daily,
  };
}
