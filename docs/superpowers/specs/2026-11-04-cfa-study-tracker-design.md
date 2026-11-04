---
title: CFA Study Tracker design
type: spec
module: root
updated: 2026-11-04
status: draft
---

## Purpose

A multi-user phone-and-web study companion for CFA candidates (Levels I-III). The
candidate sets an exam date, level, and weekly study-time availability; logs what
they study against the official topic/LOS tree as they go, with a 1-5 confidence
rating and a count of questions answered; the app tracks coverage and pace against
the exam date, flags low-confidence LOS for review, and shows daily/weekly/monthly
behind-or-ahead status. It does not teach, quiz, or grade; it tracks.

Reza is Level II. Style and infra reference: his own `openGym` (self-hosted,
install-to-home-screen, own-your-data, plan import/export) and `cron-server`
(the actual deploy pattern to copy).

## Goals

- Set up once: exam date, level, weekly availability template, study packages in
  use, each tagged with what it's for (content, questions, mocks; a package can be
  more than one). Someone already mid-way through studying can set a past start
  date and declare what they've already covered (topics/LOS, confidence, questions
  answered) during setup, so the plan reflects real progress from day one instead
  of starting blank.
- Be gently nudged if a LOS has a meaningful volume of question practice from only
  one question-bank source while confidence is still mid-or-low, since candidate
  reviews and the interleaving/desirable-difficulty research both associate
  single-bank drilling with worse real-exam transfer than mixing sources.
- See a recommended content-vs-practice time split for remaining study hours (a
  1:2 ratio by default), reflecting the "power set" method for working
  candidates: content consumption (video, reading) only puts material into
  short-term memory, retrieval practice (problem-solving) is what moves it into
  long-term memory, so most of the time budget should go there. Advisory only,
  computed from existing `PlanPackage` role tags, never enforced.
- Log a study session against a specific LOS: confidence (1-5), questions answered
  (count only), optional note.
- See coverage of the official topic/LOS tree for the chosen level, weighted by
  each topic's official CFA Institute exam weight (not a flat LOS count), and
  which LOS are flagged for review (low confidence, poor question-bank accuracy,
  or gone stale from disuse).
- Log a full mock exam's score, separately from LOS-level study sessions, and see
  the trend over time, the strongest available signal of real exam readiness.
- See whether the candidate is behind or ahead of pace, at daily/weekly/monthly
  rollups, against the exam date. Missing days automatically steepens the required
  pace on the next view; no manual "replan" step exists or is needed. If that
  required pace crosses into unrealistic territory, say so explicitly instead of
  quietly climbing.
- See new-topic coverage and review-of-flagged-work as two distinct numbers, not
  one blended "on pace" figure that lets stalled breadth hide behind review work.
- Mark a date range (a holiday, a work crunch) as unavailable, so the pace engine
  excludes it from remaining study hours and doesn't flag it as a missed day.
- Be alerted, in the app and (if they opt in) as a phone push notification, when a
  day they'd planned to study (per their weekly template) passed with nothing
  logged.
- Export the full log and plan as JSON; export the study log as CSV; share/import a
  plan as a small file (openGym-style).
- Installable on a phone home screen (PWA), usable on the web.
- Multi-user accounts, each candidate's data private to them.
- A distinctive, motion-rich interface, not a plain CRUD tracker: meaningful
  animation throughout and 3D visual elements where they earn their place (for
  example, the topic/LOS coverage map, progress visuals, or the plan setup flow).

## Non-goals

- No quiz engine, no question bank, no question content stored or generated. The
  app never asks the user a question.
- No integration with Mark Meldrum, UWorld, or Kaplan accounts (no public APIs;
  scraping their sites would violate their terms). Package tracking is a label the
  user attaches to a manual log entry, nothing more.
- No native iOS/Android app for v1. PWA only.
- No per-day calendar editing (swapping one specific day's hours without changing
  the whole weekly template). What v1 does support is a holiday/unavailable date
  *range* (see Holiday ranges below), which covers the real case (a trip, an exam
  period at work) without full per-day granularity.
- No spaced-repetition curve-fitting (SM-2 and the like, no per-LOS decay curve,
  no scheduled re-review date). The one time-based exception is staleness
  re-flagging (see Confidence and review): a single fixed threshold, not a curve.
- No quiz content for mock exams either: the candidate takes their mock wherever
  they always do (CFAI's own, UWorld, Kaplan) and logs only the resulting score.
- No email or SMS reminders. Push is phone-notification only (Web Push, since
  there's no native app), and only for missed-day alerts, not a general
  notification system.

## Anti-goals

- Never commit CFA Institute's verbatim topic/LOS wording into the public repo. The
  outline PDFs are marked "for candidate use only, not for distribution"; public
  URL is not a redistribution license.
- Never require a password, cookie, or scraped session for a third-party study
  provider (UWorld, Kaplan, Meldrum). If it can't be done with the provider's
  blessing or a public API, it's out of scope.

## Constraints

- Public GitHub repo (`Great-GrayT/CFA-StudyTracker`), already created, empty.
- Frontend deploys to Vercel. Backend self-hosts on Reza's existing VPS
  (`142.4.38.81`), behind the existing Caddy reverse proxy and Cloudflare, sharing
  the existing Postgres 18 container, using the existing GHCR + GitHub Actions
  push-to-deploy pipeline, same as `cron-server` (`D:\website\cron-server`). Reza
  gave explicit permission to copy that project's code, config, and assets
  (Dockerfile, CI workflow, Caddy block, security middleware, auth pattern).
- Auth mirrors `cron-server`: JWT (HS256) with `token_version` revocation, scrypt
  password hashes, optional Google/GitHub OAuth, zod-validated routes, tiered rate
  limiting, fail-closed CORS restricted to the Vercel origin.
- Stack mirrors `cron-server`: Next.js 15, React 19, TypeScript, Prisma 6 +
  Postgres, zod, pnpm.
- License: no license chosen yet. Default to MIT for the code (builder's call,
  flagged here), with a NOTICE that the curriculum seed data is Reza's own,
  privately held, and not covered by the repo's license since it isn't in the repo.

## Decisions

### Curriculum data and copyright

The official topic -> reading -> LOS tree (fetched already for Level I from CFA
Institute's own published topic-outline PDFs, same approach planned for Levels
II-III) is seed data, not source code. It lives as JSON under a path the repo's
`.gitignore` excludes (e.g. `prisma/seed-data/`), and a committed seed script loads
it into Postgres on first server setup. The repo ships the schema and the loader,
never the LOS text itself. Reza keeps a private copy of the seed JSON (outside git)
and re-runs the seed script after a yearly curriculum refresh.

### Data model (core entities)

- `User`: email, password hash, `token_version`, OAuth links, created_at.
- `Level`: I / II / III (seed-only reference data, no secrecy concern, topic names
  only, e.g. "Quantitative Methods", are fine to commit; the LOS bullet text is
  what's excluded).
- `Topic` -> `Reading` (a LOS group, matches the outline's named subsections) ->
  `LOS` (one row per bullet outcome). All level-scoped. `Topic` also carries
  `exam_weight_min`/`exam_weight_max` (the official CFA Institute exam-weight
  range for that topic at that level, e.g. 15-20 for Ethics), used to weight
  coverage instead of a flat LOS count (see Plan/pace engine). These are public
  factual percentages, not copyrighted text, fine to commit alongside topic names.
- `StudyPlan`: a user can have more than one row (so a retake keeps its own
  history), exactly one marked active at a time: level, exam_date, start_date
  (when they actually began studying, defaults to today, can be set in the past
  for someone mid-way through), weekly_availability (hours per weekday, JSON),
  created_at, is_active.
- `StudyPackage`: the label a log entry carries. Seeded with the common ones (Mark
  Meldrum, UWorld, Kaplan, CFAI) plus "Custom", and the user can add their own.
- `StudyLogEntry`: user_id, plan_id, los_id, package_id (nullable), date,
  confidence (1-5), questions_answered (int, default 0), questions_correct (int,
  default 0, must be <= questions_answered), note (optional, short text).
- `MockExam`: user_id, plan_id, date, score_percent, package_id (nullable, which
  provider's mock), note (optional). A plain logged number, no question content,
  same self-report philosophy as everything else.
- `PlanPackage`: plan_id, package_id, roles (array of `content` | `questions` |
  `mocks`; a package can carry more than one). The join between a plan and the
  packages it declared at setup, each tagged with what it's used for. This is
  per-plan, not per-`StudyPackage` row, because the same named package (say,
  Kaplan) is "content + questions" for one candidate and "questions only" for
  another who gets content elsewhere; tagging the shared `StudyPackage` row itself
  would leak one candidate's usage into everyone's.
- `ProgressSnapshot`: plan_id, date, target_cumulative, actual_cumulative. One row
  written per active plan per day by the nightly cron tick (see Plan/pace engine).
  This is what makes past behind/ahead numbers stable even after the user edits
  their weekly availability later.
- `PushSubscription`: user_id, endpoint (unique), p256dh, auth, created_at. A user
  can have more than one (multiple devices/browsers). Created when they opt in to
  push on a device; the row that sent a push the push service reports as gone
  (410/404) gets deleted.
- `PlanHoliday`: plan_id, start_date, end_date (inclusive range), note (optional).
  A plan can have several (a trip in December, a work crunch in March).

Today's live behind/ahead view is computed from `StudyLogEntry` on read; any past
day's view reads its stored `ProgressSnapshot` instead, since today's availability
no longer describes what the target was back then. v1 ships with a single active
`StudyPlan` in the UI; the `plan_id` foreign key just avoids a migration later if
a retake-history switcher gets built.

### Confidence and review

Confidence is self-reported, 1-5, set on (or updated on) every log entry for a
given LOS; a LOS's current confidence is its most recent rating. A LOS is
"flagged for review" when any of three conditions hold, each a plain threshold
check, none inferred or curve-fit:

1. **Confidence <= 2** (hardcoded for v1) on its most recent rating.
2. **Question-bank accuracy < 60%** (hardcoded for v1) on that LOS's cumulative
   `questions_correct` / `questions_answered`, once `questions_answered >= 3` (too
   few questions to mean anything below that). This catches the real-world case a
   CFA candidate knows well: confident after reading, then scoring poorly once
   tested, which a confidence-only signal would never flag.
3. **Stale**: last touched (most recent log entry) more than 30 days ago, however
   high its last confidence was. A fixed threshold, not a decay curve: there is no
   schedule, no per-LOS re-review date, just "has it been a while."

The home screen shows an actual ordered "study next" list, not just a count:
flagged-for-review LOS first (oldest-rated first), then not-yet-studied LOS in
curriculum order (CFA Institute's own published topic sequence, which is already
a taught sequence, not alphabetical). This is the whole review mechanism: a
sorted query against three threshold checks, still no spaced-repetition
scheduling, no decay curve, no ranking model.

### Weekly availability: editing and per-day pausing

`weekly_availability` is the one template already in the data model (hours per
weekday). Editing a day's hours, pausing a day (setting it to 0, meaning "not a
study day this week"), and clearing a day back to its default are all the same
operation: `PATCH` the plan's `weekly_availability` field (the route already
specified under Plan/pace engine). No separate entity, no per-day rows, no
"deactivate" or "delete" action beyond setting that day's value: the plan always
has exactly one weekly template, and editing it is editing one number per day. The
frontend screen for this (and the initial setup screen that first asks for it)
goes through the standing front-end process named below; this document fixes only
the data shape and the single edit operation.

### Day-level compliance alerts

Separate from the cumulative behind/ahead pace: for any day in the trailing week
where `weekly_availability` planned hours > 0 and no `StudyLogEntry` exists dated
that day, the day is a "missed day." The progress endpoint returns the list of
missed days, computed fresh on every read from existing data, no stored alert
state; the frontend surfaces it as an in-app dashboard banner.

On top of that, if the candidate has opted in to push on a device (granted
notification permission, registered a `PushSubscription`), the nightly cron tick
sends a Web Push notification the day after a missed day (the tick already runs
once daily, after that day's logging window has closed): "you planned to study
Monday and didn't log anything." Same library and approach as `openGym`'s own
`web-push` dependency. No email, no SMS, no general-purpose notification system:
this one alert, this one channel, opt-in.

### Holiday ranges

A `PlanHoliday` row marks a date range where the weekly template's hours don't
apply: every day inside it counts as 0 available hours regardless of what that
weekday normally has, for both the pace engine (it's excluded from "remaining
hours") and the missed-day alert (a holiday day is never flagged as missed,
pushed or otherwise). Creating, listing, and deleting a plan's holiday ranges are
plain CRUD against `PlanHoliday`, scoped to the plan's owner. Overlapping ranges
are allowed and just double up harmlessly (a day inside two ranges is still one
excluded day); the builder doesn't need to reject overlaps.

### Mid-stream onboarding (backfill)

Plan setup (both the normal flow and plan import) accepts an optional list of
already-covered LOS: `{ losId, confidence, questionsAnswered }`, plus the
`start_date` field above. On creation, the backend writes one `StudyLogEntry` per
backfilled LOS, dated `start_date`, in the same transaction as the plan itself.
No separate "backfill mode" or recomputation step exists: coverage, the
behind/ahead numbers, and the study-next list are already computed by reading
`StudyLogEntry` (spec, Data model and Plan/pace engine), so a plan created with
backfilled logs is correct from its very first read, exactly as if those sessions
had been logged one at a time from `start_date` onward.

### Plan / pace engine

Deterministic and transparent, not adaptive machine learning:

1. On plan setup, total remaining LOS for the level and total remaining study
   hours between today and the exam date (from the recurring weekly template,
   minus any day inside a `PlanHoliday` range) are both known. Missing a day does
   the same thing as a holiday to this count after the fact: it simply isn't
   covered, so the next computation has fewer remaining hours and the same
   remaining LOS, which is exactly what should happen; there's no separate "the
   user fell behind" branch in this formula.
2. Target pace = LOS per available study hour, spread evenly across remaining
   hours. This produces a daily/weekly/monthly target LOS count. Coverage
   *percentage* (as opposed to the count used for pacing) is weighted by each
   covered LOS's topic's `exam_weight`, not a flat per-LOS count: finishing every
   LOS in a 5%-weight topic while a 20%-weight topic sits untouched should not, and
   does not, read as "80% done."
3. Actual progress splits into two separate cumulative numbers, never blended:
   **new coverage** (first-time-logged LOS) and **review work** (already-flagged
   LOS re-studied). Each is tracked against its own share of the target, so
   re-drilling familiar material can't visually stand in for stalled breadth.
4. Behind/ahead = cumulative actual (new coverage + review work) vs. cumulative
   target, shown as a count and a percentage, at daily, weekly, and monthly
   rollups. Today's number is computed live; every prior day reads its stored
   `ProgressSnapshot` row instead of being recomputed under today's availability.
5. Editing the weekly availability template recomputes the pace going forward; it
   does not rewrite history (the nightly cron has already frozen each past day's
   `ProgressSnapshot`).
6. Re-logging an already-covered or already-flagged LOS updates its confidence and
   adds to its questions-answered/questions-correct totals, but credits coverage
   only once per LOS: logging the same LOS five times in a day does not count as
   five LOS of progress.
7. **Pace-realism check**: if the computed required daily pace exceeds a fixed
   sane ceiling (configurable, defaulted to a number of LOS per day that implies
   more than a plausible number of study hours given the user's own weekly
   template), the progress response carries an explicit `paceRealistic: false`
   flag and a plain-language reason, surfaced by the frontend as a warning banner
   distinct from the ordinary behind/ahead display: "at this pace you'd need more
   hours than you've told the app you have; consider moving your exam date or
   adding study time." No auto-adjustment, no exam-date change on the user's
   behalf: the warning is the whole feature, the candidate decides what to do
   about it.

### Mock exams

A `MockExam` row is just a logged score: date, percent, optionally which provider
and a note. No question content, no timing data, no section breakdown: the
candidate took the mock wherever they always do and reports the result. The
progress view shows the series as a simple trend (list or chart, builder's call on
presentation), since mock-exam performance is the strongest available signal of
real readiness and otherwise has no presence anywhere in this design. Mock exams
never feed the pace engine's target/actual math; they're a separate, parallel
readiness signal the candidate reads for themselves.

### Study-package roles and diversity nudge

At plan setup (and editable after), the candidate declares each package they're
using via a `PlanPackage` row and tags it with one or more roles: content,
questions, mocks. This is what lets the app reason about *how* a package is being
used, not just that it's named: a candidate using Kaplan for notes-only and UWorld
for questions is visibly different from one using Kaplan for everything, which a
flat package label could never express.

One soft, dismissible nudge rides on this: for a LOS (or topic) where
`questions_answered` logged against `questions`-role packages totals 20 or more,
all of it from a single package, and confidence is still below 4, the app
surfaces: "you've only practiced this with [Package]'s questions, mixing in a
second source is associated with better retention than single-bank drilling."
This is a plain threshold check on data already being tracked, not a new
integration or content source, and it's informational only: it never blocks
anything, changes the pace target, or auto-flags the LOS for review.

### Recommended session split (content vs. practice)

Mark Meldrum's "power set" method for time-constrained candidates (30 minutes of
video/content at a time, then 60 minutes of exclusive problem-solving, a 1:2
ratio) matches the broader retrieval-practice/testing-effect literature already
cited for the diversity nudge above: reading and note-taking put material into
short-term memory, but practice testing is what moves it into long-term memory,
so most of the time budget belongs there. The progress endpoint surfaces a
`recommendedSplit` for the plan's remaining weekly hours: by default one-third to
content-role package time, two-thirds to questions-role package time (the ratio
is a named constant, adjustable later, not user-editable in v1). This is a
suggestion shown alongside the pace target, never an enforced schedule, and
requires no new entity: it's computed purely from the hours figure the pace
engine already has and a fixed ratio, with `PlanPackage` roles (already in this
design) telling it which packages count as "content" for context, not required
for the math itself. The app also never offers a note-taking or highlighting
tool beyond the short optional `note` field on a log entry, intentionally:
Meldrum's framing of manual note-taking as a low-value "administrative" task is
one more reason not to build toward it.

- **Export all**: one JSON file, the user's full state (plan, availability,
  packages, every log entry). Mirrors openGym's "export everything as one JSON
  file".
- **Export log**: CSV of log entries, for spreadsheet use.
- **Share/import a plan**: a small JSON file carrying just the plan shape (level,
  exam date, weekly availability, packages), importable into a fresh account or
  shared with someone else as a starting template. Does not carry log history.

### Auth

Email + password (scrypt, `timingSafeEqual`) with JWT access tokens and
`token_version` revocation, exactly as in `cron-server`'s `FUNC-auth.ts` pattern.
Google and GitHub OAuth as optional sign-in methods, same as `cron-server`. Same
rate-limit tiers on `/api/auth/*`.

### Hosting and deploy

- Frontend: Next.js 15 app on Vercel, calling the backend's API over HTTPS.
- Backend: Next.js 15 API-only app (same shape as `cron-server`), Dockerized with
  the same multi-stage Dockerfile pattern, deployed via the same GitHub Actions
  workflow (GHCR build + SSH pull + restart), reverse-proxied through the existing
  Caddy instance behind Cloudflare, new Postgres role/database
  (`reza_cfa_study_tracker` suggested), new subdomain (`cfa.polarislab.ir`
  suggested, builder's call to finalize), new GHCR image name
  (`cfa-study-tracker-api` suggested).
- No in-app scheduler: a host cron entry hits `/api/cron/tick` (Bearer-secret
  protected) on a schedule, same pattern as `cron-server`, for the nightly
  `ProgressSnapshot` write and the missed-day push notification (see Day-level
  compliance alerts). `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` join
  the env vars this backend needs.
- `CORS_ALLOW_ORIGINS` locked to the Vercel frontend's origin(s).

### PWA / mobile

Next.js frontend ships a web app manifest and service worker so it installs to a
phone home screen (add-to-homescreen), needs no app-store distribution, and can
receive Web Push (the service worker's `push` event handler, see Day-level
compliance alerts). Push works on Android (Chrome) and on iOS 16.4+ for an
installed PWA; older iOS Safari simply never prompts for permission, so the
feature degrades to in-app-only with no special-casing needed.
Offline support is read-only caching of already-loaded data (coverage view, last
pace numbers); logging a session requires connectivity in v1. Offline write queue and sync (confirmed out of scope for v1) is a real scope
increase, a v2 candidate if it turns out to matter.

### Branding and UI build process

Logo and app icon are a separate static-design task (the `canvas-design` skill),
not specified further here. All actual UI screens go through Reza's standing
front-end process: `frontend-design` to design and build, `impeccable` to audit,
with `taste-skill` and the `emil-design-eng` family directing art direction and
animation taste. No screen layouts are prescribed in this document; that's the
builder's work under that process.

Motion and 3D are a stated goal (see Goals), not an afterthought: **Framer
Motion** (`motion` package) for interface animation and page/section transitions,
**React Three Fiber** + **Three.js** (`@react-three/fiber`, `@react-three/drei`)
for 3D elements. `animation-performance` and `animation-vocabulary` (from the
`emil-design-eng` family) apply directly here; `break-ui` and `mobile-native`
cover the failure modes (busy low-end phones, reduced-motion users). 3D/motion
must degrade gracefully: respect `prefers-reduced-motion`, and stay performant on
a mid-range phone, not just on the builder's dev machine.

## What's left to the builder

- Exact Prisma schema (field types, indexes, migrations).
- Finalizing the new subdomain, GHCR image name, and Postgres role/db name (only
  defaults suggested above).
- Fetching and transcribing the Level II and III topic/LOS outlines into the same
  private seed-data shape already established for Level I, including each topic's
  official exam-weight range (published by CFA Institute alongside the outline).
- The exact pace-realism ceiling (a specific number of hours/day, or a multiple of
  the user's own recent average); any reasonable fixed default is consistent with
  this document.
- The exact pace-engine formula's edge cases (exam date in the past, zero
  remaining availability, a level change mid-plan via a new `StudyPlan` row).
- Whether `StudyPackage` is a fixed enum plus "Custom" or a free-form per-user
  list (either is consistent with this document; pick what's simplest to build).
- All actual screen design and layout, under the standing front-end process named
  above.
- Repo license file wording (MIT suggested, needs Reza's sign-off before adding).

## Related

- [cron-server infra](D:\website\cron-server\Infra.md): the deploy pattern this
  project's backend copies.
- [cron-server security](D:\website\cron-server\SECURITY.md): the auth and
  hardening pattern this project's backend copies.
