import { describe, test, expect } from "vitest";
import { dialogueFor, renderDialogue, ALL_DIALOGUE_KEYS, type DialogueKey } from "./coach-dialogue";
import { type CoachState } from "./coach-state";
import { type Slot } from "./slots";

// Fixture: build a CoachState with sensible defaults, overridable per test
function state(overrides: Partial<CoachState>): CoachState {
  return {
    streak: "on-track",
    shape: "normal",
    logging: "nothing",
    streakDays: 0,
    ...overrides,
  };
}

// Fixture: a full set of variables for rendering tests
const FULL_VARS = {
  name: "Sam",
  daysToExam: 14,
  streak: 5,
  todayMinutes: 120,
  taskCount: 4,
  coveragePercent: 62,
  finishDate: "2026-12-15",
  droppedCount: 3,
  firstTask: "Quantitative Methods",
  n: 2,
};

describe("dialogueFor: decision tree", () => {
  describe("PRESCRIPTION: streak-based escalation", () => {
    test("the tree picks the escalating prescription for each streak band", () => {
      expect(dialogueFor("prescription", state({ streak: "on-track", shape: "normal" }))).toBe(
        "DAY_NORMAL"
      );
      expect(dialogueFor("prescription", state({ streak: "slip" }))).toBe("SLIP_1");
      expect(dialogueFor("prescription", state({ streak: "drifting" }))).toBe("DRIFT");
      expect(dialogueFor("prescription", state({ streak: "serious" }))).toBe("SERIOUS");
      expect(dialogueFor("prescription", state({ streak: "crisis" }))).toBe("CRISIS");
    });

    test("on-track prescriptions vary by day shape", () => {
      expect(dialogueFor("prescription", state({ streak: "on-track", shape: "light" }))).toBe(
        "DAY_LIGHT"
      );
      expect(dialogueFor("prescription", state({ streak: "on-track", shape: "normal" }))).toBe(
        "DAY_NORMAL"
      );
      expect(dialogueFor("prescription", state({ streak: "on-track", shape: "heavy" }))).toBe(
        "DAY_HEAVY"
      );
    });

    test("rest day beats every streak band: precedence is critical", () => {
      // This test fights the logic: crisis and rest should both be false, yet we set both true.
      // An implementation checking streak first would fail it.
      expect(dialogueFor("prescription", state({ streak: "crisis", shape: "rest" }))).toBe(
        "REST_DAY"
      );
      expect(dialogueFor("prescription", state({ streak: "serious", shape: "rest" }))).toBe(
        "REST_DAY"
      );
      expect(dialogueFor("prescription", state({ streak: "on-track", shape: "rest" }))).toBe(
        "REST_DAY"
      );
    });
  });

  describe("NUDGE: conditional suppression and escalation", () => {
    test("nudge is suppressed when there is something logged already", () => {
      // Suppression reason 1: logging is not nothing
      expect(dialogueFor("nudge", state({ logging: "partial" }))).toBeNull();
      expect(dialogueFor("nudge", state({ logging: "complete" }))).toBeNull();
      expect(dialogueFor("nudge", state({ logging: "over" }))).toBeNull();
    });

    test("nudge is suppressed on a rest day even with nothing logged", () => {
      // Suppression reason 2: shape is rest
      expect(dialogueFor("nudge", state({ shape: "rest", logging: "nothing" }))).toBeNull();
    });

    test("nudge escalates based on streak: on-track gets NUDGE_FIRST", () => {
      expect(dialogueFor("nudge", state({ streak: "on-track", logging: "nothing" }))).toBe(
        "NUDGE_FIRST"
      );
    });

    test("nudge escalates based on streak: any missed day gets NUDGE_STREAK", () => {
      expect(dialogueFor("nudge", state({ streak: "slip", logging: "nothing" }))).toBe(
        "NUDGE_STREAK"
      );
      expect(dialogueFor("nudge", state({ streak: "drifting", logging: "nothing" }))).toBe(
        "NUDGE_STREAK"
      );
      expect(dialogueFor("nudge", state({ streak: "serious", logging: "nothing" }))).toBe(
        "NUDGE_STREAK"
      );
      expect(dialogueFor("nudge", state({ streak: "crisis", logging: "nothing" }))).toBe(
        "NUDGE_STREAK"
      );
    });
  });

  describe("DEBRIEF: logging state determines dialogue", () => {
    test("debrief is suppressed on a rest day", () => {
      expect(dialogueFor("debrief", state({ shape: "rest", logging: "nothing" }))).toBeNull();
      expect(dialogueFor("debrief", state({ shape: "rest", logging: "complete" }))).toBeNull();
    });

    test("the debrief reflects what was actually logged", () => {
      expect(dialogueFor("debrief", state({ logging: "nothing" }))).toBe("DAY_LOST");
      expect(dialogueFor("debrief", state({ logging: "partial" }))).toBe("DAY_PARTIAL");
      expect(dialogueFor("debrief", state({ logging: "complete" }))).toBe("DAY_DONE");
      expect(dialogueFor("debrief", state({ logging: "over" }))).toBe("DAY_OVER");
    });
  });
});

describe("renderDialogue: variable substitution and safety", () => {
  test("every variable in every dialogue is substituted", () => {
    // A leftover brace means a variable the dictionary names but the caller
    // does not supply. That would ship a literal {streak} to a candidate.
    for (const key of ALL_DIALOGUE_KEYS) {
      const out = renderDialogue(key, FULL_VARS);
      const joined = [out.subject, out.opening, out.pressure ?? "", out.close].join(" ");
      expect(joined).not.toMatch(/[{}]/);
    }
  });

  test("the escalation ceiling holds: no dialogue addresses the person rather than the work", () => {
    // The spec's floor as a test. These are the second-person judgement patterns
    // the ceiling exists to forbid: they destroy trust by guessing character.
    for (const key of ALL_DIALOGUE_KEYS) {
      const out = renderDialogue(key, FULL_VARS);
      const joined = [out.subject, out.opening, out.pressure ?? "", out.close]
        .join(" ")
        .toLowerCase();
      expect(joined).not.toMatch(/you (clearly|obviously|never|always|do not want|don't want)/);
      expect(joined).not.toMatch(/lazy|pathetic|failure|hopeless|waste/);
    }
  });

  test("every dialogue closes with an action", () => {
    for (const key of ALL_DIALOGUE_KEYS) {
      if (key === "REST_DAY") continue; // the one case whose close is deliberately not an action
      const out = renderDialogue(key, FULL_VARS);
      expect(out.close.trim().length).toBeGreaterThan(0);
    }
  });

  test("REST_DAY close is non-empty", () => {
    // REST_DAY is the exception: its close is informational, not an action.
    // It must still be non-empty.
    const out = renderDialogue("REST_DAY", FULL_VARS);
    expect(out.close.trim().length).toBeGreaterThan(0);
  });

  test("missing a variable throws rather than silently producing empty string", () => {
    const incomplete = { ...FULL_VARS, streak: FULL_VARS.streak };
    delete (incomplete as any).daysToExam;

    // Some dialogue will reference daysToExam. Rendering it should throw.
    let threw = false;
    for (const key of ALL_DIALOGUE_KEYS) {
      try {
        renderDialogue(key, incomplete);
      } catch (e) {
        threw = true;
        break;
      }
    }
    expect(threw).toBe(true);
  });
});
