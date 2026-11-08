---
title: CFA Study Tracker screens and copy
type: spec
module: apps/frontend
updated: 2026-11-07
status: draft
---

## Purpose

The seven screens the [frontend design](2026-11-07-cfa-frontend-design.md)
specified but did not draw, plus the copy deck for every state on every surface.
Revision 2 of the design deferred both; they were blockers, so they are resolved
here rather than left to build time.

Voice rules, applied throughout:

- Active voice. A control says what happens: "Save changes", never "Submit".
- An action keeps its name through the whole flow. The button that says "Log"
  produces a toast that says "Logged".
- Errors explain what happened and what to do. They do not apologise and they
  are never vague.
- Empty screens are invitations to act, not status reports.
- Sentence case. No filler. No em dashes, no middle dots.
- `Intl.PluralRules` everywhere a count appears. "1 outcomes" is a bug.

## Screens

### /coverage

The weight gap is the hero. Topics sort by uncovered weight points descending,
so what is at stake sorts to the top without the user asking.

```
┌──────────────────────────────┐
│ ← Coverage                   │
│                              │
│ 31% of exam weight covered   │
│ ▓▓▓▓▓░░░░░░░░░░░░░░░         │
│                              │
│ Uncovered weight   [⊞ table] │
│ ┌──────────────────────────┐ │
│ │ Fixed Income             │ │
│ │ ███░░░░░░░░░ 9.4  10-12% │ │
│ │ Equity Investments       │ │
│ │ ██████░░░░░░ 6.1  10-12% │ │
│ │ Financial Reporting      │ │
│ │ ████████████ 4.8  13-17% │ │
│ │ Ethics                   │ │
│ │ ██████████████ 0.9 15-20%│ │
│ └──────────────────────────┘ │
│   ███ covered  ░░░ remaining │
│                              │
│ ( Explore in 3D )            │
└──────────────────────────────┘
```

Each row is a `role="button"` navigating to `/coverage/[topicId]`. The table
toggle swaps to a real `<table>` with the same numbers. "Explore in 3D" is the
only route to the massif, and it is absent entirely when WebGL is unavailable.

Accuracy by topic sits below the fold as a second list, sorted by accuracy
ascending, because a topic you have covered but answer badly is a different
problem from one you have not started.

### /coverage/[topicId]

The reading strip.

```
┌──────────────────────────────┐
│ ← Fixed Income      10-12%   │
│                              │
│ 23 of 78 outcomes   [⊞ table]│
│ ┌──────────────────────────┐ │
│ │ Fixed-income instruments │ │
│ │ ███████▓▓▒░░░░    9/14   │ │
│ │ Issuance and trading     │ │
│ │ ██████████████   12/12   │ │
│ │ Introduction to fixed... │ │
│ │ ▒▒░░░░░░░░░░░░    1/16 ⚑ │ │
│ │ Yield measures           │ │
│ │ ░░░░░░░░░░░░░░    0/11   │ │
│ └──────────────────────────┘ │
│  █ confident ▓ logged        │
│  ▒ flagged   ░ not started   │
└──────────────────────────────┘
```

Segment gap is 1px at phone widths, so a 16-segment reading still reads. Fill
uses the brass lightness ramp; flagged carries one texture as its second
channel, rather than revision 1's four competing patterns.

Tapping a reading expands its outcomes inline, virtualized, outcome text in
Newsreader.

### /pace

```
┌──────────────────────────────┐
│ ← Pace          [30d 90d All]│
│                              │
│ 12 outcomes behind,          │
│ about 5 hours of work.       │
│                              │
│ ┌──────────────────────────┐ │
│ │      target ╱            │ │
│ │           ╱▁▁▂           │ │
│ │      ▂▃▄▅▆  actual       │ │
│ │ ▁▂▃▄▆    ▏  ▏            │ │
│ │ └──┴──┴──┴──┴──┴──┴──    │ │
│ │  Sep  Oct  Nov  Dec      │ │
│ └──────────────────────────┘ │
│  ━ target  ▓ new  ▒ review   │
│  ▏ missed  ░ holiday         │
│                              │
│ [ Day | Week | Month ]       │
│ ┌──────────────────────────┐ │
│ │ This week   18 of 24  -6 │ │
│ │ Last week   24 of 24   0 │ │
│ │ Two weeks   11 of 20  -9 │ │
│ └──────────────────────────┘ │
│                              │
│ [⊞ table]                    │
└──────────────────────────────┘
```

Crosshair with tooltip on hover and on drag. Tick density adapts to the range.
The rollup list is the weekly and monthly view the product spec requires.

When `paceRealistic` is false, a band appears above the chart in oxide:

> "Finishing by 18 May needs about 9 hours a day from here, more than the 12
> hours a week your plan sets aside. Moving the exam date or adding study hours
> are the two things that change this."

That sentence is composed on the client. The API has no reason field.

### /mocks

```
┌──────────────────────────────┐
│ ← Mock exams      ( + Add )  │
│                              │
│ Last 71%, up 13 points       │
│ across 4 exams since Sep.    │
│                              │
│ ┌──────────────────────────┐ │
│ │ 100                      │ │
│ │                    ●     │ │
│ │              ▲           │ │
│ │        ●                 │ │
│ │  ■                       │ │
│ │   0                      │ │
│ │  Sep   Oct   Nov         │ │
│ └──────────────────────────┘ │
│  ■ CFAI  ● UWorld  ▲ Kaplan  │
│                              │
│ 12 Nov   71%   UWorld        │
│ 28 Oct   64%   CFAI          │
│ 14 Oct   61%   UWorld        │
│ 30 Sep   58%   Kaplan   ⋮    │
└──────────────────────────────┘
```

Provider is dot shape, so the series survives greyscale. No pass line.

States: zero mocks shows the empty copy below; one mock shows the dot and "one
exam is a data point, not a trend"; two shows a dashed connector and no computed
slope.

### /plan

```
┌──────────────────────────────┐
│ ← Plan                       │
│                              │
│ Level II                     │
│ Exam 18 May 2027   ( Change )│
│ Started 1 Sep 2026           │
│                              │
│ Weekly hours          12h    │
│ ┌──────────────────────────┐ │
│ │  M  T  W  T  F  S  S     │ │
│ │  ▃  ▃  ▅  ▃  ▁  ▇  ▇     │ │
│ │  2  2  3  2  0  4  4     │ │
│ └──────────────────────────┘ │
│ 12 hours a week leaves about │
│ 318 hours before the exam.   │
│                              │
│ Holidays       ( + Add )     │
│ 20-27 Dec   Trip             │
│ 14-16 Mar   Work crunch      │
│                              │
│ Packages       ( + Add )     │
│ UWorld   [content][Q][mocks] │
│ Kaplan   [content][ ][     ] │
│                              │
│ ( Export )  ( Import plan )  │
└──────────────────────────────┘
```

Columns are `role="slider"` with `aria-valuetext` of "3 hours on Wednesday".
Dragging recomputes the implied hours line live, which is the plan-health
preview: an unrealistic plan is visible while editing, not discovered later.

Role slots are three labelled boxes, filled or empty. Roles are three
independent booleans, so an empty slot shows incompleteness in a way a ring
segment cannot.

### /settings

```
┌──────────────────────────────┐
│ ← Settings                   │
│                              │
│ Account                      │
│ r.fakhrhosseini@example.com  │
│ ( Change password )          │
│                              │
│ Appearance                   │
│ ( System | Light | Dark )    │
│                              │
│ Notifications                │
│ Missed day alerts      ◉ on  │
│ Manage devices on            │
│ System health.               │
│                              │
│ Your data                    │
│ 412 logs, 6 mock exams,      │
│ 183 days of history.         │
│ ( Export everything, JSON )  │
│ ( Export log, CSV )          │
│                              │
│ ( Install on this device )   │
│                              │
│ System health →              │
└──────────────────────────────┘
```

Changing a password signs every device out, because `POST /auth/password` bumps
`tokenVersion`. The screen says so before the action, not after.

### /logs

The screen revision 1 omitted, which made `DELETE /logs/:id` unreachable and
left no way to fix a typo.

```
┌──────────────────────────────┐
│ ← Log history      [Filter]  │
│                              │
│ Today                        │
│ ┌──────────────────────────┐ │
│ │ Describe the standard    │ │
│ │ normal distribution      │ │
│ │ Quant, conf 4, 12 of 15  │ │
│ │                      ⋮   │ │
│ └──────────────────────────┘ │
│                              │
│ Yesterday                    │
│ ┌──────────────────────────┐ │
│ │ Calculate and interpret  │ │
│ │ a confidence interval    │ │
│ │ Quant, conf 3, 8 of 14   │ │
│ │                      ⋮   │ │
│ └──────────────────────────┘ │
│                              │
│ 5 Nov                        │
│ ...                          │
└──────────────────────────────┘
```

Grouped by day with `react-virtuoso`, cursor paginated. The overflow menu offers
Edit and Delete. Delete asks once and says what it changes:

> "Delete this log? Coverage for this outcome drops back to not started, and 12
> answered questions come off your accuracy."

Relative day headings become absolute dates after 7 days.

### /los/[losId]

```
┌──────────────────────────────┐
│ ← Outcome                    │
│                              │
│ Describe the standard normal │
│ distribution and explain how │
│ to standardize a random      │
│ variable.                    │
│ Quantitative Methods         │
│ Probability concepts         │
│                              │
│ ⚑ Flagged: rated 2, and last │
│   studied 34 days ago.       │
│                              │
│ Confidence        Accuracy   │
│ ▁▂▄▃▅            ◕ 58%       │
│ 5 ratings        26 of 45    │
│                              │
│ Question sources             │
│ ████████████████░░░░         │
│ UWorld 40        Kaplan 5    │
│ Practising with a second     │
│ source is associated with    │
│ better retention than        │
│ drilling one bank.           │
│                              │
│ History                      │
│ 12 Nov  conf 2  12 of 20     │
│ 28 Oct  conf 3   8 of 15     │
│                              │
│ ( Log a session )            │
└──────────────────────────────┘
```

This screen is where a flag is explained. Without it every flag is unexplained,
which is why it was added beyond the product spec. The diversity nudge lives
here as evidence beside the source mix bar, rather than as a floating sentence
on Today.

## Copy deck

### Empty states

| Surface | Copy |
| --- | --- |
| Today, day 1 | "Your plan starts today. Nothing logged yet, and nothing is due yet. Log your first session when you finish some study." |
| Today, no plan | "Set up a plan to start tracking. It takes about two minutes." |
| Coverage, nothing covered | "Nothing covered yet. Every topic below is still ahead of you, biggest exam weight first." |
| Reading strip, reading untouched | "No outcomes logged in this reading yet." |
| Study next, all covered | "Everything is covered at least once. Flagged outcomes will appear here as they go stale." |
| Pace, under 3 days of history | "Two days in. The pace line needs about a week before it means much." |
| Mocks, none | "No mock exams logged. Mock scores are the strongest signal of real readiness, so log one when you sit it." |
| Logs, none | "No sessions logged yet." |
| Logs, filter matches nothing | "No sessions match this filter." |
| Holidays, none | "No holidays set. Add a range and those days stop counting against your pace." |
| Watchdogs, no runs | "No nightly runs recorded yet. The first one lands at 3:00 UTC." |
| Search, no match | "No outcomes match. Try a shorter phrase, or browse by topic." |

### Loading

Skeletons shaped like the real visual, never a spinner, except the OAuth
callback where there is nothing to shape.

| Surface | Treatment |
| --- | --- |
| Today | Hero line, sparkline block, three list rows |
| Coverage | Six bar rows at varied widths |
| Pace | Axis frame with no series |
| Any list | Three rows |
| OAuth callback | "Signing you in" with the Vortex mark drawing |

### Errors

| Case | Copy |
| --- | --- |
| 401 on sign in | "That email and password do not match." |
| 409 on register | "An account already uses that email. Sign in instead?" |
| Password too short | "Use at least 8 characters." |
| 403 | "This plan is not yours to change." |
| 404 on plan | "No active plan. Set one up to start tracking." |
| 400 validation | The field-level message, inline, never a banner |
| 429 | "Too many attempts. Try again in a minute." |
| 500 | "The server could not handle that. If it keeps happening, the request may be malformed rather than the server being down." |
| Network down, read | "Showing what was saved on this device. Reconnect to refresh." |
| Network down, write | "You are offline. This needs a connection to save." |
| WebGL lost | "The 3D view stopped. Showing the chart instead." |
| Curriculum id unmatched | "This outcome is not in the current curriculum. It may have been renumbered in a yearly update." |
| Holiday end before start | "The end date needs to be on or after the start date." |
| Push denied | "Notifications are blocked for this site. Your browser settings control that." |
| iOS not installed | "Add this app to your home screen first. iOS only allows notifications for installed apps." |
| Cron wedged | "No run recorded for more than 48 hours. The scheduler on the server may be stopped." |

### Confirmations

Toasts via `sonner`, past tense matching the action's verb.

| Action | Toast |
| --- | --- |
| Log | "Logged." with Undo for 5 seconds |
| Log and next | "Logged. Next outcome ready." |
| Delete log | "Log deleted." with Undo |
| Create plan | "Plan created." |
| Change availability | "Hours saved. Pace updated." |
| Add holiday | "Holiday added. Those days no longer count against your pace." |
| Add mock | "Mock exam logged." |
| Run cron now | "Run finished. 1 plan recorded." |
| Export | "File saved." |

### Partial data

The states that only appear after months of use, which revision 1 never
considered.

| Case | Treatment |
| --- | --- |
| Exam date today | Today becomes "Your exam is today. Good luck." with the pace chart frozen |
| Exam date passed | "Your exam was on 18 May. Start a new plan when you are ready." Logging is disabled, history stays readable |
| Snapshot gap | The pace line draws dashed across missing nights, with a note linking to watchdogs |
| Plan older than its curriculum | A banner naming the version mismatch, with unmatched outcomes listed as real rows |
| 700 outcomes, none flagged | Study next falls through to curriculum order and says so |

## Related

- [CFA Study Tracker frontend design](2026-11-07-cfa-frontend-design.md): the design these screens implement.
- [CFA Study Tracker design](2026-11-04-cfa-study-tracker-design.md): the product spec.
- [Asset pipeline and mark set](../../design/assets/ASSETS.md): marks and icons.
