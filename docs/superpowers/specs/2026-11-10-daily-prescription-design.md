---
title: Daily prescription engine design
type: spec
module: root
updated: 2026-11-10
status: draft
---

## Purpose

Turn the study tracker from a coverage recorder into a planner that states, for
each day, the exact work to do: which Mark Meldrum lecture to watch, which notes
pages to read, which UWorld vignettes to answer, when to sit a mock. The
candidate's requirement, verbatim: "the application should define exactly and
precisely what candidate needs to do each day".

Today the pace engine reasons in abstract outcome-per-hour units. It can say
"you are 4 outcomes behind". It cannot say "watch Fixed Income LM2, 53 minutes,
then UWorld FI R2 vignettes 1 and 2". The gap between those two sentences is
this document.

Level II 2027 curriculum is already seeded (10 topics, 51 modules, 382
outcomes, version `2027`). This design covers what is built on top of it.

## Goals

- A per-day task list naming real resources with real minute estimates, stable
  within a day, regenerated as reality changes.
- Allocate study minutes by exam weight, not by how much material a provider
  happens to ship on a topic.
- Sequence the 51 modules respecting genuine prerequisites and the curriculum's
  own effort-versus-return ranking.
- Bring material back for review on a schedule, with the review content chosen
  from what the candidate actually got wrong.
- Say honestly when the remaining time cannot cover the remaining work, and
  name exactly what was dropped to fit.
- State the plan's own totals up front (hours, questions, vignettes, mocks) and
  define a reachable 100 percent, so the candidate has a finish line rather
  than a drifting percentage.
- Shift deliberately from learning to practice as the exam approaches, against
  declared per-phase targets rather than as a side effect.
- Learn the candidate's real pace from logged minutes, so estimates converge on
  truth instead of staying at their seeded guess.

## Non-goals

- No question content stored, displayed, or generated. The app stores counts,
  vignette ranges, and a link to the candidate's own file. It never shows a
  question. This preserves the v1 anti-goal unchanged.
- No scraping of any provider's website, and no provider credentials.
- No per-day editing of availability. The candidate edits the weekly template
  and holiday ranges, exactly as today; the engine owns which tasks land on
  which day.
- No attempt to model forgetting as a curve. Review intervals are a fixed
  ladder of integers with a one-step modifier, not SM-2 and not a per-outcome
  decay function.
- No second copy of the outcome text. Meldrum's inventory carries 340 outcome
  statements from the 2026 edition, 8 visibly truncated. They are discarded at
  extraction: the seeded 2027 set is authoritative and complete, and the
  module-level crosswalk makes the provider's copy redundant.

## Anti-goals

- Never commit provider catalogue data. Provider names and edition years are
  published facts and may be committed. Folder structures, file names, Drive
  file ids, file sizes, notes page ranges, and per-reading question analytics
  are not: they exist only because a private view-only share was enumerated,
  and the per-reading counts are a derived index of licensed material.
- Never serve a third party's Drive link to any user other than its owner. A
  Drive file id is a capability, and the existing preset mechanism
  (`userId: null`) is returned to everyone.
- Never let the material in hand define the plan. The plan comes from the exam;
  a shortfall in what the candidate owns is reported as something to acquire,
  never absorbed by dropping a module, lowering a readiness bar, or shifting its
  exam weight elsewhere. Material can be bought; exam weight cannot be
  negotiated.
- Never present an estimated minute count as a measured one.

## What this reverses in the v1 spec

Four documented non-goals and one documented design decision are overridden by
this requirement. Recording them because reversing a decision quietly is worse
than reversing it.

1. "No spaced repetition, no scheduled re-review date." Now: a fixed three-rung
   interval ladder with real due dates. Defended as thresholds rather than
   curve-fitting, but it is a reversal.
2. "Package tracking is a label the user attaches to a manual log entry,
   nothing more." Now: packages carry a resource catalogue. This is the largest
   reversal and the entire basis of the feature.
3. "No per-day calendar editing." The candidate still cannot edit one day's
   hours, so the intent survives, but per-day task objects now exist.
4. "Mock exams never feed the pace engine." Now: a mock's per-topic scores
   reorder review priority. Target and actual pace figures stay untouched, so
   the pace maths is unaffected; only ordering changes.
5. `MockExam` deliberately had no section breakdown. It now needs an optional
   per-topic score field.

The v1 anti-goals are all preserved. Nothing here commits curriculum text,
stores question content, or touches a provider account.

## Constraints

- Single user. The candidate's answer was explicit: this app is for them alone.
  The provider catalogue is therefore owner-scoped data, which is what makes
  the Drive-link question tractable.
- Level II 2027 is the canonical curriculum. Provider editions are Meldrum 2026
  and UWorld 2025, so edition skew is permanent and must be modelled, not
  normalised away.
- The existing seed pipeline's discipline holds: one file per concern in
  gitignored `prisma/seed-data/`, a validator that refuses a bad file, natural
  key upserts so a reseed updates in place, and the four production gotchas
  recorded in the seeding runbook.
- The runtime image has no `tsx`. Every script must run under plain `node` with
  Node 22's type stripping, and must derive its own directory from
  `import.meta.url`.

## The data, and what it does not contain

Established by direct verification of all three source documents, not by
trusting their summaries.

Curriculum (2027): 10 topics, 51 modules, 382 outcomes. Body, summary table,
and module index agree exactly. Every outcome opens with a known command verb;
no truncation. Already seeded and validated.

Meldrum 2026: 45 learning modules, 144 videos, 14 documents, 37.83 GB. The file
inventory reconciles in three parts that must all be read: 139 typed rows in
the per-module tables, 3 topic-level seminars that appear only in the seminar
index, and 2 orientation videos in the front matter. Reading only the module
tables silently loses 5 files. Notes page ranges exist for 44 of 45 modules.

UWorld 2025: 43 readings, 199 vignettes, 1064 questions, 86 files. Per-reading
counts sum exactly to the document's stated totals. Only Quant is tagged at
outcome level, covering 120 of 1064 questions.

**The critical absence: Meldrum video durations do not exist in the source.**
Drive does not return them. Only file sizes are available. This single gap
drives the whole effort model below.

## Effort model

### Why file size cannot be used

File size was tested three ways and fails all three.

Within-type dispersion is severe: coefficient of variation 0.63 for lectures,
0.65 for end-of-chapter walkthroughs, 0.84 for reviews, with a 24-fold spread
between the smallest and largest lecture. Pinning any one internally consistent
set of plausible durations to the anchor files implies a constant somewhere
between 2.2 and 7.6 MB per minute, a 3.5-fold spread inside one course. Per
topic constants do not rescue it: mean lecture size runs from 231 MB (Quant) to
940 MB (Economics), and the spread *within* Quant is still nearly tenfold.

The subtle version also fails. A module's lecture and its walkthrough are one
recording session, so encoder settings should cancel in their ratio. The ratio
has a coefficient of variation of 1.35, worse than absolute size. Nothing
derived from file size gets below roughly 0.55, at which point a task estimated
at 60 minutes routinely takes 30 or 95. That breaks the one promise the feature
makes.

**Decision: file size is stored as download size only and plays no part in any
effort estimate.**

### What replaces it

Meldrum's 646 measured notes pages across 45 modules. Switching the lecture
estimator from size to notes pages replaces 45 unknown encoder bitrates with
one unknown human reading-and-watching pace. The argument is not that pages are
more accurate on day one; it is that a single pace parameter is *calibratable*
from the candidate's own logs and 45 bitrates are not.

UWorld needs no such substitute. Words per question has a coefficient of
variation of 0.08 across all 43 readings, an order of magnitude tighter than
anything on the Meldrum side, so question effort can be genuinely precise.

### The split that should shape the interface

Prescription is exact; duration is estimated. The inventory supports a perfectly
precise instruction ("watch Meldrum FI LM2, then UWorld FI R2 vignettes 1 to
2") with no uncertainty whatsoever. Minutes are a scheduling input carrying
error bars. The precision the requirement asks for is precision of
*instruction*, and promising precise minutes on day one would be false
precision. An uncalibrated estimate shows as a range labelled as an estimate; a
calibrated one shows as a point labelled as the candidate's own pace.

### Formulas

| Resource kind | Estimate |
|---|---|
| Lecture video | `max(15, PAGE_RATE × notesPages)`, split above 90 minutes |
| End-of-chapter walkthrough | `max(10, EOCQ_MULT × lectureMinutes)` |
| Review video | `max(8, REVIEW_MULT × lectureMinutes)` |
| Seminar | flat `SEMINAR_MIN` |
| Notes reading | `NOTES_RATE × pages` |
| Question block | `Q × (Q_BASE + (Q_CALC − Q_BASE) × calcShare)` |
| Explanation review | `answerWords / WPM + IMG_MIN × exhibits + CALC_REDO × calcCount` |
| Mock exam | 264 minutes, plus a 180 minute debrief as a separate task |
| Any of the above | multiplied by the learned pace factor for its kind |

Seed constants, each labelled by provenance so a builder knows which are load
bearing guesses:

| Constant | Value | Basis |
|---|---|---|
| `PAGE_RATE` | 6.0 min/page | assumed, and the widest single driver |
| `EOCQ_MULT` | 0.55 | derived from a high-variance ratio, so weak |
| `REVIEW_MULT` | 0.25 | derived |
| `SEMINAR_MIN` | 35 min | assumed |
| `NOTES_RATE` | 2.5 min/page | assumed |
| `Q_BASE` | 2.5 min | derived against the 3.0 min exam-pace anchor |
| `Q_CALC` | 4.5 min | derived, same constraint |
| `WPM` | 140 | assumed |
| `IMG_MIN` | 0.5 min/exhibit | assumed |
| `CALC_REDO` | 1.0 min/calc question | assumed |
| `ET_LM3_MIN` | 180 min | assumed, a module with no notes pages at all |

### Calibration

Learn a multiplicative pace factor, never absolute minutes: the content
measures already carry the size variation, so what remains is "this candidate
runs 1.3 times the seed".

```
r       = clamp(actualMinutes / estimatedMinutes, 0.25, 4.0)
kObs    = EWMA(r), half-life 14 blocks
kHat(n) = (n × kObs + m × kHat(parent)) / (n + m),  m = 5
hierarchy: global -> (provider, kind) -> (provider, kind, topic)
```

Shrinkage handles the cold start, the moving average handles genuine drift as
the candidate speeds up, and the clamp guards against a forgotten timer. `m = 5`
is chosen from dispersion rather than taste: at a plausible within-kind
coefficient of variation of 0.35, five observations put the blended estimate
within roughly 8 percent, which is accurate enough to schedule a day.

This requires an actual-minutes field, which does not exist today. Without it
the model is frozen at its seed values permanently, so it is the one hard schema
prerequisite for the whole feature. It belongs on the task, not on the log: a
single task fans out to many log entries (14 for the Ethics Guidance group), so
a minute count on the log would be either duplicated 14 times or divided into
fourteenths, and calibration needs exactly one estimated-versus-actual pair per
task. Any report of minutes studied sums over tasks.

Capture is a timer on the task with a manual override, not a typed number. The
clamp above exists because a timer left running is the realistic failure, and a
typed figure would be a remembered guess calibrating a model against itself.

### Budget

| Layer | Hours |
|---|---|
| Lectures | 67.6 |
| Walkthroughs | 30.6 |
| Solving questions | 52.7 |
| Reviewing explanations | 62.5 |
| **Core subtotal** | **213.4** |
| Review video | 11.7 |
| Seminars | 12.3 |
| Notes pre-reads | 27.1 |
| Mocks (6 at 264 plus 180 minutes) | 44.4 |
| Final-stretch review | 40.5 |
| **Total, every layer on** | **349.4** |
| Total with the optional layers off | 298.3 |

So the plan is around 350 hours by default and around 300 with notes pre-reads,
review video and seminars switched off. Both sit at or above the commonly cited
300-hour guidance, and the lower figure is what the degradation ladder converges
on under time pressure, which is the right relationship between the two. The
credible band around these is wide, 245 to 401 hours, which is itself the
argument for calibrating early.

Plan-wide the split is **149 hours of learning to 200 hours of practice, 43 to
57**. Worth stating because v1 aimed at a 1:2 or 1:3 content-to-practice ratio,
and that is not reachable on a first pass: Meldrum's lecture volume alone is
67.6 hours. The ratio is a reported outcome, not an enforced input.

One finding changes prioritisation independently of everything else: core hours
are misallocated against exam weight. Equities runs at 1.37 times its weight
share and Quant at 1.25, while Ethics sits at 0.72 and Economics at 0.75.
Working through the material in inventory order systematically over-studies
Equities. **The planner must treat an exam-weight-derived budget as the target
and the inventory as what fills it, never the reverse.**

## Data model

Four new tables and one additive column, hanging off the existing
`StudyPackage` rather than a parallel provider entity, because `StudyPackage` is
already referenced by the log, mock, and plan-package tables.

- `PackageEdition`: one provider offering for one level and one curriculum year.
  Separate from the package because the provider label is what a log entry
  carries and must survive a yearly refresh, while the edition is what goes
  stale. Carries `ownerUserId`, which is the mechanism that keeps Drive links
  private.
- `PackageUnit`: the provider's own chunk of content, one Meldrum module or one
  UWorld reading. Keyed by a deterministic `ref` string such as `qm/lm2`.
- `PackageResource`: one addressable asset, polymorphic by `kind` over a shared
  finite fact set (size, duration, page range, word count, question count,
  vignette count, calculation count, exhibit count). `durationSeconds` starts
  null and is the slot a measurement or calibration fills.
- `PackageUnitReading`: the crosswalk, many-to-many.
- `PackageUnitLos`: optional outcome-level refinement, keyed on the provider's
  own outcome string rather than on an id, so a retired statement keeps its
  identity.
- `StudyPackage.slug`, nullable and unique, as the natural key a reseed needs.

A deterministic `ref` is used instead of a composite natural key because two
real cases break the obvious keys: all seven Quant modules share one notes PDF,
so a Drive file id is not unique per resource, and a composite key containing a
nullable column enforces nothing in Postgres, which treats nulls as distinct.

Rejected: separate tables per resource type (every scheduler query becomes a
union, and a third provider adds tables rather than rows). Rejected: a JSON
facts column (the scheduler filters and sums on these fields constantly).
Rejected emphatically: JSON on `StudyPackage` (roughly 190 resources and 100
crosswalk edges per package, needing joins to readings, outcomes, and logged
progress; and a reseed would rewrite the blob, destroying any locally measured
duration).

Additions the scheduler needs:

- `PlanTask`, carrying `actualMinutes` and the timer state, plus the persisted
  `estimatedMinutes` as generated, so a later recalibration cannot retroactively
  rewrite frozen history.
- `ReviewVisit`, persisted separately because visits outlive the task horizon,
  and keyed on the **scheduling group**, not the module. Keying it per module
  would give the Ethics Guidance group seven independent ladders whose first
  visit is the same video seven times. The confidence modifier therefore reads
  the weight-weighted mean confidence across the group's modules.
- `VignetteResult`: one row per vignette attempted, recording the unit, the
  vignette number, questions answered and correct, and the date. Without it the
  headline review mechanic ("redo only what you got wrong") cannot be built:
  counts alone cannot name which vignettes to redo, and the 63-minute review
  visit becomes an arbitrary selection of the right size. Storing a vignette
  number is not storing question content, so the v1 anti-goal is untouched.
- `MockExam.topicScores`, optional.
- Prior work declared at setup is stored as frozen `PlanTask` rows marked done,
  dated when the candidate says it happened, with `actualMinutes` null so it
  never pollutes calibration. Synthesising tasks rather than adding a separate
  "already done" table means the queue, the in-flight cap, and the review ladder
  all read one representation of completion instead of two.
- Prerequisite, band and priority fields on `Reading`, as seeded curriculum
  facts rather than code.
- `StudyPlan.orderingStrategy`, one of `curriculum`, `weight`, `confidence`,
  defaulting to `curriculum`. Chosen at setup, changeable afterwards, and a
  change regenerates the unfrozen window only.
- `StudyPlan.targetHours`, `targetQuestions`, `targetMocks`, and
  `targetMode` (`strict` or `approx`, defaulting to `approx`). Pre-filled at
  setup from the engine's own computed figures. Stored so the contract can be
  tracked against, and so a later change is visible as a change rather than a
  silently different plan.
- `PlanPreferences` for the notes pre-read toggle and seminar policy.
- A persisted degradation state on the plan: the active rung, with hysteresis.
  Recomputing it from the live ratio each night would make dropped content
  reappear and vanish as the ratio drifts across the threshold, which destroys
  the stability the whole persistence model exists to provide. Re-expansion is
  explicit: the rung only unwinds when the ratio has sat below the threshold for
  seven consecutive days, and the candidate is told.

## Crosswalk

Seeded, reviewed once by a human, never derived by name matching at load time.
Name matching fails on exactly the drift present here: "Corporate Finance"
against "Corporate Issuers", "Price and EV Multiples" against "Price and
Enterprise Value Multiples", and Meldrum's "Evaluation Quality of Financial
Reports" against the curriculum's "Evaluating Quality". A near-miss matcher is
worse than none, because it is silently wrong.

Binding targets readings, with outcomes as an optional overlay where a provider
tags them. Resolution is by topic and reading order, then verified against the
stored name, which catches a reseed that renumbered the curriculum.

Absence is declared, never inferred. Each crosswalk file carries both a `map`
and an `uncovered` list, and the validator asserts the two together account for
exactly 51 readings, each exactly once. This is what makes a mapping bug
impossible to confuse with a genuine content gap.

The real numbers:

- Meldrum: 45 units covering all 51 readings. Ethics module 1 maps to LM1, LM2
  fans out to modules 2 through 8, LM3 maps to module 9. Nothing uncovered.
- UWorld: 43 units covering 49 readings. **Two** gaps, not one: FSA Integration
  of Financial Statement Analysis Techniques, and Ethics module 1, which has no
  dedicated unit.

One transcription correction that will misbehave if missed: Meldrum's Ethics LM1
folder physically holds LM2's review and walkthrough files. Those rows must
attribute to the Guidance group, not to LM1, or the engine will schedule LM1 and
play LM2.

## The scheduler

### Scheduling unit

One `PlanTask` row per discrete piece of work on one day, pointing at one
resource and at the curriculum modules it covers (plural, because of Ethics).
Done means supplying what the existing log already wants: confidence 1 to 5,
questions answered and correct, actual minutes, optional note.

Completion fans out to outcome-level log entries. Tasks are module-level
because that is the granularity providers ship; the log stays outcome-level
because that is what every existing coverage and pace computation reads.
Questions are attributed to the outcome they target where known, otherwise
divided evenly with the remainder to the lowest order, so module totals are
conserved exactly.

Persistence is hybrid with a 14-day horizon: materialised for today plus 14
days, a module-level projection computed on demand beyond that, and frozen
history behind. Not fully on demand, because a day's prescription must be
stable: opening the app at 09:00 and at 20:00 must not reshuffle the list. Not
fully pre-generated, because an eight-month plan is around 1500 tasks and every
availability edit invalidates the tail.

The existing nightly cron is extended rather than joined by a second
scheduler: freeze yesterday, roll the horizon forward one day, regenerate the
unfrozen window if the backlog changed, reusing the existing run counters.

Falling three days behind leaves those days frozen as skipped, which is the
honest record and which the existing missed-day reporting already surfaces. The
undone work re-queues at the head of the live window and the overflow pushes the
finish date out, which feeds feasibility. An availability or holiday change
regenerates the unfrozen window immediately rather than on the next tick,
because the candidate changed it to see the consequence now. A task already
carrying a log entry is never destroyed, even in the future: the candidate
worked ahead, and that is data.

### Module ordering

Module weight is the sum of its outcomes' weight shares, reusing the formula
already in the progress route so there is one source of truth and Ethics' nine
modules need no special case.

Prerequisites are seeded data, not code, because they are curriculum facts that
change with each yearly outline. The real edges: regression before time series
and machine learning; term structure before arbitrage-free valuation before
bonds with embedded options; dividend valuation before free cash flow and
residual income; cost of capital before free cash flow valuation; the five FSA
modules before FSA Integration; the Code before the Guidance modules before
Application.

A greedy priority scheduler walks the resulting graph, choosing among ready
groups by a strict lexicographic key whose terms are: phase band from the
curriculum's own suggested order, topic cohesion, module order, the
effort-versus-return rank, return per hour, and module id as a deterministic
last resort so identical inputs always give an identical sequence and the tests
are stable.

**Which term leads is set by the plan's study-order strategy** (see Decisions
taken below), not fixed in code. Under the default curriculum strategy the band
leads, which makes weight a late tie-break; under the weight-first strategy
module weight leads. The prerequisite graph, the weight-capped budget, and the
remaining terms are identical in every strategy.

The return-per-hour term needs one guard. FSA Integration has no UWorld
questions, so its estimated minutes are far below what its weight implies, and
an unguarded ratio would rank it absurdly high. Dividing by
`max(estimatedMinutes, weightImpliedMinutes)` means a module cannot win on
cheapness caused by a missing asset.

### Within a module

Notes pre-read, then lecture, then walkthrough where one exists, then UWorld
questions in vignette-boundary blocks, then a confidence checkpoint.

Question mode comes from the reading's own data: a calculation share at or above
0.35 means a timed drill, otherwise untimed review with notes open. Explanation
review is separately budgeted either way, which is why a 32-question reading
costs several hours and always spans days.

Two deliberate deviations from the providers' own advice, both flagged as such:

- **The review video is not scheduled straight after the lecture**, which is
  what Meldrum's folder guide suggests. Watching a recap twenty minutes after
  the lecture is massed practice. The review video becomes the content of the
  first spaced visit instead, which is a strictly better use of the identical
  asset.
- **Seminars are never scheduled on the first pass.** They fire on evidence,
  using the thresholds the existing flag classifier already uses: module
  confidence at or below 2, or question accuracy below 60 percent with at least
  8 questions answered. The inserted task records why it appeared, so the
  interface can explain a 31-minute video that was not there yesterday.

The 2024 UWorld set is never auto-scheduled. Its unique material is largely
private equity, pensions, and trade execution, and private equity valuation is
explicitly off the 2027 blueprint. Prescribing off-syllabus work would be a
direct failure of the requirement. It is offered as an opt-in suggestion on the
one module where the overlap is genuine, FSA Employee Compensation, for
pensions.

### Review

A fixed ladder at 7, 21, and 56 days after first-pass completion, plus a
mandatory final-stretch visit. One modifier, not a curve: confidence 1 or 2
halves the next interval and inserts a seminar, 3 leaves it, 4 or 5 doubles it.

Visit content, first applicable winning: the review video, else a notes reread;
then redo only the vignettes answered wrong, which turns a 224-minute reading
into a 63-minute visit; then, once accuracy is at or above 80 percent and
confidence at or above 4, a five-minute formula-sheet pass, which is exactly
what Meldrum's formula sheet organised by topic and module supports.

Review competes for minutes through a weekly reserve rather than a merged
queue. The reserve ramps from 20 percent to 50 percent across the plan, then
takes everything in the final stretch: early there is nothing to review, late
there is nothing new. Unspent reserve returns to new coverage the same day.
Overdue visits go to the front ordered by confidence then due date, which is the
existing study-next ordering generalised, so that function is reused rather than
duplicated.

Ethics is the general rule with one parameter changed, not a special case: a
7, 14, 28, 42 ladder, so it is touched every two to four weeks for the whole
plan, funded by a flat 20 minutes per study day from the plan midpoint. Its 96
questions have zero calculations, so they are always untimed review: three
questions a day for months, which is precisely what a 20-minute block supports.

What the track funds depends on the strategy. Under the default curriculum
order, Ethics' first pass falls in the final third, so the track funds that
first pass and then the review that follows it, and the track therefore starts
at the plan midpoint rather than later. Under weight-first the first pass is
already done by the midpoint and the track is review only.

### Phases: learning gives way to practice

The shift from learning to question solving must be a declared target, not an
accident. Three mechanisms in this design each push that way on their own (the
review reserve ramp, the cutoff on new coverage, the mock cadence), and together
they do produce the right shape, but a shape nobody specified cannot be
explained to the candidate or tested. So the allocator gets explicit per-phase
targets and those three mechanisms serve them.

| Phase | Span | Learning to practice | What dominates |
|---|---|---|---|
| Build | start to 55% of the plan | 60 / 40 | first pass: notes, lectures, walkthroughs, each module's own questions |
| Consolidate | 55% to 6 weeks out | 30 / 70 | first pass finishing, review ladder at full weight, mocks every 14 days |
| Sharpen | final 6 weeks | 5 / 95 | no new coverage, weekly mocks, missed-vignette redos, formula passes |

The targets are ratios over a week's minutes, checked against the week's actual
allocation and reported. They are deliberately loose: a week holding one
378-minute Ethics lecture cannot hit 60/40, and forcing it would split a lecture
for arithmetic's sake. The allocator treats a target as a pull on which group
enters next, never as a hard constraint on a single day.

The phase boundaries are proportional rather than fixed dates, so a 12-week
crash plan and a 40-week plan both get all three phases. Only the Sharpen phase
is pinned to the exam, because its content (mocks and redos) is exam-relative.

### What 100 percent means

Coverage alone is a bad finish line: every outcome can be marked covered while
the candidate has answered nothing. So readiness is a gate per module, and the
headline number is the exam-weight-weighted share of modules through it.

A module is **exam-ready** when all of:

1. Its activity chain is complete.
2. Every vignette in its allocation has been attempted at least once.
3. Accuracy on the most recent pass is at or above 70 percent.
4. Confidence is at or above 4.
5. It was last touched inside the staleness window.

Overall readiness is therefore a real 0 to 100 percent figure that moves with
work, weights by what the exam actually tests, and can **regress**: a module
left alone long enough fails criterion 5 and drops out, which is the honest
behaviour and the whole reason the review ladder exists.

The 70 percent bar sits above the historical minimum passing standard and
aligns with the thresholds already in this design: below 60 percent triggers a
seminar, 70 is ready, 80 and above earns the formula-sheet-only review path.

**A module with no questions stays unready, and the gap is reported as
something to buy.** FSA Integration of Financial Statement Analysis Techniques
and Ethics module 1 have no UWorld coverage, so criterion 2 is unsatisfiable for
them. The engine does not soften the gate to make the number look better. It
reports that the ceiling on achievable readiness is roughly 97 percent with the
material currently owned, names the two modules responsible and their combined
exam weight, and says what would fill the gap.

This follows the governing rule in Material gaps below: the plan is derived from
the exam, never from the material in hand. Lowering a readiness bar because a
provider happens not to ship something would quietly redefine readiness as
"ready given what you bought", which is exactly the wrong number to put in front
of a candidate.

### Material gaps

**Governing rule: the plan is derived from the exam, not from the material in
hand. Material can be bought; exam weight cannot be negotiated.** So a shortfall
in what the candidate owns is surfaced as a procurement decision, never absorbed
by silently dropping a module, lowering a readiness bar, or redistributing its
weight to topics that happen to be well supplied.

The engine maintains a material gap report: for every module, what its activity
chain requires against what the catalogue actually holds, ordered by exam weight
so the costly gaps come first. Each entry states the module, its exam weight,
what is missing, and the consequence.

With the current catalogue the report is:

| Gap | Modules | Exam weight | Consequence |
|---|---|---|---|
| No questions at all | FSA Integration, Ethics module 1 | about 3% | cannot reach exam-ready; caps achievable readiness near 97% |
| No walkthrough | Fixed Income LM3 | about 2.5% | chain shortened, practice unaffected |
| Stale walkthrough | Economics LM1 | about 3.75% | older recording, flagged when scheduled |
| No review video | 13 modules | varies | first review visit falls through to a notes reread |

Only the first is a readiness blocker. The others shorten a chain or weaken a
review visit, and are reported at lower severity so the important one is not
lost among them.

A gap that blocks readiness is raised at plan setup, not discovered in the final
weeks when buying material no longer helps. The report names the category of
thing that would fill it (for these two, CFA Institute's own practice questions
or a second question bank) without recommending a vendor.

If the candidate buys material, it is added as another `PackageEdition` and the
gap closes on the next reseed with no change to the plan's logic. This is the
case the catalogue schema was shaped around: editions are rows, so a third
provider adds data rather than tables.

**With no catalogue at all**, the engine still plans from the curriculum rather
than refusing. Modules with no material behind them are scheduled on a
weight-derived estimate (the plan's target hours apportioned by exam weight
across the topic's modules), explicitly labelled as having no material behind
them, and every one of them appears in the gap report. This replaces an earlier
call in this document that fell back to v1 behaviour when no edition was owned;
that fallback contradicted the governing rule above, because it let an empty
catalogue cancel the plan instead of reporting an empty catalogue.

### The plan contract, declared by the candidate

At setup the candidate is asked for three targets, and a mode governing how
literally the engine takes them:

- total hours of study
- first-pass questions
- number of mocks

**The fields are pre-filled with the engine's own computed figures** (about 350
hours, 1021 questions, 6 mocks for the worked example), because most candidates
have no basis for inventing these numbers and asking an unanswerable question is
worse than not asking. The ask is really a negotiation over a proposal, not a
blank form.

Hours here is a budget on prescribed work, which is not the same quantity as
weekly availability. Availability says when the candidate can work; the hours
target says how much of that they intend to spend. 374 hours available and a
280-hour target is a coherent, common position.

The question target counts first-pass questions only. Redo attempts and mock
questions are reported but not targeted, because the number of redos is an
outcome of accuracy rather than a choice.

### Strict and approximate modes

**Approximate (the default).** Each target is a centre with a tolerance band of
plus or minus 15 percent. The engine prefers plans inside the band and reports
where it landed. When a target conflicts with feasibility, feasibility wins and
the deviation is named. This is the mode for a candidate who has a rough
intention and wants the engine to exercise judgement around it.

**Strict.** The targets are honoured exactly, subject to the guardrails below.
Hours become a hard ceiling on prescribed minutes, the question target selects
exactly that many questions, and the mock count is exactly met. The engine never
quietly exceeds a strict budget: if the candidate falls behind, it reports what
the targets now require ("hitting 1021 questions from here needs 18 hours a week,
not 14") and leaves the decision with them.

Two honest limits on strict. First, questions are selected at vignette
boundaries, since a 4 or 6 question item set is the unit of practice, so the
achieved count lands on the nearest boundary rather than exactly on the number
asked. Second, which questions get cut is not the candidate's choice: the
existing rule applies, keeping all vignettes in 10 to 15 percent topics and
sampling light topics highest-calculation-share first.

**Coherence is checked before anything is planned.** The three targets can
contradict each other, and the degradation ladder must not be used to resolve
that. The ladder is ordered for time pressure, where cutting practice last is
correct; applied to a deliberately small budget with a large mock count it
produces a plan with almost no practice. Modelled: a 250-hour budget with 10
mocks yields 238 first-pass questions, and a 200-hour budget with 10 mocks
yields **zero**. That is a degenerate plan, and emitting it would be a failure
of the whole feature.

So strict mode validates the triple first and refuses an incoherent one,
naming the cheapest single fix for each dimension. For 200 hours, 1064 questions
and 10 mocks: questions alone need 120 hours, mocks 74, and lectures 68, which
is 262 hours before any notes, review or seminars, so the plan is 62 hours over
before it starts. The engine reports exactly that, and that the fix is to raise
hours to 262, cut mocks to 1, or cut questions to 517.

Guardrails that hold in both modes, because a plan violating them is not worth
producing:

- First-pass questions never fall below half of what the weight cap allows.
  Below that the candidate is reading, not practising.
- Mocks are capped at one per two weeks of the Consolidate and Sharpen phases.
  This is not an arbitrary limit: mocks are already gated on 70 percent
  coverage, because a mock mostly measures what has not been read yet, so a
  mock count that outruns coverage is incoherent by the design's own rule.
- Every module keeps at least one vignette where it has any, so no module is
  covered entirely without practice.

Within a strict budget the ladder still runs, and its ordering still explains
itself. At 300 hours the cost is the notes pre-reads, the third review visits,
and 78 questions. At 250 hours it is those plus roughly half the question bank,
which is the point at which the engine should say plainly that the budget is the
binding constraint on readiness.

### What the contract reports

Whatever the mode, the plan states its totals and tracks against them: hours,
first-pass questions against the number owned, vignettes, redo attempts, mocks,
total question attempts, and the date new coverage stops.

The comparison between prescribed and owned questions is shown deliberately,
because it is how the weight cap explains itself. In the worked example the cap
trims only 43 of 1064, since an over-served topic gives up its notes pre-reads
and review videos first and reaches questions only once those are gone.
Equities, the most over-served at 1.37 times its weight share, loses all 4.4
hours of notes and 2.2 of review video before losing 29 questions. That ordering
is intentional: rewatching is the most droppable thing in the plan, and practice
is the least.

### Partially started modules

The common real starting point is a candidate who has watched a few lectures and
answered no questions at all. Treating a module as a single unit of progress
gets this wrong in both directions, so completion is tracked per activity.

A module's chain is notes, lecture, walkthrough, questions, checkpoint. Watching
the lecture completes one link. The module is then **in flight**, not done: its
remaining links stay in the queue and its review ladder has not started.

**What the existing log already tells us.** A `StudyLogEntry` carries
`packageId` and `questionsAnswered`, which is enough to classify prior work
without a new concept: an entry against the Meldrum package with zero questions
answered means content was consumed and practice was not. An entry with
questions answered means practice happened, and against which package.

**What it cannot tell us** is whether a lecture, its walkthrough, or both were
watched, because v1 has no activity dimension. For the two or three modules a
mid-stream candidate has actually touched, the cheapest accurate answer is to
ask: plan setup shows a short checklist for each module with prior history only
(notes, lecture, walkthrough, questions), never for all 51. Anything not
confirmed is treated as not done, because re-watching a lecture wastes an hour
while skipping one unwatched costs exam marks.

**Precedence: owed practice outranks new content.** The scheduler's in-flight
cap already provides the mechanism, with no new rule: at most two groups in
flight, one holding the content slot and one the practice slot. A module whose
lecture is watched but whose questions are owed occupies the practice slot,
while a fresh module occupies the content slot. So in the scenario above, week
one both clears the question backlog on the watched modules and starts new
lectures elsewhere. Owed practice keeps the practice slot until it is drained.

The justification is not symmetry. Confidence logged from watching alone
overstates readiness, because nothing has tested it, so coverage computed from
those entries is optimistic precisely where the candidate believes they are
furthest ahead. Practice is what corrects the estimate, and it is also the
first thing to decay. Deferring it in favour of more lectures compounds both
errors, and UWorld's solve-plus-review time is 115 of the plan's 350 hours, so
a backlog of it does not stay small.

**The review ladder starts at the checkpoint**, meaning chain completion, never
at the first log entry touching the module. Anchoring on any log would enter a
never-practised module into review at day seven, where the visit content rule
("redo the vignettes you got wrong") has nothing to work with and degenerates to
a notes reread. A module that was watched and never practised needs its
practice, not a review of it.

**If the candidate watched lectures before any plan existed**, there are no log
entries and the engine knows nothing. That is what the setup checklist is for.
Without declaring it, they will be prescribed those lectures again, which is
correct behaviour given no information, and is recoverable in one screen.

### Mocks

Gate then cadence. First mock at the earlier of 70 percent weighted coverage or
eight weeks out, because before that a mock mostly measures what has not been
read yet. Then every 14 days, weekly inside the final four weeks.

A mock is an unsplittable pair on consecutive available days: 264 minutes for
the real 88-question format, placed on the week's largest block, and 180 minutes
of review. If no day in the window holds 264 minutes, it goes on the largest day
and the engine says so rather than silently shrinking the exam.

Feedback affects ordering only. On logging a mock with a per-topic breakdown,
every module in a topic below 60 percent has its next visit pulled to within
three days and its ladder reset, and topics above 80 percent advance a step. A
candidate who knows only their overall percentage still gets the trend, and the
reprioritisation simply does not fire.

New coverage stops 14 days out. Any module never reached is reported as
uncovered and out of time, not quietly scheduled into the final week where it
would displace review of material the candidate half knows.

### Feasibility and degradation

The existing boolean becomes a triage: required minutes over available minutes,
where required is a sum over actual named work rather than a quantity
algebraically tied to remaining hours. At or below 1.0 is feasible, 1.0 to 1.25
is tight with the deficit stated in hours, above 1.25 is infeasible and triggers
a named, ordered degradation ladder that stops as soon as the ratio fits:

1. Drop notes pre-reads.
2. Drop third review visits.
3. Sample the question bank by weight, keeping all vignettes in heavy topics
   and half in light ones, highest calculation share first.
4. Drop walkthroughs where UWorld already covers the module.
5. Drop second review visits.
6. Drop whole modules, lowest return per hour first, by name.

Then it says plainly what it did and what the candidate will and will not
cover, including the case where even rung 6 does not fit, where the only honest
answers are more hours per week or a later exam date.

### Ethics fan-out and the FSA gap

The queue iterates over scheduling groups, not modules, where a group is the
transitive closure of "shares a provider asset". The 51 modules collapse to 45
groups, with the seven Guidance modules becoming one. A naive one-task-per-module
loop would otherwise schedule the same long video seven times.

The Guidance group's weight is seven module shares combined, close to 10 percent,
making it the single heaviest item in the plan. Whether that pulls it early
depends on the chosen strategy: under weight-first it does, under the default
curriculum order it does not. The grouping matters regardless, because it stops
the heaviest item in the plan being accounted for as seven small cheap ones.
One task carries all seven
module references, splits across days, and fans out to 14 log entries on
completion (the seeded data gives each Guidance module exactly 2 outcomes),
which is correct: the candidate did cover all of them. Only the final part of a
split task fans out, so a module is not recorded as covered halfway through its
lecture.

FSA Integration gets no question task, is guarded against winning the
return-per-hour tie-break, and lands last in FSA by prerequisite, where it
doubles as FSA's own review visit: its visits redo missed vignettes from the
five FSA modules that feed it, declared in data rather than hidden in code.

That substitution is a stopgap, not a resolution. Redoing other modules'
vignettes does not test this module, so it stays short of exam-ready and appears
in the material gap report as a readiness blocker until real questions for it
are acquired. The mechanism keeps the time useful in the meantime; it does not
pretend the gap is closed.

The remaining holes are chain-shortening rather than readiness-blocking, and the
same two mechanisms handle them: Fixed Income LM3 has no walkthrough, Economics
LM1's walkthrough is an older recording and is marked stale so the candidate
knows why it looks different, and thirteen modules have no review video so their
first visit falls through to a notes reread. All of them are still listed in the
gap report, at lower severity, so the blocking gap is not buried among them.

## Licensing line

Committable: provider names, slugs, edition years. That Mark Meldrum sells a
2026 Level II course is a published fact.

Gitignored seed data, without exception: unit titles, file names, Drive file ids
and URLs, file sizes, notes page ranges, per-reading question and vignette and
calculation and statement counts, and the concept summaries. This is stricter
than the curriculum rule, for a good reason: CFA Institute publishes topic names
and exam weights for anyone to read, which is why those are safe. A private
folder's structure and a per-reading analytics index of licensed material are
published nowhere.

Drive URLs in the database: yes for the owner, never as a shared preset. Hence
`PackageEdition.ownerUserId`. The labels stay global, the catalogue does not.

## Extraction pipeline

Three extractors over a shared library, because the three documents share no
structure. The curriculum extractor is built and verified. The library owns
markdown table parsing, Drive id extraction, and size parsing, which must handle
thousands separators: missing that silently drops the two largest files in the
Meldrum course.

Self-checks, every one of which was confirmed to actually hold, so a failure
means real damage rather than a mistuned threshold:

- Meldrum: 45 module headings; the type histogram exactly (45 lectures, 42
  walkthroughs, 31 reviews, 20 seminars, 1 update); 23 seminar index entries of
  which exactly 3 are topic level; 2 orientation videos; and the reconciliation
  139 plus 3 plus 2 equals the stated 144. A notes range on every module except
  the one whose heading says there is none.
- UWorld: 43 reading rows; column sums matching the stated totals; 86 files; and
  every question and answer link resolving to exactly one file row by Drive id.
  That last check is what catches the one answers file whose name lacks the usual
  suffix, instead of dropping it. Role comes from the per-reading table, never
  from the filename.
- Quant outcome map: 7 blocks, 40 rows, 120 questions, with exactly one row
  failing to match the 2027 text, being the retired neural-networks statement
  that 2027 readmits descriptively inside machine learning outcome 1. Any other
  unmatched row is a hard error.

Loading is a second script rather than an extension of the curriculum seed,
because the crosswalk's foreign keys point at rows whose ids the curriculum seed
generates, so it must fail loudly when a level is unseeded rather than skipping.
Unlike the curriculum loader, these tables get real unique constraints, so
upserts work directly instead of being hand-rolled.

## Measurements worth taking before building

Two cheap measurements retire the model's three largest uncertainties, and both
are the candidate's to make.

- **Time one UWorld vignette.** Roughly 20 minutes. First-pass solving typically
  runs 1.3 to 1.6 times slower than exam pace, and the question constants are
  currently pinned to exam pace. This is around 24 hours of budget error and the
  highest value per minute spent of anything available.
- **Harvest 12 to 15 video durations, not 144.** A stratified sample (the two
  smallest Quant lectures, the longest Quant lecture, both long Ethics videos,
  three mid-range lectures, three walkthroughs, two reviews) is around 10 minutes
  of browser work and resolves the page-rate parameter, the walkthrough
  multiplier, and the two worst individual guesses in the course. Harvesting all
  144 is not worth it: Drive exposes duration only once the player initialises,
  so the realistic cost is a screenshot read per file, around an hour, with a
  meaningful failure rate, against an aggregate error that calibration fixes
  within a week anyway. Harvest the rest only if the residual dispersion of the
  sample comes back high, at which point it is a decision rather than a hope.

## Calls settled after review

A builder read this document cold and reported what they would have had to
guess. These are the calls made in response. They are the author's, not the
candidate's.

- **Splitting is phrased as parts, never as minute ranges.** A split task reads
  "part 2 of 4, resume where you stopped", and the candidate reports the point
  they reached. Saying "watch minutes 90 to 180" of a video whose true length is
  unknown would break this document's own rule against presenting an estimate as
  a measurement.
- **A measured duration overrides the estimate for that resource only.** The
  stratified sample additionally re-fits `PAGE_RATE` and `EOCQ_MULT` once, at
  seed time, as a data change rather than at run time. Constants live in a
  seeded row, not in code, so a re-fit does not need a deploy. Already generated
  tasks keep the estimate they were generated with.
- **The feature ships on seed constants.** The two measurements are a data-only
  follow-up, not a build prerequisite. Blocking the first release on them would
  trade a working plan for a slightly better one.
- **Bootstrapping resolves per activity, not per module.** See Partially
  started modules below. An earlier draft of this document said an outcome
  carrying a log entry counts as first-pass covered; that was wrong, and the
  section replaces it.
- **The engine is never gated on owning material.** Superseded by Material gaps:
  with a thin or empty catalogue the plan is still built from the curriculum, on
  weight-derived estimates, and the missing material is reported. `PlanPackage`
  roles still gate which owned resources may be prescribed, so a candidate who
  never tagged UWorld as a questions source is not told to do UWorld questions,
  but that absence is then a reported gap rather than a silent reduction in
  scope.
- **Edition skew needs no further modelling.** The curriculum document's own
  2026-to-2027 analysis is that testable content is essentially unchanged and
  that the six new modules are the Ethics split, which the fan-out already
  handles. So the 2026 and 2025 provider editions map onto 2027 without a
  content-drift layer.

## Decisions taken by the candidate

### Exam weight caps new work; the surplus becomes review

An allocation layer sits above the queue. Each topic's first-pass minutes are
capped at its exam-weight share of the plan, and this applies whether or not the
plan is feasible, so it is not merely a degradation rung. Time freed in an
over-served topic is not returned to that topic and is not discarded: it is
spent on review of the topics whose confidence is lowest.

This is what stops the inventory dictating the plan. Equities ships 1.37 times
its weight share of material and Ethics 0.72, so without the cap the candidate
over-studies Equities by default, with time to spare being the reason rather
than the excuse. Under the cap, Equities content beyond the cap is trimmed by
the same rule the degradation ladder uses (sample the question bank, highest
calculation share first), and the hours move to Ethics and Economics review.

### Study order is a strategy chosen at plan setup

The default is the curriculum's own suggested order, with Ethics last. That is
the candidate's stated preference, and it is also the safest default, since it
is the order the curriculum authors recommend.

But the order is no longer hardcoded. The candidate picks a strategy when
setting up a plan, and the engine runs the same prerequisite graph and the same
weight-capped budget underneath each one. Only the sort key's priority changes:

- **Curriculum order (default).** Phase band leads. Ethics first pass lands in
  the final third, and the 20 minute daily track funds that first pass as well
  as the review that follows it.
- **Weight first.** Module weight leads, so the Guidance group, the single
  heaviest item in the plan, comes early, and the daily track is review only.
  This is the order for a candidate who wants the cheapest points banked first.
- **Weakest first.** Confidence leads, seeded from existing log history for a
  mid-stream plan or from a short self-assessment at setup. Bands and weight
  become tie-breaks.

Three strategies rather than a free-form ordering: each one is explicable in a
sentence, which is the property that makes a candidate trust the plan it
produces. The set is the author's call; the default is the candidate's.

The strategy is stored on the plan, so changing it regenerates the unfrozen
window and nothing else. The setup choice itself is interface work and goes
through the standing front-end process.

### The pace-reporting bug is fixed as part of this

The progress route counts log rows for actual progress but distinct outcomes for
target, which the frontend spec already records as a backend bug. Task fan-out
writes 14 log rows for one Ethics task, and review visits add hundreds more over
a plan, so shipping on top of it would leave the pace screens materially less
trustworthy than they are today. Actual progress must count distinct outcomes
covered, matching how target is computed, with review visits contributing to a
separate review figure rather than inflating coverage.

## Left to the builder

- Exact table and column names, index choices, and migration ordering.
- Whether the degradation ladder's rungs are data or code.
- The interface for a day's task list, which goes through the standing
  front-end process and is out of scope here.
- Whether the notes pre-read defaults on or off, and the seminar policy's
  default.
- Test strategy, beyond the requirement that the existing database reset helper
  gains deletes for the five new tables in dependency order. Omitting that leaks
  rows and makes unrelated suites fail later on foreign key constraints, which
  looks like flakiness rather than a missing cleanup.

## Related

- [CFA Study Tracker design](2026-11-04-cfa-study-tracker-design.md): the v1
  product spec, whose non-goals this document reverses in five named places.
- [CFA Study Tracker frontend design](2026-11-07-cfa-frontend-design.md): where
  the day view will be designed.
- [Seeding a curriculum level](../../SEEDING.md): the loader contract, the
  licensing rationale, and the four production gotchas any new seed script
  inherits.
