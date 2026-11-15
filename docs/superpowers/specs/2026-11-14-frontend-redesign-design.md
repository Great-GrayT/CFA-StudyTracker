---
title: Frontend redesign on the shadcn asset kit
type: spec
module: apps/frontend
updated: 2026-11-15
status: active
---

## Purpose

Rebuild the whole frontend UI layer of the CFA Study Tracker. The backend and
its endpoints do not change. Everything a user sees does: the page map, the
content and order on each page, the journey between pages, and the visual
system.

The owner's diagnosis, in their words: the app "has not been designed, too
much generic", "the contents on each page and components on each page is not
organised", "user journey is not properly set up", and the UI components are
"very very little thoroughly developed". The bar they set is Linear, Stripe,
Bloomberg and Amazon: products that are one system applied everywhere, with
every state handled.

This document supersedes the information architecture and screen sections of
[CFA Study Tracker frontend design](2026-11-07-cfa-frontend-design.md) and
[CFA frontend screens](2026-11-07-cfa-frontend-screens.md). Their colour tokens,
the honesty test for visualization, and the accessibility rules still hold.

## What is wrong today

Found by an inventory of every route (2026-11-14). Each item is a reason for a
decision below.

- Recording study has four entry points (Composer, Today task row, topic page
  row, outcome page). The shell's "Record study" button is a no-op on 7 of 11
  app pages, because each page has to mount its own Composer.
- The same content lives on two or three pages: pace sentence and "unrealistic"
  warning (Today, Pace); week strip and day plan (Today, Plan); availability,
  packages, prior work (Onboarding, Plan, Settings); JSON export (Plan,
  Settings); install (three places); devices and notifications split across
  Settings and Watchdogs.
- Dead ends: no-plan states on Today and Plan give no link onward; log rows do
  not link to their outcome; the 3D view is a full page reload; Pace's
  exam-passed state has no action.
- `progress.studyNext`, the backend's ranked list of what to study next, is
  only used for its first item. `study-next-list.tsx` is imported nowhere.
- Bugs: `auth/account/delete` is missing from the proxy allowlist, so account
  deletion 404s in the browser. There is no auth guard on client pages. The
  Watchdogs "Missed day alerts" switch is local state that is never saved.
  Plan Setup saves do not invalidate `campaign` or `prescription`.

## Goals

- One page map where every piece of content has exactly one home.
- One core loop, visible from every screen: Today says what to study, the user
  studies, records it in one sheet, and sees it move in Syllabus and Progress.
- One visual system built on the provided assets, themed so it reads as this
  product and not as stock shadcn.
- Every state designed: loading, empty, error, offline, no plan, exam passed,
  exam day.
- Keyboard-first on desktop, thumb-first on mobile.

## Non-goals

- No backend changes. The proxy allowlist is frontend code and is fixed here.
- No new product features. Every screen is built from data the endpoints
  already return.
- Import plan stays out (the backend route exists, the product flow does not).
- The behaviour shipped on 2026-11-14 and 2026-11-15 (day-end replan,
  postponed and off-plan cells, plan-shaped record, start over) is kept as
  built. This redesign changes how it looks and where it lives, not what it
  does.

## Anti-goals

The redesign fails, even if it works, if any of these ship.

- The stock shadcn look: neutral grey, Inter, `rounded-md` on everything,
  `shadow-xs` under every box.
- The SaaS card kit: every section chopped into identical rounded cards.
- Template chrome: all-caps eyebrow labels above headings, monospace for small
  data labels, an arrow glyph appended to every link.
- Any piece of information shown on two pages as a primary element.
- Any button that does nothing on some pages.

## Approaches

Three were considered. The owner picked A.

- **A. Adopt the assets as written (chosen).** Add Tailwind v4 and the assets'
  dependencies, move the assets into `components/ui/`, map the existing tokens
  onto shadcn's CSS variables, restyle the variants, rebuild every page on
  them, and delete CSS Modules page by page. Big dependency jump and a full UI
  rewrite, but one system and the assets at full strength.
- **B. Port the assets to CSS Modules.** Keeps the stack, but means hand
  translating about 5,300 lines of class strings, loses upstream updates, and
  works against "use those assets". Dropped.
- **C. Tailwind for shell and primitives only.** Fastest, but leaves the
  disorganised page content in place, which is half the complaint. Dropped.

## Decisions

### Stack

- Tailwind CSS v4 through `@tailwindcss/postcss`, with `tw-animate-css` for the
  `animate-in` and `data-[state]` classes 16 of the assets use.
- Asset dependencies: `radix-ui`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `lucide-react`, `recharts`, `vaul`, `react-day-picker`,
  `input-otp`, `@tanstack/react-virtual`, `jotai`. `cmdk`, `sonner`,
  `next-themes`, `date-fns` are already installed.
- Assets move from `src/external-ui-assets/` to `src/components/ui/`, the path
  they import each other by. Add the files they expect: `src/lib/utils.ts`
  (`cn`), `src/hooks/ui/use-mobile.ts`, `src/hooks/ui/use-media-query.ts`.
- `combo-box.tsx` imports `@/utils/persian-fuzzy-searching`, which does not
  exist. Replace that call with `cmdk`'s built-in filter. No Persian search.
- `footer.tsx` is an async server component that reads `package.json`. Used
  only as the version line at the foot of Settings.
- Kept and reused: `lib/api.ts`, `lib/hooks.ts`, `lib/types.ts`,
  `lib/campaign-types.ts`, the pure logic in `lib/coverage.ts`, `lib/pace.ts`,
  `lib/paging.ts`, `lib/push.ts`, React Query with its IndexedDB persistence,
  the service worker, the session and OAuth routes.
- Fonts stay Archivo and Newsreader through `next/font`.

### Visual system

The subject is a CFA Level II candidate running a 6 to 9 month campaign
against a fixed exam date. The vernacular is the CFA Institute's ink blue, the
curriculum's own hierarchy (topic, reading, learning outcome), exam weights,
and the terminal screens finance people read all day. The system leans on that
and not on generic dashboard tropes.

**Colour.** Keep the WCAG-checked tokens in `tokens.css` unchanged, including
the confidence ramp and stage palette. Map them onto shadcn's variables in one
`@theme` block, so every asset is themed without editing its class strings:

| shadcn variable | token | role |
|---|---|---|
| `--background` | `--ground` | page |
| `--card`, `--popover` | `--raised` | surfaces |
| `--foreground` | `--text` | body text |
| `--muted-foreground` | `--muted` | secondary text |
| `--primary` | `--claimed` | the one action colour |
| `--border`, `--input` | `--rule` (decorative), `--rule-strong` for inputs | lines |
| `--ring` | `--focus` | focus |
| `--destructive` | `--alarm` | delete, behind pace |
| `--chart-1..5` | stage palette + `--conf-3` | charts |

Light ground stays the cool blue-grey `#eef0f8`, dark stays ink navy `#070b26`.
Neither is cream or near-black. Blue is the only accent; green and red mean
ahead and behind and nothing else.

**Type.** Two families, clearly different jobs.

- Archivo for all interface text and numbers. Numbers always use
  `tabular-nums`, never a monospace face. Display sizes use Archivo's
  semi-condensed width so large figures sit tight like a terminal.
- Newsreader for the curriculum's own words: learning outcome statements,
  reading titles in detail views, and the coach's one-sentence readouts. The
  curriculum reads like a textbook; the instrument reads like an instrument.
- Scale (px): 12, 13, 14, 16, 20, 26, 34. Body 14 on desktop, 16 on mobile.
  Tables 13. Sentence case everywhere. No all-caps labels.

**Shape and depth.** Radius encodes what a thing is, not a house style: data
marks 0, inputs and buttons 4px (`--radius-input` moves from 2px to 4px, the
one token this redesign changes; builder's call), panels 8px, sheets and dialogs 12px. Depth is
a 1px border on a raised surface. Shadow (`--shadow-float`) only on things that
float: popovers, sheets, dialogs, the command palette.

**Density.** Linear-compact. 4px grid; rows 36px on desktop, 44px on touch.
Panels are separated by space and a hairline, not wrapped in cards. A page is
a sheet of instruments, not a stack of cards.

**Motion.** Answers an action and shows what changed: sheets slide from their
edge, recorded rows settle, numbers count to their new value after a record.
One orchestrated moment in the whole app: the syllabus map's first reveal.
Everything respects `prefers-reduced-motion`. Durations reuse the existing
`--dur-*` and `--ease-*` tokens.

**The one bold element.** The syllabus map (below). Everything else stays
quiet so it can be loud.

### Page map

Five destinations and two global tools.

```
┌ sidebar (collapses to icons) ┐  ┌ top bar ───────────────────────────────┐
│ ◆ mark                       │  │ breadcrumb         ⌘K search   + Record │
│ Today                        │  └─────────────────────────────────────────┘
│ Syllabus                     │
│ Progress                     │   page content
│ Plan                         │
│ ───                          │
│ Settings                     │
│ theme · install · account    │
└──────────────────────────────┘
mobile: bottom bar  Today · Syllabus · ( + ) · Progress · Plan
        Settings from the account avatar in the top bar
```

| Route | Owns |
|---|---|
| `/today` | what to do now and how you stand |
| `/syllabus` | the curriculum and your grip on it |
| `/syllabus/[topicId]` | one topic's readings and outcomes |
| `/progress` | history: pace, mock exams, study journal (tabs) |
| `/plan` | the future: campaign, calendar, and every setup input (tabs) |
| `/settings` | account, security, coach and devices, data, danger zone |
| `/onboarding` | first plan, full screen |
| `/login`, `/forgot-password`, `/reset-password` | auth |

Tabs and the open outcome live in the URL (`?tab=`, `?los=`), so every view is
linkable and Back works.

Old routes redirect in `next.config.ts`: `/coverage` and `/coverage/explore` to
`/syllabus`, `/coverage/[id]` to `/syllabus/[id]`, `/los/[id]` to
`/syllabus?los=[id]`, `/pace` to `/progress?tab=pace`, `/mocks` to
`/progress?tab=mocks`, `/logs` to `/progress?tab=journal`, `/watchdogs` to
`/settings#system`.

### Global tools

**Record sheet.** One `Sheet` (right edge on desktop, `Drawer` from the bottom
on mobile), mounted once in the shell, opened from the top bar button, the
`R` key, the mobile centre button, and every "Record" control in the app.
Every caller passes a preset: a plan cell (`taskId`), an outcome
(`suggestedLosId`, which preselects section and module), or nothing.

It is the plan-shaped Composer from 2026-11-15 rebuilt on the assets, same
fields and same endpoint (`POST plans/:id/sessions`): section and module
(`Combobox`), type (`ToggleGroup`: notes, video, end-of-chapter questions,
questions, review), package (`Select`), minutes (`Input`), questions answered
and correct for question types (`Input` with live accuracy), confidence
(`ToggleGroup` on the confidence ramp), date (`DatePicker`), note
(`Textarea`). When a pending planned cell that day has the same reading and
kind, the sheet offers to record against it (`Checkbox`, sends `taskId`). A
preview line shows the cell the record becomes. Buttons: "Record" and
"Record and next".

The Today row's inline record panel is removed; a row's Record opens this
sheet preset to that cell. A success toast (`Sonner`) offers Undo for planned
cells (task back to pending, as today); off-plan records have no Undo, as
today, and are deleted from the journal instead.

**Command palette.** `CommandDialog` on `⌘K` / `Ctrl K` and the top bar search.
Groups: outcomes (fuzzy over the flattened curriculum), topics, pages, actions
(record study, add mock, add holiday, export, toggle theme, sign out).

### Screens

Order on each page is top to bottom, desktop first. Mobile stacks the same
order in one column.

**Today.** Question it answers: what do I do now, and am I on track?

```
┌──────────────────────────────────────────┬───────────────────────┐
│ Thursday 14 November        118 days left │ Standing              │
│ 2h 10m planned, 40m done   ▓▓▓░░░░░░      │ 12 outcomes behind    │
├──────────────────────────────────────────┤ ╱╲_╱‾ pace, 30 days   │
│ Today's work                              │ Coverage 41%          │
│ □ Reading  Equity valuation R24   45m  ⋯ │ Next mock 6 Jan       │
│ □ Questions  FRA R12, 30 q        40m  ⋯ │───────────────────────│
│ ■ Review  Fixed income R31    done 25m   │ Study next            │
│                                           │ 1 LOS 24.c  weak      │
│ Week   M T W [T] F S S                    │ 2 LOS 12.a  stale     │
└──────────────────────────────────────────┴───────────────────────┘
```

1. Day header: date, days to exam, planned vs done minutes with `Progress`,
   and the time left until the day closes at the plan's debrief, in the
   plan's zone (existing `lib/day-end.ts`). Exam day and exam passed replace
   this with their own states. When the day closes, Today refetches so
   carried work appears.
2. Today's work: the day's cells from `plans/:id/tasks`. Each row: kind,
   module, minutes, materials (external links in a `DropdownMenu`), "Record"
   opening the Record sheet preset to the cell, Undo once recorded. A cell
   carrying missed work shows a `Badge` "Postponed from Tue 10 Nov"; an
   off-plan cell shows "Off plan" and sits after the planned ones. Missed work
   returns through the engine, so there is no separate Not done list.
3. Week strip: compact, selects the day shown in Today's work for this week
   only. Other weeks live in Plan.
4. Standing panel (right column, below on mobile): pace delta with a 30-day
   sparkline (`Chart`), coverage percent, next mock. Each links to its home in
   Progress or Syllabus. The "unrealistic" warning appears here only, as an
   `Alert` linking to Plan setup.
5. Study next: the top five of `progress.studyNext` with the reason each was
   chosen; each opens the outcome sheet. This is where `study-next-list` logic
   finally ships.
6. Missed days in the last week: one line in the Standing panel, not a section.
   Postponed tags on the cells carry the detail.

No plan: an empty state that explains and links to `/onboarding`.

**Syllabus.** Question it answers: what does the exam weigh, and how well do I
know it?

1. Header: weighted coverage percent and question accuracy, one line each.
2. View switch (`SegmentedControl`): Map, Table, 3D.
3. Map (default, the bold element): the `tree-map` asset. Topic cells sized by
   midpoint exam weight, fill on the confidence ramp by average confidence,
   untouched cells hatched. Below topic level the curriculum has no weights,
   so inside a topic every outcome is an equal tile and a reading's area is
   its outcome count; the tooltip and legend say so (builder's call, keeps the
   honesty test). Drill down topic to reading to outcome with the
   asset's breadcrumb and keyboard navigation. Clicking an outcome cell opens
   the outcome sheet. Tooltip: weight range, covered X of Y, accuracy.
4. Table: every topic as a row (weight range, coverage bar, accuracy, weakest
   reading), expandable with `Accordion` to readings. Sortable. This is the
   accessible equivalent of the map and the place the weight-gap chart's
   information now lives.
5. 3D: the existing massif, lazy loaded inside the page, no reload.

`/syllabus/[topicId]`: header with weight and coverage, readings as an
`Accordion`, each with its per-outcome status strip; outcome rows open the
outcome sheet and have a "Record" button.

Outcome sheet (`Sheet`, `?los=` in the URL): the current `/los` page content in
this order: outcome statement in Newsreader, flagged reasons as an `Alert`,
confidence trend and meter, accuracy, question source mix with the
monoculture nudge, freshness, history `Table` with `Pagination`, and a
"Record" button.

**Progress.** Question it answers: what have I done, and is it working?
`Tabs`: Pace, Mocks, Journal.

- Pace: range (`ToggleGroup` 30d, 90d, All), the pace sentence, the pace field
  chart, rollup `Table` by week or month with `Pagination`.
- Mocks: score trend (`Chart`, one shape per package), table, "Add mock" in a
  `Dialog` (`DatePicker`, `Input`, `Select`, `Textarea`), delete through an
  `AlertDialog` style confirm built on `Dialog`.
- Journal: virtualized list grouped by day with filters (topic `Select`,
  package `Select`, date range). Each row opens the outcome sheet; row
  `DropdownMenu` has Delete. CSV export button here, since this is where the
  data lives.

**Plan.** Question it answers: what is ahead, and what is it built from?
`Tabs`: Campaign, Calendar, Setup.

- Campaign: campaign chart (stage palette), coverage projection and slack
  days, `Alert` when the calendar is too short.
- Calendar: week navigation, week strip and read-only day plan for any week.
  The current week links back to Today for recording.
- Setup, one column of sections with a hairline between them:
  exam date (`DatePicker`, start date and level read-only), weekly hours
  (`Slider` per day with the plan-health line), holidays (`Calendar` range
  pick in a `Popover`, list with delete), packages (`Select` to add,
  `ToggleGroup` for roles), how the plan is built (current PlannerSettings,
  rebuilt with `RadioGroup`, `Select`, `Slider`, inside `Collapsible`
  "Advanced"), what you have already studied (current PriorWork).
  Saves invalidate `plan`, `campaign` and `prescription` queries.

**Settings.** Question it answers: who am I here, and how does the app reach
me? Left sub-nav on desktop, stacked on mobile. Sections:

1. Account: email, change password, sign out.
2. Security: passkeys list, add passkey, two-factor with `InputOTP`.
3. Coach and devices: email and push coach (`Switch`, `Select`), schedule,
   preview and "Send me one now", devices list (each named by its label,
   "Android, Chrome") with add and remove, install card. The "Missed day alerts" switch is removed, since nothing stores it.
4. Where you study: city `Combobox` on `geocode`.
5. System health (`#system`): last nightly run, 30-night grid, run now,
   backfill a night. Moved here from Watchdogs.
6. Your data: counts, export everything as JSON. The JSON export on Plan is
   removed.
7. Danger zone: "Start over" as a `Collapsible` that explains what happens
   and confirms with a second button (`POST plans/:id/restart`, clear the
   onboarding draft and query cache, go to `/onboarding`; history kept),
   then delete account in a `Dialog`.
8. Version line (`footer`).

**Onboarding.** Full screen, no shell. Step header with `Progress`, same six
steps and localStorage draft as today. Steps reuse the Plan Setup editors
(availability, packages, prior work) so the two can never drift. A user with
an active plan who opens it is told so and offered Plan or "Start a new plan".

**Auth.** One centred panel on the ground, the vortex mark above it. Login
keeps Sign in and Create account (`Tabs`), OAuth buttons with provider marks,
passkey, forgot link. The second factor step uses `InputOTP`. Forgot and reset
reuse the same panel.

### States

Every data region has four states, built from the same parts:

- Loading: `Skeleton` in the region's real shape.
- Empty: one sentence saying what will appear and one action to make it appear.
- Error: what failed in plain words, from `messageForStatus`, with Retry.
- Offline: cached data shown with a quiet "Offline, showing saved data" line.

No plan and exam passed are page-level states with a link to the fix.

### Guards and fixes

- `middleware.ts` sends requests without the session cookie on app routes to
  `/login`. The plan guard is a client component in the app layout that sends
  a 404 on `plans` to `/onboarding`.
- Add `^auth\/account\/delete$` to the proxy allowlist, with a test.
- Remove the unpersisted "Missed day alerts" switch.
- Setup saves invalidate `campaign` and `prescription`.

### Asset map

| Asset | Used for |
|---|---|
| sidebar | desktop shell |
| breadcrumb | top bar, treemap drill path |
| command | ⌘K palette, outcome search in Record sheet |
| sheet, drawer | Record sheet, outcome sheet (drawer on mobile) |
| dialog | add mock, confirmations, delete account |
| tabs, segmented-control, toggle-group | Progress and Plan tabs, Syllabus views, ranges, roles, confidence |
| tree-map | Syllabus map |
| chart | pace sparkline, mock trend, rollups |
| table, pagination | history, rollups, mocks, syllabus table |
| accordion, collapsible | readings, advanced planner settings |
| calendar, date-picker, popover | exam date, holidays, log date, mock date |
| input, textarea, label, checkbox, radio-group, select, combo-box, slider, switch, input-otp | all forms |
| alert, badge, progress, skeleton, tooltip, separator, scroll-area, avatar | states and detail |
| dropdown-menu | row actions, account menu |
| sonner, use-toast | toasts (sonner only; `use-toast` is not mounted) |
| footer | version line in Settings |
| button | everything |

Custom components stay custom, rebuilt in Tailwind on the same tokens: mark
and its motion, massif, pace field, campaign chart, week strip, confidence
meter, status strip.

### Build order

On a branch, one commit per step, app usable after each:

1. Tailwind, dependencies, assets moved, theme mapping, `cn`, hooks.
2. Shell: sidebar, top bar, mobile bar, Record sheet, command palette, guards,
   redirects, allowlist fix.
3. Today.
4. Syllabus with map, table, 3D, topic page, outcome sheet.
5. Progress.
6. Plan.
7. Settings.
8. Auth and onboarding.
9. Delete the old CSS Modules and orphaned components.

### Verification

- `pnpm typecheck`, `pnpm test`, `pnpm build` green after every step.
- Existing logic tests (`coverage`, `pace`, `paging`, `push`, `allowlist`)
  keep passing; a test for the new allowlist entry.
- Each screen checked in a real browser at 390px and 1440px, light and dark,
  keyboard only, and audited with `/impeccable` per section.

## What is left to the builder

- Exact Tailwind class strings and variant restyles, within the system above.
- Treemap cell rendering details, as long as the encoding (area is weight, fill
  is confidence, hatch is untouched) holds and a table equivalent exists.
- Whether rollups use `chart` or stay as tables.
- Icon choices from `lucide-react`.
- Copy, following the sentence case and plain verb rules of the 2026-11-07
  copy deck.

## Related

- [CFA Study Tracker frontend design](2026-11-07-cfa-frontend-design.md): token and accessibility rules this keeps.
- [CFA frontend screens](2026-11-07-cfa-frontend-screens.md): the screen spec this replaces; its copy deck still applies.
- [Day view design](2026-11-11-day-view-design.md): the prescription Today's work renders.
- [Planner modes design](2026-11-12-planner-modes-design.md): the settings Plan Setup edits.
- [Email coach design](2026-11-11-email-coach-design.md): the coach settings in Settings.
- [Day-end replan design](2026-11-14-day-end-replan-design.md): the debrief clock Today shows.
- [Postponed cells, plan restart, and plan-shaped study logs](2026-11-15-postponed-restart-logstudy-design.md): the Record sheet's fields, the cell tags, and Start over.
