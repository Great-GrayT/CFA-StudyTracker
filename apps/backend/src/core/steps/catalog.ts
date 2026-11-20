import type {
  ModuleCatalog, ReadingRow, ResourceRow, SourceOption, StepNo, UnitRow,
} from "./types";
import { ANSWER_WPM, DEFAULT_RULES, MIN_PER_QUESTION, NOTES_MIN_PER_PAGE, type StepRules } from "./rules";

export const LES_SLUG = "cfa-les";
const READ_KINDS = new Set(["lecture", "eocq", "seminar"]);

type Agg = {
  packageId: string;
  readSec: number; // lecture + eocq + seminar
  reviewSec: number;
  pages: number;
  notesSec: number;
  q: number;
  reviewMin: number; // answer review minutes for the q questions
  readIds: Set<string>;
  noteIds: Set<string>;
  qIds: Set<string>;
};

function newAgg(packageId: string): Agg {
  return {
    packageId, readSec: 0, reviewSec: 0, pages: 0, notesSec: 0, q: 0, reviewMin: 0,
    readIds: new Set(), noteIds: new Set(), qIds: new Set(),
  };
}

export function buildCatalog(input: {
  readings: ReadingRow[]; units: UnitRow[]; resources: ResourceRow[];
  planPackageSlugs: string[]; priority: Record<1 | 2 | 3 | 4 | 5, string[]>; lesHours: number;
  rules?: StepRules;
}): ModuleCatalog[] {
  const { readings, units, resources, planPackageSlugs, priority, lesHours, rules } = input;
  const onPlan = new Set(planPackageSlugs);
  const rMap = new Map(readings.map((r) => [r.id, r]));
  const byUnit = new Map<string, ResourceRow[]>();
  for (const r of resources) {
    if (!r.unitId) continue;
    const list = byUnit.get(r.unitId) ?? [];
    list.push(r);
    byUnit.set(r.unitId, list);
  }
  const sum = (rs: ResourceRow[], match: (k: string) => boolean, f: (r: ResourceRow) => number | null) =>
    rs.filter((r) => match(r.kind)).reduce((a, r) => a + (f(r) ?? 0), 0);

  // LES seconds per reading are the split weights for fan-out units.
  const lesSec = new Map<string, number>();
  for (const u of units) {
    if (u.packageSlug !== LES_SLUG || !onPlan.has(LES_SLUG)) continue;
    const ids = u.readingIds.filter((id) => rMap.has(id));
    const sec = sum(byUnit.get(u.id) ?? [], (k) => k === "notes", (r) => r.durationSeconds);
    for (const id of ids) lesSec.set(id, (lesSec.get(id) ?? 0) + sec / ids.length);
  }

  const aggs = new Map<string, Agg>(); // `${slug}|${readingId}`
  for (const u of units) {
    if (!onPlan.has(u.packageSlug)) continue;
    const ids = u.readingIds.filter((id) => rMap.has(id)).sort((a, b) => {
      const ra = rMap.get(a)!, rb = rMap.get(b)!;
      return ra.topicOrder - rb.topicOrder || ra.order - rb.order;
    });
    if (!ids.length) continue;
    const rs = byUnit.get(u.id) ?? [];
    const useLes = u.packageSlug !== LES_SLUG && ids.every((id) => (lesSec.get(id) ?? 0) > 0);
    const raw = ids.map((id) => (useLes ? lesSec.get(id)! : 1));
    const tot = raw.reduce((a, b) => a + b, 0);
    const shares = raw.map((w) => w / tot);

    const readSec = sum(rs, (k) => READ_KINDS.has(k), (r) => r.durationSeconds);
    const reviewSec = sum(rs, (k) => k === "review", (r) => r.durationSeconds);
    const notesSec = sum(rs, (k) => k === "notes", (r) => r.durationSeconds);
    const qTotal = sum(rs, (k) => k === "question_set", (r) => r.questionCount);
    const words = sum(rs, (k) => k === "answer_set", (r) => r.wordCount);
    // Known answer words at 200 wpm, else 1/3 of answering time.
    const perQReview = qTotal > 0 && words > 0 ? words / ANSWER_WPM / qTotal : MIN_PER_QUESTION / 3;

    let cum = 0, prevRound = 0;
    ids.forEach((id, i) => {
      const key = `${u.packageSlug}|${id}`;
      let a = aggs.get(key);
      if (!a) { a = newAgg(u.packageId); aggs.set(key, a); }
      const s = shares[i];
      cum += s;
      // Cumulative rounding makes the integer question split sum to the unit total.
      const nowRound = i === ids.length - 1 ? qTotal : Math.round(qTotal * cum);
      const q = nowRound - prevRound;
      prevRound = nowRound;
      a.readSec += readSec * s;
      a.reviewSec += reviewSec * s;
      a.notesSec += notesSec * s;
      a.pages += (u.notesPageCount ?? 0) * s;
      a.q += q;
      a.reviewMin += q * perQReview;
      for (const r of rs) {
        if (READ_KINDS.has(r.kind) || (r.kind === "notes" && (r.durationSeconds ?? 0) > 0)) a.readIds.add(r.id);
        if (r.kind === "notes" || r.kind === "review") a.noteIds.add(r.id);
        if (r.kind === "question_set" || r.kind === "answer_set") a.qIds.add(r.id);
      }
    });
  }

  const lesScale = lesHours / 200;
  const readMin = (slug: string, a: Agg) =>
    ((a.readSec + a.notesSec) / 60) * (slug === LES_SLUG ? lesScale : 1);

  const out: ModuleCatalog[] = [];
  const sorted = [...readings].sort((a, b) => a.topicOrder - b.topicOrder || a.order - b.order);
  for (const rd of sorted) {
    const options: Record<StepNo, SourceOption[]> = { 1: [], 2: [], 3: [], 4: [] };
    const slugsFor = (step: 1 | 2 | 3 | 4) => priority[step].filter((s) => onPlan.has(s));

    for (const slug of slugsFor(1)) {
      const a = aggs.get(`${slug}|${rd.id}`);
      if (!a) continue;
      const minutes = readMin(slug, a);
      if (minutes > 0) {
        options[1].push({ packageSlug: slug, packageId: a.packageId, resourceIds: [...a.readIds],
          kind: "read", minutes, label: `${slug} reading` });
      }
    }
    const s1 = options[1][0]?.minutes ?? 0;

    // Review reading is floored at a share of step 1: short review videos alone
    // would make the pre-question refresh trivially small.
    const share = (rules ?? DEFAULT_RULES).reviewShare / 100;
    const slugs3 = slugsFor(3).filter((slug) => aggs.has(`${slug}|${rd.id}`));
    slugs3.forEach((slug, i) => {
      const a = aggs.get(`${slug}|${rd.id}`)!;
      const own = a.pages * NOTES_MIN_PER_PAGE + a.reviewSec / 60;
      let minutes = own;
      // Text-only sources (LES) review at half their own step 1 rate.
      if (minutes <= 0) minutes = 0.5 * readMin(slug, a);
      const ids = new Set(a.noteIds);
      // A lead with no review or notes ids would leave the task without material: borrow the next package's.
      if (!ids.size) for (const nxt of slugs3.slice(i + 1)) {
        for (const r of aggs.get(`${nxt}|${rd.id}`)!.noteIds) ids.add(r);
        if (ids.size) break;
      }
      if (s1 > 0) minutes = Math.min(Math.max(minutes, share * s1), Math.max(0.5, share) * s1);
      if (minutes > 0) {
        options[3].push({ packageSlug: slug, packageId: a.packageId, resourceIds: [...ids],
          kind: "read", minutes, label: `${slug} review` });
      }
    });

    for (const step of [2, 4] as const) {
      for (const slug of slugsFor(step)) {
        const a = aggs.get(`${slug}|${rd.id}`);
        if (slug === LES_SLUG) {
          // Unlimited supply: sized in minutes by the engine, nothing to exhaust.
          options[step].push({ packageSlug: slug, packageId: a?.packageId ?? "", resourceIds: [],
            kind: "questions", minutes: 0, questions: null, minutesPerQuestion: MIN_PER_QUESTION,
            answerReviewPerQuestion: MIN_PER_QUESTION / 3, label: `${slug} questions` });
          continue;
        }
        if (!a || a.q <= 0) continue;
        const arpq = a.reviewMin / a.q;
        options[step].push({ packageSlug: slug, packageId: a.packageId, resourceIds: [...a.qIds],
          kind: "questions", minutes: a.q * (MIN_PER_QUESTION + arpq), questions: a.q,
          minutesPerQuestion: MIN_PER_QUESTION, answerReviewPerQuestion: arpq, label: `${slug} questions` });
      }
    }

    out.push({
      readingId: rd.id, topicId: rd.topicId, topicOrder: rd.topicOrder, readingOrder: rd.order,
      examWeight: (rd.examWeightMin + rd.examWeightMax) / 200, options,
      ...(rules ? { rules } : {}),
    });
  }
  return out;
}

export function step1Minutes(m: ModuleCatalog): number {
  return m.options[1][0]?.minutes ?? 0;
}

// Baselines use uncrashed step 1 minutes (spec Builder answer 6).
export function adequateMinutes(m: ModuleCatalog, step: 2 | 4): number {
  const r = m.rules ?? DEFAULT_RULES;
  return (step === 2 ? r.step2Multiplier : r.step2Multiplier * r.step4Multiplier) * step1Minutes(m);
}
