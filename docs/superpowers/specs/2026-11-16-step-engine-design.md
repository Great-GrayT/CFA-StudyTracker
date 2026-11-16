---
title: Five-step study engine, new catalogues, Pace page and coach ladder
type: spec
module: root
updated: 2026-11-16
status: active
---

## Purpose

Owner redesign of the planner, agreed in conversation on 2026-11-16. A
module (curriculum reading, 51 at Level II) is exam-ready only after five
steps. The engine decides the hours; the user only gives a weekly rhythm
and holidays. Kaplan and the Premium Pack join the catalogue. The Pace page,
Plan calendar, Today recording, Settings and coach follow the new model.

Goals: every module passes steps 1 to 4 and every topic passes mocks;
a plan that is honest about whether it leads to a pass; one visible picture
of plan, coverage, tracking and performance.

Non-goals: Level I and III step tuning (same engine, no new catalogue);
changing auth, push, email transport, or deployment.

Anti-goals: a plan that "fits" by assuming impossible speed; hidden cuts;
counting effort on a step that has not met its pass rule as done.

## Approaches

- **A, chosen.** New pure engine in `apps/backend/src/core/steps/` beside the
  old one; `generateHorizon` switches to it in one change; old core files
  (allocation, pairing, packing, ordering, review, sequence, effort parts)
  are deleted once tests pass. Step state is derived from logs each rebuild.
- B, rejected. Rework pairing and review packers in place. The old model has
  no per-module step state and a 14-day horizon; every rule would be bolted on.
- C, rejected. Persist step state in a table updated on every log. Undo,
  edit and self-state paths would each need to keep it right; deriving from
  logs avoids drift.

## The five steps

All steps 1 to 4 are per module. Modules keep curriculum order inside a
topic (sections: QM, Economics, FSA, ...; the narrative order matters).

### Step 1, initial reading
- Any mix of videos and reading by package priority. Time: video runtime,
  or words at reading rate. End-of-chapter videos count as reading.
- CFA LES reading time: a configurable total (default 200 h) split across
  topics by Meldrum core runtime share (lecture + EOCQ + review + update,
  seminars excluded), then across modules the same way; modules with no
  Meldrum unit get an even share of their topic. Used only when LES is the
  chosen source for the step.
- Kaplan has no reading content in its inventory; it is skipped for steps
  1 and 3 and the next package is used.

### Step 2, initial questions
- After step 1. Pass = cumulative accuracy >= 80% AND adequate.
- Adequate: question minutes + answer-review minutes >= 2 x the module's
  step 1 minutes.
- Question minutes: 3 min per question. Answer review: answer words at
  200 wpm where known (UWorld, Premium Pack), else 1/3 of answering time.
- Every question task carries its answer review. A question task recorded
  without answer review spawns a separate answer-review task.
- Top-up after a failed check, assuming the new questions are all correct:
  `n80 = ceil((0.8*A - C) / 0.2)`; adequacy shortfall `nAdq = ceil(shortMin
  / perQuestionMin)`; add `max(n80, nAdq)`; loop until pass.
- Exemption: once answered >= 2 x adequate count without 80%, schedule a
  step 3 review for the module, then a fresh round where prior attempts no
  longer count. Loop again under the same rules.
- Package: first in priority with questions left for the module; move to
  the next only when the bank is used up.

### Step 3, review reading
- After steps 1 and 2. Timing by the plan's review policy (kept:
  decay-triggered, after-coverage, weekly-interleave, fixed-date), always
  after step 2.
- Time at most 1/2 of the module's step 1 time. Text at 1/2 the step 1 rate.
- Sources by priority: Meldrum notes (+ Meldrum review video), Kaplan, LES.

### Step 4, review questions
- After step 3. Same rules as step 2 with adequate = 2 x step 2 adequate,
  exemption at 2 x that. Separate rounds and counts from step 2.

### Step 5, mocks
- 30 days before the exam steps 1 and 2 are complete for every module.
- A mock session is eligible when steps 1 to 3 are done for every module of
  every topic that session covers. Steps 4 and 5 can run together.
- Minimum schedule: 1 mock in exam-week -4, 2 in -3, 3 in -2, 4 in -1
  (10 full mocks, 20 sessions). A mock is 2 sessions of 132 min plus answer
  review (default 0.5 x session time).
- Scoring: correct answers per topic per session. Any topic under 75% sends
  each of its modules back through step 3 and a new step 4 round.
- Mock supply: Premium Pack 2026 then 2025 (10 mocks, topic map per
  vignette), then LES, then Kaplan checkpoints. Premium 2026 Mock 4 session
  2 has no answers file: flagged, answer review time still planned.

## Package priority

Per step, editable in Settings (only packages on the plan take part).
Defaults:

| Step | Order |
|---|---|
| 1 read | Meldrum (lecture, EOCQ, seminars, in order) > Kaplan > CFA LES |
| 2 questions | UWorld > Kaplan > Premium Pack > CFA LES EOC |
| 3 review | Meldrum notes > Kaplan > CFA LES |
| 4 review questions | Premium Pack > Kaplan > UWorld > CFA LES |
| 5 mocks | Premium Pack > CFA LES > Kaplan |

If one package is adequate, no other is used. The Premium Pack is labelled
"Premium Pack", not CFA Institute (its pages are third-party).

## Hours and the fit ladder

- No user-entered study total. Engine sums remaining step work and spreads
  it evenly so steps 1 and 2 finish by exam - 30 days and steps 3 and 4 by
  the exam, mocks in the last 30 days. No buffer: plan exactly what is
  needed; missed work is re-spread at the next rebuild.
- Weekly hours per weekday are hard caps. Holidays are removed from capacity.
- If work exceeds capacity:
  1. Crash pace in steps up to a ceiling: reading and video 1.5x faster,
     25% fewer minutes per question.
  2. Cancel holidays one at a time, closest to the exam first.
  3. Report infeasible: the plan does not lead to a pass. Offer to continue
     with the best plan. On consent (`belowPassAccepted`), keep steps 1 and 2
     whole and trim in order: step 4 extras, step 4 base (lowest exam weight
     first), mock count (earliest week first). Step 3 is kept. Cuts are shown.

## Self-states and recording

- Self-states per module per step; replan after each.
  - Step 1 done + confidence >= 3: step 1 done. Confidence <= 2: step 1 is
    replaced by a step-3-style task (half time). Step 3 and step 2 still
    happen after it.
  - Step 2 with answered/correct: if it meets 80% and adequate, step 2 and
    its answer review are done; else the counts become round attempts and
    top-ups follow.
  - Step 3 cannot be stated before step 1; step 4 not before step 2 (pairs
    can be stated together).
- Every Today task has Record (done today) and Did this before (self-state).
  When the package's question count for the task is known, only the correct
  count is asked. Answer review done yes/no plus minutes.

## Coach ladder

| Stage | Messages per day | Timing |
|---|---|---|
| On plan, steps 1-2 | 3 | anchors: morning, evening, night |
| On plan, steps 3-4 | 3 | anchors |
| Mock window | 4 | anchors + midday |
| Behind plan | 3 + days behind | extras at random times |
| Below-pass plan | up to 12 | mostly random |

Random times sit inside the morning-to-night window, at least 45 minutes
apart; anchors always go out. Tone hardens up the ladder and names overdue
tasks. The overall stage is the earliest step most modules are in. Replaces
the old fixed 3-per-day cap.

## Pace page (Progress, Pace tab)

Compact bento, every tile with a maximise view. Mockup:
`.superpowers/brainstorm/*/content/pace-overview-v4.html` (local only).

- Verdict strip: exam-weighted readiness vs plan today, hours behind, mocks
  done / 10, extra tasks and hours, weakest section. Each links to its page.
- The plan (tall tile): zoom To exam / This month / This week. One row per
  section, expandable to modules. Each step is a coloured horizontal bar
  from start to deadline, ending in a circle (filled done, ring planned,
  dashed red overdue). Today line, 30-day mock gate, hatched holidays.
  Colours: step 1 teal, 2 blue, 3 violet, 4 magenta.
- Coverage: all 10 sections, four step bars each = share of that step's
  planned hours done AND passed; hatched = hours spent on a step not yet
  passed; tick = plan today; exam weight column. Expanded: 51 modules with
  done/due dates per step, sort curriculum / most behind / only behind,
  scrolls inside the panel.
- Readiness = sum over sections of exam-weight midpoint x section step
  completion, steps weighted by their share of planned hours.
- Tracking: zoom To exam (months + cumulative planned vs done lines),
  This month (weeks), This week (days, holidays grey), Today (tasks planned
  vs actual minutes). Owed hours dashed red.
- Performance: per section initial Q, review Q, mocks against their bars
  (80%, 75%) and Extras (tasks, hours). Expanded: per module answered,
  correct, accuracy, adequacy, extras with the reason (80% top-up,
  adequacy top-up, package switch, exemption reset, mock fail).
- Phone (<760 px): one column; maximise opens a full-screen sheet.
- Every text naming a thing links to its route.

Plan, Calendar tab: month heat calendar (shade = planned hours, red outline =
missed), click day for tasks.

## Data changes

- `PackageResource`: loader writes `durationSeconds`; new kinds `mock_session`,
  `quiz`, `checkpoint`; new `topicMix Json?` (topic -> question count) for
  mock sessions; `questionCount` optional for quiz.
- New packages: `kaplan-l2` (Schweser Qbank: question/answer sets per
  reading, Ethics files grouped per Standard; topic quizzes; checkpoints) and
  `premium-l2` (practice questions per reading, 20 mock sessions). New
  catalogue package `cfa-les` with synthetic reading time per reading.
- `StudyPlan`: `stepPriority Json`, `lesReadingHours Int @default(200)`,
  `belowPassAccepted Boolean`, `cancelledHolidayIds String[]`, fit report.
- `PlanTask`: `step Int?`, `round Int?`, `extraReason String?`,
  `mockRef String?`, `questionCount Int?`; kinds `read`, `questions`,
  `answer-review`, `review`, `mock`, `mock-review`.
- `MockExam`: per-topic results (`MockTopicScore` rows: topicId, answered,
  correct) and `sessionRef`.
- Self-state: `StepDeclaration` rows (planId, readingId, step, confidence,
  answered, correct).
- `planMode` loses `effort-return`; tuning reduces to reading wpm, video
  speed, minutes per question, LES hours, review policy.

## Builder decisions (my calls, marked)

- Answer review default when not recorded: assumed done when task Recorded
  as finished with answer-review ticked; untick spawns the task.
- LES end-of-chapter question supply is unknown: treated as unlimited, sized
  in minutes; user enters answered and correct when recording.
- Kaplan module quizzes (no counts) are not planned.
- Mock tasks are full-mock days on the user's longest available day of the
  week where possible.

## Builder answers (settled after review)

1. **Migration.** No reset. Existing logs stay and map to steps by kind:
   notes, video, seminar, eocq-video credit step 1; question logs count as
   step 2 attempts until step 2 passes, then as step 4 attempts once step 3
   is done; review logs credit step 3. Declared prior work maps the same
   way. Done tasks stay frozen (`step` null allowed); future unprotected
   tasks are replaced by the first rebuild. Restart keeps working.
2. **Horizon.** The whole schedule to the exam is computed in memory each
   rebuild (pure). Only the next 14 days persist as PlanTask, as today.
   `GET plans/:id/projection` returns the whole schedule, cached per
   `horizonGeneratedFor`. Planned-to-date for past days = frozen PlanTask
   minutes, so planned-vs-done lines need no extra history.
3. **Source data.** The inventories exist in the repo root (gitignored) and
   are parsed by new extractors. LES reading time is synthetic: the Meldrum
   share rule above, no word counts.
4. **Modules.** The unit is the curriculum reading (51). Kaplan R41.x files
   group into one unit per Standard (several resources). Kaplan R1 and the
   Ethics guidance files fan out by reviewed crosswalk; R1's 144 questions
   split across readings 1 to 4 by Meldrum runtime share.
5. **Accuracy and adequacy.** Accuracy is cumulative across packages within
   a round. Adequacy is measured in minutes (each package's own
   minutes per question and answer review), so mixing packages is fair.
   Exemption threshold = 2 x adequate minutes.
6. **Crash.** Adequacy baselines use uncrashed step 1 minutes; crashing only
   shortens scheduled estimates.
7. **Low-confidence step 1.** Replacement task is 1/2 step 1 time; step 3
   later is still its full 1/2. Self-stated done steps count as hours done
   in coverage.
8. **Mock failure.** Triggers a rebuild; the fit ladder runs as usual and
   may end in the below-pass offer.
9. **Coach.** Stage = earliest step not yet passed by at least 90% of
   modules; inside 30 days it is the mock window. Days behind = ceil(hours
   behind / average planned hours per study day). Below-pass tone only when
   `belowPassAccepted`; an infeasible plan without consent sends a "plan
   does not fit, change setup" message daily. Slot selection is rewritten;
   transport and idempotency stay.
10. **Delivery.** Phased commits (catalogue, engine, API, front end, coach),
    pushed to main when all tests pass. UI follows the front-end workflow
    with an /impeccable audit. Mockups are in `docs/design/mockups/`
    (`pace-overview.html` is the agreed layout).

## Related

- [Postponed, restart and log study spec](2026-11-15-postponed-restart-logstudy-design.md): missed-work tagging kept.
- [Planner modes spec](2026-11-12-planner-modes-design.md): superseded by this spec for packing.
- [Email coach spec](2026-11-11-email-coach-design.md): cap of 3 per day superseded.
- [Seeding guide](../../SEEDING.md): pipeline the new extractors join.
