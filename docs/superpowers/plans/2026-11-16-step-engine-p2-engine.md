---
title: Step engine phase 2, the engine
type: spec
module: apps/backend/src/core/steps
updated: 2026-11-16
status: active
---

# Step engine phase 2: the engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the planner with a pure five-step engine (`core/steps/`), wire `generateHorizon` to it, and delete the old packers.

**Architecture:** Pure functions, no DB, in `apps/backend/src/core/steps/`. `lib/FUNC-schedule.ts` loads rows, builds the engine input, calls `planSteps`, and keeps its existing 14-day write transaction. Step state is derived from history every rebuild. The whole schedule to the exam is computed each time; only 14 days persist.

**Tech Stack:** TypeScript, Vitest, Prisma 6.

**Spec:** docs/superpowers/specs/2026-11-16-step-engine-design.md (all of "The five steps", "Package priority", "Hours and the fit ladder", "Self-states and recording", "Builder answers").

## Global Constraints

- Step 2 pass: cumulative round accuracy >= 0.80 AND round minutes (questions + answer review) >= 2 x step 1 minutes (uncrashed).
- Step 4: same, adequate = 2 x step 2 adequate.
- Top-up questions: `max(ceil((0.8*A - C) / 0.2), ceil(shortMin / perQuestionMin))`, never negative.
- Exemption: round minutes >= 2 x adequate minutes and accuracy < 0.80 -> a step 3 review task, then a new round (A, C, minutes reset).
- Minutes per question 3; answer review = answer words / 200 wpm when the resource has `wordCount` on its answer_set, else 1/3 of answering minutes.
- Step 3 time = 1/2 x step 1 minutes (cap). Low-confidence step 1 self-state: replacement task = 1/2 x step 1 minutes.
- Mocks: gate = exam - 30 days; minimum mocks per week before exam: week -4: 1, -3: 2, -2: 3, -1: 4. Mock = 2 sessions x 132 min + answer review 0.5 x session minutes. Topic < 0.75 sends its modules to a new step 3 + step 4 round.
- Crash ceiling: reading/video minutes / 1.5, question minutes x 0.75; crash goes in 6 even steps (k = 1.0, 1.1 ... 1.5, question factor 1 - 0.5*(k-1)).
- Holidays cancelled closest-to-exam first. Trim order when `belowPassAccepted`: step 4 extras, step 4 base (lowest exam-weight topic first), mocks (earliest week first). Steps 1, 2, 3 never trimmed.
- Default step priority (package slugs): 1 `["mm-l2","kaplan-l2","cfa-les"]`, 2 `["uw-l2-2025","kaplan-l2","premium-l2","cfa-les"]`, 3 `["mm-l2","kaplan-l2","cfa-les"]`, 4 `["premium-l2","kaplan-l2","uw-l2-2025","cfa-les"]`, 5 `["premium-l2","cfa-les","kaplan-l2"]`. Only packages on the plan count.
- LES reading minutes scale by `plan.lesReadingHours / 200`. LES question supply is unlimited.
- Task kinds written: `read`, `questions`, `answer-review`, `review`, `mock`, `mock-review`. Old kinds stay readable for history.
- Comments: why not what, no em dashes.

## Review Focus

- A module whose only step 2 package bank runs out mid-round must continue on the next package, never stall with an unplannable deficit.
- A plan created the day before the gate, or after it, must still produce mocks and must not divide by zero capacity.
- Weekday caps of 0 on some days plus a holiday covering every remaining study day before the gate: fit ladder cancels it, never infinite-loops.
- Undo (record then set pending) must return step state exactly to before; state derivation is pure over current rows.
- Off-plan sessions and pre-existing old-kind tasks (`content-video`, `eocq`, `questions`, `review`) must map into steps (spec Builder answer 1).

---

### Task 1: Types, catalogue view and step rules

**Files:**
- Create: `src/core/steps/types.ts`, `src/core/steps/catalog.ts`, `src/core/steps/rules.ts`, tests `catalog.test.ts`, `rules.test.ts` beside them.

**Interfaces (produces):**
```ts
type StepNo = 1 | 2 | 3 | 4;
type SourceOption = { packageSlug: string; packageId: string; resourceIds: string[];
  kind: "read" | "questions"; minutes: number;            // read: total minutes for the module from this package
  questions?: number | null;                                // bank size; null = unlimited (LES)
  minutesPerQuestion?: number; answerReviewPerQuestion?: number; label: string };
type ModuleCatalog = { readingId: string; topicId: string; topicOrder: number; readingOrder: number;
  examWeight: number; options: Record<StepNo, SourceOption[]> };   // ordered by plan priority, packages on plan only
function buildCatalog(input: { readings: ReadingRow[]; units: UnitRow[]; resources: ResourceRow[];
  planPackageSlugs: string[]; priority: Record<1|2|3|4|5, string[]>; lesHours: number }): ModuleCatalog[];
function step1Minutes(m: ModuleCatalog): number;           // first option that covers reading; uncrashed
function adequateMinutes(m: ModuleCatalog, step: 2 | 4): number; // 2x step1, 4x step1
function topUpQuestions(r: { answered: number; correct: number; minutes: number; adequate: number; perQ: number }): number;
function roundOutcome(r: RoundState, adequate: number): "pass" | "top-up" | "exemption";
```
Read option minutes: Meldrum = lecture + eocq (+ seminar) seconds / 60 for step 1; step 3 = min(notes pages x 2.5 + review video minutes, 0.5 x step1). Kaplan has no read option. LES = notes `durationSeconds` x lesHours/200. Fan-out units (one unit, many readings) split minutes and question counts by the readings' LES share.

- [ ] Step 1: Tests: `topUpQuestions({answered:40,correct:24,...adequate met})` = 40; shortfall-only case 30 min short at 3 min/q = 10; both -> max; passing -> 0. `roundOutcome` exemption at minutes >= 2 x adequate with 0.79. `buildCatalog` orders by priority, skips packages not on plan, Kaplan absent from step 1, fan-out split sums to the unit total, LES scaled at 150 h = 0.75 x.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS + `npx tsc --noEmit`. Step 5: commit `feat(engine): step catalogue and rules`.

### Task 2: Derive step state from history

**Files:** Create `src/core/steps/state.ts`, `state.test.ts`.

**Interfaces:**
```ts
type HistoryTask = { id: string; date: string; kind: string; step: number | null; round: number | null;
  readingIds: string[]; status: "done" | "partial" | "pending"; minutes: number;
  answered: number; correct: number; answerReviewDone: boolean; packageSlug: string | null };
type Declaration = { readingId: string; step: StepNo; confidence: number | null; answered: number | null; correct: number | null };
type MockResult = { date: string; topicScores: Array<{ topicId: string; answered: number; correct: number }> };
type RoundState = { round: number; answered: number; correct: number; minutes: number; usedByPackage: Record<string, number> };
type ModuleState = { readingId: string;
  s1: { doneMin: number; done: boolean; lowConfidence: boolean };
  s2: RoundState & { passed: boolean; pendingAnswerReview: number };
  s3: { doneMin: number; done: boolean; owed: number };   // owed counts reviews required (exemption, mock fail)
  s4: RoundState & { passed: boolean; pendingAnswerReview: number };
  mockRetestFrom: string | null };
function deriveState(cat: ModuleCatalog[], tasks: HistoryTask[], decls: Declaration[], mocks: MockResult[]): Map<string, ModuleState>;
```
Old-kind mapping when `step` is null: `content-notes|content-video|seminar|eocq` -> 1; `review` -> 3; `questions` -> 2 until s2 passes, then 4 if s3 done else still 2; `answer-review` follows the task it reviews. Partial credits min(actual, estimate). Questions done without answer review add to `pendingAnswerReview`. Declarations per spec "Self-states" (s3 ignored without s1, s4 without s2). Mock topic < 0.75 after a module passed s4 -> `s3.owed += 1`, new s4 round.

- [ ] Step 1: Tests: one per mapping rule above; exemption opens round 2 and s3.owed; declaration passing step 2 marks answer review done; low confidence s1; mock fail reopens; undo (task back to pending) equals fresh state.
- [ ] Steps 2-5 as Task 1; commit `feat(engine): derive module step state`.

### Task 3: Remaining work list

**Files:** Create `src/core/steps/work.ts`, `work.test.ts`.

**Interfaces:**
```ts
type WorkItem = { id: string; readingId: string; step: 1|2|3|4|5; round: number; kind: "read"|"questions"|"answer-review"|"review"|"mock"|"mock-review";
  minutes: number; questions?: number; packageId: string; resourceIds: string[]; label: string;
  extraReason: null | "top-up-80" | "top-up-adequacy" | "package-switch" | "exemption-review" | "mock-retest" | "answer-review-owed";
  after: string[] };   // ids of items that must finish first
function remainingWork(cat: ModuleCatalog[], state: Map<string, ModuleState>): WorkItem[];
```
Per module in curriculum order: s1 remainder (or low-confidence replacement), s2 remaining questions = current deficit or the full adequate count on a fresh round (questions = ceil(adequate / (perQ + reviewPerQ))) drawn from options in priority order respecting `usedByPackage`, each question item paired with an answer-review item; s3 (after s2 pass, plus owed reviews); s4 like s2. `extraReason` set when the item exists because of a failed check, a package switch, an exemption, a mock retest, or owed answer review.

- [ ] Step 1: Tests: fresh module yields read -> questions -> answer-review -> review -> questions -> answer-review with correct minutes; UWorld bank of 20 when 40 needed yields 20 UWorld + 20 next-package questions tagged `package-switch`; top-up after 24/40 yields 40 questions tagged `top-up-80`; owed answer review item.
- [ ] Steps 2-5; commit `feat(engine): remaining step work`.

### Task 4: Scheduler and mocks

**Files:** Create `src/core/steps/schedule.ts`, `src/core/steps/mocks.ts`, tests.

**Interfaces:**
```ts
type DayCap = { date: string; minutes: number; holidayId: string | null };
type ScheduledTask = { date: string; order: number; item: WorkItem; minutes: number };
function mockSlots(today: string, exam: string, sessions: MockSession[], eligibleFrom: Map<string, string>): WorkItem[] & dated;
function schedule(input: { today: string; exam: string; caps: DayCap[]; work: WorkItem[]; mocks: MockPlacement[];
  reviewPolicy: "decay-triggered"|"after-coverage"|"weekly-interleave"|"fixed-date"; reviewStartDate: string | null;
  order: "curriculum-topic"|"curriculum-strict" }): { tasks: ScheduledTask[]; load: number; unplaced: WorkItem[] };
```
Algorithm: mocks are placed first on the largest-capacity days of each exam week (a day too small takes one session, the second session goes on the next study day). Load factor `f = max(R12 / C12, Rall / Call)` where R12 = remaining steps 1-2 minutes, C12 = capacity today..gate after mocks, Rall/Call to exam. Each day takes `cap x min(f,1)` minutes filled in dependency order: steps 1-2 queue first; review items join once eligible by policy (decay-triggered: 14 days after the module's s2 finish; after-coverage: after every module's s2; weekly-interleave: up to 20% of each week; fixed-date: from reviewStartDate). Items split across days in >= 15 minute pieces. `load > 1` means it does not fit; caller runs the fit ladder.

- [ ] Step 1: Tests: even spread (two weeks, 10 h work, 20 h caps -> each day ~50% of cap); s1/s2 finish by gate; mocks 1/2/3/4 by week and none before eligibility; zero-cap days skipped; plan starting inside the gate window still places mocks; load > 1 reported.
- [ ] Steps 2-5; commit `feat(engine): step scheduler and mock placement`.

### Task 5: Fit ladder, metrics and `planSteps`

**Files:** Create `src/core/steps/fit.ts`, `src/core/steps/metrics.ts`, `src/core/steps/index.ts`, tests.

**Interfaces:**
```ts
type FitReport = { crash: number; cancelledHolidayIds: string[]; feasible: boolean; belowPass: boolean;
  trims: Array<{ readingId: string | null; step: 4 | 5; minutes: number; reason: string }> };
function planSteps(input: EngineInput): { tasks: ScheduledTask[]; fit: FitReport; windows: ModuleWindow[];
  metrics: { readiness: number; readinessPlanToday: number; extras: { tasks: number; minutes: number }; requiredMinutes: number } };
type ModuleWindow = { readingId: string; steps: Array<{ step: StepNo; start: string | null; due: string | null; doneOn: string | null; status: "done"|"planned"|"overdue"|"in-progress" }> };
```
Ladder per spec; readiness = sum over topics of examWeight x topic completion, topic completion = sum over steps of (done-and-passed step minutes / planned step minutes) weighted by step's share of planned minutes. `readinessPlanToday` uses the windows' due dates up to today.

- [ ] Step 1: Tests: crash applied before holiday cancel; holiday nearest exam cancelled first; infeasible without consent -> `feasible:false`, tasks still returned at load 1; with consent trims in the stated order and never step 1-3; readiness of a fresh plan 0 and of all-passed plan 1.
- [ ] Steps 2-5; commit `feat(engine): fit ladder, metrics and planSteps`.

### Task 6: Schema and wiring `generateHorizon`

**Files:**
- Modify: `prisma/schema.prisma` (StudyPlan: `stepPriority Json?`, `lesReadingHours Int @default(200)`, `belowPassAccepted Boolean @default(false)`, `fitReport Json?`; PlanTask: `step Int?`, `round Int?`, `extraReason String?`, `mockRef String?`, `answerReviewDone Boolean @default(false)`, `resourceIds String[]`, `questionCount Int?` (existing `packageId` reused; HistoryTask answered/correct = sum of the task's StudyLogEntry rows); new `StepDeclaration {id, planId, readingId, step, confidence Int?, answered Int?, correct Int?, createdAt; @@unique([planId, readingId, step])}`; new `MockTopicScore {id, mockExamId, topicId, answered, correct}`; MockExam `sessionRef String?`), migration `step_engine`.
- Modify: `src/lib/FUNC-schedule.ts` (replace planning body with load -> `planSteps` -> map to planned days; keep the write transaction, writing the new fields; `dryRun` returns `{ tasks, fit, windows, metrics }` for the projection); `tests/helpers/test-db.ts` (reset new tables).
- Delete: `src/core/{allocation,pairing,packing,ordering,review,sequence,effort,question-pace,calibration,mastery,spread?}.ts` and their tests, only where no remaining import exists (`spread` stays if `FUNC-record.ts` uses it). Remove `effort-return` from `validation.ts` planMode enum and `core/tuning.ts`; tuning keeps only `readingWpm`, `minutesPerQuestion`, review policy fields.
- Keep every importer compiling and green: `FUNC-campaign.ts` maps new dry-run tasks to its stage minutes (`read` step 1 -> firstPassReading, `review` -> reviewReading, questions/answer-review by `step` 2 or 4, `mock*` -> mocks); `FUNC-prescription.ts` resolves materials from `packageId` + `resourceIds` instead of roles; `FUNC-coach.ts` `KIND_LABELS` gains the new kinds.
- Update: `tests/schedule/*.test.ts` to the new model (delete tests for removed behaviour; keep postponed tagging and write-transaction tests).

- [ ] Step 1: Integration test `tests/schedule/step-engine.test.ts` with the test DB: seed a level with 2 topics x 2 readings, a Meldrum-like and UWorld-like package, a plan 120 days out with 2 h/day: first rebuild writes 14 days of `read` then `questions` + `answer-review` tasks with `step` set; recording a step 2 task at 50% then rebuilding inserts a `top-up-80` task; plan's `fitReport.feasible` true.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: full backend suite `npx vitest run` and `npx tsc --noEmit` PASS. Step 5: commit `feat(engine): generateHorizon runs the step engine; remove old packers`.
