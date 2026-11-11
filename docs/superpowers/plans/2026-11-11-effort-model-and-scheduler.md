# Effort Model and Scheduler Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the loaded provider catalogue into a dated list of first-pass tasks: estimate minutes for every resource, cap each topic's work at its exam-weight share, order the modules, and emit `PlanTask` rows for a rolling horizon.

**Architecture:** Four pure layers over the catalogue, each testable without a database, plus one persistence layer that writes tasks. Estimation turns a resource into minutes. Allocation turns exam weights into a per-topic minute budget. Ordering turns the prerequisite graph plus a strategy into a module sequence. Packing turns that sequence plus weekly availability into dated tasks. Calibration feeds logged actuals back into estimation.

**Tech Stack:** TypeScript on Node 22, Prisma 6, Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-daily-prescription-design.md`

## Scope note

Second of the spec's four subsystems. It produces working software on its own: a candidate with a seeded catalogue gets a correct, dated, budgeted list of first-pass work. It deliberately stops before review visits, mocks, feasibility triage, the readiness gate and the plan contract, which are subsystem 3, because each of those reads a completed first pass and none can be tested without one. Subsystem 4 is the API and day view.

One consequence to hold: until subsystem 3 lands, a plan's tasks run out when the first pass is done. That is correct for this slice, not a bug.

## Global Constraints

- Every script under `prisma/` runs under plain `node` on Node 22. Local imports carry an explicit `.ts` extension, and anything that is only a type uses `import type`. Vitest cannot catch a violation: its esbuild loader erases a value-shaped type import that plain node rejects. `prisma/cli-smoke.test.ts` is the only guard, and any new CLI must be added to its `SCRIPTS` array.
- No real provider Drive id, file name, page count, size, question count, or CFA Institute outcome wording in any committed file, including test fixtures and comments. Committable: provider names, slugs, edition years, curriculum topic names, exam weight ranges. Use fabricated 33-character Drive ids.
- Prose in comments and commit messages uses no em-dashes and no double-dashes.
- Comments explain why, not what.
- Never commit a red suite or a failing typecheck. Both have shipped on this project before.
- No test body wrapped in a conditional, and no tautological assertion. Both produce tests that cannot fail and both shipped before being caught.
- Effort estimation is pure: no database reads, no clock, no randomness. It takes catalogue facts and constants and returns minutes.

## Review Focus

Five failure modes the spec implies that no task's happy path exercises.

1. **A topic's whole first pass vanishing under the weight cap.** The cap trims an over-served topic, and the trim order reaches questions only after notes and review video are gone. A cap computed against the wrong denominator, or applied before the floor, can silently zero a topic's practice. Pinned in Task 3.
2. **A prerequisite cycle hanging the scheduler.** Prerequisites are seeded curriculum data, so a bad edge is a data error, not a code error, and a naive topological walk either loops forever or drops every module in the cycle. Pinned in Task 4.
3. **A module with no provider coverage getting zero minutes and disappearing.** FSA Integration has no UWorld questions and the spec forbids letting material shortfall shrink the plan. An estimator returning 0 for an uncovered module removes it from the schedule silently. Pinned in Task 2.
4. **Calibration diverging on a forgotten timer.** The ratio is clamped to 0.25 to 4.0 precisely because a timer left running produces an actual of hundreds of minutes. An unclamped or wrongly ordered update lets one bad observation dominate the learned factor permanently. Pinned in Task 6.
5. **Regeneration destroying work already done.** The horizon regenerates on every availability change, and a task already carrying a log entry must survive even when it sits in the future, because the candidate worked ahead. Pinned in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | `PlanTask`, `StudyLogEntry.actualMinutes`, plan strategy and target fields, `Reading` prerequisite and band fields |
| `src/core/effort.ts` (create) | Resource to minutes, pure |
| `src/core/effort.test.ts` (create) | Its tests |
| `src/core/allocation.ts` (create) | Exam-weight budget and the trim ladder, pure |
| `src/core/allocation.test.ts` (create) | Its tests |
| `src/core/ordering.ts` (create) | Prerequisite graph and strategy-driven module sequence, pure |
| `src/core/ordering.test.ts` (create) | Its tests |
| `src/core/packing.ts` (create) | Module sequence plus availability to dated task shapes, pure |
| `src/core/packing.test.ts` (create) | Its tests |
| `src/core/calibration.ts` (create) | Learned pace factor, pure |
| `src/core/calibration.test.ts` (create) | Its tests |
| `src/lib/FUNC-schedule.ts` (create) | The one impure layer: reads catalogue and plan, writes `PlanTask` |
| `tests/schedule/generate.test.ts` (create) | Its tests, against a real database |
| `prisma/seed-data/prerequisites-l2-2027.json` (create, gitignored) | Seeded curriculum facts |
| `prisma/seed-prerequisites.ts` (create) | Loads them |

Five pure modules rather than one scheduler file: each is independently testable without a database, and a reviewer rejecting the ordering logic should not have to re-review estimation. `src/core/` is where this codebase already keeps pure engine code (`pace.ts`), so these sit beside it.

---

### Task 1: Schema for tasks, calibration and plan strategy

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: migration (generated)
- Modify: `apps/backend/tests/helpers/test-db.ts`
- Test: `apps/backend/tests/schedule/schema.test.ts`

**Interfaces:**
- Produces: `PlanTask`, `StudyLogEntry.actualMinutes`, `StudyPlan.orderingStrategy`, `Reading.prereqRefs` / `Reading.phaseBand` / `Reading.priorityRank`. Every later task reads these.

Fields the spec fixes:

- `PlanTask`: `id`, `planId`, `date`, `order`, `kind`, `resourceId` (nullable), `readingIds` (String array, plural because one Ethics task covers seven modules), `estimatedMinutes`, `actualMinutes` (nullable), `timerStartedAt` (nullable), `status`, `splitOf` (nullable), `splitIndex`, `splitCount`, `requiresConfidence`, `questionTarget` (nullable), `vignetteFrom` / `vignetteTo` (nullable), `mode` (nullable), `frozen`, `logEntryId` (nullable), `insertedBecause` (nullable). `@@index([planId, date])`, `@@unique([planId, date, order])`.
- `StudyLogEntry.actualMinutes` is NOT added. Minutes live on `PlanTask`. The spec is explicit: one task fans out to many log entries, so a minute count on the log would be duplicated or divided, and calibration needs exactly one estimated-versus-actual pair per task.
- `StudyPlan.orderingStrategy` String, default `"curriculum"`.
- `Reading.prereqRefs` String array (refs of readings that must precede it), `Reading.phaseBand` Int nullable, `Reading.priorityRank` Int nullable.

`estimatedMinutes` is stored as generated, never recomputed on read, so a later recalibration cannot retroactively rewrite frozen history.

- [ ] **Step 1: Write the failing tests**

```ts
test("a task records the estimate it was generated with", async () => {
  const t = await makeTask({ estimatedMinutes: 45 });
  expect(t.estimatedMinutes).toBe(45);
  expect(t.actualMinutes).toBeNull();
});

test("two tasks cannot occupy the same slot on a day", async () => {
  await makeTask({ date: "2027-01-05", order: 1 });
  await expect(makeTask({ date: "2027-01-05", order: 1 })).rejects.toThrow();
});

test("one task can cover many readings", async () => {
  const t = await makeTask({ readingIds: ["a", "b", "c", "d", "e", "f", "g"] });
  expect(t.readingIds).toHaveLength(7);
});

test("resetDb removes plan tasks", async () => {
  await makeTask({});
  await resetDb();
  expect(await db.planTask.count()).toBe(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter backend exec vitest run tests/schedule/schema.test.ts`
Expected: FAIL, `db.planTask` is undefined.

- [ ] **Step 3: Add the models and fields, with comments giving the reason each exists**

In particular record why minutes live on the task and not the log, and why `estimatedMinutes` is persisted rather than derived.

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter backend exec prisma migrate dev --name add_plan_tasks`

- [ ] **Step 5: Add `planTask` to `resetDb`, before `studyPlan`**

- [ ] **Step 6: Run the new tests and the whole suite**

Run: `pnpm --filter backend test`
Expected: new tests pass, existing 271 still pass.

- [ ] **Step 7: Commit**

---

### Task 2: Effort estimation

**Files:**
- Create: `apps/backend/src/core/effort.ts`
- Test: `apps/backend/src/core/effort.test.ts`

**Interfaces:**
- Produces:
  - `type EffortConstants` with the eleven named constants, and `DEFAULT_EFFORT_CONSTANTS`
  - `estimateResource(r: ResourceInput, ctx: EffortContext, k?: number): number` returning whole minutes
  - `estimateModule(m: ModuleInput, ctx: EffortContext): ModuleEstimate` with a per-kind breakdown
  - `type ResourceInput = { kind: string; notesPages?: number; questionCount?: number; calcCount?: number; answerWords?: number; exhibitCount?: number; lectureMinutes?: number }`

Seed constants, copied verbatim from the spec: `PAGE_RATE` 6.0, `EOCQ_MULT` 0.55, `REVIEW_MULT` 0.25, `SEMINAR_MIN` 35, `NOTES_RATE` 2.5, `Q_BASE` 2.5, `Q_CALC` 4.5, `WPM` 140, `IMG_MIN` 0.5, `CALC_REDO` 1.0, `ET_LM3_MIN` 180.

Formulas, also verbatim: lecture `max(15, PAGE_RATE × notesPages)`; walkthrough `max(10, EOCQ_MULT × lectureMinutes)`; review `max(8, REVIEW_MULT × lectureMinutes)`; seminar flat `SEMINAR_MIN`; notes `NOTES_RATE × pages`; question block `Q × (Q_BASE + (Q_CALC − Q_BASE) × calcShare)`; explanation review `answerWords / WPM + IMG_MIN × exhibits + CALC_REDO × calcCount`.

File size plays no part in any estimate. The spec's whole argument is that it cannot: the implied constant spans 3.5-fold inside one course.

- [ ] **Step 1: Write the failing tests**

```ts
test.each([
  ["lecture", { notesPages: 5 }, 30],      // 6.0 * 5
  ["lecture", { notesPages: 1 }, 15],      // floor wins over 6.0 * 1
  ["seminar", {}, 35],
  ["notes", { notesPages: 10 }, 25],       // 2.5 * 10
])("%s with %j estimates %i minutes", (kind, input, expected) => {
  expect(estimateResource({ kind, ...input }, CTX)).toBe(expected);
});

test("a question block costs more as its calculation share rises", () => {
  const plain = estimateResource({ kind: "question_set", questionCount: 10, calcCount: 0 }, CTX);
  const half = estimateResource({ kind: "question_set", questionCount: 10, calcCount: 5 }, CTX);
  expect(plain).toBe(25);          // 10 * 2.5
  expect(half).toBe(35);           // 10 * (2.5 + 2.0 * 0.5)
  expect(half).toBeGreaterThan(plain);
});

test("explanation review charges for words, exhibits and calculation redos", () => {
  // 1400/140 = 10, + 0.5*4 = 2, + 1.0*3 = 3
  expect(estimateResource({ kind: "answer_set", answerWords: 1400, exhibitCount: 4, calcCount: 3 }, CTX)).toBe(15);
});

// Review Focus 3
test("a module with no provider resources still gets its weight-implied minutes, never zero", () => {
  const est = estimateModule({ ref: "fsa/lm6", resources: [], weightImpliedMinutes: 240 }, CTX);
  expect(est.total).toBe(240);
  expect(est.hasMaterial).toBe(false);
});

test("file size never changes an estimate", () => {
  const small = estimateResource({ kind: "lecture", notesPages: 5, sizeKb: 1 }, CTX);
  const huge = estimateResource({ kind: "lecture", notesPages: 5, sizeKb: 9_000_000 }, CTX);
  expect(small).toBe(huge);
});

test("a learned pace factor scales an estimate", () => {
  expect(estimateResource({ kind: "seminar" }, CTX, 1.5)).toBe(53); // 35 * 1.5, rounded
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement `effort.ts`**

Round to whole minutes at the boundary, not inside, so a module total does not drift from the sum of its parts by more than a minute.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Assert the model reproduces the spec's budget**

Add one test that runs `estimateModule` over a fabricated catalogue shaped like the real one (45 lecture modules with the real notes page total of 646, 1064 questions at a 24 percent calculation share) and asserts the core subtotal lands within 5 percent of the spec's 213.4 hours. This is the check that catches a formula transcribed wrongly, which no per-formula test can see.

- [ ] **Step 6: Commit**

---

### Task 3: Weight-capped allocation

**Files:**
- Create: `apps/backend/src/core/allocation.ts`
- Test: `apps/backend/src/core/allocation.test.ts`

**Interfaces:**
- Consumes: Task 2's `ModuleEstimate`.
- Produces: `allocate(topics: TopicEstimate[], totalMinutes: number): AllocationResult` where `AllocationResult = { byTopic: Map<string, TopicBudget>; trimmed: TrimRecord[]; surplusMinutes: number }`.

Each topic's first-pass minutes are capped at its exam-weight share of the plan, applied whether or not the plan is feasible. Surplus from an over-served topic is not returned to it and not discarded: it is reported as `surplusMinutes` for subsystem 3 to spend on review.

The trim order within an over-served topic, cheapest value first: notes pre-reads, then review video, then question sampling by highest calculation share. Every trim is recorded in `trimmed` with what was dropped and why, because the spec requires the plan to explain itself.

- [ ] **Step 1: Write the failing tests**

```ts
test("a topic at its weight share is untouched", () => {
  const r = allocate([topic("qm", { weightMid: 10, estimateMinutes: 100 })], 1000);
  expect(r.trimmed).toEqual([]);
  expect(r.byTopic.get("qm")!.minutes).toBe(100);
});

test("an over-served topic is trimmed to its share and the surplus is reported", () => {
  // 137 minutes of material in a topic entitled to 100.
  const r = allocate([topic("eq", { weightMid: 10, estimateMinutes: 137, notes: 20, review: 10, questions: 60 })], 1000);
  expect(r.byTopic.get("eq")!.minutes).toBe(100);
  expect(r.surplusMinutes).toBe(37);
});

test("trimming takes notes first, then review video, then questions", () => {
  const r = allocate([topic("eq", { weightMid: 10, estimateMinutes: 137, notes: 20, review: 10, questions: 60 })], 1000);
  expect(r.trimmed.map((t) => t.layer)).toEqual(["notes", "review", "questions"]);
  expect(r.trimmed.find((t) => t.layer === "notes")!.minutes).toBe(20);
});

// Review Focus 1
test("a topic never loses all of its practice, however over-served", () => {
  const r = allocate([topic("eq", { weightMid: 1, estimateMinutes: 1000, notes: 50, review: 50, questions: 900 })], 100);
  const eq = r.byTopic.get("eq")!;
  expect(eq.questionMinutes).toBeGreaterThan(0);
  expect(r.trimmed.some((t) => t.layer === "questions")).toBe(true);
});

test("an under-served topic is not padded", () => {
  const r = allocate([topic("eth", { weightMid: 10, estimateMinutes: 60 })], 1000);
  expect(r.byTopic.get("eth")!.minutes).toBe(60);
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement `allocation.ts`**

The practice floor in the fourth test is the spec's own guardrail, half of what the cap would otherwise allow. Name the constant.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Assert against the real misallocation the spec measured**

Add a test using the spec's measured per-topic ratios (Equities 1.37, Quant 1.25, Ethics 0.72, Economics 0.75) and assert that after allocation no topic exceeds its weight share and the surplus is non-zero. This is the finding the whole layer exists to fix.

- [ ] **Step 6: Commit**

---

### Task 4: Prerequisite graph and module ordering

**Files:**
- Create: `apps/backend/src/core/ordering.ts`
- Test: `apps/backend/src/core/ordering.test.ts`
- Create: `apps/backend/prisma/seed-data/prerequisites-l2-2027.json` (gitignored)
- Create: `apps/backend/prisma/seed-prerequisites.ts`

**Interfaces:**
- Produces: `orderModules(groups: SchedulableGroup[], strategy: Strategy): SchedulableGroup[]` and `type Strategy = "curriculum" | "weight" | "confidence"`.

A group is the transitive closure of "shares a provider asset", so the seven Ethics Guidance modules collapse into one and the 51 modules become 45 groups. A naive one-task-per-module loop would otherwise schedule the same long video seven times.

The sort key is lexicographic over: phase band, topic cohesion, module order, effort-versus-return rank, return per hour, module id. Which term leads is set by the strategy, not fixed in code. The return-per-hour term divides by `max(estimatedMinutes, weightImpliedMinutes)` so a module cannot win on cheapness caused by a missing asset.

Prerequisites are seeded data. The real edges, from the spec: regression before time series and machine learning; term structure before arbitrage-free valuation before bonds with embedded options; dividend valuation before free cash flow and residual income; cost of capital before free cash flow valuation; the five FSA modules before FSA Integration; the Code before Guidance before Application.

- [ ] **Step 1: Write the failing tests**

```ts
test("a prerequisite always precedes its dependant", () => {
  const out = orderModules(GROUPS_WITH_PREREQS, "curriculum");
  expect(indexOf(out, "qm/lm1")).toBeLessThan(indexOf(out, "qm/lm5"));
});

test("the same input always gives the same order", () => {
  expect(orderModules(GROUPS, "curriculum")).toEqual(orderModules(GROUPS, "curriculum"));
});

test("strategy changes which term leads, not the prerequisite graph", () => {
  const byCurriculum = orderModules(GROUPS, "curriculum");
  const byWeight = orderModules(GROUPS, "weight");
  expect(byCurriculum).not.toEqual(byWeight);
  // Both still respect prerequisites.
  for (const out of [byCurriculum, byWeight]) {
    expect(indexOf(out, "qm/lm1")).toBeLessThan(indexOf(out, "qm/lm5"));
  }
});

test("a fanned-out group is scheduled once, carrying every module it covers", () => {
  const out = orderModules(GROUPS_WITH_ETHICS_FANOUT, "curriculum");
  const guidance = out.filter((g) => g.ref === "et/lm2");
  expect(guidance).toHaveLength(1);
  expect(guidance[0].readingRefs).toHaveLength(7);
});

test("a module cannot rank high merely because it has no material", () => {
  // Same weight, but one has no questions so its raw estimate is tiny.
  const out = orderModules([cheapBecauseUncovered("fsa/lm6"), normal("fsa/lm1")], "weight");
  expect(indexOf(out, "fsa/lm6")).toBeGreaterThan(indexOf(out, "fsa/lm1"));
});

// Review Focus 2
test("a prerequisite cycle is reported, not hung or silently dropped", () => {
  expect(() => orderModules(GROUPS_WITH_CYCLE, "curriculum")).toThrow(/cycle/i);
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement `ordering.ts`**

A greedy walk over ready groups. Detect a cycle by noticing that no group is ready while groups remain, and name the groups involved in the error.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Write the prerequisite seed file and its loader**

`seed-prerequisites.ts` writes `Reading.prereqRefs`, `phaseBand` and `priorityRank`. Add it to `cli-smoke.test.ts`'s `SCRIPTS`. Run it against the real database and assert every edge resolves to a real reading, failing loudly when one does not.

- [ ] **Step 6: Commit**

---

### Task 5: Packing a module sequence into days

**Files:**
- Create: `apps/backend/src/core/packing.ts`
- Test: `apps/backend/src/core/packing.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 4.
- Produces: `packDays(seq: SchedulableGroup[], cal: Calendar, opts: PackOptions): PlannedDay[]` where `Calendar` carries weekly availability and holiday ranges and `PlannedDay = { date: string; tasks: PlannedTask[] }`.

Within a module the chain is: notes pre-read, lecture, walkthrough where one exists, questions in vignette-boundary blocks, confidence checkpoint on the last task. Question mode comes from the reading's own data: a calculation share at or above 0.35 is a timed drill, otherwise untimed review.

Packing rules the spec fixes: at most two groups in flight, one content and one practice. Tasks split only at natural boundaries, and never mid-vignette, because a 4 or 6 question item set is the unit of exam practice. No slice under 15 minutes. A task under 15 minutes merges into the preceding task of the same module. Longest tasks prefer the largest blocks.

- [ ] **Step 1: Write the failing tests**

```ts
test("a day never exceeds its availability", () => {
  const days = packDays(SEQ, calendar({ mon: 90 }), OPTS);
  for (const d of days) expect(sum(d.tasks.map((t) => t.estimatedMinutes))).toBeLessThanOrEqual(90);
});

test("a holiday gets no tasks", () => {
  const days = packDays(SEQ, calendar({ mon: 90, holidays: ["2027-01-04"] }), OPTS);
  expect(days.find((d) => d.date === "2027-01-04")!.tasks).toEqual([]);
});

test("a module's chain is emitted in order", () => {
  const kinds = packDays(ONE_MODULE, calendar({ every: 600 }), OPTS).flatMap((d) => d.tasks.map((t) => t.kind));
  expect(kinds).toEqual(["content-notes", "content-video", "eocq", "questions"]);
});

test("a question block never splits inside a vignette", () => {
  const days = packDays(BIG_QUESTION_MODULE, calendar({ every: 60 }), OPTS);
  for (const t of days.flatMap((d) => d.tasks).filter((t) => t.kind === "questions")) {
    expect(t.vignetteFrom).toBeLessThanOrEqual(t.vignetteTo!);
    expect(Number.isInteger(t.vignetteFrom)).toBe(true);
  }
});

test("a long lecture splits into parts, none under 15 minutes", () => {
  const tasks = packDays(LONG_LECTURE, calendar({ every: 60 }), OPTS).flatMap((d) => d.tasks);
  const parts = tasks.filter((t) => t.splitOf);
  expect(parts.length).toBeGreaterThan(1);
  for (const p of parts) expect(p.estimatedMinutes).toBeGreaterThanOrEqual(15);
  expect(parts.map((p) => p.splitIndex)).toEqual([1, 2, 3]);
});

test("question mode follows the reading's calculation share", () => {
  expect(modeOf(packDays(CALC_HEAVY, CAL, OPTS))).toBe("timed-drill");     // share 0.5
  expect(modeOf(packDays(JUDGEMENT, CAL, OPTS))).toBe("untimed-review");   // share 0.1
});

test("only the last task of a module asks for confidence", () => {
  const tasks = packDays(ONE_MODULE, calendar({ every: 600 }), OPTS).flatMap((d) => d.tasks);
  expect(tasks.filter((t) => t.requiresConfidence)).toHaveLength(1);
  expect(tasks.at(-1)!.requiresConfidence).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement `packing.ts`**

Pure: it takes a calendar rather than reading a clock, so a test can pin dates exactly.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit**

---

### Task 6: Calibration

**Files:**
- Create: `apps/backend/src/core/calibration.ts`
- Test: `apps/backend/src/core/calibration.test.ts`

**Interfaces:**
- Produces: `updateFactor(prior: FactorNode, observation: { estimated: number; actual: number }): FactorNode` and `factorFor(tree: FactorTree, key: FactorKey): number`.

The spec's model exactly:

```
r       = clamp(actualMinutes / estimatedMinutes, 0.25, 4.0)
kObs    = EWMA(r), half-life 14 blocks
kHat(n) = (n * kObs + m * kHat(parent)) / (n + m),  m = 5
hierarchy: global -> (provider, kind) -> (provider, kind, topic)
```

- [ ] **Step 1: Write the failing tests**

```ts
test("with no observations the factor is its parent's", () => {
  expect(factorFor(EMPTY_TREE, { provider: "mm", kind: "lecture" })).toBe(1);
});

test("a candidate who runs slow pulls the factor above one", () => {
  let node = EMPTY;
  for (let i = 0; i < 10; i++) node = updateFactor(node, { estimated: 60, actual: 90 });
  expect(node.kObs).toBeCloseTo(1.5, 1);
});

// Review Focus 4
test("a forgotten timer cannot dominate the learned factor", () => {
  let node = EMPTY;
  for (let i = 0; i < 5; i++) node = updateFactor(node, { estimated: 60, actual: 60 });
  const before = node.kObs;
  node = updateFactor(node, { estimated: 60, actual: 60 * 400 }); // timer left running overnight
  expect(node.kObs).toBeLessThan(before * 1.6);                   // clamped at 4.0, then averaged
});

test("five observations put the blend halfway between prior and observed", () => {
  // m = 5, so at n = 5 the learned value and the parent carry equal weight.
  let node = EMPTY;
  for (let i = 0; i < 5; i++) node = updateFactor(node, { estimated: 60, actual: 120 });
  expect(blended(node, 1.0)).toBeCloseTo(1.5, 1);
});

test("a deeper node falls back to its parent until it has its own observations", () => {
  const tree = treeWith({ provider: "mm", kind: "lecture" }, 1.4);
  expect(factorFor(tree, { provider: "mm", kind: "lecture", topic: "qm" })).toBeCloseTo(1.4, 2);
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement `calibration.ts`**

Clamp before the moving average, never after: clamping the average lets one extreme observation move it first and be trimmed second.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit**

---

### Task 7: Generate and regenerate tasks

**Files:**
- Create: `apps/backend/src/lib/FUNC-schedule.ts`
- Test: `apps/backend/tests/schedule/generate.test.ts`
- Modify: `apps/backend/tests/helpers/fixtures.ts`

**Interfaces:**
- Consumes: Tasks 1 to 6.
- Produces: `generateHorizon(planId: string, today: string): Promise<{ created: number; frozen: number; kept: number }>`.

The one impure layer. It reads the plan, its catalogue editions and the curriculum, runs the five pure layers, and writes `PlanTask` rows for today plus 14 days. Beyond that nothing is materialised.

Regeneration replaces unfrozen days wholesale keyed on `(planId, date, order)`. Days before today are frozen with their outcomes. **A task carrying a `logEntryId` is never destroyed, even when its date is in the future**, because the candidate worked ahead and that is data.

- [ ] **Step 1: Write the failing tests**

```ts
test("generates a stable horizon", async () => {
  const { planId } = await setupPlanWithCatalogue();
  const a = await generateHorizon(planId, "2027-01-04");
  const b = await generateHorizon(planId, "2027-01-04");
  expect(b.created).toBe(0);
  expect(await db.planTask.count({ where: { planId } })).toBe(a.created);
});

test("materialises today plus fourteen days and no more", async () => {
  const { planId } = await setupPlanWithCatalogue();
  await generateHorizon(planId, "2027-01-04");
  const dates = (await db.planTask.findMany({ where: { planId } })).map((t) => t.date.toISOString().slice(0, 10));
  expect(Math.max(...dates.map(Date.parse))).toBeLessThanOrEqual(Date.parse("2027-01-18"));
});

test("yesterday's undone tasks are frozen, not deleted", async () => {
  const { planId } = await setupPlanWithCatalogue();
  await generateHorizon(planId, "2027-01-04");
  await generateHorizon(planId, "2027-01-05");
  const yesterday = await db.planTask.findMany({ where: { planId, date: new Date("2027-01-04") } });
  expect(yesterday.length).toBeGreaterThan(0);
  expect(yesterday.every((t) => t.frozen)).toBe(true);
});

// Review Focus 5
test("a future task the candidate already completed survives regeneration", async () => {
  const { planId } = await setupPlanWithCatalogue();
  await generateHorizon(planId, "2027-01-04");
  const future = await db.planTask.findFirst({ where: { planId, date: new Date("2027-01-10") } });
  await db.planTask.update({ where: { id: future!.id }, data: { logEntryId: "fake-log", status: "done" } });

  await generateHorizon(planId, "2027-01-04"); // availability changed, window regenerates

  const still = await db.planTask.findUnique({ where: { id: future!.id } });
  expect(still).not.toBeNull();
  expect(still!.status).toBe("done");
});

test("changing the ordering strategy regenerates the window and nothing else", async () => {
  const { planId } = await setupPlanWithCatalogue();
  await generateHorizon(planId, "2027-01-04");
  const before = await db.planTask.findMany({ where: { planId }, orderBy: [{ date: "asc" }, { order: "asc" }] });
  await db.studyPlan.update({ where: { id: planId }, data: { orderingStrategy: "weight" } });
  await generateHorizon(planId, "2027-01-04");
  const after = await db.planTask.findMany({ where: { planId }, orderBy: [{ date: "asc" }, { order: "asc" }] });
  expect(after.map((t) => t.resourceId)).not.toEqual(before.map((t) => t.resourceId));
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement `FUNC-schedule.ts`**

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Run against the real seeded catalogue**

Generate a horizon for a real plan over the loaded Meldrum and UWorld editions, and report the first seven days with their resource names and minute counts. The spec's worked example is the comparison. A day that is empty, or one that exceeds its availability, is a defect even though every unit test passes.

- [ ] **Step 6: Extend `seedCatalogue` in fixtures so later plans can build on this**

- [ ] **Step 7: Commit**

---

## Self-Review

**Spec coverage.** Effort model maps to Task 2, its constants verbatim. Calibration maps to Task 6. The weight cap maps to Task 3. Module ordering, the prerequisite graph, the group collapse and the three strategies map to Task 4. The within-module chain, question mode, splitting and the in-flight cap map to Task 5. The scheduling unit, the 14-day horizon, freezing and regeneration map to Tasks 1 and 7. Review visits, mocks, feasibility, the readiness gate, the plan contract, phases and material gap reporting are out of scope by the Scope note and carry to subsystem 3. Covered.

**Gaps found and fixed while reviewing:** the spec says calibration needs an actual-minutes field and the plan originally put it on `StudyLogEntry`, which contradicts the spec's own reasoning two paragraphs later. Task 1 now puts it on `PlanTask` and records why. Task 2 originally had no check that the formulas reproduce the spec's 213.4-hour budget, so a transcription error in one constant would have passed every per-formula test; Step 5 adds it. Task 4's cycle detection was unstated, which for seeded prerequisite data is a data error that must be reported rather than hung on.

**Type consistency.** `ModuleEstimate` is defined in Task 2 and consumed by Tasks 3, 4 and 7. `SchedulableGroup` is defined in Task 4 and consumed by Tasks 5 and 7. `Strategy` is the same three strings in Task 4 and in `StudyPlan.orderingStrategy` from Task 1. `PlannedTask` from Task 5 maps field for field onto `PlanTask` from Task 1.

**Review Focus coverage.** Each of the five has a named test in the task owning the code: 1 in Task 3, 2 in Task 4, 3 in Task 2, 4 in Task 6, 5 in Task 7.

**Proportion.** The plan is roughly half the length of the spec sections it implements, and most of its blocks are test assertions rather than implementation bodies.

---

## Related

- [Daily prescription engine design](../specs/2026-11-10-daily-prescription-design.md): the spec, and the two subsystems that follow this one.
- [Provider catalogue plan](2026-11-10-provider-catalogue.md): the subsystem this builds on, now merged.
- [Seeding a curriculum level](../../SEEDING.md): the loader contract and the production gotchas any new seed script inherits.
