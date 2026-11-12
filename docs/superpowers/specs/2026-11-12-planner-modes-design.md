---
title: Planner modes, paired practice, and mastery
type: spec
module: apps/backend
updated: 2026-11-12
status: draft
---

## Purpose

The planner currently hands the candidate a week that reads Ethics, then
Quantitative Methods, then the head of Financial Statement Analysis. That is
not a bug in the sort, it is the absence of any rule tying a reading to the
questions that prove it was learned, plus the absence of a week-level sense of
where one unit ends and the next begins. `ordering.ts:40` checks topic cohesion
before the phase band, so a topic area runs to exhaustion and the next one
starts wherever the day happens to end. Ethics is small at Level II, so three
topic areas genuinely fit one week and nothing in the engine objects.

This design does three things.

**One.** It makes the plan mode an explicit, switchable choice with three
values, so the candidate can compare orderings instead of inheriting one.

**Two.** It adopts Mark Meldrum's practice ratio as the engine's organising
principle rather than a suggestion in prose: on a first read, one part reading
is followed by two parts question solving, in the same sitting, for the same
unit. Reading without its practice does not count as progress. The converse
does not hold, and that asymmetry is deliberate: practice without reading can
count as progress, if the practice demonstrates proficiency.

**Three.** It replaces "covered" with a number. A unit is learned when a
quantity `M`, built from accuracy, coverage, self-rated confidence and
freshness, clears a bar. Everything the review phase does is driven by `M`.

### Goals

- Three plan modes, switchable per plan, default `curriculum-topic`.
- First-pass days that pair a unit's reading with twice its minutes of
  questions, reproducing the candidate's own worked example exactly.
- A review phase with its own ratio, 1 part reading to 4 parts questions, held
  as a weekly budget rather than a per-sitting rule.
- Four review start policies, switchable, default decay-triggered.
- A mastery figure per learning outcome, aggregating up to topic area and plan.
- Reconciliation of a candidate who has gone off plan, in either direction,
  including one who arrives having already studied, so that pure question days
  and pure reading days both exist where the evidence calls for them.
- Every constant named in this document editable by the candidate in the app.

### Non-goals

- The effort model (`effort.ts`) does not change. Minutes still come from
  pages, question counts and calculation share exactly as they do today.
- The exam-weight cap (`allocation.ts`) does not change.
- The coach, the mock exam log and the pace chart are untouched beyond reading
  the new figures.
- No new runtime dependency.

### Anti-goals

These make the feature a failure even if it ships and passes its tests.

- A plan that reads a unit and never practises it.
- A question task served for material the candidate has not read.
- A week whose packed minutes exceed what the candidate said the week holds.
- Switching mode and losing logged work, or losing the mastery history that
  logged work earned.
- A settings screen with twenty numbers on it and no indication of what any of
  them do.

### Constraints

- `apps/backend/src/core/*` stays pure. No database, no HTTP, no framework.
  New modules follow that rule.
- The weekly budget is binding. The per-day figure is a description of an
  ordinary day, not a ceiling, which `packing.ts` already handles through
  `carry` and the 2x day cap.
- Mode 1 must behave exactly as the engine behaves today, so the comparison is
  honest. Its tests are the proof.
- Exam weight is not a sorting mechanism in any mode.

### Vocabulary

Two granularities are easy to conflate and this document keeps them apart.

- **Topic area**: Quantitative Methods, Financial Statement Analysis, Equity.
  The things that carry an exam weight.
- **Unit**: one learning module inside a topic area, the candidate's "quant
  topic 1". This is the existing `SchedulableGroup`, and it is the thing the
  first-pass loop iterates and the 15-minute floor guards.

## Methods

### orderModules

Unchanged in signature, extended in behaviour. `apps/backend/src/core/ordering.ts`

- **in**: `groups: SchedulableGroup[]`, `strategy: Strategy`
- **out**: `SchedulableGroup[]` in placement order
- **errors**: throws on a prerequisite cycle, as today
- **notes**: the `"weight"` and `"confidence"` branches stay, with their
  tests, because they are correct code and removing them buys nothing. They
  stop being offered as plan modes. Mode selection happens one level up, in
  `planMode`, and maps to `strategy` as described under Logic.

### sequenceUnits

New. `apps/backend/src/core/sequence.ts`

- **in**: `groups: SchedulableGroup[]`, `mode: PlanMode`
- **out**: `SchedulableGroup[]`
- **errors**: throws on a prerequisite cycle
- **notes**: the single entry point the scheduler calls. For
  `effort-return` it delegates to `orderModules(groups, "curriculum")`,
  preserving today's behaviour exactly. For `curriculum-strict` and
  `curriculum-topic` it sorts topic areas by curriculum position, then units
  by `moduleOrder` inside each area, then runs the same greedy topological
  pass so prerequisites still win over the stated order. The two curriculum
  modes produce an identical first-pass sequence; they diverge only in whether
  the review phase is permitted to reorder anything.

### packFirstPass

New. `apps/backend/src/core/pairing.ts`

- **in**: `seq: PackableGroup[]`, `cal: Calendar`, `tuning: Tuning`
- **out**: `PlannedDay[]`
- **errors**: none; an impossible day yields an empty day rather than a throw
- **notes**: implements Rule A, below. Replaces `packDays` for the first-pass
  span. Keeps `packing.ts`'s weekly `carry`, its 2x day cap, its 15-minute
  task floor, its vignette-boundary splitting and its indivisible-task
  deadlock escape, all of which are correct and hard-won.

### reconcile

New. `apps/backend/src/core/pairing.ts`

- **in**: `seq: PackableGroup[]`, `logs: MasteryObservation[]`, `asOf: Date`,
  `tuning: Tuning`
- **out**: `{ units: ReconciledUnit[]; writeOffs: WriteOff[] }`, where a
  `ReconciledUnit` carries `readingDebt`, `questionDebt` and a `pairing` tag of
  `paired`, `questions-only` or `reading-only`
- **errors**: none
- **notes**: runs before `packFirstPass` on every generation, not only the
  first. Negative debts clamp to zero, so a candidate who over-practised one
  unit does not earn credit against another. `writeOffs` records each unit
  whose reading was dropped on question evidence, with the `M` that justified
  it, for display on `/settings` and for the coach to mention once.

### solveQuestionMultiple

New. `apps/backend/src/core/pairing.ts`

- **in**: `readingMinutes: number`, `availableMinutes: number`, `tuning: Tuning`
- **out**: `{ effective: number; requested: number; calendarTooShort: boolean }`
- **errors**: none
- **notes**: runs once per generation, before packing. Returns the requested
  multiple when the calendar can afford it and the largest affordable multiple
  otherwise, floored at `questionMultipleFloor`, with `calendarTooShort` set
  when the floor binds. `packFirstPass` takes `effective`, never `requested`.

### projectCoverageDate

New. `apps/backend/src/core/review.ts`

- **in**: `unreadMinutes: number`, `realisedPace: number`, `asOf: Date`,
  `cal: Calendar`
- **out**: `{ date: string; slackDays: number }`
- **errors**: throws if `realisedPace` is not positive
- **notes**: feeds the injection throttle under `decay-triggered`. Pace comes
  from the existing calibration in `pace.ts` rather than a second estimate, so
  there is one answer in the app to "how fast is this candidate actually
  going". A plan with no logged work yet has no realised pace and uses the
  estimated pace, which is what the first week does anyway.

### packReview

New. `apps/backend/src/core/review.ts`

- **in**: `queue: ReviewUnit[]`, `cal: Calendar`, `tuning: Tuning`
- **out**: `PlannedDay[]`
- **errors**: none
- **notes**: spends a weekly budget split 1 part reading to 4 parts questions.
  Any single day may be entirely questions. Reading and question streams are
  drawn from independent cursors, so the candidate may be re-reading Equity
  while answering Financial Statement Analysis.

### mastery

New. `apps/backend/src/core/mastery.ts`

- **in**: `obs: MasteryObservation`, `asOf: Date`, `tuning: Tuning`
- **out**: `number` in `[0, 1]`
- **errors**: throws if the three mastery weights sum to zero
- **notes**: pure arithmetic over one learning outcome's logged work. The
  formula is under Logic. Aggregation helpers `masteryByTopic` and
  `planReadiness` live beside it.

### reviewQueue

New. `apps/backend/src/core/review.ts`

- **in**: `units: ReviewUnit[]`, `asOf: Date`, `tuning: Tuning`,
  `mode: PlanMode`
- **out**: `ReviewUnit[]` ascending by `M`
- **errors**: none
- **notes**: under `curriculum-strict` the queue is returned in curriculum
  order regardless of `M`, because that mode promises a sequence you could
  print. Under `curriculum-topic` and `effort-return` it is ordered by `M`
  ascending, with the evidence triggers under Logic deciding which units are
  eligible to jump at all.

### reviewPhaseStart

New. `apps/backend/src/core/review.ts`

- **in**: `cal: Calendar`, `coverage: CoverageState`, `tuning: Tuning`
- **out**: `{ policy: ReviewPolicy; firstReviewDate: string | null; injections: Injection[] }`
- **errors**: throws if `policy` is `fixed-date` and no date is set
- **notes**: evaluates the four policies. Only `decay-triggered` returns
  `injections`, the per-day reservations it wants carved out of the first pass.

### Tuning

New. `apps/backend/src/core/tuning.ts`

- **in**: `unknown` from the stored JSON column
- **out**: a fully populated `Tuning`, every field defaulted
- **errors**: never throws; an out-of-range or malformed field falls back to
  its default and is reported in a `rejected` list the settings screen shows
- **notes**: one parse function, one defaults object, one range table. The
  engine never reads the raw JSON. A plan saved before this feature existed
  has no column value and gets defaults, so no backfill migration is needed.

## Logic

### Rule A, the first-pass slice

The candidate supplied three worked days and they discriminate between two
plausible rules. Day 1 was 40 minutes of reading and 80 of questions, but unit
1 holds 56 minutes of reading against 140 of questions, a ratio of 1 to 2.50.
The day therefore did not inherit the unit's own ratio, it used a flat 1 to 2.
Rule A is the rule that fits:

For a day of capacity `K`, with `remaining = K`, repeat:

1. Let `u` be the open unit, meaning the earliest unit in sequence with
   reading or questions still owed. If none is open, take the next unit in
   sequence and treat it as a **new unit**.
2. `readSlice = min(u.readingRemaining, floor(remaining / (1 + questionMultiple)))`
   where `questionMultiple` defaults to 2.
3. **New-unit floor.** If `u` is a new unit and `readSlice < minNewUnitReadMinutes`,
   stop. The rest of the day is left to tomorrow. The one exception: a unit
   whose *entire* reading is under the floor is placed anyway, since waiting
   cannot help it and it has to go somewhere.
4. `questionSlice = min(u.questionsRemaining, questionMultiple * readSlice)`.
5. **Flush.** If `readSlice` consumes the unit's last reading minute, then
   `questionSlice = min(u.questionsRemaining, remaining - readSlice)` instead.
   A closing unit empties its bank in the same sitting rather than leaving a
   stub to orphan a later day.
6. Emit the reading task, then the question task, in that order.
7. `remaining -= readSlice + questionSlice`. Stop if `remaining` is under the
   15-minute task floor.

Traced against the candidate's figures, with unit 1 at 56 and 140 and unit 2
at 51 and 104:

| Day | K | Placed | Check |
|-----|---|--------|-------|
| 1 | 120 | u1 read 40, u1 questions 80 | `floor(120/3) = 40`, not the last reading minute, so `2 x 40 = 80` |
| 2 | 127 | u1 read 16, u1 questions 60 | 16 is u1's last reading, so flush takes all 60 rather than 32 |
| 2 | 51 left | u2 read 17, u2 questions 34 | `floor(51/3) = 17`, clears the 15-minute floor, `2 x 17 = 34` |
| 3 | 104 | u2 read 34, u2 questions 70 | 34 is u2's last reading, flush takes the remaining 70 |

All three days reproduce exactly. These are the acceptance tests.

### Reconciliation, when the candidate has gone off plan

Rule A as stated assumes every unit begins owing its full reading and its full
practice. That is true only of a plan nobody has deviated from, which is no
real plan. A candidate arrives having read three topic areas on their own
before signing up, or spends a fortnight ignoring the schedule and grinding
question banks, and the planner's job is then to bring them back to the
sequence rather than to pretend the fortnight did not happen.

So packing is preceded by `reconcile`, which gives every unit two debts:
reading minutes not yet logged, and question minutes owed under the effective
multiple less question minutes logged. Four cases follow, and only the first is
the paired one Rule A describes.

1. **Both debts open.** Normal Rule A pairing, reading then its questions, in
   the same sitting.
2. **Reading done, questions owed.** The day may be entirely question solving
   on material read earlier, with no reading at all. The gating invariant is
   already satisfied, because the reading happened, just not here.
3. **Questions done, reading owed, proficiency not demonstrated.** The day may
   be entirely reading, decoupled from practice, because the practice is
   already spent. This is the mirror of case 2 and the reason the first-pass
   ratio is a target over the **unit**, not over the day: a unit reconciled
   mid-flight will have its reading and its questions on different days and
   there is nothing to be done about that.
4. **Questions done, reading owed, proficiency demonstrated.** The reading debt
   is written off. If `M` clears `readingWriteOffBar` on question evidence
   alone, reading the material would teach nothing, and the honest reading of
   the situation is that the candidate read it and did not log it. The unit is
   marked learned and never scheduled for reading. The write-off is recorded
   with its `M` at the time, so the candidate can see what was skipped and why.

Case 4 is the one worth being careful about, because it is the only place the
engine decides on the candidate's behalf that material needs no reading. It
therefore gets its own bar rather than borrowing `masteryBar`: being learned
enough to leave the review queue and being learned enough to skip the reading
entirely are different claims, and the second deserves a higher threshold.

Reconciliation is not a one-off at onboarding. It runs on every regeneration,
so a candidate who goes off plan in March is folded back in overnight on the
same rules. Onboarding gains a prior-work intake so the first generation starts
from the truth: per topic area, what has been read and roughly how many
questions have been answered at roughly what accuracy. Coarse input beats no
input, and anything the candidate declares there lands as `StudyLogEntry` rows
flagged as self-declared, so mastery treats them as real but the audit trail
keeps them distinguishable from logged work.

### The question gating invariant

A question task may never be placed before the reading task that covers its
material. Rule A satisfies this for free, since step 6 emits reading first and
`questionSlice` is drawn only from the unit whose reading was just placed.

Reconciliation does not weaken this. Case 2 above schedules questions with no
reading beside them, but the reading is in the candidate's log, which is
stronger evidence than a scheduled task. The invariant is about what the plan
asks for, so its precise statement is: no scheduled question task may precede
the reading of its material, whether that reading is a scheduled task earlier
in the plan or a logged entry already behind the candidate. Case 3 schedules
reading after its questions were answered, which the invariant permits because
the candidate chose that order themselves; the engine never originates it.

It has to be enforced explicitly in two other places. In the review phase,
only units with at least one completed first-pass reading are eligible for the
queue. Under review policy `fixed-date`, material still unread at the
switchover is folded into review, and there its reading is emitted before its
questions despite the phase otherwise decoupling the two streams.

This is an invariant, not a heuristic. It gets a test that walks every
generated plan and asserts no question task precedes its own reading.

### A thin question bank

If a unit holds fewer question minutes than `questionMultiple` times its
reading, the ratio cannot be met and the shortfall is real. The engine does
not invent questions and does not pad with another unit's. It places what
exists, and the deficit shows up on its own: coverage `c` in the mastery
formula is answered over available, so a unit that could never be practised
enough carries a low `M`, and a low `M` is exactly what pulls it into the
review queue. The shortfall is also recorded on the plan so the settings
screen can say which units are under-practised and by how many minutes.

This is my call rather than the candidate's instruction, and the alternative
worth knowing about is borrowing question minutes from a sibling unit in the
same topic area.

### When the calendar is too short for the ratio

Rule A makes a unit cost its reading plus twice its reading, so the full
curriculum at 1 to 2 will usually not fit a real Level II calendar. The ratio
bends rather than the coverage.

Before packing, `solveQuestionMultiple` finds the largest multiple that fits:
total reading minutes `R` are fixed by the curriculum, available minutes `A`
come from the calendar, and the engine takes

```
mEff = min(requested, max(0, (A - R) / R))
```

clamped below at a floor, default 0.5, beneath which a plan is not a study plan
and the candidate should be told the calendar is too short rather than handed a
ratio that pretends otherwise. The solve runs once per generation, applies to
every unit identically, and both numbers are shown on `/settings`: the ratio
requested and the ratio the calendar supports. A plan running at a reduced
multiple is never silent about it.

Two consequences worth stating. Coverage always completes, which is the point
of choosing this over trimming units. And the exam-weight cap in
`allocation.ts` still applies afterwards, so a topic area whose question stock
is enormous relative to its weight is still held to its share; the global
multiple sets the shape, the cap stops one area eating the plan.

### Mastery

Per learning outcome, from its `StudyLogEntry` rows (`schema.prisma:276`,
which already carries `confidence`, `questionsAnswered`, `questionsCorrect`
and a date):

- **accuracy** `a = (correct + 1) / (answered + 2)`, Laplace-smoothed, so two
  correct out of two reads as 0.75 rather than a false 1.0.
- **coverage** `c = min(1, answered / available)` against that outcome's
  question stock.
- **confidence** `s = (confidence - 1) / 4`, mapping the stored 1 to 5 rating
  onto 0 to 1.
- **freshness** `r = exp(-ln2 * daysSinceLastTouch / halfLifeDays)`, an
  exponential decay with a half-life, default 45 days. Note `ln2` in the
  exponent: that is what makes `halfLifeDays` mean a half-life rather than a
  time constant, so setting it to 45 genuinely halves `M` in 45 idle days.

Then

```
M = r * (wa * a + wc * c + ws * s)
```

with weights normalised to sum to 1, defaulting to 0.60, 0.25 and 0.15. A unit
is **learned** when `M >= masteryBar`, default 0.75.

Confidence stays in the formula. The candidate's instruction was that every
constant be theirs to set, which covers this case: dragging `ws` to zero makes
mastery score-and-coverage only and demotes confidence to something the coach
reads and the planner ignores.

Aggregation: topic-area mastery is the mean of its outcomes weighted by
question minutes, so a long outcome counts for more than a short one. Plan
readiness is topic-area mastery weighted by exam weight. This is the one place
exam weight still steers anything, and it steers reporting, not ordering.

### The three plan modes

**`effort-return`.** Today's engine, untouched. Topic cohesion first, then
phase band, module order, priority rank, return per hour. Kept so the
candidate can switch back and see the difference rather than take it on faith.
Its review phase, if enabled, orders by `M` like the default mode.

**`curriculum-strict`.** Topic areas in curriculum order, units in
`moduleOrder` inside them, prerequisites still binding. No evidence reorders
anything, in either phase. A sequence you could print and pin up.

**`curriculum-topic`, the default.** Identical first pass to
`curriculum-strict`. On a first read, confidence is near zero almost
everywhere, so sorting on it is sorting on noise, and the candidate rejected
exam weight as a sort outright. Only the review phase may deviate, and only on
evidence that a unit is genuinely weak rather than merely new.

### What counts as genuine evidence

A unit becomes eligible to jump the curriculum order when any of:

- its stored confidence is `confidenceTriggerValue`, default 1, the floor of
  the scale; or
- its accuracy `a` is below `accuracyFloor`, default 0.50, across at least
  `accuracyMinSample` answered questions, default 12. The sample floor exists
  so one bad vignette cannot reorder a plan; or
- its `M` has decayed below `masteryBar`.

Eligible units are then served in ascending `M`.

### The four review start policies

All four ship. The default is `decay-triggered`, which supersedes the
candidate's earlier preference for `after-coverage`.

- **`decay-triggered`, the default.** The first pass owns the calendar. The
  nightly tick evaluates every covered unit, and any unit meeting an evidence
  trigger is injected into the next day, which reserves up to
  `reviewInjectionCapShare` of its capacity, default 0.35, for it. The first
  pass keeps the rest. Quiet when the candidate is doing well, loud when they
  are not, so no two plans look alike.

  **Coverage wins until coverage is at risk.** A candidate scoring badly early
  would otherwise earn so many injections that the first pass never finishes,
  which is the one outcome worse than reviewing too little. So the same nightly
  tick projects the first-pass completion date from the remaining unread
  minutes and the candidate's recent realised pace, and compares it to a
  deadline of the exam date less `coverageDeadlineWeeks`, default 6. While the
  projection sits inside the deadline, injections run at the full cap. As it
  approaches, the cap is throttled in proportion to how much slack is left.
  Once the projection would pass the deadline, injections stop entirely and the
  day is coverage only, with the queued units held as a backlog the review
  phase picks up the moment coverage completes. The throttle is a ramp rather
  than a cliff so the plan does not lurch between two behaviours on a single
  bad week, and the current cap is shown on `/settings` so the candidate can
  see when it has been pulled down and why.
- **`after-coverage`.** Nothing is reviewed until every unit has been read
  once, then review takes the remaining calendar.
- **`weekly-interleave`.** From week one, `weeklyInterleaveShare` of each
  week's minutes, default 0.20, goes to the lowest-`M` units. Coverage
  finishes later in exchange for decay never getting a long run.
- **`fixed-date`.** The candidate names the switchover. Anything unread by
  then is folded into review and read there at the review ratio, under the
  gating invariant above.

### The review phase shape

One part reading to four parts questions, `reviewQuestionMultiple` default
4.0, held as a **weekly** budget, not a per-sitting one. For a week whose
availability totals `W`, the week owes `W / (1 + 4)` to reading and the rest to
questions. Any individual day may be entirely questions and no reading at all.

The packer draws from two independent cursors over the queue. Each day it
fills from the question cursor first, then the reading cursor, tracking a
running weekly ledger. If the reading budget is still underspent with two days
of the week left, reading is forced in, so a week cannot end having silently
spent its reading allowance on questions. That forcing rule is my call; the
plainer alternative is to let the shortfall roll into the next week.

### Which minutes are reading and which are questions

`effort.ts` emits seven resource kinds and Rule A needs them sorted into two
buckets. Reading is `notes`, `lecture` and `seminar`. Questions are
`question_set`, `eocq` and `answer_set`, the last of these being the time spent
working back through a provided answer, which is practice rather than reading.
The `review` kind, meaning a review video, is reading-layer material that the
first pass does not touch at all: it is held back and becomes the review
phase's reading stream, which is what makes a 1 to 4 ratio achievable without
re-reading the original notes end to end.

### From learning outcomes up to a unit

`StudyLogEntry` is keyed by `losId` but Rule A slices units, so the two have to
meet. A unit's mastery is the question-minute-weighted mean of the mastery of
the learning outcomes its readings carry, the same weighting used one level up
for topic areas, so the aggregation rule is stated once and applied twice.

Question stock in the catalogue is recorded per resource, which is unit-level,
not per outcome. `available` for one outcome is therefore its unit's stock
divided pro rata by that outcome's share of the unit's question minutes. This
is an approximation and it is the honest one available: the provider does not
tag questions by outcome.

### A unit whose whole reading is under the floor

Step 3's exception has to say where such a unit actually lands. It is merged
into the current day's tail if the day has room for the unit's reading and its
questions together, and otherwise into the next day, fused with the slice of
the unit that follows it. This mirrors `mergeSmallTasks` in `packing.ts:214`,
which already merges a sub-floor task into its neighbour rather than letting it
stand alone, and reuses that function's forward-merge branch for the case where
the short unit leads a day.

### Tuning fields

Every field below appears on `/settings`, grouped as the table groups them.
Each has a default and a valid range; `parseTuning` silently substitutes the
default for anything outside its range and reports the substitution.

| Field | Default | Range | Governs |
|-------|---------|-------|---------|
| `planMode` | `curriculum-topic` | one of three | which sequence the first pass follows |
| `reviewPolicy` | `decay-triggered` | one of four | when review starts |
| `reviewStartDate` | none | a date after today | policy `fixed-date` only |
| `firstPassQuestionMultiple` | 2.0 | 0.5 to 6.0 | Rule A's requested question slice per minute of reading |
| `questionMultipleFloor` | 0.5 | 0.2 to 2.0 | below this the calendar is declared too short rather than bent further |
| `coverageDeadlineWeeks` | 6 | 1 to 20 | weeks before the exam by which the first pass must finish |
| `reviewQuestionMultiple` | 4.0 | 1.0 to 10.0 | the review phase's weekly ratio |
| `minNewUnitReadMinutes` | 15 | 5 to 60 | the floor for opening a new unit |
| `weeklyInterleaveShare` | 0.20 | 0.05 to 0.50 | policy `weekly-interleave` only |
| `reviewInjectionCapShare` | 0.35 | 0.10 to 0.80 | policy `decay-triggered` only |
| `masteryWeightAccuracy` | 0.60 | 0 to 1 | `wa` |
| `masteryWeightCoverage` | 0.25 | 0 to 1 | `wc` |
| `masteryWeightConfidence` | 0.15 | 0 to 1 | `ws`, zero to ignore confidence |
| `masteryHalfLifeDays` | 45 | 7 to 365 | the decay half-life |
| `masteryBar` | 0.75 | 0.30 to 0.95 | where a unit counts as learned |
| `readingWriteOffBar` | 0.85 | 0.50 to 0.98 | mastery on question evidence alone above which a unit's reading is dropped |
| `confidenceTriggerValue` | 1 | 1 to 3 | the confidence that makes a unit eligible to jump |
| `accuracyFloor` | 0.50 | 0.20 to 0.80 | the accuracy that makes a unit eligible to jump |
| `accuracyMinSample` | 12 | 5 to 100 | questions needed before accuracy may trigger |

The three mastery weights are normalised to sum to 1 at parse time, so the
candidate can set them in any units they like and setting all three to zero is
the one case `mastery` throws on rather than guessing.

`reviewPolicy` is independent of `planMode`. All three modes get a review
phase; the mode decides only whether the queue may depart from curriculum
order, which `reviewQueue` already handles.

### Switching mode

Changing `planMode`, `reviewPolicy` or any tuning field regenerates the plan
from today forward, through the path `FUNC-schedule.ts:570` already uses for
an ordering-strategy change. Logged work and mastery history are keyed to
learning outcomes, not to plan tasks, so they survive regeneration untouched.
Days already past are never rewritten.

## Data flow

Estimation to plan, first pass:
`PackageResource` -> `effort.estimateModule` -> `allocation.allocate` ->
`sequence.sequenceUnits` -> `pairing.solveQuestionMultiple` ->
`pairing.reconcile` -> `pairing.packFirstPass` -> `PlanTask` rows -> `/today`

Prior work declared at onboarding:
`/onboarding` -> self-declared `StudyLogEntry` rows -> `pairing.reconcile` ->
first generation

Estimation to plan, review:
`StudyLogEntry` -> `mastery.mastery` -> `review.reviewQueue` ->
`review.packReview` -> `PlanTask` rows -> `/today`

Policy evaluation, nightly:
`cron/tick` -> `pace` realised rate -> `review.projectCoverageDate` ->
injection throttle -> `review.reviewPhaseStart` -> injections -> regeneration
from tomorrow forward

Tuning, read and write:
`/settings` -> `PATCH /api/plans/:id` -> `StudyPlan.tuning` (JSON) ->
`tuning.parseTuning` -> every core module. `GET /api/settings` stays read-only,
as `route.ts:6` says it must, and gains the tuning block plus the
rejected-field list for display.

Readiness, read:
`StudyLogEntry` -> `mastery.masteryByTopic` -> `mastery.planReadiness` ->
`/coverage` and the coach

## Dependencies

Internal, existing: [Effort model and scheduler plan](../plans/2026-11-11-effort-model-and-scheduler.md)
for `effort.ts`, `allocation.ts`, `ordering.ts` and `packing.ts`;
[Day view design](2026-11-11-day-view-design.md) for how a packed day is
rendered; [Daily prescription design](2026-11-10-daily-prescription-design.md)
for what the coach says about a day.

Internal, new: `core/sequence.ts`, `core/pairing.ts`, `core/review.ts`,
`core/mastery.ts`, `core/tuning.ts`.

Schema: `StudyPlan` gains `planMode String @default("curriculum-topic")`,
`reviewPolicy String @default("decay-triggered")`,
`reviewStartDate DateTime?` and `tuning Json?`. `orderingStrategy` stays for
the existing tests and for `effort-return`'s internals.

External: Prisma, Next.js. Nothing new.

## Related

- [Day view design](2026-11-11-day-view-design.md): the screen that renders
  the days this engine packs, including how a paired reading and question slice
  should read on a weeknight.
- [Daily prescription design](2026-11-10-daily-prescription-design.md): the
  coach's copy, which will need a line for an injected review unit.
- [Effort model and scheduler plan](../plans/2026-11-11-effort-model-and-scheduler.md):
  where the minutes this design slices come from.
- [CFA study tracker design](2026-11-04-cfa-study-tracker-design.md): the
  product requirement this feature serves, that the candidate be told exactly
  what to do each day.
