import { describe, expect, it } from "vitest";
import { deriveDoneOn } from "./done-on";
import { module } from "./testkit";
import type { HistoryTask } from "./state";

const t = (id: string, date: string, o: Partial<HistoryTask>): HistoryTask => ({
  id, date, kind: "read", step: 1, round: null, readingIds: ["r1"], status: "done", minutes: 60,
  answered: 0, correct: 0, answerReviewDone: false, packageSlug: null, ...o,
});

describe("deriveDoneOn", () => {
  it("stamps the day the step passed", () => {
    const out = deriveDoneOn([module("r1", 1, 1, 60)], [
      t("a", "2026-03-01", { minutes: 30 }), t("b", "2026-03-02", { minutes: 30 }),
    ], [], []);
    expect(out.r1?.[1]).toBe("2026-03-02");
  });
  it("leaves unfinished steps unset", () => {
    const out = deriveDoneOn([module("r1", 1, 1, 60)], [t("a", "2026-03-01", { minutes: 30 })], [], []);
    expect(out.r1?.[1]).toBeUndefined();
  });
});
