// Shared builders for the scheduler, fit and planSteps tests.
import { addDays } from "./dates";
import type { DayCap } from "./schedule";
import type { ModuleCatalog, SourceOption } from "./types";
import type { WorkItem } from "./work";

export const bank = (slug: string, questions: number | null): SourceOption => ({
  packageSlug: slug, packageId: `p-${slug}`, resourceIds: [`res-${slug}`], kind: "questions",
  minutes: 0, questions, minutesPerQuestion: 3, answerReviewPerQuestion: 1, label: slug,
});
export const read = (slug: string, minutes: number): SourceOption => ({
  packageSlug: slug, packageId: `p-${slug}`, resourceIds: [], kind: "read", minutes, label: slug,
});

// s1 = s1min, s3 = s1min / 3.
export function module(id: string, topicOrder: number, order: number, s1min = 60, weight = 0.1): ModuleCatalog {
  return {
    readingId: id, topicId: `t${topicOrder}`, topicOrder, readingOrder: order, examWeight: weight,
    options: {
      1: [read("mm", s1min)], 2: [bank("uw", 500)], 3: [read("mm", s1min / 3)], 4: [bank("pp", 500)],
    },
  };
}

// 51 modules over 10 topics.
export function fullCatalog(s1min = 60): ModuleCatalog[] {
  const out: ModuleCatalog[] = [];
  for (let i = 0; i < 51; i++) out.push(module(`r${i + 1}`, (i % 10) + 1, Math.floor(i / 10) + 1, s1min, 0.1));
  return out;
}

export function caps(from: string, days: number, minutes: number, holidays: Record<string, string> = {}): DayCap[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, minutes, holidayId: holidays[date] ?? null };
  });
}

let n = 0;
export function item(o: Partial<WorkItem> & { minutes: number }): WorkItem {
  n++;
  return {
    id: `i${n}`, readingId: "r1", step: 1, round: 1, kind: "read", packageId: "p", resourceIds: [],
    label: "x", extraReason: null, after: [], ...o,
  };
}
