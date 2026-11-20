import { addDays } from "./dates";
import { EPS } from "./rules";
import type { WorkItem } from "./work";

export const MOCK_SESSION_MIN = 132;
export const MOCK_REVIEW_MIN = 66;
export const MIN_PIECE = 15;
// A paper is never split: a day may run this far over its cap to hold a whole session.
export const MOCK_OVERFLOW_MAX = 45;
// Weeks before the exam -> minimum full mocks.
const WEEK_MOCKS: Record<number, number> = { 4: 1, 3: 2, 2: 3, 1: 4 };
const ORDER = [4, 3, 2, 1];

export type MockSession = {
  ref: string; packageId: string; resourceId: string; title: string; questionCount: number;
  topicOrders: number[]; done: boolean;
  // Counts the session toward the week it was done in.
  doneOn?: string | null;
};

export type MockPlacement = { date: string; item: WorkItem; minutes: number };
export type MockPlan = { placements: MockPlacement[]; unplaced: WorkItem[]; used: Map<string, number> };
type Week = { before: number; start: string; end: string; need: number };

// Week -1 is the 7 days ending the day before the exam. Weeks wholly in the past
// are dropped (their minimum cannot be met any more).
export function mockNeeds(today: string, exam: string, sessions: MockSession[], trimMocks = 0): Week[] {
  const weeks: Week[] = [];
  for (const b of ORDER) {
    const end = addDays(exam, -1 - 7 * (b - 1));
    const start = addDays(end, -6);
    if (end < today) continue;
    const done = sessions.filter((s) => s.done && s.doneOn && s.doneOn >= start && s.doneOn <= end).length;
    weeks.push({ before: b, start, end, need: Math.max(0, 2 * WEEK_MOCKS[b] - done) });
  }
  // Trim cuts whole mocks (2 sessions) from the busiest week, latest first on ties,
  // so the cuts level the weeks out instead of emptying the early ones.
  for (let t = 0; t < trimMocks; t++) {
    let pick: Week | null = null;
    for (const w of weeks) if (w.need > 0 && (!pick || w.need >= pick.need)) pick = w;
    if (!pick) break;
    pick.need -= Math.min(2, pick.need);
  }
  return weeks;
}

export function mockDemandMinutes(today: string, exam: string, sessions: MockSession[], trimMocks = 0): number {
  return mockNeeds(today, exam, sessions, trimMocks).reduce((a, w) => a + w.need, 0)
    * (MOCK_SESSION_MIN + MOCK_REVIEW_MIN);
}

// Fewest mocks to trim so every remaining one places whole in the window's caps.
// Placement-based, so it matches what schedule() will actually do.
export function windowMockTrim(p: {
  today: string; exam: string; caps: Array<{ date: string; minutes: number }>; sessions: MockSession[];
}): number {
  const ok = (t: number) => !placeMocks({ ...p, elig: new Map(), trim: t }).unplaced.length;
  let lo = 0, hi = trimmableMocks(p.today, p.exam, p.sessions);
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ok(mid)) hi = mid; else lo = mid + 1; }
  return lo;
}

export function trimmableMocks(today: string, exam: string, sessions: MockSession[]): number {
  return Math.ceil(mockNeeds(today, exam, sessions).reduce((a, w) => a + w.need, 0) / 2);
}

// ready: readingId -> day its steps 1-3 finish in the non-mock schedule
// (null = never, absent = already done). Eligible the day after that.
// Returns ref -> first eligible date ("" = always, null = never).
export function eligibleFrom(
  sessions: MockSession[], modules: Array<{ readingId: string; topicOrder: number }>,
  ready: Map<string, string | null>,
): Map<string, string | null> {
  const byTopic = new Map<number, string | null>();
  for (const m of modules) {
    const cur = byTopic.get(m.topicOrder);
    if (cur === null) continue;
    const r = ready.get(m.readingId);
    if (r === undefined) { if (cur === undefined) byTopic.set(m.topicOrder, ""); continue; }
    if (r === null) { byTopic.set(m.topicOrder, null); continue; }
    const day = addDays(r, 1);
    byTopic.set(m.topicOrder, cur === undefined || day > cur ? day : cur);
  }
  const out = new Map<string, string | null>();
  for (const s of sessions) {
    let from: string | null = "";
    for (const t of s.topicOrders) {
      const v = byTopic.get(t);
      if (v === null) { from = null; break; }
      if (v !== undefined && v > from) from = v;
    }
    out.set(s.ref, from);
  }
  return out;
}

const mkItem = (id: string, kind: "mock" | "mock-review", minutes: number, s: MockSession | null,
  label: string, after: string[]): WorkItem => ({
  id, readingId: "", step: 5, round: 1, kind, minutes, questions: s?.questionCount,
  packageId: s?.packageId ?? "", resourceIds: s ? [s.resourceId] : [], label, extraReason: null,
  after, mockRef: s?.ref ?? null,
});

export function placeMocks(p: {
  today: string; exam: string; caps: Array<{ date: string; minutes: number }>;
  sessions: MockSession[]; elig: Map<string, string | null>; trim?: number;
  // Earliest day a generic mock may sit: every topic eligible. "" = no gate, null = never.
  genericFrom?: string | null;
}): MockPlan {
  const rem = new Map<string, number>();
  for (const c of p.caps) if (c.date >= p.today && c.date < p.exam && c.minutes > EPS) rem.set(c.date, c.minutes);
  const plan: MockPlan = { placements: [], unplaced: [], used: new Map() };
  const taken = new Set<string>();
  const supply = p.sessions.filter((s) => !s.done);

  const all = [...rem.keys()].sort();
  const weeks = mockNeeds(p.today, p.exam, p.sessions, p.trim ?? 0);
  const weekDays = weeks.map((w) => all.filter((d) => d >= w.start && d <= w.end));

  // Whole-paper day: own week first, then the nearest earlier weeks, then later ones.
  // A day needs room for the paper less the allowed overflow; roomiest wins, earliest on ties.
  const pickDay = (minutes: number, from: string, wi: number): string | null => {
    const order = [wi, ...Array.from({ length: wi }, (_, k) => wi - 1 - k),
      ...Array.from({ length: weeks.length - wi - 1 }, (_, k) => wi + 1 + k)];
    for (const x of order) {
      const c = weekDays[x].filter((d) => d >= from && rem.get(d)! >= minutes - MOCK_OVERFLOW_MAX - EPS);
      if (c.length) return c.reduce((a, b) => (rem.get(b)! > rem.get(a)! + EPS ? b : a));
    }
    return null;
  };
  const put = (d: string, item: WorkItem, m: number) => {
    rem.set(d, Math.max(0, (rem.get(d) ?? 0) - m)); // overflow leaves no room, never negative
    plan.used.set(d, (plan.used.get(d) ?? 0) + m);
    plan.placements.push({ date: d, item, minutes: m });
  };
  const placeSession = (item: WorkItem, from: string, wi: number): string | null => {
    const d = pickDay(item.minutes, from, wi);
    if (d) put(d, item, item.minutes); else plan.unplaced.push(item);
    return d;
  };
  // Review: first day from the session's own day with room for it whole, else split.
  const placeReview = (item: WorkItem, minDate: string): boolean => {
    let left = item.minutes;
    const cands = all.filter((d) => d >= minDate && (rem.get(d) ?? 0) > EPS);
    const fit = cands.find((d) => rem.get(d)! >= left - EPS);
    if (fit) { put(fit, item, left); return true; }
    for (const d of cands) {
      let take = Math.min(rem.get(d)!, left);
      if (take < left - EPS) {
        if (left - take < MIN_PIECE - EPS) take = left - MIN_PIECE;
        if (take < MIN_PIECE - EPS) continue;
      }
      put(d, item, take);
      left -= take;
      if (left <= EPS) return true;
    }
    plan.unplaced.push({ ...item, minutes: left });
    return false;
  };

  let gi = 0;
  weeks.forEach((w, wi) => {
    for (let i = 0; i < w.need; i++) {
      const s = supply.find((x) => !taken.has(x.ref) && p.elig.get(x.ref) !== null
        && pickDay(MOCK_SESSION_MIN, p.elig.get(x.ref) ?? "", wi) !== null);
      if (s) taken.add(s.ref);
      const key = s ? s.ref : `generic:${w.before}:${gi++}`;
      const label = s ? s.title : "Mock (any provider)";
      const sess = mkItem(`mock:${key}`, "mock", MOCK_SESSION_MIN, s ?? null, label, []);
      const from = s ? (p.elig.get(s.ref) ?? "") : (p.genericFrom === undefined ? "" : p.genericFrom);
      const rev = mkItem(`mock:${key}:review`, "mock-review", MOCK_REVIEW_MIN, s ?? null,
        `${label} answer review`, [sess.id]);
      const fin = from === null ? null : placeSession(sess, from, wi);
      if (from === null) plan.unplaced.push(sess);
      if (fin === null) plan.unplaced.push(rev);
      else placeReview(rev, fin);
    }
  });
  return plan;
}
