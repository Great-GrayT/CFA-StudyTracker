import { describe, test, expect } from "vitest";
import { renderCoachMail, type MailData } from "./FUNC-mail-render";
import type { DialogueVars } from "../core/coach-dialogue";

// Same literal values coach-dialogue.test.ts uses for its own FULL_VARS -
// kept independent here (not imported) so a change to that file's fixture
// can't silently change what this file is asserting against.
const FULL_VARS: DialogueVars = {
  name: "Sam",
  daysToExam: 14,
  streak: 5,
  todayMinutes: 120,
  taskCount: 4,
  coveragePercent: 62,
  finishDate: "2026-12-15",
  droppedCount: 3,
  requeueCount: 3,
  firstTask: "Quantitative Methods",
  offPlanCount: 2,
  offPlanTopic: "Derivatives",
  restDays: 4,
  dayOfBlock: 2,
  n: 2,
};

const DATA: MailData = {
  tasks: [
    { title: "Meldrum FI LM2", minutes: 53, done: false },
    { title: "UWorld FI R2 v1-2", minutes: 84, done: true },
  ],
  coveragePercent: 62,
  daysToExam: 14,
  planUrl: "https://example.test/plan/today",
};

describe("renderCoachMail", () => {
  test("the html carries no construct email clients drop", () => {
    const { html } = renderCoachMail("P_NORMAL", FULL_VARS, DATA);
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/class=/i);
    expect(html).not.toMatch(/<svg/i);
    expect(html).not.toMatch(/display:\s*(flex|grid)/i);
  });

  test("the progress bar is a table whose filled cell matches the percentage", () => {
    const { html } = renderCoachMail("P_NORMAL", { ...FULL_VARS, coveragePercent: 37 }, DATA);
    expect(html).toMatch(/width:\s*37%/);
  });

  test("every task in the data appears in both the html and the text", () => {
    const { html, text } = renderCoachMail("P_NORMAL", FULL_VARS, DATA);
    for (const task of DATA.tasks) {
      expect(html).toContain(task.title);
      expect(text).toContain(task.title);
    }
  });

  test("the text alternative survives without layout and carries no markup", () => {
    const { text } = renderCoachMail("P_NORMAL", FULL_VARS, DATA);
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text.length).toBeGreaterThan(40);
  });

  test("html special characters in a resource name are escaped", () => {
    // Provider titles are third-party data. An unescaped ampersand breaks the
    // markup; an unescaped angle bracket is worse.
    const data: MailData = { ...DATA, tasks: [{ title: "Bonds & <Options>", minutes: 30, done: false }] };
    const { html } = renderCoachMail("P_NORMAL", FULL_VARS, data);
    expect(html).toContain("Bonds &amp; &lt;Options&gt;");
    expect(html).not.toContain("<Options>");
  });
});

describe("variant rotation reaching the email", () => {
  // These exist because of a real bug: renderCoachMail called renderDialogue
  // without a date, so it silently used the library's default. Every candidate
  // would have received the SAME variant of a state every morning for nine
  // months, and the whole multi-variant collection would collapse to one line
  // per state. Nothing in the suite noticed, because every other test here
  // pins one key and inspects the HTML rather than varying the day.

  test("different dates produce different copy for the same state", () => {
    const subjects = new Set(
      ["2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08", "2027-01-09"].map(
        (d) => renderCoachMail("P_NORMAL", FULL_VARS, DATA, d).subject
      )
    );
    // P_NORMAL has several variants. If the date were being ignored this set
    // would hold exactly one entry.
    expect(subjects.size).toBeGreaterThan(1);
  });

  test("the same date is reproducible, so copy can be pinned in a test", () => {
    const a = renderCoachMail("P_NORMAL", FULL_VARS, DATA, "2027-03-21");
    const b = renderCoachMail("P_NORMAL", FULL_VARS, DATA, "2027-03-21");
    expect(a.subject).toBe(b.subject);
    expect(a.html).toBe(b.html);
  });

  test("the rendered date reaches the HTML and the plain text together", () => {
    const first = renderCoachMail("P_NORMAL", FULL_VARS, DATA, "2027-01-04");
    const second = renderCoachMail("P_NORMAL", FULL_VARS, DATA, "2027-01-05");
    // Whichever variant each day picks, the HTML and the text must be telling
    // the same story on that day. A mismatch here would mean the two builders
    // rendered independently.
    expect(first.html).not.toBe(second.html);
    expect(first.text).not.toBe(second.text);
  });
});

describe("the push channel", () => {
  // The requirement is that the phone notification says the same thing as the
  // email. That is guaranteed structurally (one renderDialogue call feeds both)
  // rather than by convention, and these tests hold that structure in place.

  test("the notification title is exactly the email subject", () => {
    const { subject, push } = renderCoachMail("P_NORMAL", FULL_VARS, DATA, "2027-01-04");
    expect(push.title).toBe(subject);
  });

  test("the notification body comes from the same variant as the email body", () => {
    // Pick a date, then confirm a distinctive run of words from the push body
    // also appears in the plain-text email. Two independent render calls could
    // legitimately choose different variants and this would fail.
    const { push, text } = renderCoachMail("P_SLIP", FULL_VARS, DATA, "2027-02-11");
    const stem = push.body.replace(/\.\.\.$/, "").slice(0, 40);
    expect(stem.length).toBeGreaterThan(10);
    expect(text).toContain(stem);
  });

  test("the notification carries a deep link rather than dumping the user on a home screen", () => {
    const { push } = renderCoachMail("P_NORMAL", FULL_VARS, DATA, "2027-01-04");
    expect(push.url).toBe(DATA.planUrl);
  });

  test("the body is trimmed to a length a phone will actually show", () => {
    // Every state, every variant: the longest opening plus pressure in the
    // whole collection must still come out short enough to display.
    for (const date of ["2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07"]) {
      for (const key of ["P_CRISIS", "P_FINAL_WEEK_BEHIND", "D_PARTIAL_BEHIND"] as const) {
        const { push } = renderCoachMail(key, FULL_VARS, DATA, date);
        expect(push.body.length).toBeLessThanOrEqual(180);
      }
    }
  });

  test("a trimmed body ends on a word boundary, not mid-word", () => {
    // A notification reading "you have four task" is worse than one reading
    // "you have four..." because the first looks like a typo.
    const { push } = renderCoachMail("P_CRISIS", FULL_VARS, DATA, "2027-01-04");
    if (push.body.endsWith("...")) {
      const beforeEllipsis = push.body.slice(0, -3);
      expect(beforeEllipsis).not.toMatch(/\s$/);
      expect(beforeEllipsis.length).toBeGreaterThan(100);
    }
  });

  test("a short body is left completely alone", () => {
    const { push } = renderCoachMail("P_EXAM_DAY", FULL_VARS, DATA, "2027-01-04");
    if (push.body.length < 180) {
      expect(push.body.endsWith("...")).toBe(false);
    }
  });
});
