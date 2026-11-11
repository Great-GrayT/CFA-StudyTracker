---
title: Email study coach design
type: spec
module: apps/backend
updated: 2026-11-11
status: draft
---

## Purpose

Turn the planner into a coach that reaches the candidate rather than waiting to
be opened. Three scheduled emails a day, each one knowing exactly where the
candidate stands:

- **Morning, the prescription.** Today's tasks, named, with minutes.
- **Evening, the nudge.** Sent only if nothing is logged yet, before the day is
  closed and counted against them.
- **Night, the debrief.** What they actually did, what it cost them, and what
  tomorrow now looks like.

When days are missed the plan is revised and the candidate is told plainly, in
language that escalates with the streak. A planner that silently absorbs a
missed week is a planner that lets someone fail politely.

## What this reverses

The v1 spec's non-goal is explicit: "No email or SMS reminders. Push is
phone-notification only (Web Push, since there's no native app), and only for
missed-day alerts, not a general notification system."

`src/lib/FUNC-mail.ts` carries the same rule in its own header: "The product
spec rules out email reminders, and this does not reintroduce them: it is auth
infrastructure, not a notification channel. Nothing else in the codebase sends
mail, and nothing should without that decision being revisited."

The candidate has now revisited it and asked for exactly this. Recorded here so
the reversal is deliberate rather than discovered, and the comment in
`FUNC-mail.ts` must be updated in the same change rather than left to
contradict the code.

## Goals

- A candidate who reads only their email still knows what to study today.
- A missed day produces a revised plan, not a silently growing backlog.
- The debrief is honest about cost: what moved, what got dropped, what the
  finish date now is.
- Escalating pressure that a person actually feels, with a floor it never goes
  below.
- One email per slot per day, ever, however many times the cron runs.

## Non-goals

- No SMS, no push in this design. Push already exists for missed-day alerts and
  is not replaced.
- No marketing, no streak badges, no gamified points. The pressure comes from
  the real plan and the real exam date.
- No reply parsing. These emails are outbound; logging happens in the app.
- No per-task emails. Three a day is the ceiling, and the evening nudge is
  conditional, so a candidate who logs on time gets two.

## Anti-goals

- Never shame in a way that makes quitting easier than continuing. See the
  escalation ceiling.
- Never send a plan the engine has not actually regenerated. A coach that
  emails a stale list is worse than silence.
- Never guess at the candidate's day boundary. See the timezone prerequisite.
- Never let a send failure corrupt plan state, or a plan regeneration be rolled
  back by a mail error.

## The timezone prerequisite, which blocks everything else

There is no timezone anywhere in the schema, and every date in this system is a
UTC plan-date (`startOfUTCDay`, `toISODate`). That is correct for a plan, and
fatal for this feature: "end of each day" has no meaning without the
candidate's own midnight. A night debrief sent at 23:00 UTC reaches a candidate
in Los Angeles at 15:00, mid-afternoon, declaring their day over.

So `StudyPlan` gains `timeZone`, an IANA name (`Europe/London`), captured at
setup and defaulted from the browser. Three local send times are then derived
per candidate, not per server:

| Slot | Local time | Condition |
|---|---|---|
| Prescription | 06:30 | always, on a study day |
| Nudge | 20:00 | only if nothing is logged today |
| Debrief | 22:30 | always, on a study day |

The cron already ticks; it gains a per-plan check of whether that plan's local
clock has passed each slot's time without that slot having been sent.

Plan dates stay UTC throughout. The timezone decides only WHEN a mail is sent
and which local date it describes, never how the pace engine computes.

## The decision tree

Three independent inputs decide which email a slot sends, and which dialogue
tier it uses.

**Input A, the streak state.** Consecutive missed study days immediately before
today, counting only days the plan actually scheduled work on and excluding
holidays, which the existing `missedStudyDays` already computes correctly.

```
0        on track
1        one slip
2 to 3   drifting
4 to 6   serious
7+       crisis
```

**Input B, today's shape.** Whether today is a study day at all, and what is on
it.

```
rest        no availability, or a holiday
light       under 45 scheduled minutes
normal      a usual day
heavy       over 150 minutes, or carrying a mock
catch-up    today's list contains requeued work from a missed day
```

**Input C, the logging state**, which only the nudge and debrief consult.

```
nothing     no log entry today
partial     some tasks done, some pending
complete    every task done
over        every task done and more logged beyond the plan
```

### The tree

```
PRESCRIPTION (morning)
├─ B = rest
│   └─ REST_DAY                      (no tasks, says so, no guilt)
├─ A = 0
│   ├─ B = light   → DAY_LIGHT
│   ├─ B = normal  → DAY_NORMAL
│   └─ B = heavy   → DAY_HEAVY       (warns the size up front)
└─ A ≥ 1
    ├─ plan regenerated first, ALWAYS
    ├─ A = 1          → SLIP_1       (factual, one line of pressure)
    ├─ A = 2 to 3     → DRIFT        (names the cost in days)
    ├─ A = 4 to 6     → SERIOUS      (names the finish date moving)
    └─ A ≥ 7          → CRISIS       (names the arithmetic, offers the fork)

NUDGE (evening, only when C = nothing)
├─ B = rest → not sent
├─ A = 0    → NUDGE_FIRST            (gentle, it is a reminder)
└─ A ≥ 1    → NUDGE_STREAK           (states what a second miss costs)

DEBRIEF (night)
├─ B = rest       → not sent
├─ C = nothing    → DAY_LOST         (the day is closed and counted)
├─ C = partial    → DAY_PARTIAL      (credits what was done, names the rest)
├─ C = complete   → DAY_DONE         (short, earned, no padding)
└─ C = over       → DAY_OVER         (credits it, warns about pace realism)
```

Every prescription with `A >= 1` regenerates the plan BEFORE composing, because
the whole point of the email is that the list is current. A regeneration failure
means no email is sent, and the failure is logged. An email with a stale plan
would be worse than no email.

## The dialogue dictionary

Each state maps to a dialogue entry: a subject, an opening line, a pressure
line, and a closing action. Written once, here, so the voice is consistent and
reviewable rather than improvised per template.

The variables available to every line: `{name}`, `{daysToExam}`, `{streak}`,
`{todayMinutes}`, `{taskCount}`, `{coveragePercent}`, `{finishDate}`,
`{droppedCount}`, `{firstTask}`.

### Prescription dialogues

| Key | Subject | Opening | Pressure | Close |
|---|---|---|---|---|
| `REST_DAY` | Rest day | No tasks today. | none | Back tomorrow with {taskCount} tasks. |
| `DAY_LIGHT` | Today: {todayMinutes} min | A short one today. | {daysToExam} days to the exam. | Start with {firstTask}. |
| `DAY_NORMAL` | Today: {taskCount} tasks, {todayMinutes} min | Here is today. | {daysToExam} days left, {coveragePercent}% covered. | Start with {firstTask}. |
| `DAY_HEAVY` | Today is a big one: {todayMinutes} min | Today is heavier than usual. | Splitting it across the evening is fine. Skipping it is not. | Start with {firstTask}. |
| `SLIP_1` | You missed yesterday. Today: {todayMinutes} min | Yesterday is gone and the work is not. | Yesterday's tasks are in today's list. That makes today heavier. | Start with {firstTask}. |
| `DRIFT` | {streak} days missed. The plan has moved. | Three days of silence. The plan has absorbed what it can. | You are {streak} days behind and the backlog is now in today's list. | Start with {firstTask}. |
| `SERIOUS` | {streak} days missed. Your finish date moved to {finishDate}. | This is the {streak}th day in a row with nothing logged. | At this rate you finish {finishDate}, which is after your exam. {droppedCount} items have already been dropped to fit. | Start with {firstTask}. One task. Now. |
| `CRISIS` | {streak} days. Read the arithmetic. | A week. Nothing logged. | {daysToExam} days remain and {coveragePercent}% is covered. The plan can no longer fit what is left. Either the hours go up or the exam date moves. | Two choices in the app: add hours, or change the date. Doing neither is also a choice. |

### Nudge dialogues

| Key | Subject | Body |
|---|---|---|
| `NUDGE_FIRST` | Nothing logged today | {todayMinutes} minutes are still on today's list. The day closes at midnight and what is not logged is counted as missed. There is still time. |
| `NUDGE_STREAK` | Nothing logged today, and that would make it {streak} | This would be day {streak}. One task logged tonight keeps the streak at {streak} rather than {streak+1}, and the difference compounds. |

### Debrief dialogues

| Key | Subject | Body |
|---|---|---|
| `DAY_DONE` | Done: {todayMinutes} min | Everything on today's list is logged. {coveragePercent}% covered, {daysToExam} days to go. |
| `DAY_OVER` | Done, and then some | You logged past the plan today. Credited in full. Worth knowing: a day like this is not repeatable, and the plan assumes your real weekly hours, not your best day. |
| `DAY_PARTIAL` | Partly done: {n} of {taskCount} | You logged {n} of {taskCount} tasks. The rest moves to tomorrow, which makes tomorrow heavier. |
| `DAY_LOST` | Day closed with nothing logged | Today is closed. It counts as missed, and the streak is now {streak}. {todayMinutes} minutes of work moved to tomorrow. |

### The escalation ceiling, and why it exists

The candidate asked for shaming. The tiers above get genuinely sharp: `CRISIS`
tells someone the plan no longer fits and makes them choose. That is harder
than most software will ever talk to its user, and it is the right call,
because a planner that stays pleasant while someone fails is useless.

There is a floor, and it is a product decision rather than squeamishness:

- Never attack the person, only the arithmetic. "A week. Nothing logged." is a
  fact. "You clearly do not want this" is a guess about someone's character,
  and a wrong one often enough to destroy trust permanently.
- Never close without an action small enough to do tonight. Shame with no exit
  produces avoidance, and the avoidance behaviour here is deleting the email
  rule, which ends the coaching relationship for good.
- Never escalate past `CRISIS`. Beyond it there is nothing true left to say, and
  repetition reads as nagging rather than seriousness.

The ceiling is what keeps the pressure usable. An email that makes someone feel
contempt gets filtered, and a filtered coach coaches nobody.

## Email structure

One layout, three variants. Built as a table-based HTML email, because that is
what email clients actually render.

```
┌──────────────────────────────────────┐
│  CFA Level II        {daysToExam} d  │   header, 1 row
├──────────────────────────────────────┤
│  Subject line as an H1               │   the dialogue opening
│  Pressure line                       │
├──────────────────────────────────────┤
│  ▓▓▓▓▓▓▓▓░░░░░░░░  {coverage}%       │   progress bar, table cells
├──────────────────────────────────────┤
│  TODAY                               │
│  ┌────┬─────────────────────┬──────┐ │
│  │ ✓  │ Meldrum FI LM2      │ 53m  │ │   the task table
│  │    │ UWorld FI R2 v1-2   │ 84m  │ │
│  └────┴─────────────────────┴──────┘ │
├──────────────────────────────────────┤
│  [ Open today's plan ]               │   one button, one job
├──────────────────────────────────────┤
│  Why you got this · Stop these        │   footer
└──────────────────────────────────────┘
```

### The constraints that shape it

Email is not the web, and the differences are not stylistic:

- **Inline styles only.** No stylesheet, no classes. Gmail strips `<style>` in
  some contexts and all of it in forwarded mail.
- **Tables for layout.** Flexbox and grid are unreliable; Outlook renders
  through Word's engine, which supports neither.
- **No SVG.** Support is poor to absent, Gmail blocks it outright. So "visuals"
  means table cells with background colours, which render everywhere.
- **The progress bar is a two-cell table**, one cell at `width: {n}%` with a
  background colour, one filling the rest. That is a real bar chart in every
  client, with no image and no script.
- **A per-topic bar chart** uses the same trick, one row per topic. This is how
  the debrief shows coverage without an attachment.
- **Dark mode** is handled by giving every cell an explicit background and
  colour. A transparent background inverts unpredictably.
- **Images are blocked by default**, so nothing load-bearing may be an image.
  The emails carry no logo for that reason.
- **Plain-text alternative is mandatory**, not a courtesy: it is what spam
  filters read, and what a watch or a screen reader may use. Every dialogue
  therefore has to survive without layout, which is also a good discipline on
  the copy.

### What the three variants carry

| | Prescription | Nudge | Debrief |
|---|---|---|---|
| Header with days remaining | yes | yes | yes |
| Coverage bar | yes | no | yes |
| Task table | today's tasks | count only | today's tasks with done marks |
| Per-topic chart | no | no | yes |
| Plan-change notice | when regenerated | no | when work moved |
| Button | Open today's plan | Log tonight's work | Open tomorrow's plan |

## Sending rules

**Idempotency is the hard requirement.** The cron can re-run, retry, or overlap.
A new table, `EmailSend`, with `@@unique([planId, localDate, slot])`, is written
in the SAME transaction that marks the send. A duplicate prescription is worse
than a missed one: it tells the candidate the system does not know what it has
already said.

**Send failure never corrupts plan state.** The plan regeneration commits first,
on its own. The send is attempted after, and a failure is recorded on the
`EmailSend` row as a failed attempt rather than rolled back. A mail outage must
not mean a candidate's plan stops being regenerated.

**A kill switch per candidate, honoured immediately.** `StudyPlan.emailCoach`
is one of `all`, `debrief-only`, or `off`. The footer link sets it without a
login, through a signed token, because an unsubscribe that requires signing in
is an unsubscribe that does not work. This is also the legal floor for
non-transactional mail.

**A hard cap of three per day per plan**, enforced at the query, not by
convention. Any future slot must displace an existing one rather than add to it.

**Nothing is sent to an unverified address.** The auth system already knows
whether an address has been confirmed.

## Decisions left to the builder

- Whether the morning slot is fixed at 06:30 local or derived from the
  candidate's logging history. Fixed is correct for v1.
- The exact `droppedCount` wording when the degradation ladder has fired more
  than once in a week.
- Whether the debrief's per-topic chart shows all ten topics or only those
  touched this week. Ten is probably too many rows for mobile.
- SMTP sender identity, SPF, DKIM and DMARC setup, which is deployment rather
  than design, but note that a coach email that lands in spam is worse than no
  coach at all.

## Related

- [Daily prescription engine design](2026-11-10-daily-prescription-design.md): the engine whose output every one of these emails describes.
- [Day view design](2026-11-11-day-view-design.md): the screen each button links to, and the source of the copy conventions these dialogues follow.
- [CFA Study Tracker design](2026-11-04-cfa-study-tracker-design.md): the v1 spec whose email non-goal this reverses.
