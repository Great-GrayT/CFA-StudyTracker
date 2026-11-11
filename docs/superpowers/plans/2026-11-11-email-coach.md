# Email Study Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a candidate three emails a day that know exactly where they stand: this morning's tasks, an evening nudge when nothing is logged, and a night debrief with what they did and what it cost.

**Architecture:** Four pure layers plus one scheduled sender. Local-time slot resolution decides whether an email is due. State classification turns a plan into the three inputs of the decision tree. The dialogue dictionary maps that state to copy. The renderer turns copy plus plan data into table-based HTML and its mandatory plain-text twin. The sender is the only impure piece: it regenerates the plan when a streak demands it, writes an idempotency row, and hands the message to the existing SMTP helper.

**Tech Stack:** TypeScript on Node 22, Prisma 6, Postgres, Vitest, nodemailer (already present), `Intl.DateTimeFormat` for zones (no new dependency).

**Spec:** `docs/superpowers/specs/2026-11-11-email-coach-design.md`

## Scope note

This plan builds the coach on top of the scheduler, which is merged and produces dated `PlanTask` rows. It stops short of the per-topic bar chart in the debrief, which needs coverage data the progress route owns, and of SPF/DKIM/DMARC setup, which is deployment rather than code.

One honest dependency: the scheduler currently emits a narrow set of task kinds against the real catalogue. The emails describe whatever the engine produces, so they improve automatically as that widens. Nothing here depends on a kind that does not yet exist.

## Global Constraints

- Every script under `prisma/` runs under plain `node` on Node 22. Anything that is only a type uses `import type`; Node's type stripping does not erase a value-shaped import of a type. Vitest cannot catch a violation because its esbuild loader does erase it.
- Plan dates stay UTC. The timezone decides only WHEN a mail fires and which local date it names, never how the pace engine computes. `startOfUTCDay` and `toISODate` in `src/core/pace.ts` keep their current meaning.
- Prose in comments and commit messages: no em-dashes, no double-dashes.
- Comments explain why, not what.
- Never commit a red suite or a failing typecheck. The suite is around 343 passing.
- No test body wrapped in a conditional, and no tautological assertion. Both have shipped on this project repeatedly.
- The pure layers take their inputs as arguments: no database, no `new Date()` with no argument, no randomness. A function that reads the clock cannot be tested against a fixed day.
- Email HTML uses inline styles and tables only. No `<style>` block, no class attributes, no SVG, no flexbox, no grid. Outlook renders through Word's engine.
- Every email carries a plain-text alternative. It is what spam filters read.

## Review Focus

Five failure modes the spec implies that no happy path exercises.

1. **A duplicate prescription.** The cron re-runs, retries and overlaps. Two identical "here is today" emails tell the candidate the system does not know what it already said, which is worse than a missed send. The uniqueness guard must be in the same transaction as the send record. Pinned in Task 5.
2. **An email describing a stale plan.** Any email with a missed-day streak must regenerate first. If regeneration fails the email must not be sent at all, because a coach emailing yesterday's list is worse than silence. Pinned in Task 5.
3. **A debrief arriving mid-afternoon.** Slot resolution in the wrong zone, or a day boundary computed in UTC, declares someone's day over while they are still working. Must be tested across a positive offset, a negative offset, and a DST transition. Pinned in Task 1.
4. **A mail outage stopping plan regeneration.** The plan commit and the send must be independent. A failed send records a failed attempt; it never rolls back a regenerated plan. Pinned in Task 5.
5. **An unsubscribe that does not work.** The footer link must act without a login, or it is decoration. A signed single-purpose token, not a session. Pinned in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | `StudyPlan.timeZone`, `StudyPlan.emailCoach`, `EmailSend` |
| `src/core/slots.ts` (create) | Local-time slot resolution, pure |
| `src/core/slots.test.ts` (create) | Its tests, including DST |
| `src/core/coach-state.ts` (create) | Plan to the tree's three inputs, pure |
| `src/core/coach-state.test.ts` (create) | Its tests |
| `src/core/coach-dialogue.ts` (create) | The dictionary: state to copy, pure |
| `src/core/coach-dialogue.test.ts` (create) | Its tests |
| `src/lib/FUNC-mail-render.ts` (create) | Copy plus data to HTML and text |
| `src/lib/FUNC-mail-render.test.ts` (create) | Its tests |
| `src/lib/FUNC-mail.ts` (modify) | Accept `html` alongside `text` |
| `src/lib/FUNC-coach.ts` (create) | The sender: regenerate, guard, send, record |
| `tests/coach/send.test.ts` (create) | Its tests, against a real database |
| `src/app/api/cron/tick/route.ts` (modify) | Call the coach per plan |
| `src/app/api/email-prefs/[token]/route.ts` (create) | No-login unsubscribe |
| `tests/coach/unsubscribe.test.ts` (create) | Its tests |

Four pure layers rather than one composer: slot resolution is date arithmetic, state classification is plan arithmetic, dialogue is copy, rendering is markup. Each is independently testable, and a reviewer rejecting the copy should not have to re-review the timezone maths. `src/core/` is where this codebase keeps pure engine code.

---

### Task 1: Local-time slot resolution

**Files:**
- Create: `apps/backend/src/core/slots.ts`
- Test: `apps/backend/src/core/slots.test.ts`

**Interfaces:**
- Produces: `type Slot = "prescription" | "nudge" | "debrief"`, `SLOT_LOCAL_TIMES` mapping each to an hour and minute (06:30, 20:00, 22:30), `localDateFor(instant: Date, timeZone: string): string` returning an ISO date, and `dueSlots(instant: Date, timeZone: string, alreadySent: Slot[]): Slot[]`.

This is the layer the whole feature rests on, and it is pure date arithmetic. Use `Intl.DateTimeFormat` with `timeZone` and no new dependency. `date-fns` is in `package.json` and used in zero files; do not reach for it here, since `Intl` handles zones correctly and `date-fns` without `date-fns-tz` does not.

- [ ] **Step 1: Write the failing tests**

```ts
test("the local date is the candidate's date, not the server's", () => {
  // 23:30 UTC is already tomorrow in Tokyo and still today in Los Angeles.
  const t = new Date("2027-01-04T23:30:00Z");
  expect(localDateFor(t, "Asia/Tokyo")).toBe("2027-01-05");
  expect(localDateFor(t, "America/Los_Angeles")).toBe("2027-01-04");
  expect(localDateFor(t, "UTC")).toBe("2027-01-04");
});

test("a slot is due once its local time has passed and it has not been sent", () => {
  const sevenAmLondon = new Date("2027-01-04T07:00:00Z");
  expect(dueSlots(sevenAmLondon, "Europe/London", [])).toEqual(["prescription"]);
});

test("a slot already sent is never due again", () => {
  const sevenAmLondon = new Date("2027-01-04T07:00:00Z");
  expect(dueSlots(sevenAmLondon, "Europe/London", ["prescription"])).toEqual([]);
});

test("a later instant makes the earlier slots due together", () => {
  const elevenPmLondon = new Date("2027-01-04T23:00:00Z");
  expect(dueSlots(elevenPmLondon, "Europe/London", [])).toEqual(["prescription", "nudge", "debrief"]);
});

// Review Focus 3
test("the debrief does not fire mid-afternoon for a western candidate", () => {
  // 23:00 UTC is 15:00 in Los Angeles. Nothing is due there yet except the morning slot.
  const t = new Date("2027-01-04T23:00:00Z");
  expect(dueSlots(t, "America/Los_Angeles", [])).toEqual(["prescription"]);
});

test("a DST transition does not duplicate or skip a day", () => {
  // London moves to BST on 2027-03-28. 00:30 UTC that day is 00:30 local,
  // and 01:30 UTC is 02:30 local, so the clock jumps over 01:00 to 02:00.
  expect(localDateFor(new Date("2027-03-28T00:30:00Z"), "Europe/London")).toBe("2027-03-28");
  expect(localDateFor(new Date("2027-03-28T01:30:00Z"), "Europe/London")).toBe("2027-03-28");
  // 06:00 UTC is 07:00 BST, so the 06:30 prescription is due.
  expect(dueSlots(new Date("2027-03-28T06:00:00Z"), "Europe/London", [])).toEqual(["prescription"]);
});

test("an unknown timezone is rejected rather than silently treated as UTC", () => {
  expect(() => localDateFor(new Date(), "Mars/Olympus")).toThrow(/time zone|timezone/i);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter backend exec vitest run src/core/slots.test.ts`

- [ ] **Step 3: Implement `slots.ts`**

Derive the local wall-clock from `Intl.DateTimeFormat` with `hour12: false` and the parts you need. Do not construct a `Date` from a formatted string and hope.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit**

---

### Task 2: Schema for zone, preference and idempotency

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: migration (generated)
- Modify: `apps/backend/tests/helpers/test-db.ts`
- Test: `apps/backend/tests/coach/schema.test.ts`

**Interfaces:**
- Consumes: Task 1's `Slot`.
- Produces: `StudyPlan.timeZone` (String, default `"UTC"`), `StudyPlan.emailCoach` (String, default `"all"`, one of `all` / `debrief-only` / `off`, documented as a closed set in a comment), and `EmailSend`.

`EmailSend`: `id`, `planId`, `localDate` (String, the candidate's own date as `YYYY-MM-DD`, not a DateTime, because it is a label in their calendar and not an instant), `slot`, `sentAt` (nullable), `failedAttempts` (Int, default 0), `lastError` (String, nullable), `createdAt`, relation to `StudyPlan`, `@@unique([planId, localDate, slot])`, `@@index([planId, localDate])`.

`timeZone` defaults to `"UTC"` rather than being required, so the migration does not need a backfill and an existing plan keeps working. A plan on the default gets correct behaviour, just in UTC.

- [ ] **Step 1: Write the failing tests**

```ts
test("a plan cannot record the same slot twice for one local date", async () => {
  const { planId } = await setupUserWithPlan({});
  await db.emailSend.create({ data: { planId, localDate: "2027-01-04", slot: "prescription" } });
  await expect(
    db.emailSend.create({ data: { planId, localDate: "2027-01-04", slot: "prescription" } }),
  ).rejects.toThrow();
});

test("the same slot on a different local date is allowed", async () => {
  const { planId } = await setupUserWithPlan({});
  await db.emailSend.create({ data: { planId, localDate: "2027-01-04", slot: "prescription" } });
  await db.emailSend.create({ data: { planId, localDate: "2027-01-05", slot: "prescription" } });
  expect(await db.emailSend.count({ where: { planId } })).toBe(2);
});

test("an existing plan defaults to UTC and the coach on", async () => {
  const { plan } = await setupUserWithPlan({});
  expect(plan.timeZone).toBe("UTC");
  expect(plan.emailCoach).toBe("all");
});

test("resetDb removes email sends", async () => {
  const { planId } = await setupUserWithPlan({});
  await db.emailSend.create({ data: { planId, localDate: "2027-01-04", slot: "debrief" } });
  await resetDb();
  expect(await db.emailSend.count()).toBe(0);
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Add the fields and the model**

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter backend exec prisma migrate dev --name add_email_coach`

- [ ] **Step 5: Add `emailSend` to `resetDb`, before `studyPlan`**

It has a foreign key to `StudyPlan`, so deleting it later fails on the constraint.

- [ ] **Step 6: Run the new tests and the whole suite**

- [ ] **Step 7: Commit**

---

### Task 3: State classification

**Files:**
- Create: `apps/backend/src/core/coach-state.ts`
- Test: `apps/backend/src/core/coach-state.test.ts`

**Interfaces:**
- Produces: `classify(input: CoachInput): CoachState` where `CoachState = { streak: StreakBand; shape: DayShape; logging: LoggingState; streakDays: number }`, with `StreakBand = "on-track" | "slip" | "drifting" | "serious" | "crisis"`, `DayShape = "rest" | "light" | "normal" | "heavy" | "catch-up"`, `LoggingState = "nothing" | "partial" | "complete" | "over"`.

The bands, from the spec exactly: streak 0 is `on-track`, 1 is `slip`, 2 to 3 is `drifting`, 4 to 6 is `serious`, 7 or more is `crisis`. Shape: no availability or a holiday is `rest`, under 45 scheduled minutes is `light`, over 150 minutes or carrying a mock is `heavy`, a list containing requeued work is `catch-up`, otherwise `normal`. Logging: no entry is `nothing`, some done is `partial`, all done is `complete`, all done plus extra logged is `over`.

`CoachInput` carries today's tasks, today's availability in minutes, whether today is a holiday, the consecutive missed-day count, and the logged counts. It does NOT read the database or the clock; the caller supplies everything.

Reuse rather than reimplement: `missedStudyDays` in `src/core/pace.ts` already computes consecutive missed days correctly, excluding holidays. Take its result as an input.

- [ ] **Step 1: Write the failing tests**

```ts
test.each([
  [0, "on-track"], [1, "slip"], [2, "drifting"], [3, "drifting"],
  [4, "serious"], [6, "serious"], [7, "crisis"], [30, "crisis"],
])("a streak of %i days is %s", (days, band) => {
  expect(classify(input({ streakDays: days })).streak).toBe(band);
});

test("a holiday is a rest day even when tasks exist", () => {
  expect(classify(input({ isHoliday: true, taskMinutes: 90 })).shape).toBe("rest");
});

test("shape follows scheduled minutes at the stated boundaries", () => {
  expect(classify(input({ taskMinutes: 44 })).shape).toBe("light");
  expect(classify(input({ taskMinutes: 45 })).shape).toBe("normal");
  expect(classify(input({ taskMinutes: 150 })).shape).toBe("normal");
  expect(classify(input({ taskMinutes: 151 })).shape).toBe("heavy");
});

test("a day carrying requeued work is catch-up whatever its size", () => {
  expect(classify(input({ taskMinutes: 200, hasRequeued: true })).shape).toBe("catch-up");
});

test("a day with a mock is heavy", () => {
  expect(classify(input({ taskMinutes: 60, hasMock: true })).shape).toBe("heavy");
});

test.each([
  [0, 3, "nothing"], [1, 3, "partial"], [3, 3, "complete"],
])("%i of %i tasks done is %s", (done, total, state) => {
  expect(classify(input({ tasksDone: done, taskCount: total })).logging).toBe(state);
});

test("logging beyond the plan is over, not complete", () => {
  expect(classify(input({ tasksDone: 3, taskCount: 3, extraLogged: 1 })).logging).toBe("over");
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement `coach-state.ts`**

Order matters in `shape`: check `rest` first, then `catch-up`, then `heavy`, then `light`, then `normal`. A holiday with requeued work is still a rest day.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit**

---

### Task 4: The dialogue dictionary

**Files:**
- Create: `apps/backend/src/core/coach-dialogue.ts`
- Test: `apps/backend/src/core/coach-dialogue.test.ts`

**Interfaces:**
- Consumes: Task 3's `CoachState`.
- Produces: `dialogueFor(slot: Slot, state: CoachState): DialogueKey | null` and `renderDialogue(key: DialogueKey, vars: DialogueVars): { subject: string; opening: string; pressure: string | null; close: string }`.

`null` from `dialogueFor` means no email is sent for that slot, which is the correct answer for a nudge on a rest day and for a nudge when something is already logged.

The fifteen keys and their copy come from the spec's dialogue tables verbatim: `REST_DAY`, `DAY_LIGHT`, `DAY_NORMAL`, `DAY_HEAVY`, `SLIP_1`, `DRIFT`, `SERIOUS`, `CRISIS`, `NUDGE_FIRST`, `NUDGE_STREAK`, `DAY_DONE`, `DAY_OVER`, `DAY_PARTIAL`, `DAY_LOST`. Copy the strings exactly rather than paraphrasing: the voice was argued over and the escalation ceiling depends on the precise wording.

Variables: `{name}`, `{daysToExam}`, `{streak}`, `{todayMinutes}`, `{taskCount}`, `{coveragePercent}`, `{finishDate}`, `{droppedCount}`, `{firstTask}`, and `{n}` for the partial case.

- [ ] **Step 1: Write the failing tests**

```ts
test("the tree picks the escalating prescription for each streak band", () => {
  expect(dialogueFor("prescription", state({ streak: "on-track", shape: "normal" }))).toBe("DAY_NORMAL");
  expect(dialogueFor("prescription", state({ streak: "slip" }))).toBe("SLIP_1");
  expect(dialogueFor("prescription", state({ streak: "drifting" }))).toBe("DRIFT");
  expect(dialogueFor("prescription", state({ streak: "serious" }))).toBe("SERIOUS");
  expect(dialogueFor("prescription", state({ streak: "crisis" }))).toBe("CRISIS");
});

test("a rest day gets the rest dialogue whatever the streak", () => {
  expect(dialogueFor("prescription", state({ streak: "crisis", shape: "rest" }))).toBe("REST_DAY");
});

test("the nudge is suppressed when there is nothing to nudge about", () => {
  expect(dialogueFor("nudge", state({ logging: "partial" }))).toBeNull();
  expect(dialogueFor("nudge", state({ logging: "complete" }))).toBeNull();
  expect(dialogueFor("nudge", state({ shape: "rest", logging: "nothing" }))).toBeNull();
});

test("the nudge escalates once a streak exists", () => {
  expect(dialogueFor("nudge", state({ streak: "on-track", logging: "nothing" }))).toBe("NUDGE_FIRST");
  expect(dialogueFor("nudge", state({ streak: "drifting", logging: "nothing" }))).toBe("NUDGE_STREAK");
});

test("the debrief reflects what was actually logged", () => {
  expect(dialogueFor("debrief", state({ logging: "nothing" }))).toBe("DAY_LOST");
  expect(dialogueFor("debrief", state({ logging: "partial" }))).toBe("DAY_PARTIAL");
  expect(dialogueFor("debrief", state({ logging: "complete" }))).toBe("DAY_DONE");
  expect(dialogueFor("debrief", state({ logging: "over" }))).toBe("DAY_OVER");
});

test("every variable in every dialogue is substituted", () => {
  // A leftover brace means a variable the dictionary names and the caller
  // does not supply, which would ship a literal {streak} to a candidate.
  for (const key of ALL_DIALOGUE_KEYS) {
    const out = renderDialogue(key, FULL_VARS);
    const joined = [out.subject, out.opening, out.pressure ?? "", out.close].join(" ");
    expect(joined).not.toMatch(/[{}]/);
  }
});

test("the escalation ceiling holds: no dialogue addresses the person rather than the work", () => {
  // The spec's floor, as a test. These are the second-person judgement
  // patterns the ceiling exists to forbid.
  for (const key of ALL_DIALOGUE_KEYS) {
    const out = renderDialogue(key, FULL_VARS);
    const joined = [out.subject, out.opening, out.pressure ?? "", out.close].join(" ").toLowerCase();
    expect(joined).not.toMatch(/you (clearly|obviously|never|always|do not want|don't want)/);
    expect(joined).not.toMatch(/lazy|pathetic|failure|hopeless|waste/);
  }
});

test("every dialogue closes with an action", () => {
  for (const key of ALL_DIALOGUE_KEYS) {
    if (key === "REST_DAY") continue; // the one case whose close is deliberately not an action
    expect(renderDialogue(key, FULL_VARS).close.trim().length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement `coach-dialogue.ts`**

One table, keyed by `DialogueKey`, holding the four strings. Substitution is a single pass over `{name}` style tokens; a token with no matching variable is an error rather than a silent empty string.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit**

---

### Task 5: The sender

**Files:**
- Create: `apps/backend/src/lib/FUNC-coach.ts`
- Modify: `apps/backend/src/lib/FUNC-mail.ts`
- Create: `apps/backend/src/lib/FUNC-mail-render.ts`
- Test: `apps/backend/src/lib/FUNC-mail-render.test.ts`
- Test: `apps/backend/tests/coach/send.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4, `generateHorizon` from `src/lib/FUNC-schedule.ts`, `sendMail` from `src/lib/FUNC-mail.ts`.
- Produces: `renderCoachMail(key, vars, data): { subject: string; html: string; text: string }` and `runCoachForPlan(planId: string, now: Date): Promise<{ sent: Slot[]; skipped: Slot[]; failed: Slot[] }>`.

`FUNC-mail.ts`'s `Mail` type gains an optional `html`, and `sendMail` passes it through. Update that file's header comment in the same change: it currently states that nothing should send mail without the email non-goal being revisited, and it has been.

The renderer's constraints are the spec's and they are not stylistic. Inline styles only, tables for layout, no `<style>`, no class attributes, no SVG, no flexbox, no grid. The progress bar is a two-cell table, one cell at a percentage width with a background colour. Every cell carries an explicit background and colour so dark mode cannot invert it unpredictably. Nothing load-bearing is an image, because images are blocked by default.

- [ ] **Step 1: Write the failing renderer tests**

```ts
test("the html carries no construct email clients drop", () => {
  const { html } = renderCoachMail("DAY_NORMAL", FULL_VARS, DATA);
  expect(html).not.toMatch(/<style/i);
  expect(html).not.toMatch(/class=/i);
  expect(html).not.toMatch(/<svg/i);
  expect(html).not.toMatch(/display:\s*(flex|grid)/i);
});

test("the progress bar is a table whose filled cell matches the percentage", () => {
  const { html } = renderCoachMail("DAY_NORMAL", { ...FULL_VARS, coveragePercent: 37 }, DATA);
  expect(html).toMatch(/width:\s*37%/);
});

test("every task in the data appears in both the html and the text", () => {
  const { html, text } = renderCoachMail("DAY_NORMAL", FULL_VARS, DATA);
  for (const task of DATA.tasks) {
    expect(html).toContain(task.title);
    expect(text).toContain(task.title);
  }
});

test("the text alternative survives without layout and carries no markup", () => {
  const { text } = renderCoachMail("DAY_NORMAL", FULL_VARS, DATA);
  expect(text).not.toMatch(/<[a-z]/i);
  expect(text.length).toBeGreaterThan(40);
});

test("html special characters in a resource name are escaped", () => {
  // Provider titles are third-party data. An unescaped ampersand breaks the
  // markup; an unescaped angle bracket is worse.
  const data = { ...DATA, tasks: [{ title: "Bonds & <Options>", minutes: 30, done: false }] };
  const { html } = renderCoachMail("DAY_NORMAL", FULL_VARS, data);
  expect(html).toContain("Bonds &amp; &lt;Options&gt;");
  expect(html).not.toContain("<Options>");
});
```

- [ ] **Step 2: Write the failing sender tests**

```ts
// Review Focus 1
test("running twice sends each slot once", async () => {
  const { planId } = await setupPlanWithTasks({ timeZone: "UTC" });
  const first = await runCoachForPlan(planId, new Date("2027-01-04T07:00:00Z"));
  const second = await runCoachForPlan(planId, new Date("2027-01-04T07:05:00Z"));
  expect(first.sent).toEqual(["prescription"]);
  expect(second.sent).toEqual([]);
  expect(await db.emailSend.count({ where: { planId, slot: "prescription" } })).toBe(1);
});

// Review Focus 2
test("a streak regenerates the plan before the email is composed", async () => {
  const { planId } = await setupPlanWithTasks({ missedDays: 3 });
  const before = await db.planTask.count({ where: { planId } });
  await runCoachForPlan(planId, new Date("2027-01-04T07:00:00Z"));
  // The regeneration ran: the backlog is now in the live window.
  expect(await db.planTask.count({ where: { planId } })).not.toBe(before);
});

test("a regeneration failure sends nothing at all", async () => {
  const { planId } = await setupPlanWithTasks({ missedDays: 3, breakRegeneration: true });
  const out = await runCoachForPlan(planId, new Date("2027-01-04T07:00:00Z"));
  expect(out.sent).toEqual([]);
  expect(await db.emailSend.count({ where: { planId, sentAt: { not: null } } })).toBe(0);
});

// Review Focus 4
test("a send failure records an attempt and leaves the plan intact", async () => {
  const { planId } = await setupPlanWithTasks({ failMail: true });
  const taskCountBefore = await db.planTask.count({ where: { planId } });
  const out = await runCoachForPlan(planId, new Date("2027-01-04T07:00:00Z"));
  expect(out.failed).toEqual(["prescription"]);
  const row = await db.emailSend.findFirst({ where: { planId, slot: "prescription" } });
  expect(row!.sentAt).toBeNull();
  expect(row!.failedAttempts).toBe(1);
  expect(await db.planTask.count({ where: { planId } })).toBe(taskCountBefore);
});

test("emailCoach off sends nothing and debrief-only sends only the debrief", async () => {
  const { planId: offPlan } = await setupPlanWithTasks({ emailCoach: "off" });
  expect((await runCoachForPlan(offPlan, new Date("2027-01-04T23:00:00Z"))).sent).toEqual([]);
  const { planId: dPlan } = await setupPlanWithTasks({ emailCoach: "debrief-only" });
  expect((await runCoachForPlan(dPlan, new Date("2027-01-04T23:00:00Z"))).sent).toEqual(["debrief"]);
});

test("the nudge is not sent once something is logged", async () => {
  const { planId } = await setupPlanWithTasks({ tasksDone: 1 });
  const out = await runCoachForPlan(planId, new Date("2027-01-04T20:30:00Z"));
  expect(out.sent).not.toContain("nudge");
});
```

- [ ] **Step 3: Run to verify they fail**

- [ ] **Step 4: Implement the renderer, then the sender**

The sender's order is load bearing and the tests above pin it: resolve due slots, bail on `emailCoach`, regenerate when the streak demands it and abort entirely on failure, classify, pick the dialogue, bail if `null`, claim the `EmailSend` row inside a transaction so a concurrent run loses the race, then send, then mark `sentAt`. A send failure updates `failedAttempts` and `lastError` and never throws past the slot.

- [ ] **Step 5: Run to verify they pass, then the whole suite**

- [ ] **Step 6: Commit**

---

### Task 6: Cron wiring and the no-login unsubscribe

**Files:**
- Modify: `apps/backend/src/app/api/cron/tick/route.ts`
- Create: `apps/backend/src/app/api/email-prefs/[token]/route.ts`
- Test: `apps/backend/tests/coach/unsubscribe.test.ts`
- Modify: `apps/backend/tests/helpers/test-db.ts` if a token table is added

**Interfaces:**
- Consumes: Task 5's `runCoachForPlan`.
- Produces: a `GET` on `/api/email-prefs/[token]` that sets `emailCoach` without a session, and coach counters on the cron's existing `CronRun` row.

The tick already loops `activePlans` and already catches per-plan failures without aborting the sweep. Add the coach call inside that loop, in its own try so a coach failure cannot stop `ProgressSnapshot` work, and report `emailsSent` and `emailsFailed` alongside the existing counters.

The token follows the `PasswordResetToken` pattern already in the schema: store a SHA-256 hash, never the token, because this table would otherwise hand an attacker working preference links for every candidate. It differs in two ways: it does not expire, since an unsubscribe link in an old email must still work, and it is single-purpose, so it can only change `emailCoach` and can do nothing else.

- [ ] **Step 1: Write the failing tests**

```ts
// Review Focus 5
test("the unsubscribe link works with no session", async () => {
  const { planId, token } = await setupPlanWithToken();
  const res = await GET(new Request(`http://x/api/email-prefs/${token}?set=off`), { params: { token } });
  expect(res.status).toBe(200);
  expect((await db.studyPlan.findUnique({ where: { id: planId } }))!.emailCoach).toBe("off");
});

test("the token is stored hashed, never in plaintext", async () => {
  const { token } = await setupPlanWithToken();
  const rows = await db.emailPrefToken.findMany();
  expect(rows.every((r) => r.tokenHash !== token)).toBe(true);
});

test("an unknown token changes nothing and does not reveal whether it existed", async () => {
  const res = await GET(new Request("http://x/api/email-prefs/nope?set=off"), { params: { token: "nope" } });
  expect(res.status).toBe(200);
});

test("the token can only set the preference, and rejects a value outside the set", async () => {
  const { planId, token } = await setupPlanWithToken();
  await GET(new Request(`http://x/api/email-prefs/${token}?set=admin`), { params: { token } });
  expect((await db.studyPlan.findUnique({ where: { id: planId } }))!.emailCoach).toBe("all");
});

test("a coach failure does not stop the nightly sweep", async () => {
  // The tick must still process snapshots for other plans.
  const { planId: broken } = await setupPlanWithTasks({ failMail: true });
  const { planId: fine } = await setupPlanWithTasks({});
  const res = await TICK(cronRequest());
  expect(res.status).toBe(200);
  expect(await db.progressSnapshot.count({ where: { planId: fine } })).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement the route and the cron wiring**

- [ ] **Step 4: Run to verify they pass, then the whole suite and typecheck**

- [ ] **Step 5: Send one real email end to end**

With SMTP configured locally, trigger a prescription for a real plan and open it in at least one client. Report the subject, whether the progress bar rendered, and whether the plain-text alternative is readable. A rendering check no human has looked at is not a rendering check: the whole point of the table-based markup is behaviour this suite cannot observe.

- [ ] **Step 6: Commit**

---

## Self-Review

**Spec coverage.** The three slots and their local times map to Task 1. The timezone prerequisite maps to Tasks 1 and 2. The decision tree maps to Tasks 3 and 4. The dialogue dictionary and the escalation ceiling map to Task 4. Email structure and its client constraints map to Task 5's renderer. Idempotency, send-failure isolation and the per-candidate kill switch map to Tasks 2, 5 and 6. The per-topic bar chart and DNS setup are out of scope by the Scope note. Covered.

**Gaps found and fixed while reviewing.** The spec says the escalation ceiling is a product decision but gave no way to enforce it, so Task 4 now tests it: no dialogue may address the person rather than the work, and every dialogue bar `REST_DAY` must close with an action. The spec also did not say what happens when a dialogue names a variable the caller does not supply; Task 4 makes that an error rather than shipping a literal `{streak}` to a candidate. And provider titles are third-party strings going into HTML, so Task 5 now has an escaping test, which nothing in the spec mentioned.

**Type consistency.** `Slot` is defined in Task 1 and consumed by Tasks 2, 4, 5 and 6. `CoachState` is defined in Task 3 and consumed by Task 4. `DialogueKey` is defined in Task 4 and consumed by Task 5. `EmailSend`'s `localDate` is a String in both the schema and every caller, matching `localDateFor`'s return type.

**Review Focus coverage.** Each of the five has a named test in the task owning the code: 1, 2 and 4 in Task 5, 3 in Task 1, 5 in Task 6.

**Proportion.** The plan is roughly as long as the spec section it implements, and most of its blocks are test assertions rather than implementation bodies.

---

## Related

- [Email study coach design](../specs/2026-11-11-email-coach-design.md): the spec, including the full dialogue tables this plan copies verbatim.
- [Daily prescription engine design](../specs/2026-11-10-daily-prescription-design.md): the engine whose output every email describes.
- [Day view design](../specs/2026-11-11-day-view-design.md): the screen every button links to, and the source of the copy conventions.
