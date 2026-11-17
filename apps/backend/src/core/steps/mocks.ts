import { addDays } from "./dates";
import { EPS } from "./rules";
import type { WorkItem } from "./work";

export const MOCK_SESSION_MIN = 132;
export const MOCK_REVIEW_MIN = 66;
export const MIN_PIECE = 15;
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
  // Trim cuts whole mocks (2 sessions), earliest week first.
  let cut = 2 * trimMocks;
  for (const w of weeks) { const c = Math.min(w.need, cut); w.need -= c; cut -= c; }
  return weeks;
}

export function mockDemandMinutes(today: string, exam: string, sessions: MockSession[], trimMocks = 0): number {
  return mockNeeds(today, exam, sessions, trimMocks).reduce((a, w) => a + w.need, 0)
    * (MOCK_SESSION_MIN + MOCK_REVIEW_MIN);
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

  const place = (item: WorkItem, days: string[], minDate: string, prefer?: string): string | null => {
    let left = item.minutes;
    const cands = days.filter((d) => d >= minDate && (rem.get(d) ?? 0) > EPS);
    let last: string | null = null;
    const put = (d: string, m: number) => {
      rem.set(d, (rem.get(d) ?? 0) - m);
      plan.used.set(d, (plan.used.get(d) ?? 0) + m);
      plan.placements.push({ date: d, item, minutes: m });
      left -= m; last = d;
    };
    const fits = cands.filter((d) => rem.get(d)! >= left - EPS);
    if (fits.length) {
      // Prefer the same day as the session, else the roomiest day.
      const pick = prefer && fits.includes(prefer) ? prefer
        : fits.reduce((a, b) => (rem.get(b)! > rem.get(a)! + EPS ? b : a));
      put(pick, left);
      return pick;
    }
    for (const d of cands) {
      let take = Math.min(rem.get(d)!, left);
      if (take < left - EPS) {
        if (left - take < MIN_PIECE - EPS) take = left - MIN_PIECE;
        if (take < MIN_PIECE - EPS) continue;
      }
      put(d, take);
      if (left <= EPS) break;
    }
    if (left > EPS) plan.unplaced.push({ ...item, minutes: left });
    return left <= EPS ? last : null;
  };

  let gi = 0;
  for (const w of mockNeeds(p.today, p.exam, p.sessions, p.trim ?? 0)) {
    const days: string[] = [];
    for (let i = 0; i < 7; i++) { const d = addDays(w.start, i); if (rem.has(d)) days.push(d); }
    // A session needs room for itself and its review from its eligible day on.
    const hasDays = (from: string) =>
      days.filter((d) => d >= from).reduce((a, d) => a + (rem.get(d) ?? 0), 0) >= MOCK_SESSION_MIN + MOCK_REVIEW_MIN;
    for (let i = 0; i < w.need; i++) {
      const s = supply.find((x) => !taken.has(x.ref) && p.elig.get(x.ref) !== null
        && hasDays(p.elig.get(x.ref) ?? ""));
      if (s) taken.add(s.ref);
      const key = s ? s.ref : `generic:${w.before}:${gi++}`;
      const label = s ? s.title : "Mock (any provider)";
      const sess = mkItem(`mock:${key}`, "mock", MOCK_SESSION_MIN, s ?? null, label, []);
      const from = s ? (p.elig.get(s.ref) ?? "") : (p.genericFrom === undefined ? "" : p.genericFrom);
      const rev = mkItem(`mock:${key}:review`, "mock-review", MOCK_REVIEW_MIN, s ?? null,
        `${label} answer review`, [sess.id]);
      const fin = from === null ? null : place(sess, days, from);
      if (from === null) plan.unplaced.push(sess);
      if (fin === null) plan.unplaced.push(rev);
      else place(rev, days, fin, fin);
    }
  }
  return plan;
}
