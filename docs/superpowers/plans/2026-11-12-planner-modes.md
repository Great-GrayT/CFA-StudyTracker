# Planner Modes, Paired Practice and Mastery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the planner's single implicit ordering with three switchable plan modes, pair every minute of first-pass reading with a candidate-set multiple of question minutes in the same sitting, and drive the review phase off a computed mastery figure rather than a coverage tick.

**Architecture:** Five new pure modules in `apps/backend/src/core`, each testable with no database: `tuning.ts` parses and clamps every candidate-editable constant, `mastery.ts` turns logged work into a number, `sequence.ts` chooses the unit order, `pairing.ts` solves the achievable practice ratio, reconciles off-plan work and packs the first pass, and `review.ts` queues, projects and packs the review phase. One composition layer, `FUNC-schedule.ts:366`, is rewired to call them. One schema change adds four columns to `StudyPlan`. One API surface exposes the constants; one settings section lets the candidate set them.

**Tech Stack:** TypeScript on Node 22, Prisma 6, Postgres, Vitest, Next.js 15, React 19.

**Spec:** `docs/superpowers/specs/2026-11-12-planner-modes-design.md`

## Global Constraints

- `apps/backend/src/core/*` stays pure: no database, no HTTP, no framework imports. New modules obey this.
- No new runtime dependency. Prisma, Next, Zod and Vitest only.
- Mode `effort-return` must produce byte-identical output to today's engine. `ordering.test.ts` passes unchanged throughout; any change to it is a defect in this work.
- The `weight` and `confidence` branches in `ordering.ts:52` stay, with their tests. They are only unexposed as plan modes.
- Exam weight is never a sort key. It caps minutes (`allocation.ts:68`) and weights readiness reporting. Nothing else.
- Every constant in the spec's tuning table is candidate-editable, with the spec's exact default and range.
- Freshness decay uses `exp(-ln2 * days / halfLifeDays)`, not a bare `exp(-days / tau)`. The `ln2` is what makes the field mean a half-life.
- Accuracy is Laplace-smoothed as `(correct + 1) / (answered + 2)`.
- Prose in code comments, commits and user-facing copy uses no em-dashes and no double-hyphens. Commas, colons, parentheses or a new sentence instead.
- The three plan mode identifiers are exactly `effort-return`, `curriculum-strict`, `curriculum-topic`. The four review policies are exactly `decay-triggered`, `after-coverage`, `weekly-interleave`, `fixed-date`.

## Review Focus

Five conditions the spec implies, that a candidate will meet, and that no task's happy path exercises. Each has its test pinned to the task that owns the code.

- **A unit with no logged work at all.** Laplace smoothing gives `a = 0.5` from zero evidence, so a naive `M` reads about 0.3 for material never touched, which would mark it fresher than a unit practised badly. `M` must be exactly 0 with no observations. Test in Task 2.
- **A unit with zero reading minutes.** Rule A's `readSlice` is then 0, the new-unit floor refuses to open it, and the same unit is refused every day until the horizon runs out, handing the candidate an empty fortnight. Test in Task 5.
- **A unit with zero question minutes.** The flush branch must place the reading and advance, not spin on a unit whose question debt can never fall. Test in Task 5.
- **A calendar shorter than the curriculum's reading alone.** `(A - R) / R` goes negative, and a negative multiple would make `questionSlice` negative and corrupt every day. Must clamp to the floor and report `calendarTooShort`. Test in Task 4.
- **A log entry dated in the future.** Clock skew or a candidate back-dating gives negative elapsed days, so `exp(-ln2 * negative / h)` exceeds 1 and `M` exceeds its own weighted sum. Freshness clamps at 1. Test in Task 2.

---

## File Structure

**Create:**
- `apps/backend/src/core/tuning.ts` plus `tuning.test.ts`: the constants, their defaults, their ranges, one parser.
- `apps/backend/src/core/mastery.ts` plus `mastery.test.ts`: `M`, its aggregations, the evidence triggers.
- `apps/backend/src/core/sequence.ts` plus `sequence.test.ts`: plan mode to unit order.
- `apps/backend/src/core/pairing.ts` plus `pairing.test.ts`: ratio solve, reconciliation, Rule A packing.
- `apps/backend/src/core/review.ts` plus `review.test.ts`: queue, coverage projection, injection throttle, review packing.
- `apps/backend/prisma/migrations/<timestamp>_planner_modes/migration.sql`: generated.
- `apps/frontend/src/components/planner-settings.tsx` plus `planner-settings.module.css`: the settings section.

**Modify:**
- `apps/backend/prisma/schema.prisma:179-224`: four columns on `StudyPlan`.
- `apps/backend/src/lib/FUNC-schedule.ts:366-513`: call the new modules instead of `orderModules` and `packDays` directly.
- `apps/backend/src/app/api/plans/[id]/route.ts`: accept the new fields.
- `apps/backend/src/app/api/settings/route.ts`: return the tuning block and the derived figures.
- `apps/backend/src/app/api/onboarding` or the existing onboarding write path: prior-work intake.
- `apps/frontend/src/app/settings/page.tsx`: mount the new section.
- `apps/frontend/src/app/onboarding/page.tsx`: the prior-work step.
- `.gitignore`: add `.superpowers/`.

**Untouched:** `effort.ts`, `allocation.ts`, `ordering.ts`, `packing.ts`, `calibration.ts`. `packing.ts` keeps serving `effort-return` and lends its helpers to `pairing.ts`.

---

### Task 1: Tuning constants

**Files:**
- Create: `apps/backend/src/core/tuning.ts`
- Test: `apps/backend/src/core/tuning.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PlanMode = "effort-return" | "curriculum-strict" | "curriculum-topic"`
  - `type ReviewPolicy = "decay-triggered" | "after-coverage" | "weekly-interleave" | "fixed-date"`
  - `type Tuning = { planMode: PlanMode; reviewPolicy: ReviewPolicy; reviewStartDate: string | null; firstPassQuestionMultiple: number; questionMultipleFloor: number; coverageDeadlineWeeks: number; reviewQuestionMultiple: number; minNewUnitReadMinutes: number; weeklyInterleaveShare: number; reviewInjectionCapShare: number; masteryWeightAccuracy: number; masteryWeightCoverage: number; masteryWeightConfidence: number; masteryHalfLifeDays: number; masteryBar: number; readingWriteOffBar: number; confidenceTriggerValue: number; accuracyFloor: number; accuracyMinSample: number }`
  - `type RejectedField = { field: string; given: unknown; usedInstead: number | string | null; reason: string }`
  - `const DEFAULT_TUNING: Tuning`
  - `const TUNING_RANGES: Record<string, { min: number; max: number }>`
  - `function parseTuning(raw: unknown): { tuning: Tuning; rejected: RejectedField[] }`

- [ ] **Step 1: Write the failing tests**

```ts
test("an absent column yields every default", () => {
  const { tuning, rejected } = parseTuning(null);
  expect(tuning).toEqual(DEFAULT_TUNING);
  expect(rejected).toEqual([]);
});

test("defaults match the spec exactly", () => {
  expect(DEFAULT_TUNING.planMode).toBe("curriculum-topic");
  expect(DEFAULT_TUNING.reviewPolicy).toBe("decay-triggered");
  expect(DEFAULT_TUNING.firstPassQuestionMultiple).toBe(2.0);
  expect(DEFAULT_TUNING.questionMultipleFloor).toBe(0.5);
  expect(DEFAULT_TUNING.coverageDeadlineWeeks).toBe(6);
  expect(DEFAULT_TUNING.reviewQuestionMultiple).toBe(4.0);
  expect(DEFAULT_TUNING.minNewUnitReadMinutes).toBe(15);
  expect(DEFAULT_TUNING.weeklyInterleaveShare).toBe(0.2);
  expect(DEFAULT_TUNING.reviewInjectionCapShare).toBe(0.35);
  expect(DEFAULT_TUNING.masteryHalfLifeDays).toBe(45);
  expect(DEFAULT_TUNING.masteryBar).toBe(0.75);
  expect(DEFAULT_TUNING.readingWriteOffBar).toBe(0.85);
  expect(DEFAULT_TUNING.confidenceTriggerValue).toBe(1);
  expect(DEFAULT_TUNING.accuracyFloor).toBe(0.5);
  expect(DEFAULT_TUNING.accuracyMinSample).toBe(12);
});

test("an out of range number falls back and is reported, never thrown", () => {
  const { tuning, rejected } = parseTuning({ masteryBar: 1.4 });
  expect(tuning.masteryBar).toBe(0.75);
  expect(rejected).toHaveLength(1);
  expect(rejected[0].field).toBe("masteryBar");
  expect(rejected[0].given).toBe(1.4);
  expect(rejected[0].usedInstead).toBe(0.75);
});

test("garbage of the wrong type falls back and is reported", () => {
  const { tuning, rejected } = parseTuning({ masteryHalfLifeDays: "soon", planMode: "vibes" });
  expect(tuning.masteryHalfLifeDays).toBe(45);
  expect(tuning.planMode).toBe("curriculum-topic");
  expect(rejected.map((r) => r.field).sort()).toEqual(["masteryHalfLifeDays", "planMode"]);
});

test("mastery weights are normalised to sum to one, in any units", () => {
  const { tuning } = parseTuning({
    masteryWeightAccuracy: 6,
    masteryWeightCoverage: 2.5,
    masteryWeightConfidence: 1.5,
  });
  const sum = tuning.masteryWeightAccuracy + tuning.masteryWeightCoverage + tuning.masteryWeightConfidence;
  expect(sum).toBeCloseTo(1, 10);
  expect(tuning.masteryWeightAccuracy).toBeCloseTo(0.6, 10);
});

test("zeroing the confidence weight is allowed and survives normalisation", () => {
  const { tuning, rejected } = parseTuning({
    masteryWeightAccuracy: 0.7,
    masteryWeightCoverage: 0.3,
    masteryWeightConfidence: 0,
  });
  expect(tuning.masteryWeightConfidence).toBe(0);
  expect(rejected).toEqual([]);
});

test("all three weights zero falls back to the default trio rather than dividing by zero", () => {
  const { tuning, rejected } = parseTuning({
    masteryWeightAccuracy: 0,
    masteryWeightCoverage: 0,
    masteryWeightConfidence: 0,
  });
  expect(tuning.masteryWeightAccuracy).toBe(0.6);
  expect(rejected.some((r) => r.field === "masteryWeights")).toBe(true);
});

test("fixed-date policy without a date is reported and falls back to the default policy", () => {
  const { tuning, rejected } = parseTuning({ reviewPolicy: "fixed-date", reviewStartDate: null });
  expect(tuning.reviewPolicy).toBe("decay-triggered");
  expect(rejected.some((r) => r.field === "reviewStartDate")).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && npx vitest run src/core/tuning.test.ts`
Expected: FAIL, cannot resolve `./tuning`.

- [ ] **Step 3: Implement `tuning.ts`**

Write `DEFAULT_TUNING` and `TUNING_RANGES` from the spec's tuning table verbatim, then `parseTuning(raw: unknown): { tuning: Tuning; rejected: RejectedField[] }`. One field-by-field pass: wrong type or out of range means push a `RejectedField` and keep the default. Normalise the three weights last, after clamping, dividing each by their sum; an all-zero trio reports under the synthetic field name `masteryWeights` and restores all three defaults. `parseTuning` never throws.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && npx vitest run src/core/tuning.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/core/tuning.ts apps/backend/src/core/tuning.test.ts
git commit -m "feat(core): candidate-editable planner constants with clamping parser"
```

---

### Task 2: Mastery

**Files:**
- Create: `apps/backend/src/core/mastery.ts`
- Test: `apps/backend/src/core/mastery.test.ts`

**Interfaces:**
- Consumes: `Tuning` from Task 1.
- Produces:
  - `type MasteryObservation = { losId: string; answered: number; correct: number; available: number; confidence: number | null; lastTouch: Date | null; questionMinutes: number }`
  - `function mastery(obs: MasteryObservation, asOf: Date, t: Tuning): number`
  - `function masteryOfUnit(obs: MasteryObservation[], asOf: Date, t: Tuning): number`
  - `function masteryByTopic(byTopic: Map<string, MasteryObservation[]>, asOf: Date, t: Tuning): Map<string, number>`
  - `function planReadiness(topicMastery: Map<string, number>, topicWeights: Map<string, number>): number`
  - `function isLearned(m: number, t: Tuning): boolean`
  - `function isEligibleToJump(obs: MasteryObservation[], asOf: Date, t: Tuning): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
const T = DEFAULT_TUNING;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-12T00:00:00Z");
function obs(p: Partial<MasteryObservation> = {}): MasteryObservation {
  return { losId: "l1", answered: 0, correct: 0, available: 100, confidence: null, lastTouch: null, questionMinutes: 60, ...p };
}

test("no logged work is mastery zero, not a smoothed floor", () => {
  expect(mastery(obs(), NOW, T)).toBe(0);
});

test("accuracy is Laplace-smoothed, so two of two reads as 0.75", () => {
  // answered 2, correct 2, available 2 so coverage is 1, confidence absent so s is 0.
  // M = 1 * (0.60 * 0.75 + 0.25 * 1 + 0.15 * 0) = 0.70
  const m = mastery(obs({ answered: 2, correct: 2, available: 2, lastTouch: NOW }), NOW, T);
  expect(m).toBeCloseTo(0.7, 10);
});

test("coverage caps at one when more questions were answered than the stock holds", () => {
  const m = mastery(obs({ answered: 300, correct: 300, available: 100, lastTouch: NOW }), NOW, T);
  const a = 301 / 302;
  expect(m).toBeCloseTo(0.6 * a + 0.25 * 1, 10);
});

test("confidence maps 1 to 5 onto 0 to 1", () => {
  const low = mastery(obs({ answered: 10, correct: 5, available: 10, confidence: 1, lastTouch: NOW }), NOW, T);
  const high = mastery(obs({ answered: 10, correct: 5, available: 10, confidence: 5, lastTouch: NOW }), NOW, T);
  expect(high - low).toBeCloseTo(0.15, 10);
});

test("freshness halves M over exactly one half-life", () => {
  const fresh = mastery(obs({ answered: 20, correct: 15, available: 20, lastTouch: NOW }), NOW, T);
  const stale = mastery(
    obs({ answered: 20, correct: 15, available: 20, lastTouch: new Date(NOW.getTime() - 45 * DAY) }),
    NOW,
    T,
  );
  expect(stale).toBeCloseTo(fresh / 2, 10);
});

test("a future-dated log cannot push freshness above one", () => {
  const future = mastery(
    obs({ answered: 20, correct: 15, available: 20, lastTouch: new Date(NOW.getTime() + 30 * DAY) }),
    NOW,
    T,
  );
  const today = mastery(obs({ answered: 20, correct: 15, available: 20, lastTouch: NOW }), NOW, T);
  expect(future).toBeCloseTo(today, 10);
  expect(future).toBeLessThanOrEqual(1);
});

test("zeroing the confidence weight removes confidence from the number entirely", () => {
  const { tuning } = parseTuning({ masteryWeightAccuracy: 0.7, masteryWeightCoverage: 0.3, masteryWeightConfidence: 0 });
  const low = mastery(obs({ answered: 10, correct: 5, available: 10, confidence: 1, lastTouch: NOW }), NOW, tuning);
  const high = mastery(obs({ answered: 10, correct: 5, available: 10, confidence: 5, lastTouch: NOW }), NOW, tuning);
  expect(high).toBeCloseTo(low, 10);
});

test("a unit's mastery is the question-minute-weighted mean of its outcomes", () => {
  const long = obs({ losId: "a", answered: 100, correct: 100, available: 100, lastTouch: NOW, questionMinutes: 300 });
  const short = obs({ losId: "b", answered: 0, correct: 0, available: 100, lastTouch: null, questionMinutes: 10 });
  const m = masteryOfUnit([long, short], NOW, T);
  const expected = (mastery(long, NOW, T) * 300 + 0 * 10) / 310;
  expect(m).toBeCloseTo(expected, 10);
});

test("plan readiness weights topic mastery by exam weight", () => {
  const r = planReadiness(new Map([["fsa", 1], ["alt", 0]]), new Map([["fsa", 15], ["alt", 5]]));
  expect(r).toBeCloseTo(0.75, 10);
});

test("confidence at the trigger value makes a unit eligible to jump", () => {
  expect(isEligibleToJump([obs({ answered: 40, correct: 38, available: 40, confidence: 1, lastTouch: NOW })], NOW, T)).toBe(true);
});

test("low accuracy under the sample floor does not make a unit eligible", () => {
  expect(isEligibleToJump([obs({ answered: 4, correct: 0, available: 50, confidence: 4, lastTouch: NOW })], NOW, T)).toBe(false);
});

test("low accuracy at or above the sample floor makes a unit eligible", () => {
  expect(isEligibleToJump([obs({ answered: 12, correct: 3, available: 50, confidence: 4, lastTouch: NOW })], NOW, T)).toBe(true);
});

test("decay below the bar makes a unit eligible even when it was once mastered", () => {
  const old = obs({ answered: 100, correct: 95, available: 100, confidence: 5, lastTouch: new Date(NOW.getTime() - 200 * DAY) });
  expect(isEligibleToJump([old], NOW, T)).toBe(true);
});

test("throws only when every mastery weight is zero", () => {
  const broken = { ...T, masteryWeightAccuracy: 0, masteryWeightCoverage: 0, masteryWeightConfidence: 0 };
  expect(() => mastery(obs({ answered: 1, correct: 1, lastTouch: NOW }), NOW, broken)).toThrow();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && npx vitest run src/core/mastery.test.ts`
Expected: FAIL, cannot resolve `./mastery`.

- [ ] **Step 3: Implement `mastery.ts`**

The formula is fixed by the spec: `a = (correct + 1) / (answered + 2)`, `c = min(1, answered / available)`, `s = (confidence - 1) / 4` with absent confidence contributing 0, `r = min(1, exp(-Math.LN2 * daysSince / halfLifeDays))`, and `M = r * (wa * a + wc * c + ws * s)`. Two guards the tests pin: `answered === 0 && lastTouch === null` returns 0 before any arithmetic, and a zero weight sum throws. `isEligibleToJump` is the disjunction of the three triggers in the spec's evidence section, evaluated over the unit's pooled observations.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && npx vitest run src/core/mastery.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/core/mastery.ts apps/backend/src/core/mastery.test.ts
git commit -m "feat(core): quantify learning as decaying accuracy, coverage and confidence"
```

---

### Task 3: Unit sequencing by plan mode

**Files:**
- Create: `apps/backend/src/core/sequence.ts`
- Test: `apps/backend/src/core/sequence.test.ts`

**Interfaces:**
- Consumes: `PlanMode` from Task 1; `SchedulableGroup` and `orderModules` from `ordering.ts:6`.
- Produces: `type SequencableGroup = SchedulableGroup & { topicOrder: number }` and `function sequenceUnits(groups: SequencableGroup[], mode: PlanMode): SequencableGroup[]`.

`topicOrder` is the curriculum position of the unit's topic area, supplied by the caller. It is a new field because `SchedulableGroup.ref` carries a topic prefix but no ordinal, and parsing an order out of a string identifier is how planners come to read Ethics before Quant.

- [ ] **Step 1: Write the failing tests**

```ts
test("effort-return delegates to today's engine unchanged", () => {
  const groups = fixtureMixedTopics();
  expect(sequenceUnits(groups, "effort-return").map((g) => g.ref))
    .toEqual(orderModules(groups, "curriculum").map((g) => g.ref));
});

test("curriculum-strict runs whole topic areas in curriculum order", () => {
  // Two areas interleaved on input, ethics at topicOrder 9, qm at 1.
  const refs = sequenceUnits(fixtureEthicsAndQm(), "curriculum-strict").map((g) => g.ref);
  expect(refs).toEqual(["qm/lm1", "qm/lm2", "qm/lm3", "ethics/lm1", "ethics/lm2"]);
});

test("curriculum-topic produces the identical first-pass sequence to curriculum-strict", () => {
  const groups = fixtureEthicsAndQm();
  expect(sequenceUnits(groups, "curriculum-topic").map((g) => g.ref))
    .toEqual(sequenceUnits(groups, "curriculum-strict").map((g) => g.ref));
});

test("a prerequisite outranks the stated curriculum order", () => {
  // equity/lm1 sits at topicOrder 4 but is a prereq of qm/lm3 at topicOrder 1.
  const refs = sequenceUnits(fixturePrereqAcrossAreas(), "curriculum-strict").map((g) => g.ref);
  expect(refs.indexOf("equity/lm1")).toBeLessThan(refs.indexOf("qm/lm3"));
});

test("exam weight never reorders anything in either curriculum mode", () => {
  const light = fixtureEthicsAndQm();                                  // ethics weight 5
  const heavy = light.map((g) => g.ref.startsWith("ethics") ? { ...g, weight: 40 } : g);
  expect(sequenceUnits(heavy, "curriculum-topic").map((g) => g.ref))
    .toEqual(sequenceUnits(light, "curriculum-topic").map((g) => g.ref));
});

test("a prerequisite cycle still throws", () => {
  expect(() => sequenceUnits(fixtureCycle(), "curriculum-strict")).toThrow(/cycle/i);
});
```

Write the four fixture helpers at the top of the test file. `fixtureEthicsAndQm` is the regression this whole feature exists for: shuffle the input array so a correct implementation cannot pass by accident.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && npx vitest run src/core/sequence.test.ts`
Expected: FAIL, cannot resolve `./sequence`.

- [ ] **Step 3: Implement `sequence.ts`**

`effort-return` returns `orderModules(groups, "curriculum")` and nothing else. The two curriculum modes run the same greedy topological pass as `orderModules` so prerequisites keep winning, but with the comparator replaced by lexicographic `topicOrder`, then `moduleOrder`, then `ref`. Topic cohesion is not a separate term here: ordering by `topicOrder` first makes cohesion a consequence rather than a tiebreak, which is the bug at `ordering.ts:40` being fixed.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && npx vitest run src/core/sequence.test.ts src/core/ordering.test.ts`
Expected: PASS. `ordering.test.ts` must pass untouched.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/core/sequence.ts apps/backend/src/core/sequence.test.ts
git commit -m "feat(core): sequence units by plan mode, topic area order before module order"
```

---

### Task 4: Achievable ratio and reconciliation

**Files:**
- Create: `apps/backend/src/core/pairing.ts`
- Test: `apps/backend/src/core/pairing.test.ts`

**Interfaces:**
- Consumes: `Tuning` from Task 1; `MasteryObservation`, `masteryOfUnit` from Task 2; `PackableGroup` from `packing.ts:52`.
- Produces:
  - `function solveQuestionMultiple(readingMinutes: number, availableMinutes: number, t: Tuning): { effective: number; requested: number; calendarTooShort: boolean }`
  - `type PairingTag = "paired" | "questions-only" | "reading-only"`
  - `type ReconciledUnit = PackableGroup & { readingDebt: number; questionDebt: number; pairing: PairingTag }`
  - `type WriteOff = { ref: string; mastery: number; readingMinutesDropped: number }`
  - `type UnderPractised = { ref: string; shortfallMinutes: number }`
  - `function reconcile(seq: PackableGroup[], logsByRef: Map<string, MasteryObservation[]>, readingDoneByRef: Map<string, number>, questionsDoneByRef: Map<string, number>, multiple: number, asOf: Date, t: Tuning): { units: ReconciledUnit[]; writeOffs: WriteOff[]; underPractised: UnderPractised[] }`

- [ ] **Step 1: Write the failing tests**

```ts
test("a roomy calendar gets the requested multiple", () => {
  const r = solveQuestionMultiple(1000, 5000, DEFAULT_TUNING);
  expect(r.effective).toBe(2);
  expect(r.calendarTooShort).toBe(false);
});

test("a tight calendar gets the largest multiple that fits, reported against the request", () => {
  // R = 1000, A = 2580, so (A - R) / R = 1.58.
  const r = solveQuestionMultiple(1000, 2580, DEFAULT_TUNING);
  expect(r.effective).toBeCloseTo(1.58, 10);
  expect(r.requested).toBe(2);
  expect(r.calendarTooShort).toBe(false);
});

test("a calendar shorter than the reading alone clamps to the floor and flags, never goes negative", () => {
  const r = solveQuestionMultiple(1000, 600, DEFAULT_TUNING);
  expect(r.effective).toBe(DEFAULT_TUNING.questionMultipleFloor);
  expect(r.effective).toBeGreaterThan(0);
  expect(r.calendarTooShort).toBe(true);
});

test("a zero-availability calendar clamps to the floor and flags", () => {
  const r = solveQuestionMultiple(1000, 0, DEFAULT_TUNING);
  expect(r.effective).toBe(DEFAULT_TUNING.questionMultipleFloor);
  expect(r.calendarTooShort).toBe(true);
});

test("zero reading minutes does not divide by zero", () => {
  const r = solveQuestionMultiple(0, 500, DEFAULT_TUNING);
  expect(Number.isFinite(r.effective)).toBe(true);
  expect(r.effective).toBe(2);
});

test("a fresh unit owes all its reading and multiple times its reading in questions", () => {
  const { units } = reconcile([unit("qm/lm1", { read: 56, questions: 140 })], new Map(), new Map(), new Map(), 2, NOW, DEFAULT_TUNING);
  expect(units[0]).toMatchObject({ readingDebt: 56, questionDebt: 112, pairing: "paired" });
});

test("question debt never exceeds the stock that exists", () => {
  const { units, underPractised } = reconcile([unit("qm/lm1", { read: 100, questions: 50 })], new Map(), new Map(), new Map(), 2, NOW, DEFAULT_TUNING);
  expect(units[0].questionDebt).toBe(50);
  expect(underPractised).toEqual([{ ref: "qm/lm1", shortfallMinutes: 150 }]);
});

test("reading already done off plan yields a questions-only unit", () => {
  const { units } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map(), new Map([["qm/lm1", 56]]), new Map(), 2, NOW, DEFAULT_TUNING,
  );
  expect(units[0]).toMatchObject({ readingDebt: 0, pairing: "questions-only" });
  expect(units[0].questionDebt).toBeGreaterThan(0);
});

test("questions done but proficiency not shown yields a reading-only unit", () => {
  const weak = [obs({ answered: 40, correct: 14, available: 40, confidence: 2, lastTouch: NOW, questionMinutes: 140 })];
  const { units, writeOffs } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map([["qm/lm1", weak]]), new Map(), new Map([["qm/lm1", 140]]), 2, NOW, DEFAULT_TUNING,
  );
  expect(units[0]).toMatchObject({ questionDebt: 0, readingDebt: 56, pairing: "reading-only" });
  expect(writeOffs).toEqual([]);
});

test("questions done and proficiency shown writes the reading off, with the mastery that justified it", () => {
  const strong = [obs({ answered: 140, correct: 133, available: 140, confidence: 5, lastTouch: NOW, questionMinutes: 140 })];
  const { units, writeOffs } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map([["qm/lm1", strong]]), new Map(), new Map([["qm/lm1", 140]]), 2, NOW, DEFAULT_TUNING,
  );
  expect(units).toEqual([]);
  expect(writeOffs).toHaveLength(1);
  expect(writeOffs[0]).toMatchObject({ ref: "qm/lm1", readingMinutesDropped: 56 });
  expect(writeOffs[0].mastery).toBeGreaterThanOrEqual(DEFAULT_TUNING.readingWriteOffBar);
});

test("the write-off bar is stricter than the learned bar, so a unit can leave review without skipping its reading", () => {
  const middling = [obs({ answered: 140, correct: 112, available: 140, confidence: 4, lastTouch: NOW, questionMinutes: 140 })];
  const m = masteryOfUnit(middling, NOW, DEFAULT_TUNING);
  expect(m).toBeGreaterThanOrEqual(DEFAULT_TUNING.masteryBar);
  expect(m).toBeLessThan(DEFAULT_TUNING.readingWriteOffBar);
  const { units, writeOffs } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map([["qm/lm1", middling]]), new Map(), new Map([["qm/lm1", 140]]), 2, NOW, DEFAULT_TUNING,
  );
  expect(writeOffs).toEqual([]);
  expect(units[0].pairing).toBe("reading-only");
});

test("over-practising one unit earns no credit against another", () => {
  const { units } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 }), unit("qm/lm2", { read: 51, questions: 104 })],
    new Map(), new Map(), new Map([["qm/lm1", 500]]), 2, NOW, DEFAULT_TUNING,
  );
  expect(units.find((u) => u.ref === "qm/lm1")!.questionDebt).toBe(0);
  expect(units.find((u) => u.ref === "qm/lm2")!.questionDebt).toBe(102);
});

test("a fully settled unit leaves the first pass entirely", () => {
  const { units } = reconcile(
    [unit("qm/lm1", { read: 56, questions: 140 })],
    new Map(), new Map([["qm/lm1", 56]]), new Map([["qm/lm1", 140]]), 2, NOW, DEFAULT_TUNING,
  );
  expect(units).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && npx vitest run src/core/pairing.test.ts`
Expected: FAIL, cannot resolve `./pairing`.

- [ ] **Step 3: Implement `solveQuestionMultiple` and `reconcile` in `pairing.ts`**

`solveQuestionMultiple` is `min(requested, max(floor, (A - R) / R))` with `calendarTooShort` set when the floor binds, and the `R === 0` branch returning the requested multiple rather than dividing. `reconcile` walks the sequence computing `readingDebt = max(0, readingMinutes - readingDone)` and `questionDebt = max(0, min(questionMinutes, multiple * readingMinutes) - questionsDone)`, then assigns the `pairing` tag from the spec's four cases, dropping settled units and write-offs from `units` entirely. `underPractised` records `multiple * readingMinutes - questionMinutes` where the stock cannot meet the multiple. Debts are per unit; nothing pools across units.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && npx vitest run src/core/pairing.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/core/pairing.ts apps/backend/src/core/pairing.test.ts
git commit -m "feat(core): solve the achievable practice ratio and reconcile off-plan work"
```

---

### Task 5: Rule A first-pass packing

**Files:**
- Modify: `apps/backend/src/core/pairing.ts` (add the packer)
- Test: `apps/backend/src/core/pairing.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `ReconciledUnit` and `PairingTag` from Task 4; `Calendar`, `PlannedDay`, `PlannedTask` from `packing.ts:26`; `MIN_TASK_MINUTES` and the split and merge helpers from `packing.ts`, which must be exported from there for reuse rather than copied.
- Produces: `function packFirstPass(units: ReconciledUnit[], cal: Calendar, multiple: number, t: Tuning): PlannedDay[]`.

- [ ] **Step 1: Export the helpers `pairing.ts` needs from `packing.ts`**

Change `MIN_TASK_MINUTES`, `splitTask` and `mergeSmallTasks` in `apps/backend/src/core/packing.ts` from module-private to exported. No behaviour change, so `packing.test.ts` must pass untouched.

Run: `cd apps/backend && npx vitest run src/core/packing.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 2: Write the failing tests, the candidate's trace first**

```ts
// The acceptance test for this whole feature. Figures are the candidate's own.
// Unit 1 holds 56 min reading against 140 of questions, unit 2 holds 51 and 104.
test("reproduces the candidate's three days exactly", () => {
  const days = packFirstPass(
    [recon("qm/lm1", { read: 56, questions: 140 }), recon("qm/lm2", { read: 51, questions: 104 })],
    calendarOf([120, 127, 104]),
    2,
    DEFAULT_TUNING,
  );
  expect(summarise(days[0])).toEqual([
    { kind: "content-notes", ref: "qm/lm1", minutes: 40 },
    { kind: "questions", ref: "qm/lm1", minutes: 80 },
  ]);
  expect(summarise(days[1])).toEqual([
    { kind: "content-notes", ref: "qm/lm1", minutes: 16 },
    { kind: "questions", ref: "qm/lm1", minutes: 60 },
    { kind: "content-notes", ref: "qm/lm2", minutes: 17 },
    { kind: "questions", ref: "qm/lm2", minutes: 34 },
  ]);
  expect(summarise(days[2])).toEqual([
    { kind: "content-notes", ref: "qm/lm2", minutes: 34 },
    { kind: "questions", ref: "qm/lm2", minutes: 70 },
  ]);
});

test("a closing unit flushes its bank rather than leaving a stub", () => {
  // Day 2 above: 16 minutes of reading pulls 60 minutes of questions, not 32.
  const days = packFirstPass([recon("qm/lm1", { read: 56, questions: 140 })], calendarOf([120, 127]), 2, DEFAULT_TUNING);
  expect(summarise(days[1])).toEqual([
    { kind: "content-notes", ref: "qm/lm1", minutes: 16 },
    { kind: "questions", ref: "qm/lm1", minutes: 60 },
  ]);
});

test("a new unit is not opened for less than the floor of reading", () => {
  // 40 minutes left after unit 1 closes gives floor(40/3) = 13, under the 15 floor.
  const days = packFirstPass([recon("a", { read: 20, questions: 40 }), recon("b", { read: 90, questions: 180 })], calendarOf([100, 200]), 2, DEFAULT_TUNING);
  expect(summarise(days[0]).every((task) => task.ref === "a")).toBe(true);
});

test("a unit whose entire reading is under the floor is placed anyway", () => {
  const days = packFirstPass([recon("a", { read: 90, questions: 180 }), recon("tiny", { read: 8, questions: 16 })], calendarOf([300, 300]), 2, DEFAULT_TUNING);
  const placed = days.flatMap(summarise).filter((task) => task.ref === "tiny");
  expect(placed.length).toBeGreaterThan(0);
});

test("a unit with zero reading minutes is placed and never starves the horizon", () => {
  const days = packFirstPass([recon("vid", { read: 0, questions: 90 }), recon("next", { read: 60, questions: 120 })], calendarOf([120, 120, 120]), 2, DEFAULT_TUNING);
  const refs = days.flatMap(summarise).map((task) => task.ref);
  expect(refs).toContain("vid");
  expect(refs).toContain("next");
});

test("a unit with zero question minutes places its reading and advances", () => {
  const days = packFirstPass([recon("dry", { read: 60, questions: 0 }), recon("next", { read: 60, questions: 120 })], calendarOf([120, 120, 120]), 2, DEFAULT_TUNING);
  const refs = days.flatMap(summarise).map((task) => task.ref);
  expect(refs).toContain("dry");
  expect(refs).toContain("next");
});

test("a questions-only unit gets a day with no reading on it", () => {
  const days = packFirstPass([{ ...recon("qm/lm1", { read: 56, questions: 140 }), readingDebt: 0, pairing: "questions-only" }], calendarOf([120]), 2, DEFAULT_TUNING);
  expect(summarise(days[0]).every((task) => task.kind === "questions")).toBe(true);
});

test("a reading-only unit gets a day with no questions on it", () => {
  const days = packFirstPass([{ ...recon("qm/lm1", { read: 56, questions: 140 }), questionDebt: 0, pairing: "reading-only" }], calendarOf([120]), 2, DEFAULT_TUNING);
  expect(summarise(days[0]).every((task) => task.kind !== "questions")).toBe(true);
});

test("no scheduled question task precedes the reading of its own unit", () => {
  const days = packFirstPass(fixtureManyUnits(), calendarOf(Array(30).fill(150)), 2, DEFAULT_TUNING);
  const firstRead = new Map<string, number>();
  let index = 0;
  for (const day of days) for (const task of day.tasks) {
    index++;
    const ref = task.readingIds[0];
    if (task.kind !== "questions" && !firstRead.has(ref)) firstRead.set(ref, index);
    if (task.kind === "questions") expect(firstRead.get(ref)).toBeLessThan(index);
  }
});

test("the week's packed minutes never exceed the week's availability", () => {
  const cal = calendarOf([120, 120, 120, 120, 120, 0, 0]);
  const days = packFirstPass(fixtureManyUnits(), cal, 2, DEFAULT_TUNING);
  const packed = days.slice(0, 7).flatMap((d) => d.tasks).reduce((sum, t) => sum + t.estimatedMinutes, 0);
  expect(packed).toBeLessThanOrEqual(600);
});

test("a reduced multiple shrinks the question slice, not the reading", () => {
  const days = packFirstPass([recon("qm/lm1", { read: 56, questions: 140 })], calendarOf([120]), 1, DEFAULT_TUNING);
  expect(summarise(days[0])).toEqual([
    { kind: "content-notes", ref: "qm/lm1", minutes: 60 },
    { kind: "questions", ref: "qm/lm1", minutes: 60 },
  ]);
});
```

Write `recon`, `calendarOf`, `summarise` and `fixtureManyUnits` at the top of the describe block. `calendarOf` takes per-day minutes directly, bypassing the hours-to-minutes conversion that bit `FUNC-schedule.ts:500`.

- [ ] **Step 3: Run to verify failure**

Run: `cd apps/backend && npx vitest run src/core/pairing.test.ts`
Expected: FAIL, `packFirstPass` is not a function.

- [ ] **Step 4: Implement `packFirstPass`**

The loop is the spec's Rule A, steps 1 to 7, verbatim, with `questionMultiple` taken from the `multiple` argument rather than the tuning field so the solved value is what actually packs. Keep `packing.ts`'s weekly `carry`, its reset on every seventh day, its 2x day cap and its indivisible-task deadlock escape; reuse the exported `splitTask` for vignette-boundary splitting and `mergeSmallTasks` for the sub-floor unit. Reading minutes emit `content-notes`, `content-video` and `seminar` tasks in that order and questions emit `questions` and `eocq`, matching the kinds `packing.ts:112` already produces so `/today` needs no new rendering.

Three guards the tests pin, each a case where `readSlice` or `questionDebt` is zero and a naive loop never advances: a unit with no reading debt skips straight to its questions, a unit with no question debt places reading and advances, and a unit whose debts are both zero is dropped. Every iteration must either place a task or advance the unit cursor.

- [ ] **Step 5: Run to verify pass**

Run: `cd apps/backend && npx vitest run src/core/`
Expected: PASS, all core suites including `packing.test.ts` and `ordering.test.ts` untouched.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/core/pairing.ts apps/backend/src/core/pairing.test.ts apps/backend/src/core/packing.ts
git commit -m "feat(core): pair each reading slice with its question slice in the same sitting"
```

---

### Task 6: Review phase

**Files:**
- Create: `apps/backend/src/core/review.ts`
- Test: `apps/backend/src/core/review.test.ts`

**Interfaces:**
- Consumes: `Tuning`, `PlanMode`, `ReviewPolicy` from Task 1; `MasteryObservation`, `masteryOfUnit`, `isEligibleToJump` from Task 2; `Calendar`, `PlannedDay` from `packing.ts`.
- Produces:
  - `type ReviewUnit = { ref: string; topicOrder: number; moduleOrder: number; reviewReadMinutes: number; questionMinutes: number; mastery: number; eligible: boolean }`
  - `function reviewQueue(units: ReviewUnit[], mode: PlanMode): ReviewUnit[]`
  - `function projectCoverageDate(unreadMinutes: number, realisedPacePerDay: number, asOf: Date, cal: Calendar): { date: string; slackDays: number }`
  - `function injectionCap(slackDays: number, t: Tuning): number`
  - `function reviewPhaseStart(cal: Calendar, coverage: { unreadMinutes: number; realisedPacePerDay: number; allCovered: boolean }, examDate: string, asOf: Date, t: Tuning): { active: boolean; cap: number; reason: string }`
  - `function packReview(queue: ReviewUnit[], cal: Calendar, t: Tuning): PlannedDay[]`

- [ ] **Step 1: Write the failing tests**

```ts
test("the queue serves the weakest first", () => {
  const q = reviewQueue([ru("a", { mastery: 0.8 }), ru("b", { mastery: 0.2 }), ru("c", { mastery: 0.5 })], "curriculum-topic");
  expect(q.map((u) => u.ref)).toEqual(["b", "c", "a"]);
});

test("curriculum-strict keeps the queue in curriculum order whatever the mastery", () => {
  const q = reviewQueue([ru("b", { mastery: 0.2, topicOrder: 2 }), ru("a", { mastery: 0.9, topicOrder: 1 })], "curriculum-strict");
  expect(q.map((u) => u.ref)).toEqual(["a", "b"]);
});

test("only eligible units may jump the order under curriculum-topic", () => {
  const q = reviewQueue([ru("a", { mastery: 0.9, topicOrder: 1, eligible: false }), ru("b", { mastery: 0.2, topicOrder: 2, eligible: false })], "curriculum-topic");
  expect(q.map((u) => u.ref)).toEqual(["a", "b"]);
});

test("the week owes one part reading to four parts questions", () => {
  const days = packReview(fixtureQueue(), calendarOf([120, 120, 120, 120, 120, 0, 0]), DEFAULT_TUNING);
  const week = days.slice(0, 7).flatMap((d) => d.tasks);
  const read = week.filter((t) => t.kind !== "questions").reduce((s, t) => s + t.estimatedMinutes, 0);
  const quest = week.filter((t) => t.kind === "questions").reduce((s, t) => s + t.estimatedMinutes, 0);
  expect(read + quest).toBeLessThanOrEqual(600);
  expect(quest / read).toBeCloseTo(4, 0);
});

test("a single day may be entirely questions", () => {
  const days = packReview(fixtureQueue(), calendarOf([120, 120, 120, 120, 120, 0, 0]), DEFAULT_TUNING);
  expect(days.some((d) => d.tasks.length > 0 && d.tasks.every((t) => t.kind === "questions"))).toBe(true);
});

test("reading is forced in when two days remain and its budget is underspent", () => {
  const days = packReview(fixtureQuestionHeavyQueue(), calendarOf([120, 120, 120, 120, 120, 0, 0]), DEFAULT_TUNING);
  const read = days.slice(0, 7).flatMap((d) => d.tasks).filter((t) => t.kind !== "questions").reduce((s, t) => s + t.estimatedMinutes, 0);
  expect(read).toBeGreaterThan(0);
});

test("the review phase draws its reading from review videos, not the original notes", () => {
  const days = packReview([ru("a", { reviewReadMinutes: 40, questionMinutes: 400 })], calendarOf([200, 200]), DEFAULT_TUNING);
  expect(days.flatMap((d) => d.tasks).filter((t) => t.kind !== "questions").every((t) => t.kind === "review")).toBe(true);
});

test("coverage projection rejects a non-positive pace rather than returning Infinity", () => {
  expect(() => projectCoverageDate(1000, 0, NOW, calendarOf([120]))).toThrow();
});

test("injections run at the full cap while coverage has slack", () => {
  expect(injectionCap(60, DEFAULT_TUNING)).toBe(0.35);
});

test("the cap ramps down as the coverage deadline approaches, with no cliff", () => {
  const far = injectionCap(30, DEFAULT_TUNING);
  const near = injectionCap(10, DEFAULT_TUNING);
  expect(far).toBeGreaterThan(near);
  expect(near).toBeGreaterThan(0);
});

test("injections stop entirely once coverage would miss its deadline", () => {
  expect(injectionCap(-1, DEFAULT_TUNING)).toBe(0);
  expect(injectionCap(-40, DEFAULT_TUNING)).toBe(0);
});

test("after-coverage keeps review inactive until the whole curriculum is read", () => {
  const before = reviewPhaseStart(calendarOf([120]), { unreadMinutes: 500, realisedPacePerDay: 100, allCovered: false }, "2027-05-01", NOW, { ...DEFAULT_TUNING, reviewPolicy: "after-coverage" });
  expect(before.active).toBe(false);
  const after = reviewPhaseStart(calendarOf([120]), { unreadMinutes: 0, realisedPacePerDay: 100, allCovered: true }, "2027-05-01", NOW, { ...DEFAULT_TUNING, reviewPolicy: "after-coverage" });
  expect(after.active).toBe(true);
});

test("weekly-interleave is active from the first week at its configured share", () => {
  const r = reviewPhaseStart(calendarOf([120]), { unreadMinutes: 5000, realisedPacePerDay: 100, allCovered: false }, "2027-05-01", NOW, { ...DEFAULT_TUNING, reviewPolicy: "weekly-interleave" });
  expect(r.active).toBe(true);
  expect(r.cap).toBe(DEFAULT_TUNING.weeklyInterleaveShare);
});

test("fixed-date is inactive before the date and active on it", () => {
  const t = { ...DEFAULT_TUNING, reviewPolicy: "fixed-date" as const, reviewStartDate: "2026-12-01" };
  expect(reviewPhaseStart(calendarOf([120]), { unreadMinutes: 100, realisedPacePerDay: 10, allCovered: false }, "2027-05-01", new Date("2026-11-30T00:00:00Z"), t).active).toBe(false);
  expect(reviewPhaseStart(calendarOf([120]), { unreadMinutes: 100, realisedPacePerDay: 10, allCovered: false }, "2027-05-01", new Date("2026-12-01T00:00:00Z"), t).active).toBe(true);
});

test("decay-triggered throttles itself when coverage is at risk, and says why", () => {
  const t = { ...DEFAULT_TUNING, reviewPolicy: "decay-triggered" as const };
  const safe = reviewPhaseStart(calendarOf([120]), { unreadMinutes: 600, realisedPacePerDay: 120, allCovered: false }, "2027-05-01", NOW, t);
  const risky = reviewPhaseStart(calendarOf([120]), { unreadMinutes: 60000, realisedPacePerDay: 120, allCovered: false }, "2027-05-01", NOW, t);
  expect(safe.cap).toBe(0.35);
  expect(risky.cap).toBe(0);
  expect(risky.reason).toMatch(/coverage/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && npx vitest run src/core/review.test.ts`
Expected: FAIL, cannot resolve `./review`.

- [ ] **Step 3: Implement `review.ts`**

`reviewQueue` sorts ascending by `mastery` for `effort-return` and `curriculum-topic`, but only among units with `eligible` true; ineligible units hold their curriculum position. `curriculum-strict` sorts by `topicOrder` then `moduleOrder` and ignores mastery.

`projectCoverageDate` divides remaining unread minutes by the realised daily pace, walks that many study days forward through the calendar skipping zero days and holidays, and returns the date plus the signed days of slack against `examDate` less `coverageDeadlineWeeks`. It throws on a non-positive pace, so the caller substitutes the estimated pace for a plan with no logged work.

`injectionCap` is a linear ramp: full `reviewInjectionCapShare` at or above a slack of `coverageDeadlineWeeks * 7` days, zero at or below zero slack, linear between, so there is no cliff.

`packReview` splits the week's availability into a reading budget of `W / (1 + reviewQuestionMultiple)` and the rest to questions, fills each day from the question cursor first and the reading cursor second, and forces reading once two days of the week remain with the reading budget underspent. Reading tasks emit kind `review`, never `content-notes`, since the first pass held the review videos back for exactly this.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && npx vitest run src/core/`
Expected: PASS, all core suites.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/core/review.ts apps/backend/src/core/review.test.ts
git commit -m "feat(core): review phase with four start policies and a coverage-first throttle"
```

---

### Task 7: Schema

**Files:**
- Modify: `apps/backend/prisma/schema.prisma:179-224`
- Create: `apps/backend/prisma/migrations/<timestamp>_planner_modes/migration.sql` (generated)

**Interfaces:**
- Consumes: the mode and policy identifiers from Task 1.
- Produces: `StudyPlan.planMode`, `StudyPlan.reviewPolicy`, `StudyPlan.reviewStartDate`, `StudyPlan.tuning`; `StudyLogEntry.selfDeclared`.

- [ ] **Step 1: Add the columns**

On `StudyPlan`: `planMode String @default("curriculum-topic")`, `reviewPolicy String @default("decay-triggered")`, `reviewStartDate DateTime?`, `tuning Json?`. On `StudyLogEntry`: `selfDeclared Boolean @default(false)`.

Every column is defaulted or nullable, so no backfill is needed and an existing plan keeps working. `orderingStrategy` stays, unused by the new modes but still read by `effort-return`'s internals and by `fixtures.ts:682`.

A comment above the block states why `tuning` is one JSON column rather than eighteen typed ones: these are a single coherent settings object, always read and written together, never queried individually, and adding the nineteenth constant should not be a migration.

- [ ] **Step 2: Generate and apply**

Run: `cd apps/backend && npx prisma migrate dev --name planner_modes`
Expected: migration created and applied, `prisma generate` runs.

- [ ] **Step 3: Verify the existing suites still pass against the new client**

Run: `cd apps/backend && npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations
git commit -m "feat(db): plan mode, review policy and tuning on StudyPlan"
```

---

### Task 8: Wire the engine into generation

**Files:**
- Modify: `apps/backend/src/lib/FUNC-schedule.ts:366-513`
- Test: `apps/backend/tests/schedule/generate.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 7.
- Produces: `generateHorizon` unchanged in signature, new in behaviour.

- [ ] **Step 1: Write the failing tests**

```ts
test("curriculum-topic finishes a topic area before starting the next", async () => {
  // The regression this feature exists for. Seed ethics, qm and fsa, generate,
  // and assert the first week does not touch three topic areas.
  const plan = await seedPlan({ planMode: "curriculum-topic" });
  await generateHorizon(plan.id);
  const areas = await topicAreasInFirstWeek(plan.id);
  expect(areas.length).toBeLessThanOrEqual(2);
});

test("every question task in a generated plan follows the reading of its own material", async () => {
  const plan = await seedPlan({ planMode: "curriculum-topic" });
  await generateHorizon(plan.id);
  await expectNoQuestionBeforeItsReading(plan.id);
});

test("effort-return still generates exactly what it generated before", async () => {
  const plan = await seedPlan({ planMode: "effort-return" });
  await generateHorizon(plan.id);
  expect(await taskFingerprint(plan.id)).toEqual(LEGACY_FINGERPRINT);
});

test("switching mode regenerates forward and preserves logged work", async () => {
  const plan = await seedPlan({ planMode: "curriculum-topic" });
  await generateHorizon(plan.id);
  const logId = await logSomeWork(plan.id);
  await db.studyPlan.update({ where: { id: plan.id }, data: { planMode: "curriculum-strict" } });
  await generateHorizon(plan.id);
  expect(await db.studyLogEntry.findUnique({ where: { id: logId } })).not.toBeNull();
  expect(await countFrozenBeforeToday(plan.id)).toBeGreaterThanOrEqual(0);
});

test("the solved multiple is reported on the plan when the calendar cannot afford the request", async () => {
  const plan = await seedPlan({ planMode: "curriculum-topic", weeklyAvailability: tinyWeek() });
  const result = await generateHorizon(plan.id);
  expect(result.effectiveQuestionMultiple).toBeLessThan(2);
});

test("a candidate who declared prior reading gets question-only days for that material", async () => {
  const plan = await seedPlan({ planMode: "curriculum-topic" });
  await declarePriorReading(plan.id, "qm");
  await generateHorizon(plan.id);
  expect(await hasQuestionOnlyDayFor(plan.id, "qm")).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && npx vitest run tests/schedule/generate.test.ts`
Expected: FAIL on the new tests, pass on the existing ones.

- [ ] **Step 3: Rewire `generateHorizon`**

Read `planMode`, `reviewPolicy`, `reviewStartDate` and `parseTuning(plan.tuning)` at the top. Add `topicOrder` to each `SchedulableGroup` from `reading.topic.order`, the field the greedy sort has been missing. Replace the `orderModules` call at `:444` with `sequenceUnits(groups, planMode)`.

Split each unit's per-kind minutes into the spec's two buckets: reading is `noteMinutes + videoMinutes + seminarMinutes`, questions are `questionMinutes + eocqMinutes`, and `reviewMinutes` is held back from the first pass entirely and carried on the unit for `packReview`. This is the one place the layer mapping lives.

Then `solveQuestionMultiple`, `reconcile` against logged and self-declared `StudyLogEntry` rows, `packFirstPass` for the first-pass span, `reviewPhaseStart` plus `packReview` for the review span, and concatenate the days before the existing freeze, delete and write transaction, which is correct as it stands and must not be touched. `effort-return` keeps calling `packDays` so its fingerprint cannot move.

Return the new figures alongside the existing counts: `effectiveQuestionMultiple`, `requestedQuestionMultiple`, `calendarTooShort`, `writeOffs`, `underPractised`, `injectionCap`, `coverageProjection`.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && npx vitest run && npm run typecheck`
Expected: PASS, whole suite plus a clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/FUNC-schedule.ts apps/backend/tests/schedule/generate.test.ts
git commit -m "feat(schedule): generate from plan mode, solved ratio and reconciled debts"
```

---

### Task 9: API surface

**Files:**
- Modify: `apps/backend/src/app/api/plans/[id]/route.ts`
- Modify: `apps/backend/src/app/api/settings/route.ts`
- Test: `apps/backend/tests/api/plan-tuning.test.ts` (create)

**Interfaces:**
- Consumes: `parseTuning`, `TUNING_RANGES`, `DEFAULT_TUNING` from Task 1; `generateHorizon`'s new return fields from Task 8.
- Produces: `PATCH /api/plans/:id` accepting `planMode`, `reviewPolicy`, `reviewStartDate` and `tuning`; `GET /api/settings` returning a `planner` block.

- [ ] **Step 1: Write the failing tests**

```ts
test("PATCH accepts a valid mode and regenerates the plan forward", async () => {
  const res = await patchPlan(plan.id, { planMode: "curriculum-strict" });
  expect(res.status).toBe(200);
  expect(await db.studyPlan.findUnique({ where: { id: plan.id } })).toMatchObject({ planMode: "curriculum-strict" });
});

test("PATCH rejects an unknown mode with 400 and does not write", async () => {
  const res = await patchPlan(plan.id, { planMode: "vibes" });
  expect(res.status).toBe(400);
  expect(await db.studyPlan.findUnique({ where: { id: plan.id } })).toMatchObject({ planMode: "curriculum-topic" });
});

test("PATCH stores an out of range constant as the clamped value and reports it", async () => {
  const res = await patchPlan(plan.id, { tuning: { masteryBar: 1.4 } });
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.rejected.map((r: { field: string }) => r.field)).toContain("masteryBar");
});

test("PATCH rejects fixed-date with no date", async () => {
  const res = await patchPlan(plan.id, { reviewPolicy: "fixed-date", reviewStartDate: null });
  expect(res.status).toBe(400);
});

test("GET settings returns the tuning block, its ranges and the derived figures", async () => {
  const body = await (await getSettings()).json();
  expect(body.planner.tuning).toMatchObject({ planMode: "curriculum-topic" });
  expect(body.planner.ranges.masteryBar).toEqual({ min: 0.3, max: 0.95 });
  expect(body.planner).toHaveProperty("effectiveQuestionMultiple");
  expect(body.planner).toHaveProperty("injectionCap");
  expect(body.planner).toHaveProperty("writeOffs");
  expect(body.planner).toHaveProperty("underPractised");
});

test("GET settings stays read-only on the tuning block", async () => {
  const res = await postSettings({ planner: { tuning: { masteryBar: 0.4 } } });
  expect([404, 405]).toContain(res.status);
});

test("another user's plan cannot be patched", async () => {
  const res = await patchPlanAs(otherUser, plan.id, { planMode: "curriculum-strict" });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && npx vitest run tests/api/plan-tuning.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend both routes**

In `plans/[id]/route.ts`, add a Zod schema for the four fields, following the file's existing validation pattern. An unknown enum value or a `fixed-date` policy with no date is a 400. A numeric constant outside its range is not a 400: it is accepted, clamped by `parseTuning`, and the `rejected` list is returned in the response body, so the candidate's other edits are not lost to one bad field. Regenerate forward after a successful write, reusing the path the existing `orderingStrategy` change already takes.

In `settings/route.ts`, add a `planner` block with `tuning`, `ranges` from `TUNING_RANGES`, `defaults` from `DEFAULT_TUNING`, and the derived figures the last generation returned. The route stays read-only, as the comment at `route.ts:6` requires; nothing is added that writes.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/api/plans apps/backend/src/app/api/settings apps/backend/tests/api/plan-tuning.test.ts
git commit -m "feat(api): read and write plan mode, review policy and planner constants"
```

---

### Task 10: Prior-work intake at onboarding

**Files:**
- Modify: `apps/frontend/src/app/onboarding/page.tsx`
- Modify or create the matching backend write path under `apps/backend/src/app/api/`
- Test: `apps/backend/tests/api/prior-work.test.ts` (create)

**Interfaces:**
- Consumes: `StudyLogEntry.selfDeclared` from Task 7.
- Produces: an endpoint taking, per topic area, whether it has been read and roughly how many questions were answered at roughly what accuracy, written as `selfDeclared` log rows.

- [ ] **Step 1: Write the failing tests**

```ts
test("declared prior work becomes selfDeclared log rows against that area's outcomes", async () => {
  await postPriorWork(plan.id, [{ topicKey: "qm", read: true, questionsAnswered: 120, accuracyPercent: 70 }]);
  const rows = await db.studyLogEntry.findMany({ where: { planId: plan.id } });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.selfDeclared)).toBe(true);
  expect(rows.reduce((s, r) => s + r.questionsAnswered, 0)).toBe(120);
});

test("declared work is distinguishable from logged work", async () => {
  await postPriorWork(plan.id, [{ topicKey: "qm", read: true, questionsAnswered: 120, accuracyPercent: 70 }]);
  await logRealWork(plan.id, "qm");
  const rows = await db.studyLogEntry.findMany({ where: { planId: plan.id } });
  expect(new Set(rows.map((r) => r.selfDeclared))).toEqual(new Set([true, false]));
});

test("an accuracy outside 0 to 100 is rejected", async () => {
  const res = await postPriorWork(plan.id, [{ topicKey: "qm", read: true, questionsAnswered: 10, accuracyPercent: 140 }]);
  expect(res.status).toBe(400);
});

test("declaring reading only, with no questions, still marks the reading done", async () => {
  await postPriorWork(plan.id, [{ topicKey: "qm", read: true, questionsAnswered: 0, accuracyPercent: null }]);
  const rows = await db.studyLogEntry.findMany({ where: { planId: plan.id } });
  expect(rows.every((r) => r.questionsAnswered === 0)).toBe(true);
  expect(rows.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Spread the declared question count and correct count across the area's outcomes in proportion to their question minutes, the same pro-rata rule `reconcile` uses, so the two agree. `confidence` on a declared row is the midpoint, 3, since the candidate rated a topic area rather than an outcome. A declared row's `date` is the declaration date, so freshness decays from when they said it, not from when they studied it, which is the conservative direction.

- [ ] **Step 3: Run to verify pass**

Run: `cd apps/backend && npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/app/api apps/backend/tests/api/prior-work.test.ts apps/frontend/src/app/onboarding
git commit -m "feat(onboarding): take prior reading and practice as self-declared log rows"
```

---

### Task 11: Planner settings section

**Files:**
- Create: `apps/frontend/src/components/planner-settings.tsx`
- Create: `apps/frontend/src/components/planner-settings.module.css`
- Modify: `apps/frontend/src/app/settings/page.tsx:155`

**Interfaces:**
- Consumes: `GET /api/settings`'s `planner` block and `PATCH /api/plans/:id` from Task 9.
- Produces: a `<PlannerSettings />` component mounted as a new section on `/settings`.

**Required skills:** this is front-end design work, so `frontend-design:frontend-design` designs it before any JSX is written, and `impeccable` audits the section afterwards. Design, review, then build, in that order.

- [ ] **Step 1: Design the section before writing JSX**

Eighteen numbers on one screen is the failure mode the spec's anti-goals name explicitly. Produce the layout first: the mode and policy choices as the primary decision, the mastery formula's constants grouped under one heading with the formula shown so the numbers mean something, the evidence triggers under another, and the derived read-only figures (the solved multiple against the requested one, the current injection cap, the write-offs, the under-practised units) as a status block rather than inputs. Progressive disclosure: the two choices are always visible, the constants sit behind a disclosure.

- [ ] **Step 2: Write the failing component tests**

```tsx
test("renders the three modes and marks the active one", () => { /* ... */ });
test("renders the four review policies and reveals the date field only for fixed-date", () => { /* ... */ });
test("shows the solved multiple next to the requested one when they differ", () => { /* ... */ });
test("shows the current injection cap and the reason when it has been throttled", () => { /* ... */ });
test("a value outside its range is flagged inline and the clamped value is shown", () => { /* ... */ });
test("every input is labelled and reachable by keyboard", () => { /* ... */ });
test("lists written-off readings with the mastery that justified each", () => { /* ... */ });
```

- [ ] **Step 3: Build to the design, then audit**

Follow the project's existing CSS module pattern, matching `coach-settings.module.css`. Range inputs paired with a numeric field for the shares and weights, plain number inputs for the day and minute counts. The three mastery weights show their normalised values live, so setting 6, 2.5 and 1.5 visibly becomes 0.60, 0.25 and 0.15.

Then run `impeccable` over the section: contrast, focus states, semantic markup, keyboard navigation, and the copy, which follows the no-em-dash rule.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/frontend && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/planner-settings.tsx apps/frontend/src/components/planner-settings.module.css apps/frontend/src/app/settings/page.tsx
git commit -m "feat(settings): planner modes, review policy and every constant the engine reads"
```

---

### Task 12: Production gate

**Files:**
- Modify: `.gitignore`
- Test: the whole suite

- [ ] **Step 1: Ignore the brainstorming scratch directory**

Add `.superpowers/` to `.gitignore`. The mockups from design live there and must not ship.

- [ ] **Step 2: Run everything**

Run: `cd apps/backend && npx vitest run && npm run typecheck && npm run build`
Run: `cd apps/frontend && npm run typecheck && npm run lint && npm run build`
Expected: PASS on all six.

- [ ] **Step 3: Generate a real plan and read it**

Seed, generate against `curriculum-topic`, and print the first three weeks. Confirm by eye what the tests assert mechanically: topic areas do not shuffle inside a week, every question task follows its own reading, and the week's minutes match what the week was given. This is the step that catches a plan that passes every unit test and is still wrong to look at.

- [ ] **Step 4: Commit and push**

```bash
git add .gitignore
git commit -m "chore: ignore brainstorming scratch directory"
git push origin main
```

---

## Self-Review

**Spec coverage.** Three modes: Task 3. Rule A with the candidate's trace: Task 5. Mastery and its aggregations: Task 2. Four review policies and the weekly 1:4: Task 6. The solved multiple: Task 4. The coverage-first throttle: Task 6. Reconciliation and the four cases: Task 4. The write-off bar: Task 4. The gating invariant: Tasks 5 and 8. The layer mapping: Task 8. Learning-outcome aggregation: Tasks 2 and 10. The sub-floor unit: Task 5. Every tuning field: Tasks 1 and 11. Schema: Task 7. Prior-work intake: Task 10. No gaps.

**Review Focus coverage.** Zero logged work in Task 2, zero reading minutes and zero question minutes in Task 5, a calendar shorter than the reading in Task 4, a future-dated log in Task 2. All five pinned.

**Type consistency.** `Tuning` is defined once in Task 1 and consumed by name everywhere. `MasteryObservation` is defined in Task 2 and used unchanged in Tasks 4 and 10. `ReconciledUnit` extends `PackableGroup`, defined in Task 4 and consumed in Task 5. `ReviewUnit` is defined in Task 6 and is deliberately not `ReconciledUnit`: the review phase reads `reviewReadMinutes`, which the first pass never touches. `PlanMode` and `ReviewPolicy` are string unions from Task 1, matching the schema's string columns in Task 7 and the Zod enums in Task 9.

**Proportion.** Twelve tasks against a 642-line spec. The bulk is test assertions with the spec's exact values in them, which is where the decisions are. Only `packFirstPass` has an algorithm the signature does not determine, and it is referenced to the spec's Rule A rather than transcribed.
