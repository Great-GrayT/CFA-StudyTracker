import { describe, test, expect } from "vitest";
import {
  dialogueFor,
  renderDialogue,
  lineFor,
  variantIndex,
  ALL_DIALOGUE_KEYS,
  type DialogueVars,
} from "./coach-dialogue";
import { LINES } from "./coach-lines";
import type { CoachState } from "./coach-state";

function state(overrides: Partial<CoachState> = {}): CoachState {
  return {
    streak: "on-track",
    shape: "normal",
    logging: "nothing",
    horizon: "mid",
    phase: "build",
    holiday: "none",
    streakDays: 0,
    daysToExam: 120,
    ...overrides,
  };
}

const FULL_VARS: DialogueVars = {
  name: "Reza",
  daysToExam: 120,
  streak: 3,
  todayMinutes: 95,
  taskCount: 4,
  coveragePercent: 37,
  finishDate: "2027-06-02",
  droppedCount: 2,
  firstTask: "Fixed Income LM2",
  restDays: 4,
  dayOfBlock: 2,
  n: 2,
};

describe("the content itself", () => {
  test("there are at least 200 distinct dialogues across 40 states", () => {
    const total = ALL_DIALOGUE_KEYS.reduce((sum, key) => sum + LINES[key].length, 0);
    expect(ALL_DIALOGUE_KEYS).toHaveLength(40);
    expect(total).toBeGreaterThanOrEqual(200);
  });

  test("every pool keeps at least three untagged lines, so no context can empty it", () => {
    // The tag filter narrows a pool by horizon and phase. If every line in a
    // pool were tagged, some combination of context would match none of them
    // and the candidate would get a thrown error instead of an email.
    for (const key of ALL_DIALOGUE_KEYS) {
      const untagged = LINES[key].filter(
        (l) => l.horizon === undefined && l.phase === undefined
      );
      expect(untagged.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("every state has at least three variants, so no line repeats within a week", () => {
    for (const key of ALL_DIALOGUE_KEYS) {
      expect(LINES[key].length).toBeGreaterThanOrEqual(3);
    }
  });

  test("no two dialogues share a subject line", () => {
    const subjects = Object.values(LINES).flatMap((pool) => pool.map((l) => l.subject));
    expect(new Set(subjects).size).toBe(subjects.length);
  });
});

describe("the prescription tree", () => {
  test("a rest day wins over every streak band, and changes tone with it", () => {
    expect(dialogueFor("prescription", state({ shape: "rest" }))).toBe("P_REST_CLEAN");
    expect(dialogueFor("prescription", state({ shape: "rest", streak: "crisis" }))).toBe(
      "P_REST_BEHIND"
    );
  });

  test("the full escalation runs on a normal day", () => {
    expect(dialogueFor("prescription", state({ streak: "on-track" }))).toBe("P_NORMAL");
    expect(dialogueFor("prescription", state({ streak: "slip" }))).toBe("P_SLIP");
    expect(dialogueFor("prescription", state({ streak: "drifting" }))).toBe("P_DRIFT");
    expect(dialogueFor("prescription", state({ streak: "serious" }))).toBe("P_SERIOUS");
    expect(dialogueFor("prescription", state({ streak: "crisis" }))).toBe("P_CRISIS");
  });

  test("shape and streak cross rather than one overriding the other", () => {
    // The defect the crossed tree exists to prevent: a candidate four days
    // behind being told their day is light, which reads as inattention.
    expect(dialogueFor("prescription", state({ shape: "light" }))).toBe("P_LIGHT");
    expect(dialogueFor("prescription", state({ shape: "light", streak: "slip" }))).toBe(
      "P_LIGHT_SLIP"
    );
    expect(dialogueFor("prescription", state({ shape: "light", streak: "serious" }))).toBe(
      "P_LIGHT_BEHIND"
    );
    expect(dialogueFor("prescription", state({ shape: "heavy" }))).toBe("P_HEAVY");
    expect(dialogueFor("prescription", state({ shape: "heavy", streak: "drifting" }))).toBe(
      "P_HEAVY_BEHIND"
    );
  });

  test("catch-up days escalate by depth", () => {
    expect(dialogueFor("prescription", state({ shape: "catch-up", streak: "slip" }))).toBe(
      "P_CATCHUP_SLIP"
    );
    expect(dialogueFor("prescription", state({ shape: "catch-up", streak: "drifting" }))).toBe(
      "P_CATCHUP_DRIFT"
    );
    expect(dialogueFor("prescription", state({ shape: "catch-up", streak: "crisis" }))).toBe(
      "P_CATCHUP_DEEP"
    );
  });
});

describe("the nudge tree", () => {
  test("a nudge is suppressed when there is nothing to nudge about", () => {
    expect(dialogueFor("nudge", state({ logging: "partial" }))).toBeNull();
    expect(dialogueFor("nudge", state({ logging: "complete" }))).toBeNull();
    expect(dialogueFor("nudge", state({ shape: "rest", logging: "nothing" }))).toBeNull();
  });

  test("the nudge escalates across all five bands", () => {
    expect(dialogueFor("nudge", state({ streak: "on-track" }))).toBe("N_FIRST");
    expect(dialogueFor("nudge", state({ streak: "slip" }))).toBe("N_SLIP");
    expect(dialogueFor("nudge", state({ streak: "drifting" }))).toBe("N_DRIFT");
    expect(dialogueFor("nudge", state({ streak: "serious" }))).toBe("N_SERIOUS");
    expect(dialogueFor("nudge", state({ streak: "crisis" }))).toBe("N_CRISIS");
  });
});

describe("the debrief tree", () => {
  test("the debrief reflects what was actually logged", () => {
    expect(dialogueFor("debrief", state({ logging: "nothing" }))).toBe("D_LOST_FIRST");
    expect(dialogueFor("debrief", state({ logging: "partial" }))).toBe("D_PARTIAL");
    expect(dialogueFor("debrief", state({ logging: "complete" }))).toBe("D_DONE");
    expect(dialogueFor("debrief", state({ logging: "over" }))).toBe("D_OVER");
  });

  test("a complete day after a streak gets its own comeback voice", () => {
    // Without this the coach would congratulate a recovery in the same words it
    // uses for a routine day, and the candidate would never hear that the
    // hardest thing they did all month was noticed.
    expect(dialogueFor("debrief", state({ logging: "complete", streak: "serious" }))).toBe(
      "D_DONE_COMEBACK"
    );
    expect(dialogueFor("debrief", state({ logging: "nothing", streak: "drifting" }))).toBe(
      "D_LOST_STREAK"
    );
    expect(dialogueFor("debrief", state({ logging: "partial", streak: "crisis" }))).toBe(
      "D_PARTIAL_BEHIND"
    );
  });

  test("a debrief is suppressed on a rest day", () => {
    expect(dialogueFor("debrief", state({ shape: "rest", logging: "nothing" }))).toBeNull();
  });
});

describe("variant selection", () => {
  test("the same date always picks the same line, so a test can pin copy", () => {
    const a = lineFor("P_CRISIS", "2027-01-04");
    const b = lineFor("P_CRISIS", "2027-01-04");
    expect(a.subject).toBe(b.subject);
  });

  test("consecutive days rotate rather than repeating", () => {
    // Seven consecutive days against the largest pool should not land on one
    // line every time, or the rotation is doing nothing.
    const dates = [
      "2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07",
      "2027-01-08", "2027-01-09", "2027-01-10",
    ];
    const picked = new Set(dates.map((d) => lineFor("P_CRISIS", d).subject));
    expect(picked.size).toBeGreaterThan(1);
  });

  test("the index always lands inside the pool", () => {
    for (const key of ALL_DIALOGUE_KEYS) {
      const size = LINES[key].length;
      for (const d of ["2027-01-04", "2027-03-28", "2027-12-31", "2028-02-29"]) {
        const i = variantIndex(d, size);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(size);
      }
    }
  });
});

describe("rendering", () => {
  test("every variant of every state substitutes all of its variables", () => {
    // A leftover brace means the copy names a variable the caller does not
    // supply, and the candidate receives a literal {streak}.
    for (const key of ALL_DIALOGUE_KEYS) {
      for (let i = 0; i < LINES[key].length; i++) {
        // Walk dates until this exact variant is selected, so every line in
        // every pool is rendered rather than only the one today happens to pick.
        const date = dateSelecting(key, i);
        const out = renderDialogue(key, FULL_VARS, date);
        const joined = [out.subject, out.opening, out.pressure ?? "", out.close].join(" ");
        expect(joined).not.toMatch(/[{}]/);
      }
    }
  });

  test("an unsupplied variable throws rather than rendering a gap", () => {
    expect(() => renderDialogue("P_CRISIS", { daysToExam: 10 })).toThrow(/not supplied/);
  });

  test("every dialogue closes with something, and rest days are the only ones without pressure", () => {
    for (const key of ALL_DIALOGUE_KEYS) {
      for (let i = 0; i < LINES[key].length; i++) {
        const line = LINES[key][i];
        expect(line.close.trim().length).toBeGreaterThan(0);
        if (line.pressure === null) {
          expect(key).toBe("P_REST_CLEAN");
        }
      }
    }
  });
});

describe("the floor", () => {
  // The voice is deliberately sarcastic and theatrical, which is the point.
  // Two things it must still never do, and these are not matters of taste.

  test("no dialogue tells the candidate to give up entirely", () => {
    // Every escalation, including the crisis tier, must leave a door open. The
    // avoidance behaviour for a coach with no exit is switching the emails off,
    // which ends the coaching relationship permanently.
    for (const key of ALL_DIALOGUE_KEYS) {
      for (let i = 0; i < LINES[key].length; i++) {
        const line = LINES[key][i];
        const joined = [line.subject, line.opening, line.pressure ?? "", line.close]
          .join(" ")
          .toLowerCase();
        expect(joined).not.toMatch(/give up|quit the exam|hopeless|no point|why bother/);
      }
    }
  });

  test("the crisis tier always names both doors, never only the bad one", () => {
    for (const line of LINES.P_CRISIS) {
      const joined = [line.opening, line.pressure ?? "", line.close].join(" ").toLowerCase();
      const offersHours = /add hours|more hours|hours a week/.test(joined);
      const offersDate = /move the (exam|date)|change the date/.test(joined);
      expect(offersHours && offersDate).toBe(true);
    }
  });
});

/** The first date in January 2027 whose hash selects variant `want` of `key`. */
function dateSelecting(key: Parameters<typeof lineFor>[0], want: number): string {
  const size = LINES[key].length;
  for (let day = 1; day <= 31; day++) {
    const d = `2027-01-${String(day).padStart(2, "0")}`;
    if (variantIndex(d, size) === want) return d;
  }
  throw new Error(`no January date selects variant ${want} of ${key}`);
}
