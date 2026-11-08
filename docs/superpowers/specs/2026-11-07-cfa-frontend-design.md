---
title: CFA Study Tracker frontend design
type: spec
module: apps/frontend
updated: 2026-11-07
status: draft
---

## Purpose

The design for the CFA Study Tracker frontend: a heavily visualized, installable
PWA on Next.js 15, deployed to Vercel, talking to the live backend at
`https://cfa.polarislab.ir/api`. This document fixes the visual system, the
information architecture, the visualizations, the motion system, the stack
calls, and the backend changes the design requires.

Revision 2. An adversarial expert review of revision 1 returned 78 findings, 15
of them blockers. Every blocker is resolved here. The review's own corrections
to itself are folded in. Section "What revision 1 got wrong" records the
substantive reversals, because several were errors of fact that a reader of
revision 1 would otherwise carry forward.

The product spec ([CFA Study Tracker design](2026-11-04-cfa-study-tracker-design.md))
owns what the product does. This document owns how it looks, reads, and behaves.
Where the two disagree, the product spec wins.

## What revision 1 got wrong

Recorded rather than quietly patched, because each one changes a decision.

1. **The accessibility claim was false.** Revision 1 stated "Contrast floor:
   4.5:1 for text, 3:1 for the data surfaces and focus rings, verified in both
   variants." Nothing had been verified. Measured: `rule` at **1.65:1** carried
   the pace chart's target line, `alarm` at **3.09:1** on `raised` carried body
   copy, light `claimed` at **3.63:1**. The confidence ramp was non-monotonic in
   lightness (L\* 66.5, 68.5, 60.4), so it inverted in greyscale. There was no
   focus token and none of the eight could be one. The palette below is computed
   and checked, with the numbers shown.
2. **The product's core verb was unreachable.** The log composer had no way to
   choose which outcome you are logging. It was pre-filled from study next and
   offered no alternative.
3. **Onboarding never collected `startDate`.** The backfill screen exists for the
   mid-stream candidate, and without a start date their 214 backfilled outcomes
   date to today and read as a large surplus. The screen broke the exact user it
   was built for.
4. **The headline number was dimensionally wrong.** Verified in source:
   `splitProgress` in `core/pace.ts` increments per **log row**, so
   `today.actualCumulative` is a row count, while `targetCumulative` is clamped
   to distinct outcomes. Subtracting them is a unit error, and re-logging one
   outcome inflates it. The correct primitive, `coverageCount` (distinct
   `losId`), already exists in the same file and is not used for this.
5. **The 3D hero could not be justified at the size it was given.** Measured on
   the authored marks, and argued at length by the review: a 10-prism scene
   costs a WebGL context on the most-visited route, cannot be read by a screen
   reader, cannot be the target of a `layoutId` morph, and encodes two
   quantities in area and height, which is harder to read than position on a
   common scale. It is demoted to an opt-in explore view.
6. **Four middle-dot meta strings** sat in the wireframes, a direct violation of
   the brief's own anti-slop list.
7. **The Assets section described a mark that does not exist.** The authored
   mark is now Vortex (see
   [Asset pipeline and mark set](../../design/assets/ASSETS.md)).

## Goals

- One glance answers: am I behind, and which heavily weighted material have I
  not touched.
- Every number is traceable by the candidate to data they entered. No invented
  metrics, no flattery, no blended score.
- The real scale (10 topics, 60 to 80 readings, 500 to 700 outcomes) is
  navigable on a 390px phone.
- Heavily visualized: no quantity appears as bare text where a mark can carry it,
  subject to the honesty test below.
- Accessible by construction: every visualization has a non-visual path.
- Smooth on a mid-range Android phone.

## Non-goals

- No chart library. Two custom charts with encodings no library ships.
- No blended readiness score, and no pass probability.
- No crontab editing from the browser.
- No offline writes.

## Anti-goals

- The AI design tells listed in the brief. Revision 1 violated the middle-dot
  rule; that is fixed and the rule is restated here as binding.
- Anxiety theater. The countdown is present and small.
- **Visualization theater.** A mark that carries less than the sentence it
  replaced is a regression. Four of revision 1's thirty mapped surfaces failed
  this test and are reverted below.

## Decisions

### Tokens: color

Dark is the designed default; light is a complete variant from the same token
names. The palette is a field survey palette: desaturated ink and mineral, with
saturation reserved for danger.

Ink tokens (`-ink` suffix) exist because a fill that passes 3:1 as a shape does
not pass 4.5:1 as text. Splitting them is what makes the claim checkable.

Dark:

```
--ground        #0F1A1E   the page
--raised        #17272D   panels, sheets
--rule          #2C4149   decorative hairlines only, never load bearing
--rule-strong   #58757E   axes, target lines, borders that carry meaning
--text          #E6EDEA   primary text
--muted         #93ABAD   secondary text
--focus         #7FD4C1   focus ring, this token has no other job
--claimed       #C8A24A   brass fill: coverage logged
--claimed-ink   #D9B868   brass as text
--strong        #6FB79A   eucalyptus fill: confident
--alarm         #C2453C   oxide fill: flagged, behind, unrealistic
--alarm-ink     #E8796B   oxide as text
```

Light:

```
--ground        #E9EDEA
--raised        #F6F8F5
--rule          #C2CCC6
--rule-strong   #6F837E
--text          #14201F
--muted         #4F605D
--focus         #15635A
--claimed       #8A6718
--claimed-ink   #7C6128
--strong        #1F6B4F
--alarm         #A5332B
--alarm-ink     #8E2A23
```

Measured contrast, minimum of (on `ground`, on `raised`):

| Token | Dark | Light | Needs |
| --- | --- | --- | --- |
| `text` | 12.95 | 14.14 | 4.5 |
| `muted` | 6.35 | 5.62 | 4.5 |
| `focus` | 8.86 | 5.99 | 4.5 |
| `claimed-ink` | 8.07 | 4.94 | 4.5 |
| `alarm-ink` | 5.41 | 7.09 | 4.5 |
| `rule-strong` | 3.12 | 3.40 | 3.0 |
| `claimed` | 6.39 | 4.40 | 3.0 |
| `strong` | 6.53 | 5.43 | 3.0 |
| `alarm` | 3.09 | 5.72 | 3.0 |

`rule` is 1.65 dark and 1.39 light and is therefore **decorative only**: it may
never draw an axis, a target line, or a border that carries meaning. That is
what `rule-strong` is for.

**The confidence ramp is single-hue brass**, so it is monotonic in lightness and
survives greyscale and every form of color blindness:

```
dark:   #6B5520  #96762A  #C09A45  #E3C271     L* 37.3 → 51.4 → 65.6 → 79.7
light:  #BE9C55  #9E7F3B  #7C6128  #564414     L* 66.0 → 54.8 → 42.7 → 29.8
```

"Untouched" is **not a step on this ramp**. It is a neutral surface fill
(`raised` with a `rule` hairline), because absence is a different kind of thing
from a low value, and giving it a ramp position made it compete with real data.

Rules on color:

- Status is never encoded by hue alone. Every state carries a second channel: a
  shape, a texture, a position, or a label.
- `--alarm` has exactly four jobs: a flagged outcome, a behind delta, a missed
  day, and `paceRealistic: false`.
- A `@media (forced-colors: active)` block maps every data surface to system
  colors and replaces fills with patterns.

### Tokens: type

Two variable families, self-hosted and subset.

- **Archivo** for interface and data. Its width axis is used for chart and map
  lettering, which is survey-chart convention and the deliberate replacement for
  the forbidden all-caps label. Wide tracking appears **only** on chart
  lettering, never on section headings.
- **Newsreader** for outcome statements and reading-length prose. The serif is
  the curriculum's voice, the sans is the app's.

No monospace, with exactly one carved exception: the cron expression on
watchdogs, which is a literal string where character alignment is the meaning.

Scale, with tracking:

| px | Tracking | Role |
| --- | --- | --- |
| 12 | +0.01em | ticks, captions |
| 14 | 0 | secondary |
| 16 | 0 | body, all inputs (never smaller, iOS zooms below 16) |
| 20 | -0.005em | section headings |
| 26 | -0.01em | screen titles |
| 34 | -0.015em | secondary figures |
| 48 | -0.02em | the one hero figure |

Line height 1.45 Archivo, 1.6 Newsreader. Measure capped at 68 characters.

`font-variant-numeric: tabular-nums` applies to **tables, chart ticks and
counts that change in place**. It does not apply to the Today hero: proportional
figures set better in a sentence, and the hero is a sentence.

Loading: both families self-hosted, subset to Latin, `font-display: swap`,
`size-adjust` fallback metrics so swap does not shift layout, and a `preload` on
Archivo only. Self-hosting is also what lets the CSP forbid third party origins
outright, which the token storage decision depends on.

### Tokens: space, radius, border, elevation, motion

Spacing: 4, 8, 12, 16, 24, 32, 48, 64.

Radius is information: 0 on data surfaces, 2px on inputs and chips, a full pill
on the single primary action per screen.

Elevation: borders for things on the page, shadows only for things that float.
`0 8px 24px -8px rgb(0 0 0 / 0.45)` dark, `0 8px 24px -8px rgb(20 32 31 / 0.18)`
light. Cards get borders, not shadows.

Motion tokens:

```
--ease-exit     cubic-bezier(0.4, 0.0, 1, 1)
--ease-enter    cubic-bezier(0.0, 0.0, 0.2, 1)
--ease-settle   cubic-bezier(0.23, 1, 0.32, 1)
--dur-tap       120ms
--dur-move      200ms
--dur-sheet     300ms
--spring-sheet  stiffness 420, damping 34
```

`--ease-settle` is the standard easeOutQuint. Revision 1 invented a curve.

### The honesty test for visualization

The product must be heavily visualized. That directive has one limit, and
naming it is what keeps the rest credible:

> A mark replaces a sentence only when it carries at least as much information
> as the sentence did, in less time.

Applied, this reverted four of revision 1's thirty mapped surfaces:

- **Export buttons.** A "volume bar" encodes nothing a reader can act on.
  Reverted to "412 logs, 6 mock exams, 183 days".
- **Push devices.** "Subscription age" as a bar is a number nobody needs.
  Reverted to a state per row plus a "This device" label.
- **Diversity nudge.** The nudge is an argument, and an argument needs words.
  The sentence returns; the source mix bar moves to the LOS detail screen where
  it is evidence rather than decoration.
- **Missed day.** A struck-through bar does not say which day or how long.
  The sentence returns, with the bar beside it.

### Visualization 1: the weight gap (the hero)

The question the hero answers is "which heavily weighted material have I not
touched". The best encoding for that is **position on a common scale**, which is
the most accurately decoded visual channel there is.

One horizontal bar per topic, sorted by **uncovered weight points** descending:
`(exam_weight_midpoint) * (1 - covered_fraction)`. The bar's length is the
weight points still unclaimed. Covered portion is brass, uncovered is the
neutral surface fill, and the topic's weight range sits beside it as text.

```
Uncovered weight                       sorted by what is at stake
┌──────────────────────────────────────────────────────┐
│ Fixed Income        ███░░░░░░░░░░░░░  9.4 pts  10-12%│
│ Equity Investments  ██████░░░░░░░░    6.1 pts  10-12%│
│ Financial Reporting ████████████░░    4.8 pts  13-17%│
│ Ethics              ██████████████    0.9 pts  15-20%│
└──────────────────────────────────────────────────────┘
  ███ covered    ░░░ still to cover
```

It reads in one pass, it is keyboard navigable and screen-reader readable
without a parallel implementation, and it **is** the table view. A heavily
weighted untouched topic sorts to the top by construction, which is the whole
job.

Why this replaced the 3D massif as hero: the massif encoded weight as area and
coverage as height, two channels that are both harder to decode than length,
on a surface that cannot be focused, labelled, or morphed. The massif survives
as an opt-in explore view (below), because it is genuinely better for browsing
the shape of a whole level than a sorted list is.

### Visualization 2: the massif (opt-in explore view)

`/coverage/explore`, reached by an explicit control, never auto-mounted.

Ten topic prisms on a plane, near-isometric camera. Footprint area is the
topic's exam-weight **midpoint** (always shown with its full range as text,
since the range is the real datum). Height is coverage depth, **capped**, with
the remainder drawn as a ghost volume so an empty plan reads as "all still to
do" rather than as a flat field.

Geometry is a **stack of discs, one per reading**, built as a single
`InstancedMesh`. Discrete treads make height a countable number of readings
rather than an unreadable ratio, they give the drill-down a per-reading target,
and sixty instanced cylinders are one draw call against ten bespoke extrusions.
This adopts the proposal recorded in
[Asset pipeline and mark set](../../design/assets/ASSETS.md).

Requirements, all of which revision 1 missed:

- A `webglcontextlost` listener that routes to the 2D view. Android Chrome
  reclaims contexts in installed PWAs; without this the user returns to a blank
  hero.
- `aria-label` on the canvas carrying the summary, and a toggle to the same data
  as a table.
- The drill-in morph runs from a **DOM hit layer** positioned over each prism,
  not from the WebGL object. `layoutId` cannot source from a GPU primitive.
- Hard gate: if it cannot hold 60fps while orbiting on a mid-range Android, it
  ships as the table only. Measured on hardware before merge.

The 2D fallback is a squarified treemap over however many topics the level has,
not a fixed ten, using the same capped-height reading so the two views agree.

### Visualization 3: the pace field

Split in two, because Today and `/pace` ask different questions.

On Today: a **delta sparkline**, 120px tall, showing the gap over time only.

On `/pace`: the full field. X from plan start to exam date, Y cumulative
outcomes.

- Target line in `rule-strong`, never `rule`.
- Actual band split into new coverage (solid brass) and review work (brass at
  35 percent over a hatch).
- Gap filled `strong` when ahead, `alarm` when behind.
- Missed days as oxide ticks, holidays as neutral `rule-strong` bands.
- Legend, crosshair with tooltip, adaptive tick density, and a time range
  control (30 days, 90 days, all).
- Today's live point marked distinctly from frozen history.
- When `paceRealistic` is false, the required slope draws in oxide with a
  client-composed sentence naming both levers the candidate controls. There is
  no `paceRealisticReason` field in the API; revision 1 rendered one.

**The split history is computed client side** from `GET /logs`, not from
`ProgressSnapshot`, which stores only two integers. The client already needs the
log history for other reasons, and computing it exactly costs nothing more than
a migration would have cost.

### Visualization 4: the mock trend

Dots on a date axis, 0 to 100, connecting line at three or more. Provider shown
as dot shape. A computed readout beside it. Explicit 0, 1 and 2 mock states, a
delete action, and no pass line, because the app has no basis to draw one.

### Visualization 5: the day grid

Split into two components, because revision 1 conflated an editor with a report.

- **Availability editor** (`/plan`): seven columns, hours per weekday, drag or
  arrow keys, `role="slider"` with `aria-valuetext`.
- **Day grid** (read only): one cell per day carrying a floating bar, hollow
  outline for hours planned, solid body for what was logged, oxide baseline for
  a missed day, dashed neutral band for a holiday. Used on `/plan` and, with
  tick marks, on `/watchdogs`.

Holiday ranges are created with a plain two-date form, not by drawing on a grid.

### Visualization everywhere

The binding rules, as amended by the honesty test.

**No naked number.** No quantity appears as text alone where a mark can carry it.
"12 behind" is a gap with its size written in it.

**Text budget.** Text is reserved for outcome statements and reading names, the
user's own notes, error explanations, and **arguments** (the diversity nudge,
the pace-realism warning). Everything else earns a visual.

**Lazy canvas, two routes.** WebGL mounts only on `/coverage/explore` and the
onboarding backfill build. Revision 1 mounted one context at the app shell to
serve four surfaces; three of those four are now gone (sign in cut, level
chooser replaced, horizon moved to SVG), so the shared canvas is no longer
load bearing. Note for the record: context count is not render cost, and
`drei`'s `View` scissors per view, so the original argument was wrong on its own
terms.

The map, corrected:

| Surface | Treatment |
| --- | --- |
| Sign in | **No WebGL.** A static SVG weight treemap on the register tab only |
| OAuth callback | The Vortex mark drawing one arm at a time while the token is exchanged |
| Onboarding, level | Ten-segment weight bars per level, from a 2KB summary endpoint, not three curriculum fetches |
| Onboarding, exam date | Horizon in **SVG**: weeks as ticks to the exam window, your date a fixed post |
| Onboarding, availability | Seven draggable columns. More hours grows the **filled ground**; the exam post never moves |
| Onboarding, packages | Three labelled role slots per package, filled or empty |
| Onboarding, backfill | Reading strip in input mode, with the massif building beside it. The one place 3D is unarguable |
| Today, countdown | Small horizon strip in the header |
| Today, behind or ahead | Deviation sparkline with the figure set inside the gap |
| Today, new versus review | Split stack at one scale |
| Today, recommended split | 1:2 target bar against the **remaining** week |
| Today, missed days | Sentence plus the day bar beside it |
| Study next, each row | Topic spine, four-step brass confidence meter, accuracy arc, staleness bar, outcome text |
| Composer, LOS field | **Search, first field.** The product's core verb |
| Composer, confidence | Five 44px buttons in a `role="radiogroup"` |
| Composer, questions | Accuracy arc filling as you type, crossing the 60 percent threshold visibly |
| LOS detail | Confidence sparkline, accuracy donut, source mix bar, staleness bar |
| Pace, rollups | Same field at three grains |
| Settings, export | "412 logs, 6 mock exams, 183 days" as text |
| Watchdogs, devices | State per row plus "This device" |
| Empty states | The empty structure itself, with real copy |
| Loading | Skeleton in the shape of the real visual |
| Errors | The affected element turns oxide in place, explanation attached |

### Information architecture

```
/                       today
/login  /register       password plus Google and GitHub
/auth/callback          OAuth token handoff
/onboarding             six steps, resumable
/coverage               the weight gap, drill to reading strip
/coverage/explore       the massif, opt in
/coverage/[topicId]     reading strip
/los/[losId]            one outcome: history, confidence, accuracy, sources
/logs                   log history, correct and delete
/pace                   the pace field, rollups
/mocks                  mock exams
/plan                   exam date, availability, holidays, packages
/settings               account, password, push opt in, theme, export, import
/watchdogs              system health
```

Phone: four-item bottom bar (Today, Coverage, Pace, Plan) with the composer as
the bar's **center item**, so the primary action is in the thumb arc and does
not float over content. `/logs`, `/mocks`, `/settings` and `/watchdogs` sit
under Plan. Every drilled route carries an explicit back control, because an
installed iOS PWA has no edge-swipe back.

Desktop: left rail, same four, with the rest below a divider. The composer is a
centered dialog on a keyboard shortcut, and `cmdk` drives outcome search.

Offline readable: Today, Coverage, Pace, Mocks, LOS list, Logs. Writes require
network and say so in place.

### Screens

Sign in. Register and sign in as one segmented form.

```
┌──────────────────────────────┐
│   ◍  Study Tracker           │
│                              │
│   Sign in  |  Create         │
│                              │
│   Email                      │
│   ┌──────────────────────┐   │
│   └──────────────────────┘   │
│   Password                   │
│   ┌──────────────────────┐   │
│   └──────────────────────┘   │
│   ┌──────────────────────┐   │
│   │      Sign in         │   │
│   └──────────────────────┘   │
│                              │
│   or continue with           │
│   ┌─────────┐ ┌──────────┐   │
│   │ G Google│ │ ◉ GitHub │   │
│   └─────────┘ └──────────┘   │
└──────────────────────────────┘
```

401 copy: "That email and password do not match." The same message for an
unknown email, because the backend refuses to enumerate users and the interface
must not leak what the API protects.

Password recovery is a dead end in the backend: `/api/auth/forgot-password` has
a rate-limit tier in `middleware.ts` and no route. Until that is built, the sign
in screen says so plainly rather than offering a link that 404s.

OAuth callback. Reads the token, stores it via the proxy, clears the query
string with `replaceState`, routes on. Minimum 400ms so it does not flash. A
missing or rejected token says what happened and offers sign in.

Onboarding, six steps, resumable from `localStorage`, progress as a filled rule.

1. **Level.** Ten-segment weight bars per level, with outcome and topic counts.
2. **Exam date.** Date field, real CFA windows as shortcuts, days remaining live.
3. **Start date.** When did you begin studying? Defaults to today. This is the
   step revision 1 omitted, and without it step 6 is wrong for its own audience.
4. **Availability.** Seven columns. Weekly total and implied hours to exam
   computed live, so an unrealistic plan is visible during setup.
5. **Packages.** Presets plus your own, each with three labelled role slots.
6. **Starting point.** The backfill.

The backfill screen. Marking 200 of 700 outcomes by checkbox loses the user, so:

- **By reading** (default). One tap covers 11 to 16 outcomes, which is how
  candidates remember progress ("I finished Quant through hypothesis testing").
- **By outcome**, with search, virtualized.
- **Skip**, stated as correct for a genuinely new candidate.

```
┌──────────────────────────────┐
│ What have you already done?  │
│ Mark whole readings, or pick │
│ single outcomes. Skip if you │
│ are starting fresh.          │
│                              │
│ ┌──────────────────────────┐ │
│ │ By reading │ By outcome  │ │
│ └──────────────────────────┘ │
│                              │
│ Quantitative Methods   8-12% │
│  ◉ Time value of money   14  │
│  ◉ Statistical measures  12  │
│  ○ Probability concepts  16  │
│                              │
│ Confidence for marked        │
│  ① ② ③ ④ ⑤                  │
│                              │
│ ─────────────────────────    │
│ 214 of 700 marked            │
│ Since 1 Sep that is 12 ahead │
│ of the pace your plan needs. │
│ ┌──────────────────────────┐ │
│ │  Create plan             │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

The running line reads against the start date from step 3. Without it, this said
"214 ahead" to every mid-stream candidate.

Today.

```
┌──────────────────────────────┐
│ 7 Nov            142 days left│
│ ▁▂▃▄▅▆▇ horizon strip         │
│                              │
│ You are 12 outcomes behind,  │
│ about 5 hours of work.       │
│                              │
│ [ deviation sparkline 120px ]│
│                              │
│ 31 new    15 review          │
│ ████████  ▓▓▓▓               │
│                              │
│ You planned 3 hours on       │
│ Wednesday and logged none.   │
│  ▯ (the day bar, beside it)  │
│                              │
│ Next two hours               │
│ ┌──────────────────────────┐ │
│ │ 40 min content           │ │
│ │ 80 min practice          │ │
│ │ starting with:           │ │
│ │ ⚑ Describe the standard  │ │
│ │   normal distribution    │ │
│ │   Quant, rated 34d ago   │ │
│ └──────────────────────────┘ │
│                              │
│ Study next                   │
│ ┌──────────────────────────┐ │
│ │ ⚑ Calculate and inter... │ │
│ │ ○ Explain the role of... │ │
│ └──────────────────────────┘ │
│                              │
│        ( Log a session )     │
└──────────────────────────────┘
```

The hero is a **sentence with proportional figures**, priced in hours as well as
outcomes, because "12 outcomes" means nothing to a candidate until it is time.
No middle dots anywhere; the meta line reads "Quant, rated 34d ago".

The behind-or-ahead figure is **computed client side** from distinct covered
outcomes against `targetCumulative`. The API's `delta` is not rendered: see
backend ask 6.

"Next two hours" turns the recommended split from advice into a plan, using the
split, the study-next list and the package roles the client already holds. It is
a pure function over existing data and needs no backend.

Exam day and post-exam are explicit states on this route.

The composer. A bottom sheet with a real gesture layer: 1:1 drag tracking,
velocity handoff, momentum projection, rubber banding past the top, a dismissal
threshold on distance or velocity, and a focus trap.

```
┌──────────────────────────────┐
│ Log a session            ✕   │
│                              │
│ Outcome                      │
│ ┌──────────────────────────┐ │
│ │ 🔍 search outcomes       │ │  ← first field, always
│ └──────────────────────────┘ │
│ Suggested: ⚑ Describe the... │
│                              │
│ Confidence                   │
│ ┌──┐┌──┐┌──┐┌──┐┌──┐        │
│ │1 ││2 ││3 ││4 ││5 │        │  44px, radiogroup
│ └──┘└──┘└──┘└──┘└──┘        │
│                              │
│ Questions    Correct         │
│ ┌──────┐    ┌──────┐         │
│ └──────┘    └──────┘         │
│  ◔ 58% accuracy              │
│  Below 60% flags this for    │
│  review.                     │
│                              │
│ Date  [today ▾]              │
│ ▸ Package, note              │
│                              │
│ ( Log )   ( Log and next )   │
└──────────────────────────────┘
```

Backdating is supported, because people log on Sunday what they did on Saturday.

Watchdogs.

```
┌──────────────────────────────┐
│ System health                │
│                              │
│ Nightly snapshot             │
│ Ran 3:00 UTC today.          │
│ 1 plan recorded, 0 failed.   │
│                              │
│ [ 30 night grid, tick marks ]│
│  ✓✓✓✓✓✓✓ ✓✓✓✓✓✓✓ ✓✓✓✗✓✓✓    │
│                              │
│ 4 Nov is missing. That night │
│ has no frozen snapshot, so   │
│ its behind or ahead number   │
│ is estimated, not stored.    │
│  ( Backfill that night )     │
│                              │
│ Next run in 11h 20m          │
│ Schedule 0 3 * * * (UTC)     │
│ set on the server, not here. │
│  ( Run now )                 │
│                              │
│ Push notifications           │
│ ◉ Pixel, Chrome              │
│   This device    ( Remove )  │
│ ○ Add this device            │
│                              │
│ Missed day alerts  ◉ on      │
└──────────────────────────────┘
```

The cron expression is the one monospace exception. The crontab limit is stated,
not hidden: editing it from a browser needs a privileged daemon on the VPS,
which this app will not open. "Next run in" is guarded against a wedged cron.

The seven screens revision 1 left unwireframed (coverage, pace, mocks, plan,
settings, logs, LOS detail) follow the same patterns and are specified in the
worklist rather than drawn here.

### Motion

One authored non-user-triggered moment, **once per install**: the massif rising
on first entry to the explore view, 600ms total, non-uniform stagger, on
`--ease-settle`. A second authored moment fires once on plan creation. Nothing
else animates on its own, and the sign-in ambient animation is cut.

User-triggered:

- Sheets: `--spring-sheet`, transform and opacity only.
- Drill in: Framer Motion shared layout from the DOM hit layer, 300ms. The
  strip-to-LOS morph is dropped; it was a route change wearing a morph.
- Taps and toggles: `--dur-tap` on `--ease-enter`, with press feedback on
  pointer down, not on release.
- Study next after logging: `AnimatePresence mode="popLayout"`, because the
  logged outcome usually leaves the list.
- Charts do not animate on refetch.

Budget: transform and opacity only, no animated layout properties, no
`box-shadow` transitions, `will-change` only for an interaction's duration. The
3D canvas pauses its loop when not visible.

Reduced motion: final states, camera locked, morphs become 150ms opacity
crossfades. No information is lost in this mode, which is the test of whether
the motion carried any.

### Accessibility

Not a section to be audited later; these are build requirements.

- A `--focus` token with a visible ring on every interactive element, a specified
  focus order, trapping in sheets and dialogs, and non-obscuration.
- Every visualization has a table view toggle, an `aria-label` carrying the
  summary, and `role="button"` semantics on interactive rows.
- A `@media (forced-colors: active)` block for all five.
- `Intl.NumberFormat` and `Intl.PluralRules` throughout. "1 outcomes" is a bug.
- Relative timestamps switch to absolute after 7 days.

### Mobile platform baseline

Revision 1 omitted this entirely.

`viewport-fit=cover` with `env(safe-area-inset-*)` padding on the bottom bar and
sheets; two `theme-color` metas for light and dark; `overscroll-behavior: none`
on scroll containers; `touch-action: pan-y` on the sheet; `100dvh` not `100vh`;
`-webkit-tap-highlight-color: transparent` with real `:active` states;
`user-select: none` on controls; `interactive-widget=resizes-content` so the
keyboard does not cover the composer.

Manifest: `display: standalone`, `background_color`, `theme_color`, `scope`,
`start_url`, maskable icons from
[Asset pipeline and mark set](../../design/assets/ASSETS.md), and a "Log a
session" shortcut.

### Stack calls

| Choice | Reason |
| --- | --- |
| Next.js 15 App Router, React 19, TypeScript, pnpm | Pinned by the product spec |
| TanStack Query with `persistQueryClient` to IndexedDB | Server state and the read-only offline requirement in one tool. Explicit `staleTime`: 60s for `/progress`, `Infinity` for the curriculum tree |
| No global store | URL state plus Query plus one `useReducer` for the onboarding draft |
| `react-hook-form` plus `zod` | Schemas mirror the backend's own zod shapes |
| Hand-authored SVG for both charts | Encodings no library ships |
| `react-virtuoso` | Variable-height rows and grouping, which the outcome list needs |
| `cmdk` | Desktop outcome search |
| `sonner` | Toasts for write confirmation and offline failure |
| `base-ui` | Accessible primitives for the sheet, dialog, radiogroup and popover |
| `next-themes` | Theme switching without a flash |
| R3F plus `drei`, lazy, two routes | Confined to the massif and the backfill build |
| `motion` | Layout morphs and sheets; CSS owns hovers and taps |
| `date-fns` | All date math in UTC, matching the backend's `startOfUTCDay` exactly |
| `@serwist/next` | Workbox based, maintained for Next 15 |
| CSS Modules plus custom properties | Tokens visible, zero runtime |
| Vitest, Testing Library, Playwright on onboarding and logging | The two flows whose breakage makes the app useless |

JavaScript budget: 180KB gzipped on the initial route, with three.js, R3F and
drei entirely outside it behind the lazy boundary.

**Token storage: the Vercel route-handler proxy with an httpOnly cookie.** This
was flagged as open in revision 1; it is decided here. The deciding argument is
blast radius, not prevention: a token readable from JavaScript is a long-lived
bearer credential usable from anywhere once exfiltrated, while a cookie behind a
same-origin proxy yields requests only while the page is open. The stated cost
does not survive scrutiny, since one proxy hop is noise against a backend that
already does a full-level outcome fetch per `/progress`, and the hot path is
IndexedDB. It also removes CORS as a frontend concern and stops the OAuth token
from ever reaching the client, which `replaceState` only papers over.

### Backend asks

Five. Revision 1 made four, one of which was wrong in scope.

1. **`GET /curriculum?levelId=`** returning the level tree with
   `examWeightMin`/`examWeightMax`, readings, and outcomes with text and order,
   plus a **`curriculumVersion`** string, an `ETag` and a long `Cache-Control`.
   **Blocker.** Nothing serves outcome text today and `studyNext` returns bare
   `losId` strings. The version field costs nothing now and prevents silent
   blank rows later: the tree is cached in IndexedDB and reseeded yearly, so
   cached clients will eventually hold ids the API no longer returns.
   `/progress` echoes the version.
2. **`GET /curriculum/levels`**, roughly 2KB per level: name, topic count,
   outcome count, and the weight distribution. **Blocker.** The level chooser
   otherwise needs three full curriculum fetches, close to a megabyte, before
   the user has chosen anything, and Levels II and III may not be seeded.
3. **A `CronRun` row plus `GET /api/cron/runs?limit=30`**, returning each run's
   timestamp, outcome, and the `plansProcessed`, `plansFailed`, `plansSkipped`
   counts the tick already computes and discards, plus the configured schedule
   and computed next run. Watchdogs has nothing to show without it.
4. **`POST /api/cron/run`**, user JWT, rate limited, scoped to the caller's own
   active plan. The snapshot write is an idempotent upsert on the
   `[planId, date]` unique constraint, so a caller-scoped run is safe.
5. **`GET /api/push/subscriptions`.** Revision 1 asked for a DELETE too;
   `DELETE /api/push/subscribe` already exists taking `{endpoint}`. There is no
   `POST /push/test` route, so the "Send a test notification" button is cut from
   the wireframe rather than added as a sixth ask.

**Raised as a backend bug, not an ask:** `today.actualCumulative` counts log
rows (`splitProgress` increments per row) while `targetCumulative` is clamped to
distinct outcomes, so `delta` subtracts one unit from another and re-logging
inflates it. `newCoverage` and `reviewWork` are lifetime totals under a key
named `today`. The correct primitive, `coverageCount`, already exists in
`core/pace.ts` and is unused here. The frontend computes its own figure
meanwhile.

**Not asked for:** split columns on `ProgressSnapshot` (derivable client side
from `GET /logs`), a full missed-day range (same), outcome text on `studyNext`
(the client joins against the cached tree), and any readiness score.

Three contract facts that shape error copy: a malformed body returns a framework
500 rather than a 400, so 500 is not purely a server fault; `POST /auth/password`
bumps `tokenVersion` and signs the caller out, so settings must say so and
re-authenticate; the holiday route does not validate that the end date follows
the start date, so the client must.

Note on reads: `studyNext` and `history` are both unbounded, so Today's first
read on a fresh Level II plan carries roughly 700 objects. Coverage is
reconstructed from log history, not from `studyNext`, because `studyNextList`
filters covered outcomes out entirely.

### Risks and the cut list

The one thing all four source proposals had that revision 1 dropped.

| Risk | Mitigation |
| --- | --- |
| 3D misses frame budget on a mid-range Android | The table and treemap are already real views; the massif is opt-in, so this degrades rather than blocks |
| Levels II and III not seeded at launch | Ask 2 exposes it before the user commits; the level chooser disables unseeded levels with a reason |
| Curriculum reseed invalidates cached ids | Ask 1's `curriculumVersion`, plus unmatched ids rendering as real rows |
| The proxy adds a cold start on Vercel | Measure before launch; the fallback is a regional edge function, not a return to localStorage |
| Two variable families bloat first paint | Subset, self-host, `size-adjust`, preload Archivo only |

Cut order under time pressure, most expendable first:

1. The massif's 3D form (the treemap is already a real view).
2. The backfill build animation.
3. The remaining inline marks that fail the honesty test.
4. Archivo's width axis, falling back to one width.
5. The mock trend's provider shapes.

## What is left to the builder

- The massif's exact geometry and the measured frame budget on real hardware,
  which decides whether 3D ships at all.
- Copy for every empty, loading, error, offline and partial-data state, written
  against the voice rules and audited with `impeccable`.
- The twelve-glyph icon set, starting from the three authored flag shapes.
- The Vercel project, then `CORS_ALLOW_ORIGINS` and `FRONTEND_BASE_URL` on the
  server, then the Google and GitHub OAuth apps.

## Related

- [CFA Study Tracker design](2026-11-04-cfa-study-tracker-design.md): the product spec this design serves.
- [CFA backend plan](../plans/2026-11-04-cfa-backend.md): the route contracts this design consumes.
- [Asset pipeline and mark set](../../design/assets/ASSETS.md): the Vortex mark, the icon set, and the gitignored brand slot mechanism.
