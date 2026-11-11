---
title: Day view design
type: spec
module: apps/frontend
updated: 2026-11-11
status: draft
---

## Purpose

`/today` stops being a progress summary and becomes the single page that
answers the product's own requirement, verbatim: "define exactly and
precisely what the candidate needs to do each day." Everything on this
screen exists to let someone open the app on a weeknight with ninety minutes
free and know, without thinking, what to press play on first.

What this screen is **not**:

- **Not the coverage map** (`/coverage`, the weight gap bars). That screen
  answers "which heavily weighted material have I not touched, across the
  whole plan." Today answers "what do I do in the next sitting." Mixing them
  would make Today navigable only by scrolling past a second screen's worth
  of content before reaching the one thing it exists for.
- **Not the pace chart** (`/pace`, the full field with target line, review
  hatch, missed-day ticks). Today keeps one honest sentence about ahead or
  behind, because the candidate needs that fact before they start, not the
  chart that explains how the fact arose.
- **Not the composer.** The composer remains the escape hatch for logging
  work the engine did not prescribe: a question set done from memory, an
  extra pass through flashcards, anything off-plan. Today's list is the
  engine's own queue; the composer stays reachable from the bottom bar for
  everything else.

Two existing Today fixtures are retired by this redesign, named so the
removal reads as a decision rather than a loss:

- The **split stack** (lifetime new-versus-review totals). It is historical,
  not a today-shaped fact, and belongs on `/pace` rollups where the other
  lifetime figures already live.
- The **advisory split bar** ("suggested split of hours left this week").
  It was a projection because v1 had no task list to be exact about. The
  engine now names the actual tasks, so an advisory bar sitting next to an
  exact list would read as the screen disagreeing with itself.

## The hero decision

The brief warns against the generic default: a big number, a label, a
gradient. That default answers "how am I doing," which is the coverage
map's question and the pace chart's question. It is not this screen's
question, and leading with it would waste the one slot a tired candidate
actually reads before deciding whether to open the laptop at all.

The hero here is **the next task itself**, rendered larger and fuller than
the rows behind it: its resource name, its minute figure with the honesty
treatment described below, and a timer control already in reach. The
justification is the subject matter stated in the brief: a finite evening
and a fixed exam date mean the first useful fact is never "you are 61
percent ready," it is "watch this, for about this long, starting now."
A percentage would also be the wrong screen's metric to lead with: module
readiness (the 100 percent definition) is a gated figure that can regress,
and belongs where its gates are visible (`/coverage`), not compressed into
a hero number here that invites the same misreading revision 1's reviewers
already caught once (a flattering blended score nobody can trace).

The honest ahead-or-behind sentence is not deleted, it is demoted: one line
above the list, reusing the existing sentence pattern and tokens
(`--alarm-ink` behind, `--strong` ahead) at body scale rather than the old
26px hero scale. It still answers the question it is good at answering. It
just stops pretending to be the day's instruction.

## Layout

Tasks are grouped by scheduling group (one module, or the Guidance group's
seven modules fanned into one), because that is the unit the engine chains
internally and the unit the confidence prompt belongs to. At most two or
three groups are visible on an ordinary day, which keeps the promise of "a
short, ordered list" literal rather than aspirational: the engine's own
in-flight cap already limits live groups to two, plus whatever review visit
is due.

Only the single current task (the first not-done row across all of today's
groups) shows its full control surface: timer, Start, Done. Every row behind
it shows kind, name, and estimate only, and gains its controls the moment it
becomes current. This is deliberate restraint, not a missing feature: a row
offering a timer for work the candidate has not reached yet is a control
with nothing to control.

Alignment: the kind glyph and group spine sit in a fixed 32px column so every
resource name starts at the same x position down the page, the same reasoning
behind the weight-gap bars reading in one pass: position on a shared vertical
line is the easiest thing to scan, even inside a list of cards rather than a
chart. Row padding and the gaps between groups use the existing 8/16/24 steps
of the spacing scale, never a one-off value.

Desktop (content column capped near the existing 68-character measure, pace
strip as a narrow right rail rather than a second column of content, since
there is only ever one real sentence and one real total to put there):

```
┌────────────────────────────────────────────┬──────────────────┐
│ Up now                                      │ 11 Nov            │
│                                              │ 142 days left     │
│ Fixed Income LM2                             │                   │
│ ┌──────────────────────────────────────────┐│ 12 outcomes       │
│ │ ▶ Lecture                                 ││ behind, about     │
│ │   53 min, your pace                       ││ 5 hours.          │
│ │                                            ││                   │
│ │   00:00                      ( Start )    ││ 2h 42m left today │
│ └──────────────────────────────────────────┘│                   │
│  ○ Walkthrough            28 to 35 min, est.  │ Plan adjusted:    │
│  ○ Questions, UWorld FI R2                    │ notes pre-reads   │
│    vignettes 1 to 2            84 min, est.   │ dropped this week.│
│  ◆ Confidence check         ① ② ③ ④ ⑤        │                   │
│                                              │                   │
│ Ethics Guidance                              │                   │
│  ○ Lecture, part 2 of 4                       │                   │
│    resume where you stopped                  │                   │
└────────────────────────────────────────────┴──────────────────┘
```

Mobile (390px, right rail content folds above the list, countdown keeps its
existing header position):

```
┌──────────────────────────────┐
│ 11 Nov            142 days left│
│                              │
│ 12 outcomes behind, about    │
│ 5 hours of work.             │
│ 2h 42m left today            │
│                              │
│ Fixed Income LM2              │
│ ┌──────────────────────────┐ │
│ │ ▶ Lecture                 │ │
│ │   53 min, your pace       │ │
│ │                           │ │
│ │   00:00        ( Start )  │ │
│ └──────────────────────────┘ │
│  ○ Walkthrough                │
│    28 to 35 min, estimate     │
│  ○ Questions                  │
│    UWorld FI R2, vignettes    │
│    1 to 2, 84 min, estimate   │
│  ◆ Confidence check           │
│    ① ② ③ ④ ⑤                 │
│                              │
│ Ethics Guidance                │
│  ○ Lecture, part 2 of 4        │
│    resume where you stopped   │
└──────────────────────────────┘
```

## The task row

### What each row carries

- **Kind**: lecture, walkthrough, notes, questions, review video, seminar,
  mock exam, mock debrief, or confidence check. Rendered as a small glyph in
  the fixed left column plus a text label, never glyph alone (the existing
  color rule that status needs a second channel applies here too: a glyph
  the candidate cannot name is not a second channel, it is decoration).
- **Resource name**: the provider's own unit, exactly as the engine names it
  ("Fixed Income LM2", "UWorld FI R2, vignettes 1 to 2"). Never the module's
  curriculum name alone; the candidate needs to know which file to open.
- **Minute figure**, treated per the estimated-versus-calibrated rule below.
- **Timer**, present only on the current row.
- **Completion** control, a checkbox-styled chip (2px radius, matching the
  existing input and chip token), not a second pill: the pill radius is
  reserved for the one primary action on the screen, the current row's
  Start/Resume button, which is the only pill ever visible at once.
- **Confidence prompt**, appearing as the final row of its group once the
  group's chain completes, reusing the composer's exact five-button 44px
  `role="radiogroup"` rather than a new control. This is also most of the
  argument for installing Base UI now rather than hand-rolling a second
  radiogroup (see below).

Archivo carries every string on this screen. Newsreader, reserved elsewhere
for outcome statements and reading-length prose, has no job here: a resource
name and a kind label are interface data, not curriculum prose, so the
serif never appears on Today.

### States

| State | Visual | Notes |
| --- | --- | --- |
| Pending | Kind glyph, name, estimate. No timer, no Done control. | Default for every row behind the current one. |
| Current (running or not yet started) | Raised background, `--rule-strong` border, timer, Start or Resume pill. | Exactly one per day. Becomes current the instant the row above it completes. |
| Done | Checkbox filled, name set to `--muted` with a line-through, estimate replaced by logged minutes at full `--text` contrast. | The logged figure is always a point, never a range: it is a measurement, not an estimate. |
| Requeued (system) | Left rail in `--alarm`, tag "Missed earlier this week." | Reuses the existing `--alarm` job "a missed day," not a new fifth job for the token. Produced when a frozen skipped day's work re-enters the live window. |
| Deferred (candidate) | Row removed from today's list, undo offered via `sonner` ("Moved to tomorrow. Undo"). | Distinct from Requeued: a candidate choosing "Not today" on one row is reversible and carries no alarm tint, because nothing has actually been missed yet. |
| Split, part *n* of *m* | Kind label becomes "Lecture, part 2 of 4"; body line reads "resume where you stopped." No minute figure on parts after the first. | The engine's own rule: phrasing a split as a minute range would promise precision the duration model does not have. Part 1 may show the whole module's estimate once, with its honesty treatment, since that total is real. |

### Confidence check row

Appears only as the terminal row of a group whose chain just completed.
Label: "Confidence check, {module or group name}." Five 44px buttons, numerals
visible, `aria-label` carrying the full phrase ("1, not confident" through
"5, very confident"). Selecting a value commits immediately (no separate
submit step, matching the low-friction standard the composer already set)
and the row settles to a compact "Rated 4" state with a quiet edit affordance,
never a toast: a toast is for a write that could fail elsewhere in the app,
this one cannot.

The five-step selector is visually distinct from the four-step brass
confidence ramp used on the coverage and LOS screens: this is a single
rating event, not a ramp over time, so the existing ramp token is not reused
here. What is reused, deliberately, is the row's group spine: the same
aria-hidden vertical rail `study-next-list.tsx` already draws to mark a
flagged row, repurposed here to show which rows belong to the same group and
where that group's chain ends. Same visual device, a new and compatible
meaning (continuity rather than flag status), called out explicitly because
the honesty rule applies to reused marks as much as new ones.

## Estimated versus calibrated minutes

This is the brief's central rule made visible, and it is the one place on
this screen where restraint is spent on a genuinely new visual decision
rather than reused chrome.

**Estimated** (no `actualMinutes` history yet for this resource kind and
provider): the range form, joined with "to" rather than a dash, set in
`--muted`, regular weight, with the word "estimate" always present as a
second channel, not just a lighter color. Example: "28 to 35 min, estimate."

**Calibrated** (the candidate's own logged pace has adjusted this kind):
a single number, set in `--text`, 600 weight, with "your pace" as its
label. Example: "53 min, your pace."

Both use `font-variant-numeric: tabular-nums`, matching the project's own
rule for counts compared across rows (a list of tasks is table-like even
though it renders as cards), which is also why the Today hero sentence
elsewhere in this app deliberately does not use tabular figures: a sentence
and a scannable list are different kinds of text and the existing type
system already says so.

The same rule applies one level up. "2h 42m left today" sums every pending
task for the day. If any one of them is still an estimate, the total carries
the same muted, labelled-estimate treatment as a single uncalibrated row,
because a sum of one measured and four guessed numbers is itself a guess.
Only once every pending task for the day is calibrated does the total switch
to the full-contrast point figure. A logged, completed task always
contributes its measured minutes to a separate "logged so far" figure, never
to the remaining total, so finishing a task never silently shrinks what is
left to do.

## Motion

Five moments earn a place. Each is named with its purpose, duration, and
curve from the tokens the frontend spec already defines; none introduce a
new number.

| # | Moment | Purpose | Treatment |
| --- | --- | --- | --- |
| 1 | A task is marked done | State indication | Checkbox fill and name color/line-through on `--dur-tap` (120ms) `ease`, color and opacity only. Not a move, so `ease` rather than `ease-out`, per the standing rule that hover and color changes use plain ease. |
| 2 | The row behind the completed one becomes current | Preventing a jarring change | Reuses the exact pattern `study-next-list.tsx` already ships: `AnimatePresence mode="popLayout"`, `layout`, 200ms. One number for one kind of motion across the app, not a second value invented for a visually identical case. |
| 3 | The confidence row reveals after a group's last task completes | State indication, and the one rare, slightly heavier beat on this screen | Height and opacity expand on `--dur-sheet` (300ms) `--ease-enter`. Rare enough (once per group, a handful of times across a plan) to earn the full sheet-weight token rather than the tap-weight one. |
| 4 | The minutes-override popover opens | Spatial consistency | Scale and opacity from the trigger, `--dur-move` (200ms) `--ease-enter`, `transform-origin` anchored to the timer's edit control, not centered. |
| 5 | Start, Done, and Skip are pressed | Feedback | `transform: scale(0.97)` on `--dur-tap` (120ms) `ease-out`, gated behind `@media (hover: hover) and (pointer: fine)` for any paired hover state. Universal button hygiene, not a bespoke moment, kept in the count because the brief asked for an honest tally. |

Rejected, by name, because the audit's own finding (one file in the whole
app imports `motion`) is a sign of a right-sized app, not an under-built one,
and this screen should not be the one that reverses that:

- **The timer's elapsed-time display.** Rejected on frequency (it changes
  every second for the task's whole duration) and on function: this is
  exam-prep time the candidate is reading to manage a real evening, and
  Apple's own rule that constant motion needs a purpose like a progress bar
  does not rescue a bare incrementing counter.
- **The ahead-or-behind sentence updating.** Rejected on frequency, this
  renders on effectively every page load, and on tone: animating a swing
  between behind and ahead performs anxiety the brief explicitly asks this
  screen not to manufacture.
- **A count-up on "2h 42m left today."** Rejected outright under the "it
  looks cool" test the skill names as disqualifying on its own; a tired
  candidate needs that number the instant the page paints, not after a
  flourish.
- **The degradation and material-gap banners entering.** Rejected: both
  render with the page load rather than in response to anything the
  candidate just did, so there is no origin to animate from, matching the
  existing rule that charts do not animate on refetch.
- **The split-part label ("part 2 of 4") updating.** Rejected: it is a fact
  the candidate checks against their own memory of where they stopped, not
  a moment to celebrate.
- **Hover highlight on pending rows.** Not a rejected idea so much as a
  non-moment: a plain `background-color` tint under the existing
  `(hover: hover)` gate, not large enough to deserve a row in the table above.
- **A page-level entrance for the whole list on load.** Rejected on
  frequency alone: this is very likely the single most-visited route in the
  app (it is the thing the bottom bar's non-composer items lead back to),
  and the one authored once-per-install entrance this app already reserves
  for the massif is explicitly not available for a screen seen daily.

Reduced motion: row reflow (moment 2) drops to an opacity-only cross-fade
with no layout movement; the confidence reveal (moment 3) keeps its opacity
change and drops the height animation, appearing at final height instantly;
the popover (moment 4) drops scale and keeps a 150ms opacity fade; press
feedback (moment 5) is dropped entirely, since a completed action is already
confirmed by the state change itself.

## Empty and edge states

**A day with nothing scheduled.** Three different reasons need three
different sentences, not one blank state: a rest day by the weekly
template ("Nothing scheduled today. Your next task is tomorrow."), a
holiday on record ("No study today. {holiday label} holiday."), and
genuinely ahead of the plan with slack remaining ("You're ahead. Nothing
scheduled today, and that's the plan working."). Exam day and the day after
keep the existing dedicated states unchanged.

**Three days behind.** The frozen days' undone work re-enters at the head
of the live window, as Requeued rows, each tagged "Missed earlier this
week." They are not hidden and not dumped as forty rows: the engine's own
in-flight cap still governs how much is live at once, so a bad week produces
a longer list for a few days, never an unbounded one. If the backlog still
runs past a comfortable scroll (see worst-case data below), group the
Requeued rows under one collapsed header, "{n} tasks moved from earlier this
week," expandable on tap, rather than letting them crowd out today's own
plan.

**The 378-minute Ethics Guidance lecture, split across days.** Day one shows
the full module estimate once, with its honesty treatment ("about 378 min
across 4 sittings, estimate"), and a note that it will split. Day two through
four show only "Lecture, part 2 of 4" (then 3, then 4) with "resume where
you stopped," no minute figure. Only the final part fans out to the
fourteen outcome-level log entries the engine's own spec defines; marking
an earlier part done advances the chain without claiming the module is
covered.

**A plan with no catalogue.** Modules with nothing behind them still appear,
scheduled on the weight-derived estimate the engine computes without any
provider data. The resource name becomes a plain curriculum label ("Fixed
Income LM2, practice") rather than a provider's own title, carrying a quiet
tag, "No material linked," and a link into `/plan` to add a package. The
governing rule from the engine spec, that the plan is derived from the exam
and never cancelled by an empty catalogue, is what makes this state a normal
row rather than an error screen.

## Worst-case data

Applying `break-ui`'s thinking without building its toggle: the realistic
worst values for every field this row renders, and what they would do to the
layout above.

| Field | Worst-case value | What breaks | Fix |
| --- | --- | --- | --- |
| Resource name | "FSA Integration of Financial Statement Analysis Techniques" (a real module name from the engine's own crosswalk) | Wraps to three lines at 320px, pushing the estimate line down and misaligning the fixed-column glyph against a now-taller row | `min-width: 0` on the text column, allow two-line wrap, bottom-align the glyph to the first line rather than centering it against the full row height |
| Resource name, compound | "Questions, UWorld FI R2, vignettes 1 to 2" at 320px with the vignette range also long (e.g. "vignettes 1 to 6") | The comma-joined line runs long enough to crowd the estimate underneath it | Keep kind and vignette range as the single line that wraps; never truncate the vignette numbers, since the brief's own rule is to never truncate anything the user compares |
| Group name | "Evaluating Quality of Financial Reports" as a group header at 320px, zoomed to 200% | Header can collide with the spine column at extreme zoom | Group header spans full width above the spine column, not inline with it |
| Minute figure | A 6-hour day: a mock (264 min) plus its debrief (180 min) scheduled on consecutive days, 444 minutes combined | "Today's total" reads as a very large figure that looks alarming next to a typical 90 to 150 minute day | No special-case the number; the honest total is the point, and the mock's own fixed-block framing ("unsplittable, your longest block") already explains why it is large |
| Task count | Zero tasks (see empty states above) | A blank list reads as a broken page if no empty-state copy renders | Always render one of the three named empty sentences, never an unlabelled blank area |
| Task count | A 40-task backlog from a long lapse | Rendering all forty defeats "a short, ordered list" and is a real scroll-performance cost on a mid-range Android, the same hardware bar the rest of the app holds itself to | Collapse Requeued rows behind the "{n} tasks moved" header above; never let backlog volume expand today's own live window past the engine's existing in-flight cap |
| Confidence check module name | A non-Latin note added by the candidate on an earlier log entry, later surfaced in a group's context | The project has no non-Latin resource names (both providers publish in English), but a candidate's own free-text note could contain any script | Notes are not rendered inline on this screen; they stay in the log and `/logs` detail, so this row is never a vector for the problem |
| Split part count | A split task that runs to "part 1 of 9" on an unusually long recording | "part 1 of 9, resume where you stopped" is already as long as "part 1 of 4"; nothing special breaks, this row is naturally robust to the count | None needed, noted as a case that held up |

## Accessibility

**Keyboard path.** Tab order runs top to bottom: the date and pace strip are
not interactive and are skipped; then each group header (not focusable, a
heading); then, within a row, the timer's Start or Resume button, the Done
control, and last the Skip or "Not today" affordance, in that order, so the
most common action is reached first. The confidence row's five buttons form
one `role="radiogroup"` stop with roving tabindex: Tab enters and leaves the
group once, arrow keys move the selection inside it, matching the composer's
existing confidence control exactly rather than inventing a second keyboard
pattern for the same idea.

**Focus when a sheet or popover opens.** The minutes-override control is a
popover anchored to the timer, not a full sheet: focus moves to its numeric
input on open, Escape closes it and returns focus to the timer's edit
control that opened it, the same contract the composer's existing dialog
already honors for its own focus trap.

**Reduced motion.** Covered per moment above; nothing on this screen loses
information in reduced motion, which is the existing project's own test for
whether a given animation carried meaning in the first place.

**Contrast of new token uses.** Every color used here is an existing token
in an existing legal use: `--muted` and `--text` for the estimate treatment
are both already measured against `--raised` (5.62 to 6.35 and above 12.5
respectively, against a 4.5 floor), and the Requeued row's `--alarm` rail is
the same token already measured at 3.09 to 5.72 against the 3.0 floor for a
shape, not text. No new token and no new combination needs a fresh
measurement. The one genuinely new surface, the current-row border in
`--rule-strong`, already clears the 3.0 floor measured for axes and borders
that carry meaning, which this one does: it is the only border on the
screen distinguishing "do this now" from "do this later."

**Forced colors.** The current-row border and the Requeued rail both need an
entry in the existing `@media (forced-colors: active)` block that already
maps the app's five other data surfaces, since both are meaning-carrying
borders rather than decoration.

## Copy deck

| Context | Copy |
| --- | --- |
| Pace strip, behind | "You are {n} {outcome word} behind, about {h} hours of work." |
| Pace strip, ahead | "You are {n} {outcome word} ahead." |
| Pace strip, exact | "You are exactly on pace." |
| Workload line, estimate | "{h}m to {h2}m left today, estimate" (shown only when any pending task is still uncalibrated) |
| Workload line, calibrated | "{h}m left today" |
| Workload line, partial progress | "Logged {h}m so far, {h2}m left today" |
| Group header | The module or group name exactly as the curriculum names it |
| Kind labels | "Lecture", "Walkthrough", "Notes", "Questions", "Review video", "Seminar", "Mock exam", "Mock debrief", "Confidence check" |
| Estimate, pending | "{min} min, estimate" or "{lo} to {hi} min, estimate" |
| Estimate, calibrated | "{min} min, your pace" |
| Split, part 1 | "about {min} min across {n} sittings, estimate" |
| Split, part 2 and later | "part {k} of {n}, resume where you stopped" |
| Seminar inserted | "Added because confidence was below 3" or "Added because accuracy was below 60 percent" |
| Stale walkthrough tag | "Older recording" |
| Requeued tag | "Missed earlier this week" |
| Requeued backlog header | "{n} tasks moved from earlier this week" |
| Deferred undo toast | "Moved to tomorrow. Undo." |
| Degradation banner | "Plan adjusted: {dropped item} dropped to fit this week." |
| Material gap tag | "No material linked" |
| Material gap action | "Add a package in Plan" |
| Empty, rest day | "Nothing scheduled today. Your next task is tomorrow." |
| Empty, holiday | "No study today. {holiday label} holiday." |
| Empty, ahead with slack | "You're ahead. Nothing scheduled today, and that's the plan working." |
| Confidence prompt label | "Confidence check, {group name}" |
| Confidence button labels | "1, not confident" through "5, very confident" |
| Confidence, after rating | "Rated {n}" with an edit affordance |
| Timer, idle | "Start" |
| Timer, running | "Pause" |
| Timer, paused | "Resume" |
| Timer, manual override | "Log minutes instead" |
| Timer override input | "Minutes spent" |
| Done control | aria-label "Mark {resource} done" |
| Skip control | "Not today" |

Every action keeps its name through the flow: "Start" becomes "Pause" and
"Resume," never a different verb; "Not today" stays "Not today" in the undo
toast's action, never relabelled "Undo" alone without saying what is being
undone.

## Base UI recommendation

Install it. The audit already found three files hand-rolling what Base UI
was chosen to provide (a sheet, a dialog, a popover, a radiogroup), and this
screen adds a second, independent consumer of the radiogroup (the confidence
check row, next to the composer's own confidence control) and a first
consumer of a non-modal popover (the minutes override), which the project
has not needed before now. Two independently hand-built implementations of
the same accessible pattern, roving tabindex and all, is exactly the kind of
invisible detail debt that stays invisible until one of the two drifts: a
keyboard behavior fixed in the composer's version and never ported to this
screen's version is a real, quiet accessibility regression waiting to
happen. Base UI is headless and unstyled, so it costs nothing against the
CSS Modules and token system already in place, and adopting it now, while
there are only two consumers to migrate rather than four, is the cheaper
moment to pay that cost.

## What is left to the builder

- The exact glyph for each task kind, extending the existing icon set
  (`icons.tsx` currently carries `FlagConfidence`, `FlagStale`, `Untouched`)
  rather than inventing a parallel one.
- Migrating the composer's hand-rolled radiogroup and dialog onto Base UI
  alongside this screen's new consumers, in one pass rather than two.
- The exact threshold (row count or viewport height) at which the Requeued
  backlog collapses behind its header.
- Whether "Not today" needs a stronger confirmation than an undo toast for a
  task that is itself the day's only current row (deferring the one thing
  scheduled today is a bigger decision than deferring one of three).
- Wiring `PlanTask.actualMinutes` and the timer's running state, which the
  engine spec already names as the one hard schema prerequisite this feature
  needs and does not yet have.
- Test coverage for the estimated-versus-calibrated boundary specifically:
  a day that mixes both kinds of task is the state most likely to be
  skipped in manual testing and most load-bearing for the brief's central
  claim.

## Related

- [Daily prescription engine design](2026-11-10-daily-prescription-design.md): the engine this screen renders, including the scheduling unit, the split-part rule, and the estimated-versus-calibrated principle this document makes visible.
- [CFA Study Tracker frontend design](2026-11-07-cfa-frontend-design.md): the token system, the honesty test for visualization, and the Today wireframe this document supersedes.
- [CFA Study Tracker design](2026-11-04-cfa-study-tracker-design.md): the product spec both frontend documents serve.
