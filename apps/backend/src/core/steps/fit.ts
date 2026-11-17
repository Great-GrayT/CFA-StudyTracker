import { trimmableMocks, MOCK_REVIEW_MIN, MOCK_SESSION_MIN, type MockSession } from "./mocks";
import {
  estimateLoad, schedule, type DayCap, type ReviewPolicy, type ScheduleResult, type StepOrder,
} from "./schedule";
import type { WorkItem } from "./work";

export const CRASH_LADDER = [1, 1.1, 1.2, 1.3, 1.4, 1.5];
const LOAD_EPS = 1e-9;

export type FitReport = {
  crash: number; cancelledHolidayIds: string[]; feasible: boolean; belowPass: boolean;
  trims: Array<{ readingId: string | null; step: 4 | 5; minutes: number; reason: string }>;
};

export type FitInput = {
  today: string; exam: string;
  caps: DayCap[]; // base caps; days with a holidayId count as zero unless the ladder cancels it
  work: WorkItem[];
  modules: Array<{ readingId: string; topicOrder: number }>;
  mockSessions: MockSession[];
  reviewPolicy: ReviewPolicy; reviewStartDate: string | null; order: StepOrder;
  belowPassAccepted: boolean;
  // Trim order: lowest exam weight first, later curriculum position first on ties.
  weights: Map<string, { examWeight: number; index: number }>;
};
export type FitResult = { result: ScheduleResult; fit: FitReport; work: WorkItem[] };

type ItemUnit = { kind: "items"; ids: string[]; readingId: string; minutes: number; reason: string };
type Unit = ItemUnit | { kind: "mock"; reason: string };

export function fitPlan(i: FitInput): FitResult {
  const effCaps = (cancelled: Set<string>): DayCap[] =>
    i.caps.map((c) => (c.holidayId && !cancelled.has(c.holidayId) ? { ...c, minutes: 0 } : c));

  const run = (k: number, cancelled: Set<string>, work: WorkItem[], mockTrim: number, force: boolean) => {
    const caps = effCaps(cancelled);
    const common = {
      today: i.today, exam: i.exam, caps, work, crash: k, mockSessions: i.mockSessions, mockTrim,
    };
    // Estimate first: a plan that cannot fit by simple capacity needs no full schedule.
    if (!force && estimateLoad(common) > 1 + LOAD_EPS) return null;
    const r = schedule({
      ...common, modules: i.modules, reviewPolicy: i.reviewPolicy, reviewStartDate: i.reviewStartDate, order: i.order,
    });
    return force || !r.unplaced.length ? r : null;
  };
  const report = (o: Partial<FitReport> & { crash: number; cancelled: Set<string> }): FitReport => ({
    crash: o.crash, cancelledHolidayIds: [...o.cancelled], feasible: o.feasible ?? true,
    belowPass: o.belowPass ?? false, trims: o.trims ?? [],
  });

  // 1. Crash pace in six even steps.
  const none = new Set<string>();
  for (const k of CRASH_LADDER) {
    const r = run(k, none, i.work, 0, false);
    if (r) return { result: r, fit: report({ crash: k, cancelled: none }), work: i.work };
  }

  // 2. Cancel holidays, closest to the exam first, one at a time, at the crash ceiling.
  const kMax = CRASH_LADDER[CRASH_LADDER.length - 1];
  const last = new Map<string, string>();
  const base = new Map<string, number>();
  for (const c of i.caps) {
    if (!c.holidayId || c.date < i.today || c.date >= i.exam) continue;
    if (!last.has(c.holidayId) || c.date > last.get(c.holidayId)!) last.set(c.holidayId, c.date);
    base.set(c.holidayId, (base.get(c.holidayId) ?? 0) + c.minutes);
  }
  const holidays = [...last.entries()].filter(([id]) => (base.get(id) ?? 0) > 0)
    .sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0])).map(([id]) => id);
  const cancelled = new Set<string>();
  for (const h of holidays) {
    cancelled.add(h);
    const r = run(kMax, cancelled, i.work, 0, false);
    if (r) return { result: r, fit: report({ crash: kMax, cancelled }), work: i.work };
  }

  // 3. Infeasible. The best plan keeps every cancellation and the full crash.
  if (!i.belowPassAccepted) {
    const r = run(kMax, cancelled, i.work, 0, true)!;
    return { result: r, fit: report({ crash: kMax, cancelled, feasible: false }), work: i.work };
  }

  // Consent given: trim step 4 extras, step 4 base, then mocks. Steps 1 to 3 stay whole.
  const info = (id: string) => i.weights.get(id) ?? { examWeight: 0, index: 0 };
  const byWeight = (a: { readingId: string }, b: { readingId: string }) =>
    info(a.readingId).examWeight - info(b.readingId).examWeight || info(b.readingId).index - info(a.readingId).index;
  const toUnits = (items: WorkItem[]): ItemUnit[] => {
    const ids = new Set(items.map((w) => w.id));
    const out: ItemUnit[] = [];
    for (const w of items) {
      if (w.id.endsWith(":ar") && ids.has(w.id.slice(0, -3))) continue; // travels with its questions
      const group = [w.id];
      const ar = `${w.id}:ar`;
      const arItem = ids.has(ar) ? items.find((x) => x.id === ar)! : null;
      if (arItem) group.push(ar);
      out.push({
        kind: "items", ids: group, readingId: w.readingId,
        minutes: w.minutes + (arItem?.minutes ?? 0), reason: "",
      });
    }
    return out;
  };
  const s4 = i.work.filter((w) => w.step === 4);
  const extras = toUnits(s4.filter((w) => w.extraReason !== null)).sort(byWeight);
  const baseUnits = toUnits(s4.filter((w) => w.extraReason === null)).sort(byWeight);
  extras.forEach((u) => { u.reason = "step 4 extra"; });
  baseUnits.forEach((u) => { u.reason = "step 4 base, lowest exam weight first"; });
  const mockUnits: Unit[] = Array.from({ length: trimmableMocks(i.today, i.exam, i.mockSessions) },
    () => ({ kind: "mock", reason: "mock count, earliest week first" }));
  const units = [...extras, ...baseUnits, ...mockUnits];

  const apply = (n: number) => {
    const gone = new Set<string>();
    let mocks = 0;
    for (const u of units.slice(0, n)) { if (u.kind === "mock") mocks++; else u.ids.forEach((id) => gone.add(id)); }
    return { work: i.work.filter((w) => !gone.has(w.id)), mocks };
  };
  const tryN = (n: number) => { const a = apply(n); return run(kMax, cancelled, a.work, a.mocks, false); };
  // Dropping more work never makes the plan harder to fit, so search the smallest prefix.
  let lo = 0, hi = units.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tryN(mid)) hi = mid; else lo = mid + 1;
  }
  const a = apply(lo);
  const res = tryN(lo) ?? run(kMax, cancelled, a.work, a.mocks, true)!;
  const trims = units.slice(0, lo).map((u): FitReport["trims"][number] => u.kind === "mock"
    ? { readingId: null, step: 5, minutes: 2 * (MOCK_SESSION_MIN + MOCK_REVIEW_MIN), reason: u.reason }
    : { readingId: u.readingId, step: 4, minutes: u.minutes, reason: u.reason });
  return {
    result: res, work: a.work,
    fit: report({ crash: kMax, cancelled, feasible: false, belowPass: true, trims }),
  };
}
