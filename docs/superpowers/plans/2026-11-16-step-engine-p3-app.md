---
title: Step engine phase 3, API and front end
type: spec
module: root
updated: 2026-11-16
status: active
---

# Step engine phase 3: API and front end Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the step engine through the API and rebuild the screens that show and feed it: Pace bento, Plan calendar heat view, Today record and self-state, per-step package priority, fit warning with consent, per-topic mock entry, onboarding starting point.

**Architecture:** Backend adds a projection endpoint (dry-run of the engine, cached per `horizonGeneratedFor`), step declarations, per-topic mock scores and plan settings. Front end (Next 15, React Query, Tailwind v4, shadcn primitives, tokens in `app/tokens.css`) replaces the client-side outcome pace model with server data.

**Tech Stack:** Next.js 15, React 19, React Query, Tailwind v4, shadcn/radix, recharts or hand SVG (existing `pace-chart.tsx` is hand SVG), Vitest.

**Spec:** docs/superpowers/specs/2026-11-16-step-engine-design.md ("Pace page", "Self-states and recording", "Package priority", "Hours and the fit ladder"). Agreed layout: docs/design/mockups/pace-overview.html, coverage-expanded.html, performance-expanded.html, tracking-zooms.html, calendar-heat-option-e.html.

## Global Constraints

- Front-end work follows the front-end workflow: design check against the mockup, then build, then `/impeccable` audit of each section; fix findings before commit.
- Step colours (tokens): step 1 teal `#0f7fa8`, 2 blue `#2f5fe0`, 3 violet `#8a3fd1`, 4 magenta `#c2306f`, mock gate amber `#9a6408`; define as `--step-1..4`, `--gate` in tokens.css with dark-mode values checked for 3:1 contrast against the surface.
- Zoom labels exactly: "To exam", "This month", "This week", "Today" (Today only on Tracking).
- Phone layout below 760 px: one column; maximise opens a full-screen sheet; touch targets >= 44 px.
- Every text naming a section, module, mock or task links to its route (section -> `/syllabus/[topicId]`, module -> `/syllabus/[topicId]?reading=<id>`, mocks -> `/progress?tab=mocks`, task/extra -> `/today?task=<id>` opening the record sheet, hours behind -> `/plan?tab=calendar`).
- Copy: sentence case, plain verbs, no em dashes. Package names as in phase 1 (Premium Pack never "CFA Institute").
- Proxy allowlist (`apps/frontend/src/app/api/proxy/allowlist.ts`) must include every new backend path.
- Every data region keeps loading, empty, error and offline states (existing `components/states/region-states.tsx`).

## Review Focus

- A plan whose fit report is infeasible and not yet consented: Today and Pace show the warning with the two actions (change setup, continue with best plan); consenting sets `belowPassAccepted` and the warning becomes a persistent below-pass badge.
- A task with a known question count: record asks only for correct (answered prefilled, editable); correct > answered rejected client and server side.
- Self-state step 3 before step 1 (or 4 before 2) rejected with a clear message unless the pair is submitted together.
- Pace page with zero history (new plan): every tile renders its empty state, readiness 0%, no NaN.
- Mock entry for a session with an unknown topic map (LES, Kaplan checkpoint): user picks topics and counts; totals must equal answered.

---

### Task 1: API for the engine

**Files:**
- Create: `apps/backend/src/app/api/plans/[id]/projection/route.ts`, `apps/backend/src/app/api/plans/[id]/declarations/route.ts`, `apps/backend/src/lib/FUNC-projection.ts`
- Modify: `apps/backend/src/app/api/plans/[id]/route.ts` (PATCH accepts `stepPriority`, `lesReadingHours` 50..400, `belowPassAccepted`), `apps/backend/src/app/api/plans/[id]/tasks/[taskId]/route.ts` + `lib/FUNC-record.ts` + `lib/validation.ts` (`submitTaskSchema` adds `answerReviewDone: boolean`, `answerReviewMinutes?: number`; `questionsCorrect <= questionsAnswered`), `apps/backend/src/app/api/mock-exams/route.ts` (accepts `sessionRef?`, `topicScores: Array<{topicId, answered, correct}>` with sum check), `GET apps/backend/src/app/api/packages/route.ts` returns mock sessions with `topicMix` for the plan's packages, prior-work route maps old declarations into `StepDeclaration` rows (step 1 from notes/videos, step 2 from questions).
- Tests: `apps/backend/tests/api/projection.test.ts`, `declarations.test.ts`, extend `task-complete.test.ts`, `mock-exams.test.ts`, `plans.test.ts`.

**Interfaces (produces, JSON):**
```ts
type Projection = { asOf: string; exam: string; gate: string;
  fit: FitReport;                                     // from core/steps
  sections: Array<{ topicId: string; name: string; examWeight: number;
     steps: Array<{ step: 1|2|3|4; plannedMin: number; donePassedMin: number; spentUnpassedMin: number; planTodayMin: number }>;
     modules: Array<{ readingId: string; name: string; windows: ModuleWindow["steps"] }>;
     performance: { initial: { answered: number; correct: number } | null; review: { answered: number; correct: number } | null;
                    mocks: { answered: number; correct: number } | null; extras: { tasks: number; minutes: number } } }>;
  readiness: number; readinessPlanToday: number;
  daily: Array<{ date: string; plannedMin: number; doneMin: number; byStep: Record<"1"|"2"|"3"|"4"|"5", number> }>;
  holidays: Array<{ id: string; start: string; end: string; cancelled: boolean }>;
  mocks: { done: number; planned: number; firstDate: string | null };
  extras: Array<{ taskId: string | null; readingId: string; step: number; reason: string; questions: number | null; minutes: number; date: string | null }> };
```
`GET plans/:id/projection` owner-only, 404 otherwise. Past `plannedMin` = frozen task estimates on that date; `doneMin` = credited minutes.
`POST plans/:id/declarations` body `{ items: Array<{ readingId, step: 1|2|3|4, confidence?: 1..5, answered?, correct? }> }`, rejects step 3 without step 1 (existing or same request) and 4 without 2, then rebuilds.

- [ ] Step 1: failing tests: projection shape on a seeded plan (readiness 0 for fresh plan, 14 days planned, sections = topics); declarations ordering rule (400 with message "Review needs the first read first" / "Review questions need the initial questions first"); record with answerReviewDone false creates an `answer-review-owed` extra after rebuild; mock topicScores sum mismatch 400; PATCH stepPriority rejects unknown slugs.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: backend suite + tsc PASS. Step 5: commit `feat(api): projection, step declarations, per-topic mocks`.

### Task 2: Front-end data layer

**Files:** `apps/frontend/src/lib/types.ts`, `lib/hooks.ts` (`useProjection(planId)`, `useDeclare`, `useMockSessions`), `lib/api.ts`, `app/api/proxy/allowlist.ts` (+test), `lib/plan-invalidation.ts` (projection invalidated by every record, declaration, settings change), remove `lib/pace.ts` outcome model use from Today and Progress (keep file only if other importers remain).

- [ ] Tests: allowlist accepts the new paths; invalidation map includes projection. Commit `feat(web): projection data layer`.

### Task 3: Pace page bento

**Files:** Create `apps/frontend/src/components/pace/{verdict-strip,plan-tile,coverage-tile,tracking-tile,performance-tile,tile,expand-sheet}.tsx`, `lib/pace-view.ts` (+test: zoom windows, axis ticks, readiness formatting, per-step bar fractions, empty data); replace `components/progress/pace-tab.tsx`, delete `pace-chart.tsx` and `today/pace-spark.tsx` uses that depend on the old model.

Layout per `docs/design/mockups/pace-overview.html`: verdict strip; grid `minmax(0,1.15fr) minmax(0,1fr)`; plan tile spans two rows left; coverage and tracking right; performance full width below. Plan tile zoom To exam / This month / This week, sections expandable to modules, step bars + deadline circles, today line, gate line, hatched holidays, legend. Coverage four bars per section (hatched unpassed), tick plan today, weight column; expanded = coverage-expanded mockup with sort chips. Tracking zooms per tracking-zooms mockup. Performance with Extras column; expanded = performance-expanded mockup.

- [ ] Run front-end workflow; tests for `pace-view.ts`; `/impeccable` audit; commit `feat(web): Pace page bento on the step engine`.

### Task 4: Today, record and self-state; fit warning

**Files:** `components/today/todays-work.tsx`, `components/record/record-sheet.tsx`, `lib/record.ts`, new `components/record/declare-sheet.tsx`, new `components/plan/fit-banner.tsx`.

- Each task row: "Record" and "Did this before". Record for question tasks: answered prefilled from `questionCount` (editable), correct, "Reviewed the answers" checkbox + minutes. Did this before writes a declaration for that module and step.
- Fit banner on Today and Pace when `fit.feasible === false`: text "Your setup cannot fit a passing plan before the exam." actions "Change setup" (-> `/plan?tab=setup`) and "Continue with the best plan" (PATCH belowPassAccepted). After consent: badge "Below-pass plan" linking to Pace. Show crash and cancelled holidays when present ("Planned at 1.3x pace", "Cancelled holiday 24 Dec to 1 Jan").
- [ ] Tests (`lib/record.test.ts`): prefill, validation; commit `feat(web): record, did-this-before and fit warning`.

### Task 5: Plan calendar, setup and settings

**Files:** `components/plan/calendar-tab.tsx` (month heat calendar per option E mockup: shade = planned hours, red outline missed, click day -> its tasks with links), `components/plan/packages-editor.tsx` -> per-step priority lists (drag or up/down buttons, keyboard accessible) saved as `stepPriority`, LES hours input, `components/planner-settings.tsx` stripped to plan order (topic, strict) and review policy, `components/plan/prior-work-form.tsx` + onboarding "Starting point" step -> per module per step declarations with the ordering rule, `components/progress/add-mock-dialog.tsx` -> session picker + per-topic correct counts prefilled from `topicMix`.

- [ ] Tests for any new lib helpers; front-end workflow + `/impeccable`; commit `feat(web): calendar heat view, step priority, starting point, mock topics`.

### Task 6: Whole-app check

- [ ] `pnpm -r typecheck`, backend and frontend `vitest run`, `next build` for both apps PASS. Run the app (backend + frontend dev) and click through Today, Plan, Progress Pace, Settings on desktop and 390 px width. Commit fixes.
