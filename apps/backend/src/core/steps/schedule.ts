import { addDays, dayNum, weekStart } from "./dates";
import {
  eligibleFrom, mockDemandMinutes, MIN_PIECE, placeMocks, type MockPlacement, type MockSession,
} from "./mocks";
import { EPS } from "./rules";
import type { WorkItem } from "./work";

export { MIN_PIECE };
export const GATE_DAYS = 30;
export const WEEKLY_REVIEW_SHARE = 0.2;
export const DECAY_DAYS = 14;

export type DayCap = { date: string; minutes: number; holidayId: string | null };
export type ReviewPolicy = "decay-triggered" | "after-coverage" | "weekly-interleave" | "fixed-date";
export type StepOrder = "curriculum-topic" | "curriculum-strict";
export type ScheduledTask = {
  date: string; order: number; item: WorkItem;
  minutes: number;     // scheduled (crashed) minutes of this piece
  workMinutes: number; // uncrashed equivalent, for history credit
};
export type ScheduleInput = {
  today: string; exam: string;
  caps: DayCap[]; // effective caps: holidays already zeroed by the caller
  work: WorkItem[];
  crash?: number;
  modules: Array<{ readingId: string; topicOrder: number }>;
  mockSessions: MockSession[];
  mockTrim?: number;
  reviewPolicy: ReviewPolicy; reviewStartDate: string | null;
  order: StepOrder;
};
export type ScheduleResult = {
  tasks: ScheduledTask[]; load: number; unplaced: WorkItem[]; relaxedPolicy: boolean;
};

// Reading and video get faster; questions get fewer minutes each (spec fit ladder).
export function crashFactor(item: WorkItem, k: number): number {
  if (item.kind === "read" || item.kind === "review") return 1 / k;
  if (item.kind === "questions" || item.kind === "answer-review") return 1 - 0.5 * (k - 1);
  return 1;
}

// Steps 1-2 finish 30 days out. A plan born inside the window has no separate gate:
// everything must finish before the exam, steps 1-2 still first.
export function gateDate(today: string, exam: string): string {
  const g = addDays(exam, -GATE_DAYS);
  return g >= today ? g : addDays(exam, -1);
}

const ratio = (r: number, c: number) => (r <= EPS ? 0 : c <= EPS ? Infinity : r / c);

const exempt = (i: WorkItem) => i.extraReason === "exemption-review" || i.extraReason === "mock-retest";

// Cheap necessary condition used to prune the fit ladder; mocks count as demand
// against total capacity only (they all sit after the gate).
export function estimateLoad(p: {
  today: string; exam: string; caps: DayCap[]; work: WorkItem[]; crash?: number;
  mockSessions: MockSession[]; mockTrim?: number;
}): number {
  const k = p.crash ?? 1;
  const gate = gateDate(p.today, p.exam);
  let r12 = 0, rall = mockDemandMinutes(p.today, p.exam, p.mockSessions, p.mockTrim ?? 0);
  for (const w of p.work) {
    const m = w.minutes * crashFactor(w, k);
    rall += m;
    if (w.step <= 2) r12 += m;
  }
  let c12 = 0, call = 0;
  for (const c of p.caps) {
    if (c.date < p.today || c.date >= p.exam) continue;
    call += c.minutes;
    if (c.date <= gate) c12 += c.minutes;
  }
  return Math.max(ratio(r12, c12), ratio(rall, call));
}

type Node = {
  item: WorkItem; total: number; rem: number; pending: number; succ: number[];
  finish: string | null; gated: boolean; step: number;
};
type Piece = { date: string; n: number; m: number };
type Run = { pieces: Piece[]; nodes: Node[]; unplaced: Node[]; load: number; relaxed: boolean };

function runPasses(p: {
  days: DayCap[]; work: WorkItem[]; k: number; today: string; exam: string;
  reviewPolicy: ReviewPolicy; reviewStartDate: string | null; order: StepOrder;
}): Run {
  const gate = gateDate(p.today, p.exam);
  const gateN = dayNum(gate);
  const idx = new Map<string, number>();
  p.work.forEach((w, i) => idx.set(w.id, i));

  // Group 1 = steps 1-2 plus anything they transitively wait on (exemption reviews).
  const g1 = new Set<number>();
  const mark = (i: number) => {
    if (g1.has(i)) return;
    g1.add(i);
    for (const a of p.work[i].after) { const j = idx.get(a); if (j !== undefined) mark(j); }
  };
  p.work.forEach((w, i) => { if (w.step <= 2) mark(i); });
  const prio = p.work.map((_, i) => i);
  if (p.order === "curriculum-topic") prio.sort((a, b) => (+!g1.has(a)) - (+!g1.has(b)) || a - b);

  const capSum = p.days.reduce((a, c) => a + c.minutes, 0);
  const c12 = p.days.reduce((a, c) => a + (c.date <= gate ? c.minutes : 0), 0);
  let r12 = 0, rall = 0;
  for (const w of p.work) {
    const m = w.minutes * crashFactor(w, p.k);
    rall += m;
    if (w.step <= 2) r12 += m;
  }
  const f = Math.max(ratio(r12, c12), ratio(rall, capSum));
  const weekCap = new Map<string, number>();
  for (const c of p.days) { const w = weekStart(c.date); weekCap.set(w, (weekCap.get(w) ?? 0) + c.minutes); }

  // Retry with a higher load factor, then with the review policy relaxed, so
  // dependency and policy timing never strand work that capacity could hold.
  const factors: Array<[number, boolean]> = f >= 1 - EPS
    ? [[1, false], [1, true]]
    : [[f, false], [(f + 1) / 2, false], [1, false], [1, true]];

  let last!: Run;
  for (const [ff, relax] of factors) {
    last = onePass(ff, relax);
    if (!last.unplaced.length) break;
  }
  return last;

  function onePass(ff: number, relax: boolean): Run {
    const nodes: Node[] = p.work.map((w) => {
      const total = w.minutes * crashFactor(w, p.k);
      return {
        item: w, total, rem: total, pending: 0, succ: [], finish: null,
        gated: (w.step === 3 || w.step === 4) && !exempt(w), step: w.step,
      };
    });
    const modS2 = new Map<string, number>(), modS2Fin = new Map<string, string>();
    let s2Rem = 0, s2Fin: string | null = null, s12Rem = 0;
    const weekUsed = new Map<string, number>();
    const pieces: Piece[] = [];

    // Zero-minute items never run; they count as finished from the start.
    nodes.forEach((nd, i) => {
      if (nd.total <= EPS) nd.finish = "";
      for (const a of nd.item.after) {
        const j = idx.get(a);
        if (j !== undefined) { nodes[j].succ.push(i); if (nodes[j].total > EPS) nd.pending++; }
      }
      if (nd.total > EPS) {
        if (nd.step === 2) { s2Rem++; modS2.set(nd.item.readingId, (modS2.get(nd.item.readingId) ?? 0) + 1); }
        if (nd.step <= 2) s12Rem++;
      }
    });

    const finishNode = (n: number, date: string) => {
      const nd = nodes[n];
      nd.finish = date;
      if (nd.step === 2) {
        const left = (modS2.get(nd.item.readingId) ?? 0) - 1;
        modS2.set(nd.item.readingId, left);
        if (left <= 0) modS2Fin.set(nd.item.readingId, date);
        if (--s2Rem <= 0) s2Fin = date;
      }
      if (nd.step <= 2) s12Rem--;
      for (const s of nd.succ) nodes[s].pending--;
    };

    // Unused quota carries forward so a tiny load factor still yields >= 15 min pieces.
    let budget = 0;
    let lo = 0;
    for (const day of p.days) {
      const dN = dayNum(day.date);
      const wk = weekStart(day.date);
      budget += day.minutes * Math.min(ff, 1);
      let dayLeft = Math.min(day.minutes, budget);
      const start = dayLeft;
      while (dayLeft > EPS) {
        let pick = -1, take = 0;
        while (lo < prio.length && nodes[prio[lo]].rem <= EPS) lo++;
        for (let q = lo; q < prio.length; q++) {
          const n = prio[q];
          const nd = nodes[n];
          if (nd.rem <= EPS || nd.pending > 0) continue;
          if (nd.step <= 2 && dN > gateN) continue;
          let limit = Infinity;
          if (nd.gated && !relax) {
            if (p.reviewPolicy === "decay-triggered") {
              const fin = modS2Fin.get(nd.item.readingId);
              if (fin !== undefined && dN < dayNum(fin) + DECAY_DAYS) continue;
              if ((modS2.get(nd.item.readingId) ?? 0) > 0) continue;
            } else if (p.reviewPolicy === "after-coverage") {
              if (s2Rem > 0 || (s2Fin !== null && dN <= dayNum(s2Fin))) continue;
            } else if (p.reviewPolicy === "fixed-date") {
              if (p.reviewStartDate && day.date < p.reviewStartDate) continue;
            } else if (s12Rem > 0) {
              limit = WEEKLY_REVIEW_SHARE * (weekCap.get(wk) ?? 0) - (weekUsed.get(wk) ?? 0);
              if (limit <= EPS) continue;
            }
          }
          const t = Math.min(nd.rem, dayLeft, limit);
          // Only the piece that finishes an item may be shorter than the minimum.
          if (t < MIN_PIECE - EPS && t < nd.rem - EPS) continue;
          pick = n; take = t;
          break;
        }
        if (pick < 0) break;
        const nd = nodes[pick];
        nd.rem -= take;
        dayLeft -= take;
        pieces.push({ date: day.date, n: pick, m: take });
        if (nd.gated && p.reviewPolicy === "weekly-interleave") weekUsed.set(wk, (weekUsed.get(wk) ?? 0) + take);
        if (nd.rem <= EPS) { nd.rem = 0; finishNode(pick, day.date); }
      }
      budget -= start - dayLeft;
    }
    return { pieces, nodes, unplaced: nodes.filter((n) => n.rem > EPS), load: f, relaxed: relax };
  }
}

export function schedule(inp: ScheduleInput): ScheduleResult {
  const k = inp.crash ?? 1;
  const days = inp.caps
    .filter((c) => c.date >= inp.today && c.date < inp.exam && c.minutes > EPS)
    .sort((a, b) => a.date.localeCompare(b.date));
  const base = {
    work: inp.work, k, today: inp.today, exam: inp.exam,
    reviewPolicy: inp.reviewPolicy, reviewStartDate: inp.reviewStartDate, order: inp.order,
  };
  // Day each module's steps 1-3 finish (null = never placed).
  const readyOf = (run: Run) => {
    const ready = new Map<string, string | null>();
    for (const nd of run.nodes) {
      if (nd.step > 3 || nd.total <= EPS) continue;
      const cur = ready.get(nd.item.readingId);
      if (cur === null) continue;
      if (nd.rem > EPS) { ready.set(nd.item.readingId, null); continue; }
      const f = nd.finish ?? "";
      if (cur === undefined || f > cur) ready.set(nd.item.readingId, f);
    }
    return ready;
  };

  const mockViolations = (pls: MockPlacement[], r: Run) => {
    const elig = eligibleFrom(inp.mockSessions, inp.modules, readyOf(r));
    const gen = genericFrom(r);
    return pls.filter((pl) => {
      const ref = pl.item.mockRef;
      const e = ref ? elig.get(ref) : gen;
      return e === null || (e !== undefined && pl.date < e);
    });
  };
  let run = runPasses({ ...base, days });
  let mocks: { placements: MockPlacement[]; unplaced: WorkItem[] } = { placements: [], unplaced: [] };
  // Generic mocks wait for every topic: one pseudo-session spanning all of them.
  const allTopics = [...new Set(inp.modules.map((m) => m.topicOrder))];
  const genericFrom = (r: Run) => eligibleFrom(
    [{ ref: "*", packageId: "", resourceId: "", title: "", questionCount: 0, topicOrders: allTopics, done: false }],
    inp.modules, readyOf(r),
  ).get("*") ?? "";
  // Eligibility depends on the schedule and mocks shift it, so iterate to a fixed point.
  for (let it = 0; it < 3; it++) {
    const elig = eligibleFrom(inp.mockSessions, inp.modules, readyOf(run));
    const plan = placeMocks({
      today: inp.today, exam: inp.exam, caps: days, sessions: inp.mockSessions, elig, trim: inp.mockTrim,
      genericFrom: genericFrom(run),
    });
    mocks = plan;
    if (!plan.placements.length) break;
    const left = days.map((d) => ({ ...d, minutes: d.minutes - (plan.used.get(d.date) ?? 0) }))
      .filter((d) => d.minutes > EPS);
    run = runPasses({ ...base, days: left });
    if (!mockViolations(mocks.placements, run).length) break;
  }
  // No fixed point: drop mocks (and their reviews) still sitting before eligibility.
  const bad = mockViolations(mocks.placements, run);
  if (bad.length) {
    const drop = new Set(bad.map((pl) => pl.item.id.replace(/:review$/, "")));
    const keep: MockPlacement[] = [];
    const lost = new Map<string, WorkItem>();
    for (const pl of mocks.placements) {
      const key = pl.item.id.endsWith(":review") ? pl.item.id.slice(0, -7) : pl.item.id;
      if (!drop.has(key)) { keep.push(pl); continue; }
      const cur = lost.get(pl.item.id);
      lost.set(pl.item.id, { ...pl.item, minutes: (cur?.minutes ?? 0) + pl.minutes });
    }
    mocks = { placements: keep, unplaced: [...mocks.unplaced, ...lost.values()] };
  }

  const byDate = new Map<string, ScheduledTask[]>();
  const add = (t: ScheduledTask) => {
    const l = byDate.get(t.date);
    if (l) l.push(t); else byDate.set(t.date, [t]);
  };
  for (const pl of mocks.placements) {
    add({ date: pl.date, order: 0, item: pl.item, minutes: pl.minutes, workMinutes: pl.minutes });
  }
  for (const pc of run.pieces) {
    const nd = run.nodes[pc.n];
    add({ date: pc.date, order: 0, item: nd.item, minutes: pc.m, workMinutes: pc.m * (nd.item.minutes / nd.total) });
  }
  const tasks: ScheduledTask[] = [];
  for (const d of [...byDate.keys()].sort()) {
    byDate.get(d)!.forEach((t, i) => { t.order = i; tasks.push(t); });
  }
  return {
    tasks, load: run.load,
    unplaced: [
      ...run.unplaced.map((n) => ({ ...n.item, minutes: n.rem * (n.item.minutes / n.total) })),
      ...mocks.unplaced,
    ],
    relaxedPolicy: run.relaxed,
  };
}
