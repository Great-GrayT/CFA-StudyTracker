import { deriveState, type Declaration, type HistoryTask, type MockResult } from "./state";
import type { DoneOn } from "./metrics";
import type { ModuleCatalog, StepNo } from "./types";

// Replays history day by day and records the last day each step flipped to passed.
// Replay (not a stored column) keeps undo and edits exact: state is pure over current rows.
export function deriveDoneOn(
  cat: ModuleCatalog[], history: HistoryTask[], decls: Declaration[], mocks: MockResult[],
): DoneOn {
  const dates = [...new Set([
    ...history.filter((t) => t.status !== "pending").map((t) => t.date),
    ...mocks.map((m) => m.date),
    ...decls.map((d) => d.date),
  ])].sort();
  const out: DoneOn = {};
  const was = new Set<string>();
  for (const d of dates) {
    const st = deriveState(
      cat, history.filter((t) => t.date <= d), decls.filter((x) => x.date <= d), mocks.filter((m) => m.date <= d),
    );
    for (const [id, s] of st) {
      const now: Record<StepNo, boolean> = { 1: s.s1.done, 2: s.s2.passed, 3: s.s3.done, 4: s.s4.passed };
      for (const step of [1, 2, 3, 4] as StepNo[]) {
        const key = `${id}|${step}`;
        if (now[step] && !was.has(key)) {
          was.add(key);
          (out[id] ??= {})[step] = d;
        } else if (!now[step] && was.has(key)) {
          was.delete(key);
          delete out[id]?.[step];
        }
      }
    }
  }
  return out;
}
