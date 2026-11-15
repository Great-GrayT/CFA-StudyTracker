---
title: Postponed cells, plan restart, and plan-shaped study logs
type: spec
module: root
updated: 2026-11-15
status: active
---

## Purpose

Three owner requests, approved together on 2026-11-15.

1. Drop the Today "Not done" list. Missed work goes back into the plan from
   today onward wherever the engine places it, and each cell carrying missed
   work shows a Postponed tag.
2. A Settings button that restarts the plan exactly like a new user.
3. Record study takes the same shape as a plan cell: section, module, type,
   package, minutes. Today it is outcome-level and feels underbuilt.

Non-goals: changing how the packer orders or sizes work; deleting history;
the wider frontend redesign (separate draft spec).

## Approaches

- Postponed: one sensible way. The engine already re-owes missed work because
  `loadWorkDone` credits only `done` and `partial`. Only the link is missing,
  so the write step tags matching cells. A fixed-block re-slot was rejected:
  it fights the packer, and the owner wants the engine's optimisation.
- Restart: one sensible way. Deactivate the plan (the create path already
  does this), clear the onboarding draft, go to `/onboarding`. Hard delete was
  rejected: a misclick would destroy history.
- Log study: A) save as an off-plan `PlanTask` with status `done`, so the
  engine credits it by kind like any cell and the day view renders it as a
  cell; B) add kind, reading and minutes to `StudyLogEntry` and teach the
  engine a second credit rule. Chose A: one credit path, no drift.

## Logic

### Postponed

- New column `PlanTask.postponedFrom DateTime?`.
- In `generateHorizon`'s write transaction, after freezing, load frozen
  past cells with `status = "pending"` and no `insertedBecause = "off-plan"`.
- Every cell created or rewritten in the window gets `postponedFrom` = the
  earliest missed date whose `kind` matches and whose `readingIds` overlap.
  Otherwise null. Rewriting a slot recomputes it.
- Only `pending` is missed. A `partial` remainder is already re-owed and is
  not tagged (owner-approved call).
- Prescription emits `postponedFrom` (ISO date or null). Day plan shows
  "Postponed from Tue 10 Nov".
- `MissedTasks`, `missedTasks`, `missedWindow` and the extended range fetch
  are removed.

### Restart

- `POST /api/plans/:id/restart`: owner-only, sets `isActive = false`, returns
  204. Packages are user-owned and survive.
- Settings gains a "Start over" disclosure above Delete account. Opening it
  explains what happens; a second button confirms. No browser dialog.
- On success: remove `cfa-onboarding-draft` from localStorage, clear the query
  cache, push `/onboarding`.

### Plan-shaped log

- `POST /api/plans/:id/sessions` body: `readingId`, `kind` (one of
  `content-notes`, `content-video`, `eocq`, `questions`, `review`),
  `packageId?`, `minutes` (1 to 600), `confidence`, `questionsAnswered?`,
  `questionsCorrect?`, `date?`, `note?`, `taskId?`, `finished?`.
- With `taskId`: records that planned cell through `recordTask` (same as
  today's attach path).
- Without: creates a `PlanTask` with `status = "done"`,
  `insertedBecause = "off-plan"`, `frozen = true`, `readingIds = [readingId]`,
  `estimatedMinutes = actualMinutes = minutes`, `packageId`, `order` = 100 plus
  the count of the day's off-plan cells (planned slots stay below 100), then
  `recordTask` writes its outcome logs.
- Both paths then rebuild the horizon.
- Off-plan cells are excluded from pace calibration (their estimate is the
  candidate's own minutes, so the ratio is always 1).
- Prescription emits `offPlan: boolean`. Off-plan cells pick materials from
  their own `packageId` when set. They count toward done minutes but not the
  day's planned total.
- New column `PlanTask.packageId String?`.
- Composer fields: Section, Module, Type, Package, Minutes, then questions
  answered and correct (question types only), Confidence, Date, Note. When a
  pending planned cell that day has the same reading and kind, the form offers
  to record against it. `suggestedLosId` preselects section and module.

## Data flow

- missed cell -> freeze -> loadWorkDone owes it -> packer places it -> write step tags postponedFrom -> prescription -> day plan tag
- Start over -> POST restart -> plan inactive -> GET plans 404 -> onboarding
- Composer -> POST sessions -> off-plan PlanTask + logs -> generateHorizon -> day plan cell tagged Off plan

## Related

- [Day-end replan design](2026-11-14-day-end-replan-design.md): the freeze and rebuild this builds on.
- [Daily prescription design](2026-11-10-daily-prescription-design.md): the cell shape the log now mirrors.
