---
title: Step engine phase 4, coach ladder
type: spec
module: apps/backend/src/core
updated: 2026-11-16
status: active
---

# Step engine phase 4: coach ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The coach knows which step the candidate is in, how far behind they are and whether the plan is below pass, and sends more, firmer, randomly timed messages as things get worse.

**Architecture:** Pure `core/coach-ladder.ts` decides the day's slot list (anchors + extras at seeded random times); `core/coach-state.ts` gains stage, daysBehind and fit facts; `core/coach-dialogue.ts` routes new slots and stages to new line pools. `lib/FUNC-coach.ts` reads the engine projection facts and sends through the existing idempotent channels.

**Tech Stack:** TypeScript, Vitest.

**Spec:** docs/superpowers/specs/2026-11-16-step-engine-design.md ("Coach ladder", Builder answer 9).

## Global Constraints

- Ladder: on plan steps 1-2 = 3 (anchors); on plan steps 3-4 = 3; mock window (<= 30 days) = 4 (anchors + midday at the midpoint of morning and evening anchors); behind = 3 + daysBehind (extras random); below-pass accepted = 12. Cap 12 per day.
- Random extras sit strictly between the morning anchor and the night anchor, >= 45 minutes from every other send, deterministic per (planId, localDate) so a retry never reshuffles. If the window cannot fit them at 45 minute spacing, drop the overflow.
- Stage = earliest step not yet passed by >= 90% of modules (from step state); "mock-window" when daysToExam <= 30. daysBehind = ceil(hoursBehind / average planned hours per study day), 0 when ahead.
- Infeasible and not consented: one daily "plan does not fit" message (debrief slot) with the two actions.
- Extras name the overdue tasks (kind, module, package) and the extra-task reason when present.
- Slots stored in `EmailSend.slot` as `prescription | nudge | debrief | midday | extra-1..extra-9`; idempotency unchanged.
- Line pools: every new key has at least 3 untagged lines; copy is sentence case, no em dashes; tone firmer up the ladder.

## Review Focus

- A day with 0 available minutes or a holiday: extras do not fire (rest day), anchors behave as today.
- Changing `coachSchedule` mid-day: extras recompute only for future times; already-sent slots are not re-sent.
- Below-pass at 12/day with a short window (morning 09:00, night 21:00): 12 x 45 min spacing does not fit; drop overflow, never send two inside 45 minutes.
- Post-exam: no extras.
- Push channel urgency stays high; email `debrief-only` users get only the debrief.

---

### Task 1: Ladder and stage

**Files:** Create `src/core/coach-ladder.ts` + test; modify `src/core/coach-state.ts` (+test), `src/core/slots.ts` (`Slot` union widened; `dueSlots` takes the day's slot list).

**Interfaces:**
```ts
type CoachStage = "steps-1-2" | "steps-3-4" | "mock-window";
function coachStage(moduleSteps: Array<{ s1: boolean; s2: boolean; s3: boolean; s4: boolean }>, daysToExam: number): CoachStage;
function messagesFor(i: { stage: CoachStage; daysBehind: number; belowPass: boolean; restDay: boolean; pastExam: boolean }): number;
function daySlots(i: { planId: string; localDate: string; schedule: CoachSchedule; count: number }): Array<{ slot: string; hour: number; minute: number }>;
```
- [ ] Tests: each ladder row; cap 12; 45 minute spacing; determinism; overflow dropped; rest day -> anchors only. Commit `feat(coach): message ladder and stage`.

### Task 2: Dialogue and send

**Files:** `src/core/coach-dialogue.ts`, `src/core/lines/types.ts`, new `src/core/lines/ladder.ts`, `src/core/coach-lines.ts`, `src/lib/FUNC-coach.ts`, `src/app/api/coach/preview/route.ts`, tests in `src/core/coach-dialogue.test.ts`, `tests/coach/*.test.ts`.

- New keys: `M_MIDDAY_MOCK`, `X_BEHIND_1` (1-2 days), `X_BEHIND_3` (3-6), `X_BEHIND_7` (7+), `X_BELOW_PASS`, `D_PLAN_DOES_NOT_FIT`, `P_STAGE_REVIEW` (prescription in steps 3-4), `P_STAGE_MOCK` (mock window). New vars: `{stage}`, `{daysBehind}`, `{overdueList}`, `{readiness}`, `{readinessPlan}`, `{extraReason}`.
- `buildCoachContext` reads `plan.fitReport`, projection metrics (readiness, hours behind) via `generateHorizon(..., {dryRun:true})` result cached per day, and step state for stage.
- [ ] Tests: routing per new slot and stage; preview shows extras; send test for 5 days behind sends 8 on a normal day across slots at the seeded times. Commit `feat(coach): stage-aware ladder messages`.
