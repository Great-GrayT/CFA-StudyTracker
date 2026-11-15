---
title: Postponed cells, plan restart, and plan-shaped study logs plan
type: spec
module: root
updated: 2026-11-15
status: active
---

## Purpose

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Missed cells come back tagged Postponed, Settings can restart the plan, and Record study logs a plan-shaped cell.

**Architecture:** Two new `PlanTask` columns (`postponedFrom`, `packageId`). The horizon write step tags cells that carry missed work. A new sessions route turns a logged session into an off-plan `done` cell, so the engine credits it by kind. A restart route deactivates the plan.

**Tech Stack:** Next.js route handlers, Prisma on Postgres, vitest; Next.js client, TanStack Query, CSS modules.

**Spec:** [Postponed, restart, log study design](../specs/2026-11-15-postponed-restart-logstudy-design.md)

## Global constraints

- No em dashes or double dashes in user-facing copy.
- Off-plan marker string is exactly `"off-plan"` in `PlanTask.insertedBecause`.
- Off-plan cells use `order >= 100`; planned slots stay below 100.
- Log kinds accepted: `content-notes`, `content-video`, `eocq`, `questions`, `review`.
- Minutes 1 to 600.
- Onboarding draft key: `cfa-onboarding-draft`.

## Review focus

- Off-plan cell on a day the engine later rebuilds: must survive (status `done` is protected) and not collide on `(planId, date, order)`.
- Off-plan cell must not move pace calibration.
- A missed cell recorded late (status flips to done) must stop tagging future cells on the next rebuild.
- Restart by a user who does not own the plan: 403, plan untouched.
- Composer opened from an outcome page: section and module preselected from that outcome.

## Tasks

### Task 1: Schema columns

**Files:** Modify `apps/backend/prisma/schema.prisma` (`PlanTask`); create migration `20261115120000_postponed_offplan`.

- [ ] Add `postponedFrom DateTime?` and `packageId String?` to `PlanTask`, with why-comments.
- [ ] Write migration SQL: `ALTER TABLE "PlanTask" ADD COLUMN "postponedFrom" TIMESTAMP(3), ADD COLUMN "packageId" TEXT;`
- [ ] Run `npx prisma migrate deploy` against dev and test DBs, then `npx prisma generate`. Expected: applied.

### Task 2: Postponed tagging in the engine

**Files:** Modify `apps/backend/src/lib/FUNC-schedule.ts` (write transaction, calibration query). Test: `apps/backend/tests/schedule/postponed.test.ts`.

**Produces:** `PlanTask.postponedFrom` set on new or rewritten window cells.

- [ ] Test `a missed cell's reading comes back tagged with the day it was missed`: build horizon for day D with `setupPlanWithTasks`-style catalogue, leave D's cells pending, rebuild for D+1; assert some window cell with the same kind and overlapping reading has `postponedFrom = D`, and cells with no missed match have null.
- [ ] Test `a missed cell recorded late stops tagging`: same, then set the D cell `status: "done"`, rebuild; assert no window cell has `postponedFrom = D` for that reading and kind.
- [ ] Test `an off-plan cell does not count toward pace calibration`: create a done off-plan cell with estimate 30, actual 90; assert estimates are unchanged against a plan without it.
- [ ] Run: fail.
- [ ] Implement `missedOrigin(missed: Array<{date: Date; kind: string; readingIds: string[]}>, cell: {kind: string; readingIds: string[]}): Date | null` (earliest matching date). Load missed inside the transaction after freezing: `frozen: true, status: "pending", date < today`, excluding off-plan. Set `postponedFrom` on create, and on update when content changes or when the tag differs. Calibration query excludes `insertedBecause = "off-plan"` (null-safe `OR`).
- [ ] Run tests: pass. Commit.

### Task 3: Prescription emits the tags

**Files:** Modify `apps/backend/src/lib/FUNC-prescription.ts`, `apps/frontend/src/lib/types.ts` (`PrescribedTask`). Test: extend `postponed.test.ts`.

**Produces:** `PrescribedTask.postponedFrom: string | null` (ISO date), `PrescribedTask.offPlan: boolean`.

- [ ] Test: `getPrescription` returns `postponedFrom` as `YYYY-MM-DD`, and an off-plan cell returns `offPlan: true`, uses its own package for materials, and is excluded from `totalMinutes` but counted in `doneMinutes`.
- [ ] Implement. For off-plan cells with `packageId`, filter candidate units to that package instead of role packages.
- [ ] Run: pass. Commit.

### Task 4: Sessions route

**Files:** Create `apps/backend/src/app/api/plans/[id]/sessions/route.ts`; add `createSessionSchema` in `apps/backend/src/lib/validation.ts`. Test: `apps/backend/tests/api/sessions.test.ts`.

**Interfaces:** `POST /api/plans/:id/sessions` body `{ readingId, kind, packageId?, minutes, confidence, questionsAnswered?, questionsCorrect?, date?, note?, taskId?, finished? }` -> 201 `{ task: { id, status, kind, readingIds, actualMinutes, insertedBecause } }`.

- [ ] Tests: off-plan create (done, frozen, off-plan, order >= 100, estimated = actual = minutes, logs written per outcome with taskId); two sessions same day get distinct orders; `taskId` path records the planned cell (`partial` when `finished: false`); 403 for another user's plan; 400 for unknown kind, minutes 0, correct > answered, future date, reading not in plan's level; 400 when `taskId` cell's reading differs.
- [ ] Run: fail.
- [ ] Implement with `recordTask` (`FUNC-record.ts`) inside one transaction, `assertUsablePackage` for packageId, date rules copied from `api/logs/route.ts`, then `generateHorizon` with the plan's local date (log and swallow failure, as logs route does).
- [ ] Run: pass. Commit.

### Task 5: Restart route

**Files:** Create `apps/backend/src/app/api/plans/[id]/restart/route.ts`. Test: `apps/backend/tests/api/plan-restart.test.ts`.

- [ ] Tests: owner gets 204, plan `isActive` false, `GET /api/plans` then 404, tasks and logs still exist; other user 403; unauthenticated 401.
- [ ] Implement. Run: pass. Commit.

### Task 6: Frontend, postponed tag and Not done removal

**Files:** Modify `apps/frontend/src/components/day-plan.tsx` and its CSS module, `apps/frontend/src/app/today/page.tsx`, `apps/frontend/src/lib/day-end.ts` and its test; delete `missed-tasks.tsx` and its CSS module.

- [ ] Cell shows a tag "Postponed from Tue 10 Nov" (date formatted `weekday short, day, month short`, UTC) and "Off plan" for off-plan cells. Tag is text plus a style, not colour alone.
- [ ] Remove `MissedTasks`, `missedTasks`, `missedWindow` and the widened range fetch; Today fetches only the week again. Keep `msUntilDayEnd`.
- [ ] `npx tsc --noEmit` and frontend tests pass. Commit.

### Task 7: Frontend, Start over in Settings

**Files:** Create `apps/frontend/src/components/restart-plan.tsx` and CSS module; modify `apps/frontend/src/app/settings/page.tsx`.

- [ ] Collapsed disclosure "Start over" placed before Delete account. Open state lists what happens (new setup from step one, history kept but no longer shown, packages kept) and a confirm button "Start over now". No browser dialog.
- [ ] On confirm: `POST plans/:id/restart`, remove `cfa-onboarding-draft`, `queryClient.clear()`, `router.push("/onboarding")`. Error shown inline with `role="alert"`.
- [ ] Typecheck passes. Commit.

### Task 8: Frontend, plan-shaped Record study

**Files:** Rewrite `apps/frontend/src/components/composer.tsx` and CSS module; add `useCreateSession` in `apps/frontend/src/lib/hooks.ts`.

**Consumes:** Task 4 route.

- [ ] Fields in order: Section (topic select), Module (reading select, filtered by section), Type (radio group: Read notes, Watch video, End of chapter questions, Question bank, Review), Package (plan packages), Minutes, Questions answered and Correct (only for `eocq` and `questions`), Confidence, Date, Note.
- [ ] When the day's prescription has a pending cell with the chosen reading and kind, show "This is on your plan for that day" with an attach checkbox (default on) and Done/Partial; submit sends `taskId`, `finished`.
- [ ] `suggestedLosId` preselects section and module from that outcome. Keep Save and Save and log another. Keep Escape to close.
- [ ] Invalidate prescription, logs and progress queries on success. Typecheck and build pass. Commit.

### Task 9: Verify, review, push

- [ ] Backend full `npx vitest run`, frontend `npx tsc --noEmit` and tests, frontend `next build`.
- [ ] Commit spec and plan; push `main`.

## Related

- [Postponed, restart, log study design](../specs/2026-11-15-postponed-restart-logstudy-design.md): the decisions this plan executes.
