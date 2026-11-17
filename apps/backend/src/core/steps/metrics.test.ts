import { describe, it, expect } from "vitest";
import { buildWindows } from "./metrics";
import { deriveState } from "./state";
import { module } from "./testkit";

describe("buildWindows", () => {
  it("uses gateDate: a plan born inside the 30-day window is not overdue on day one", () => {
    const cat = [module("r1", 1, 1)];
    const state = deriveState(cat, [], [], []);
    const w = buildWindows({ cat, state, tasks: [], today: "2026-01-05", exam: "2026-01-15" });
    expect(w[0].steps.find((s) => s.step === 1)!.status).toBe("planned");
    const late = buildWindows({ cat, state, tasks: [], today: "2026-01-15", exam: "2026-01-15" });
    expect(late[0].steps.find((s) => s.step === 1)!.status).toBe("overdue");
  });
});
