---
title: Study history on topic page and question stats on Today
type: spec
module: root
updated: 2026-11-18
status: active
---

## Purpose

1. Topic page (`/syllabus/[topicId]`): per module, a drill-down of everything done per engine step, with edit and delete on every record.
2. Today: question rows show `n / m + q`, module total, overall rate, this-round rate, each coloured met or not met.
3. Today bug ("Basics of Multiple Regression" still owed after self-state): engine follows spec (`2026-11-16-step-engine-design.md` line 134). Stated step-2 counts below 80% or below adequate become round attempts, and a 1-question top-up followed. No engine change. Item 2 makes the reason visible.

## Methods

### Definitions (shared by backend and frontend)

- `perQ(step)` = `minutesPerQuestion + answerReviewPerQuestion` of `catalog.options[step][0]` (same rate `work.ts` sizes with).
- `adequateMin(step)` = `adequateMinutes(m, step)` from `core/steps/catalog.ts`.
- `m` (adequate question count) = `ceil(adequateMin / perQ - EPS)`; 0 when no option.
- `n` = `state.sK.answered` of the current round (stated plus recorded, as the engine sees it).
- `q` = sum of `questionCount` of the plan's pending tasks for that module, step, current round with `extraReason` not null and kind `questions`. Display `n / m + q` (omit `+ q` when 0).
- Round rate = `correct / answered` of current round; met when `accuracyMet` (>= 80%).
- `n / m` met when `round.minutes >= adequateMin - EPS` (engine adequacy, minutes based).
- Module total = all answered across step 2 and 4, every round, recorded plus stated, plus the topic's mock answered (mocks are scored per topic, not per module). Met when total >= m(2) + (s2 passed ? m(4) : 0).
- Overall rate = total correct / total answered over that same set. Met when >= 80%.

### Backend: extend projection modules

`FUNC-projection.ts` `sections[].modules[].performance.s2|s4` (StepPerformance) gains:
`adequateQ: number` (m), `extraPendingQ: number` (q), `perQ: number`.
`sections[].modules[]` gains `totals: { answered: number; correct: number; mockAnswered: number; mockCorrect: number }` (definition above; mock part is the topic's).
Bump the projection cache key if it encodes shape. Update `tests/api/projection.test.ts`.

### Backend: GET /api/plans/[id]/history?topicId=X

Owner check like other plan routes. Response:

```ts
type HistoryResponse = {
  topicId: string;
  mocks: Array<{ id: string; date: string; createdAt: string; sessionRef: string | null; packageName: string | null;
    scorePercent: number; answered: number; correct: number }>; // this topic's MockTopicScore only
  modules: Array<{
    readingId: string; name: string; order: number;
    steps: Array<{
      step: 1 | 2 | 3 | 4;
      status: "done" | "in-progress" | "not-started";
      round: number | null; // 2 and 4 only
      doneMin: number; targetMin: number;
      questions: null | { n: number; m: number; q: number; answered: number; correct: number; adequateMin: number; minutes: number; passed: boolean };
      records: Array<
        | { type: "task"; id: string; date: string; recordedAt: string; kind: string; step: number | null; round: number | null;
            status: "done" | "partial"; offPlan: boolean; extraReason: string | null; packageId: string | null; packageName: string | null;
            materials: Array<{ label: string; url: string | null }>; estimatedMinutes: number; actualMinutes: number | null;
            answerReviewDone: boolean; answerReviewMinutes: number | null; answered: number; correct: number;
            confidence: number | null; note: string | null }
        | { type: "declaration"; step: 1 | 2 | 3 | 4; createdAt: string; updatedAt: string;
            confidence: number | null; answered: number | null; correct: number | null }
      >; // newest first
    }>;
  }>;
};
```

Task records: `PlanTask` with status done or partial whose `readingIds` include the module; step via `stepOf` logic in `FUNC-projection.ts` (answer-review tasks go under their step). `recordedAt` = latest log `date`, else task `updatedAt`. Materials resolve the same way the prescription route does (reuse its helper, do not duplicate). Declarations from `StepDeclaration` plus the onboarding `studyLogEntry selfDeclared` rows are out of scope (show StepDeclaration only).

### Backend: edits

- `PATCH /api/plans/[id]/tasks/[taskId]` (exists): accept optional `date` (YYYY-MM-DD, not after plan today) and `packageId` (must be a plan package) for recorded tasks. Date move: pick `order = max(order on that date) + 1`, set `frozen = date < today`. Logs of the task move date too.
- `DELETE /api/plans/[id]/tasks/[taskId]`: off-plan task: delete task and its logs. Planned task: same as undo (status pending, logs deleted, actual minutes cleared). Replan after.
- `PATCH /api/mock-exams/[id]`: `{ date?, scorePercent?, topicScores?: Array<{topicId, answered, correct}> }`, validate correct <= answered, replan after.
- Declarations: existing `POST` (upsert) and `DELETE` cover edit and delete. Deleting step 1 while step 3 exists, or step 2 while step 4 exists: return 400 with a clear message (check the existing DELETE does this; add if not).
- Every new route must be added to the frontend proxy allowlist `apps/frontend/src/app/api/proxy/allowlist.ts` (frontend builder owns that file).

## Logic

- Engine semantics never change. The new numbers are read from `deriveState` output and the catalog already computed in `generateHorizon` dry run.
- Mocks only carry per-topic scores; a module's total includes its topic's mock counts, labelled "incl. topic mocks".
- Edits and deletes replan with `generateHorizon(planId, today)` in try/catch, same as existing routes.

## Data flow

- PlanTask + StudyLogEntry + StepDeclaration + MockTopicScore -> history route -> useHistory(topicId) -> topic page step panels.
- generateHorizon dryRun -> state + catalog -> projection modules (adequateQ, extraPendingQ, totals) -> useProjection -> Today question row stats.
- Edit dialog -> PATCH/DELETE route -> replan -> invalidate history, projection, prescription, logs, mocks queries.

## Dependencies

- Engine: `core/steps/state.ts`, `core/steps/catalog.ts`, `core/steps/rules.ts`.
- Frontend: existing `useProjection`, `useDeclare`, `useRemoveDeclaration`, `useSubmitTask`, record sheet, declare sheet.

## Related

- [Step engine design](../specs/2026-11-16-step-engine-design.md): rules the numbers come from.
