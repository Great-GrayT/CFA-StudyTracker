---
title: Day-end replan and the not-done list
type: spec
module: apps
updated: 2026-11-14
status: active
---

## Purpose

When a study day ends, the plan should be rebuilt from what the candidate
actually did, and the tasks they did not do should be in front of them, plainly,
with a way to record ones they forgot to log.

Today the rebuild only runs when the candidate records something, changes a
setting, or the morning coach run follows a missed day. A candidate who never
opens the app keeps a list that assumes yesterday went to plan. Past tasks can
be recorded through the week strip, but nothing shows what was skipped.

## Approaches

- **Sweep rebuilds at the end of the day (chosen).** The 15-minute sweep
  regenerates each plan once per day, at the debrief. The morning email then reads a
  current plan, and no screen has to remember to trigger it.
- Rebuild when the app opens. Rejected: the morning email and push would
  describe a stale plan for anyone who reads them before opening the app.
- Both. Rejected: the sweep alone covers the app-open case within 15 minutes,
  and recording a task already rebuilds immediately.

## Design

- **The day ends at the debrief** (the plan's own debrief time, default
  22:30, in its time zone). The sweep that reaches it does three things, in
  order: checks the day (snapshot, done against not done), sends the debrief,
  replans from tomorrow. The Today countdown counts to that same moment.
- **Rebuild.** `StudyPlan.horizonGeneratedFor` (local `YYYY-MM-DD`, nullable)
  records the day the horizon was last built from. `planningDate` is today
  before the debrief and tomorrow from it on. The sweep rebuilds a plan whose
  mark is behind `planningDate`, after the coach. `generateHorizon` never
  plans earlier than the mark, so a later rebuild that night cannot put work
  back on the closed day. A failure is logged and left for the next sweep.
- **Not-done list.** Reuses `GET /api/plans/:id/tasks?from&to` over the 7
  days before today (today included once the day has closed), keeping tasks with status `pending`, newest day first.
  Each already carries its materials, so the existing record panel can submit
  it. Older misses drop off: their work is already back in the plan.
- **Today.** A "Not done" section above the week strip, shown only when the
  list is non-empty: a heading with the count and the minutes owed, then one
  muted row per task (day, task, minutes) with a Record action. Record opens
  the same panel `DayPlan` uses (done or partway, minutes, confidence,
  questions). Submitting posts the existing task record route, which logs the
  study and regenerates the plan; the row then leaves the list.
- The "You planned to study on ... and logged nothing" line is replaced by
  this section.

## Non-goals

- Changing how the engine reschedules undone work. It already derives coverage
  from done and partial tasks and logs, so skipped work returns on rebuild.
- A "won't do" or dismiss action.
- Partial tasks in the list: something was done, and the engine credits it.

## Calls left to the builder

- Copy and exact styling within the current design tokens.
- Whether the record panel is extracted from `DayPlan` or reused through it.

## Related

- [Email coach design](2026-11-11-email-coach-design.md): the morning slot that must read the rebuilt plan.
