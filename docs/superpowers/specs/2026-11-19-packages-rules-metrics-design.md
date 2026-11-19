---
title: Question numbers, packages page, tunable step rules, plan metrics
type: spec
module: root
updated: 2026-11-19
status: active
---

## Purpose

Five user asks, 2026-11-19:

1. Record form: optional "which questions" field, e.g. `1,3,4,6,8,12,13` or `2-24`.
2. New Packages page: per package, what is covered (videos watched, questions answered and which are left), performance per topic and per LOS.
3. Today row "total" showed ✗ after step 2 passed (14 answered vs 43 "needed"). Fixed in `apps/frontend/src/lib/question-stats.ts`: step 4's quota joins "needed so far" only once step 4 is under way.
4. Step engine constants become per-plan settings.
5. Progress page shows plan metrics: hours and questions the plan requires, done, left, per topic.

## Methods

### A. Step rules (item 4)

`StepRules` lives in `apps/backend/src/core/steps/rules.ts`:

```ts
export type StepRules = {
  step2Multiplier: number;    // step 2 adequate minutes = k2 x step 1 minutes. default 2, range 0.5..6
  step4Multiplier: number;    // step 4 adequate minutes = k4 x step 2 adequate. default 2, range 0.5..6
  accuracyTarget: number;     // percent for steps 2 and 4. default 80, range 50..100
  mockPassTarget: number;     // percent per topic in a mock. default 75, range 50..100
  exemptionMultiplier: number;// exemption after this many x adequate minutes below target. default 2, range 1.25..5
};
export const DEFAULT_RULES: StepRules = { step2Multiplier: 2, step4Multiplier: 2, accuracyTarget: 80, mockPassTarget: 75, exemptionMultiplier: 2 };
```

- Carried on each `ModuleCatalog` as optional `rules?: StepRules` (absent = `DEFAULT_RULES`), set by `buildCatalog` from a new optional input `rules`. This keeps every engine signature and every existing test unchanged.
- `adequateMinutes(m, 2) = k2 * s1`, `adequateMinutes(m, 4) = k2 * k4 * s1` (defaults reproduce 2x and 4x).
- `accuracyMet`, `topUpParts`, `roundOutcome` take an optional target fraction / exemption multiplier, defaulting to the current 0.8 and 2. Top-up formula generalises: `n80 = ceil((t*A - C) / (1 - t))`; at t = 1 any wrong answer cannot be recovered, so cap: if t >= 1 and C < A, n80 = 0 and rely on exemption.
- Mock retest threshold in `state.ts` reads `rules.mockPassTarget / 100`.
- Tuning: five new fields in `core/tuning.ts` `Tuning`, `DEFAULT_TUNING`, `TUNING_RANGES`; parsed like `answerReviewWordsPerMinute`. `FUNC-schedule.ts` passes them to `buildCatalog` and exposes `rules` on `HorizonResult`.
- Settings UI: `planner-settings.tsx` gets a "Step rules" group, five number inputs with units (x, %), save and reset-to-default, same pattern as the words-per-minute field.

### B. Question numbers (item 1)

- `PlanTask.questionNumbers Int[] @default([])`, new migration.
- Record APIs (`PATCH /plans/:id/tasks/:taskId`, `POST /plans/:id/sessions`) accept optional `questionNumbers: number[]` (ints 1..5000, max 2000, deduped and sorted server side). `recordTask` writes it; undo (`pending`) clears it.
- Numbers refer to the package unit's question set (all `question_set` resources of the unit, in ref order, numbered from 1).
- Frontend parser `parseQuestionNumbers(text)` in `apps/frontend/src/lib/question-numbers.ts`: accepts commas, spaces, ranges `a-b` (also en dash), returns `{ numbers, error }`; plus `formatQuestionNumbers(numbers)` compressing runs back to `2-24, 30`.
- Record sheet: optional field "Which questions (optional)" for question work, placeholder `e.g. 1, 3-8, 12`; live preview "7 questions"; when answered is empty it fills answered from the count.

### C. Package coverage (item 2)

`GET /api/plans/:id/coverage` returns, for each package on the plan with an edition at the plan's level:

```ts
type Coverage = { packages: Array<{
  packageId: string; name: string; slug: string | null; year: string;
  videos: { count: number; watched: number; seconds: number; watchedSeconds: number };
  questions: { total: number; answered: number; correct: number; numbered: number };
  topics: Array<{ topicId: string; name: string; order: number;
    videos: same shape; questions: same shape;
    units: Array<{ unitId: string; ref: string; title: string; readingIds: string[]; readingNames: string[];
      videos: Array<{ resourceId: string; title: string; seconds: number; status: "watched" | "partial" | "not-started" }>;
      questions: { total: number; answered: number; correct: number; numbered: number[]; unnumbered: number; left: number[] | null };
      los: Array<{ losId: string | null; label: string; text: string; questionCount: number | null; answered: number; correct: number }>;
    }> }> }> };
```

- A video (kinds lecture, eocq, seminar, review with duration) is watched when a done task lists its id in `resourceIds`, partial when only partial tasks do, also watched when a self-declared log with `declaredWatched` names this package on one of the unit's readings.
- Unit questions: `numbered` is the union of `questionNumbers` of finished tasks whose `resourceIds` meet the unit's question sets; `unnumbered` sums answered of such tasks recorded without numbers; `answered = min(total, |numbered| + unnumbered)`. `left` lists missing numbers, or null when unnumbered > 0 (unknown which).
- Correct counts and LOS figures come from `StudyLogEntry` rows of those tasks (rows are spread evenly over a module's LOS at record time, so LOS accuracy mirrors the module's).

### D. Plan metrics (item 5)

`Projection` gains:

```ts
rules: StepRules;
totals: {
  requiredMin: number; doneMin: number; leftMin: number;     // steps 1-4 planned minutes plus mock minutes
  byStep: Record<"1"|"2"|"3"|"4"|"5", { requiredMin: number; doneMin: number }>;
  questions: { required: number; answered: number; correct: number }; // steps 2 and 4
  daysLeft: number; minPerDayNeeded: number; minPerDayAvailable: number;
};
sections[i].questions: { required: number; answered: number; correct: number };
```

- Required questions per module and step: `ceil(adequateMinutes / perQ)` at the first option's rate (0 without an option).
- Frontend: a "Plan metrics" tile first in the Pace bento, wide: headline figures (hours required, done, left, h/day needed vs available, questions required/answered, accuracy against `rules.accuracyTarget`), then a per-topic table (hours planned/done by step, questions required/answered, accuracy).
- `question-stats.ts` `RATE_TARGET` stays the default; callers pass `projection.rules.accuracyTarget` when present.

## Logic

- Rules live on the catalog rather than threaded through every function: the catalog is already built per plan, so per-plan rules ride along for free and old call sites keep defaults.
- Question numbers are per unit, not per reading, because that is how providers number their banks.

## Data flow

- settings form -> PATCH /plans/:id tuning -> parseTuning -> FUNC-schedule -> buildCatalog(rules) -> engine
- record sheet -> parseQuestionNumbers -> PATCH task / POST session -> recordTask -> PlanTask.questionNumbers -> GET coverage -> Packages page
- engine dry run -> buildProjection totals -> Plan metrics tile

## Dependencies

- Step engine: [Step engine design](2026-11-16-step-engine-design.md)

## Related

- [Step engine design](2026-11-16-step-engine-design.md): the rules being made tunable.
