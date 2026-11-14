---
title: Day-end replan and the not-done list, implementation plan
type: spec
module: apps
updated: 2026-11-14
status: active
---

## Purpose

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** rebuild each plan once per local day from what was done, and show the last 7 days' unfinished tasks on Today with a Record action.

**Architecture:** a nullable `StudyPlan.horizonGeneratedFor` marks the local day the horizon was built for; `runSweep` regenerates any plan whose mark is not today before the coach runs. Today fetches the 7 days before today through the existing prescription hook, filters `pending`, and renders rows that reuse `DayPlan`'s record control.

**Tech stack:** Next.js 15 route handlers, Prisma/Postgres, Vitest; React 19 with TanStack Query and CSS modules.

**Spec:** [Day-end replan and the not-done list](../specs/2026-11-14-day-end-replan-design.md)

## Methods

### Global constraints

- Local dates are `YYYY-MM-DD` in the plan's `timeZone` (`localDateFor` in `core/slots.ts`).
- Window: the 7 days before today, today excluded. Only `status === "pending"`.
- No em-dashes in copy. Existing design tokens only.

### Review focus

1. A plan whose regeneration throws must not stop other plans' rebuild or any plan's coach run. Test in Task 1.
2. The sweep must not regenerate twice in one local day. Test in Task 1.
3. A day-off (holiday or zero-hour day) has no tasks and must not render an empty group. Test in Task 2 (`missedTasks` on days with no tasks).
4. Recording a row must remove it without a reload. Covered by the prescription query invalidation in `useSubmitTask`; verify by hand in Task 2.
5. Before 00:00 local the previous day must not count as missed. The window ends at yesterday; test in Task 2.

### Task 1: rebuild once per local day in the sweep

**Files:** modify `apps/backend/prisma/schema.prisma` (StudyPlan), new migration `day_end_replan`, `apps/backend/src/lib/FUNC-schedule.ts` (`generateHorizon` write transaction), `apps/backend/src/lib/FUNC-sweep.ts`; test `apps/backend/tests/api/day-end-replan.test.ts`.

**Produces:** `StudyPlan.horizonGeneratedFor String?`; `rebuildIfNewDay(plan, now): Promise<boolean>` exported from `FUNC-sweep.ts`.

- [ ] Failing tests:
  - `"the sweep rebuilds a plan whose horizon was built for an earlier day"`: set `horizonGeneratedFor` to yesterday, run `runSweep()`, expect it equal to today's local date.
  - `"the sweep does not rebuild twice in one local day"`: spy `scheduleModule.generateHorizon`, run `runSweep()` twice, expect one call per plan.
  - `"a plan that fails to rebuild does not stop the next plan or its coach"`: two plans, first spy throws; expect the second's mark updated and `runCoachForPlan` called for both.
- [ ] Run, expect fail.
- [ ] Add the column and migration; `generateHorizon` writes `horizonGeneratedFor: today` inside its transaction when not `dryRun`; `rebuildIfNewDay` compares to `localDateFor(now, plan.timeZone)`, calls `scheduleModule.generateHorizon` through a namespace import, and logs failures with the plan id. `runSweep` calls it before the snapshot.
- [ ] Run the backend suite, expect pass. Commit.

### Task 2: the not-done section on Today

**Files:** create `apps/frontend/src/lib/missed.ts` and `missed.test.ts`, `apps/frontend/src/components/missed-tasks.tsx` and `.module.css`; modify `apps/frontend/src/components/day-plan.tsx` (export `SubmitControl`), `apps/frontend/src/app/today/page.tsx`.

**Consumes:** `usePrescription(planId, from, to)`, `useSubmitTask(planId)`, `PrescribedDay`, `PrescribedTask`.

**Produces:** `missedTasks(days: PrescribedDay[], todayISO: string): { date: string; task: PrescribedTask }[]`, `missedWindow(todayISO: string): { from: string; to: string }`.

- [ ] Failing tests in `missed.test.ts`: the window is today-7 to today-1; only `pending` tasks; newest day first, task order kept within a day; today's tasks never included; days with no tasks contribute nothing.
- [ ] Run, expect fail. Implement. Run, expect pass.
- [ ] Design pass with frontend-design, then build `MissedTasks`: heading "Not done", a line with the count and minutes owed, muted rows (weekday, task title, minutes) each with the existing `SubmitControl`. Render nothing when the list is empty. Replace the "logged nothing" line on Today with it, above the week strip.
- [ ] Typecheck, frontend tests, impeccable audit. Commit, push, check on production.

## Related

- [Day-end replan and the not-done list](../specs/2026-11-14-day-end-replan-design.md): the design this plan implements.
