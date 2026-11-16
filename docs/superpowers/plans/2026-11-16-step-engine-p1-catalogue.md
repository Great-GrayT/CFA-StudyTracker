---
title: Step engine phase 1, catalogue data
type: spec
module: apps/backend/prisma
updated: 2026-11-16
status: active
---

# Step engine phase 1: catalogue data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed every package the step engine needs with real runtimes and question counts: Meldrum (with video lengths), UWorld (unchanged), Kaplan, Premium Pack, and a synthetic CFA LES reading package.

**Architecture:** Same pipeline as docs/SEEDING.md: one extractor per provider markdown -> `prisma/seed-data/package-*.json` -> reviewed `crosswalk-*.json` -> `validate-packages.ts` -> `seed-packages.ts`. Seed-data JSON is gitignored (licensed ids); only code, tests with fabricated ids, and docs are committed.

**Tech Stack:** TypeScript, tsx, Vitest, Prisma 6 (Postgres), existing `prisma/lib/markdown.ts` helpers.

**Spec:** docs/superpowers/specs/2026-11-16-step-engine-design.md (sections "Data changes", "Package priority", "Step 1", "Builder answers" 3 and 4).

## Global Constraints

- Never commit Drive ids, file names, or per-reading counts from the inventories, including in test fixtures (SEEDING.md:329-336). Fixtures use fabricated ids matching `/^[A-Za-z0-9_-]{25,}$/`.
- Inventories live in the repo root and are gitignored: `Mark_Meldrum_L2_2026_Inventory.md`, `UWorld_CFA_L2_Qbank_Inventory.md`, `Kaplan_CFA_L2_Qbank_Inventory.md`, `CFA_L2_Premium_Pack_Inventory.md`.
- Each extractor refuses to write when its parsed totals disagree with the document's stated totals.
- Package display names: "Mark Meldrum", "UWorld", "Kaplan Schweser", "Premium Pack", "CFA Institute LES". Never call the Premium Pack "CFA Institute".
- Slugs: `mm-l2`, `uw-l2-2025` (existing), `kaplan-l2`, `premium-l2`, `cfa-les`.
- Prose rule: no em dashes or double dashes in comments or docs.
- Run backend tests from `apps/backend` with `npx vitest run <path>`.

## Review Focus

- Meldrum "Getting started" bullets now read `(0:09:07, 41 MB)`: orientation videos must parse (currently fails "Total files mismatch: parsed 142, expected 144").
- Meldrum Ethics LM1 table contains LM2's Review and EOCQ files: units must be keyed by the LM number in the file name, not by the table they sit under. Expected: ET LM1 runtime 0:19:50, LM2 6:10:58.
- Approximate lengths (L1274 says ±1 s): durations parse from `h:mm:ss` and `m:ss`; sum within 60 s of the stated 143:07:51.
- Kaplan Ethics files 41.1 to 41.10 must group per Standard so `checkCrosswalk` sees no reading claimed twice.
- Premium 2026 Mock 4 Session 2 has no answers file and Ethics Q64 has no reading tag: extractor records both in `sourceNote`/problem-free warnings, not as hard failures.

---

### Task 1: Schema, kinds and loader fields

**Files:**
- Modify: `prisma/schema.prisma` (PackageResource), `prisma/lib/catalogue-types.ts`, `prisma/validate-packages.ts:36-84`, `prisma/seed-packages.ts:61-76`
- Create: migration via `npx prisma migrate dev --name catalogue_mock_sessions`
- Test: `prisma/validate-packages.test.ts`, `tests/catalogue/seed-packages.test.ts`

**Interfaces:**
- Produces: `ResourceKind` adds `"mock_session" | "quiz" | "checkpoint"`. `ResourceFile` adds `stmtCount?: number; title?: string; topicMix?: Record<string, number>` (key = curriculum topic order as string, value = question count). `PackageResource.topicMix Json?` column. Loader writes `durationSeconds`, `stmtCount`, `title`, `topicMix`.

- [ ] Step 1: Tests in `validate-packages.test.ts`: `mock_session` without `topicMix` -> error containing "topicMix"; `mock_session` whose topicMix values do not sum to `questionCount` -> error; `checkpoint` without `questionCount` -> error; `quiz` without `questionCount` -> no error. In `seed-packages.test.ts`: a loaded resource with `durationSeconds: 1493` and `topicMix: {"1": 4}` reads back with both fields.
- [ ] Step 2: Run, expect FAIL.
- [ ] Step 3: Add column + migration, extend types, kind rules (mock_session: questionCount + topicMix required, sum check; checkpoint: questionCount required; quiz: optional), loader fields.
- [ ] Step 4: Run both test files plus `npx tsc --noEmit`, expect PASS.
- [ ] Step 5: Commit `feat(catalogue): mock session, quiz and checkpoint kinds; load durations`.

### Task 2: Meldrum extractor reads the revised inventory

**Files:**
- Modify: `prisma/extract-meldrum.ts` (`extractOrientationVideos`, `extractModules`, `extractSeminarIndex`), `prisma/extract-meldrum.test.ts`

**Interfaces:**
- Consumes: Task 1 `ResourceFile.durationSeconds`.
- Produces: every video resource (lecture, eocq, review, seminar, update, orientation) carries `durationSeconds`. Exported helper `parseLength(s: string): number | null` in `prisma/lib/markdown.ts` (`"0:24:53"` -> 1493, `"24:53"` -> 1493, `"n/a"` -> null).

- [ ] Step 1: Tests: `parseLength` cases above; fixture updated to the new format (Length column in `File | Type | Length | Size` tables, orientation bullet `(0:09:07, 41 MB)`, a resource filed under the wrong LM table) asserts durations, orientation count, and that the misfiled file lands in the unit its file name names.
- [ ] Step 2: Run, expect FAIL.
- [ ] Step 3: Implement. Size regex accepts an optional leading length: `/\((?:(\d+:\d{2}(?::\d{2})?),\s*)?(\d+(?:\.\d+)?)\s+(MB|GB|KB)\)/`. Assign files to units by `extractLMNumberFromFileName`, falling back to the table's LM.
- [ ] Step 4: Run tests, then the real file: `npx tsx prisma/extract-meldrum.ts ../../Mark_Meldrum_L2_2026_Inventory.md prisma/seed-data/package-mm-l2-2026.json` exits 0; a one-off check prints total video seconds within 60 of 515271 and ET LM1 / LM2 totals 1190 / 22258 s (±10).
- [ ] Step 5: Re-run `npx tsx prisma/propose-crosswalk.ts check prisma/seed-data/crosswalk-mm-l2-2026.json prisma/seed-data/level-2.json`, expect no errors. Commit `fix(seed): Meldrum extractor reads video lengths and new orientation format`.

### Task 3: Kaplan extractor

**Files:**
- Create: `prisma/extract-kaplan.ts`, `prisma/extract-kaplan.test.ts`

**Interfaces:**
- Consumes: Task 1 kinds; `markdown.ts` helpers (`sectionLines`, `parseTable`, `parseCount`, `parseSizeKb`, `driveId`); UWorld's `cellDriveId` pattern (copy, do not import across scripts).
- Produces: `export function extractKaplan(markdown: string): ExtractResult<PackageFile>`; CLI `<source.md> <out.json>`. Package `{slug:"kaplan-l2", name:"Kaplan Schweser"}`, edition `{levelId:"II", year:"2026"}`.
  - Units: one per Kaplan reading `kaplan-l2/r<N>` for R1 to R40 and R42 (title from the inventory). Ethics R41.x files group into one unit per Standard, `kaplan-l2/r41-std<I..VII>` (Standard I = 41.1+41.2, II = 41.3, III = 41.4+41.5+41.6, IV = 41.7, V = 41.8, VI = 41.9, VII = 41.10), each file pair as its own `question_set` + `answer_set` resources.
  - Each `question_set`/`answer_set` carries the per-reading `questionCount`; `vignetteCount` when given (store lower bounds as given, mark `sourceNote: "lower bound"` for ">=" cells).
  - Edition resources: topic quizzes as `quiz` (questionCount where the inventory states it), checkpoint exams as `checkpoint` with questionCount 24, 32, 32 and `sourceNote` naming reading range (1-16, 17-29, 30-42). Module quizzes are not extracted.

- [ ] Step 1: Tests with a fabricated mini inventory (2 topics, Ethics with 41.1, 41.2, 41.3, a Total row): unit refs, the Standard I unit holds 4 resources, question counts sum to the Total row, mismatch produces a problem and `data: null`.
- [ ] Step 2: Run, expect FAIL.
- [ ] Step 3: Implement parsing §4 totals, §5 per-topic tables (`| Reading | Title | Questions | ...` columns as they appear in the current file; read the file's headers first), §7 quizzes and checkpoints, reconcile against the stated total questions (2,463) and file counts.
- [ ] Step 4: Run tests; run on the real file to `prisma/seed-data/package-kaplan-l2-2026.json`; `npx tsx prisma/validate-packages.ts prisma/seed-data/package-kaplan-l2-2026.json` passes.
- [ ] Step 5: Commit `feat(seed): Kaplan Schweser extractor`.

### Task 4: Premium Pack extractor

**Files:**
- Create: `prisma/extract-premium.ts`, `prisma/extract-premium.test.ts`

**Interfaces:**
- Produces: `export function extractPremium(markdown: string, level: LevelFile): ExtractResult<PackageFile>` (needs level-2.json to resolve mock topic names to topic order). Package `{slug:"premium-l2", name:"Premium Pack"}`, edition year `"2026"`.
  - Units: one per Practice Pack reading tag, ref `premium-l2/<topic-slug>/<n>`, title = reading title as written. Resource `question_set` with `questionCount`, `calcCount`, `stmtCount` (omit when `n/c`), `wordCount` (question words when given), `externalId` = that topic's shared PDF id, `sourceNote: "shared topic file"`. The "Guidance for Standards I-VII" tag is one unit (fans out in the crosswalk).
  - Edition resources: one `mock_session` per session for 2026 (6 mocks x 2) and 2025 (4 x 2), ref `premium-l2/mock/<year>-<mock>-s<session>`, `title` "2026 Mock 1, Session 1", `questionCount` 44, `topicMix` from the per-vignette topic tables (topic name -> curriculum topic order via aliases Corporate Issuers=Corporate Finance, Equity Valuation=Equities, Portfolio Management=Portfolio Construction), `sourceNote` lists caveats ("no answers file", "OCR counts", "answers file is a results screen").
  - Ethics Q64 (untagged) is dropped from unit counts and reported as a warning line on stdout, not a problem.

- [ ] Step 1: Tests with a fabricated mini inventory: units and counts, topic alias resolution, mock topicMix sums to 44, a mock with missing answers gets the sourceNote, totals mismatch -> `data: null`.
- [ ] Step 2: Run, expect FAIL.
- [ ] Step 3: Implement; reconcile Practice Pack total (750 questions incl. Q64, so 749 tagged) and 20 sessions x 44.
- [ ] Step 4: Run tests; real file to `prisma/seed-data/package-premium-l2-2026.json`; validate passes.
- [ ] Step 5: Commit `feat(seed): Premium Pack extractor with mock sessions`.

### Task 5: Crosswalks, LES package, seeding scripts and docs

**Files:**
- Create: `prisma/build-les.ts`, `prisma/build-les.test.ts`
- Modify: `prisma/propose-crosswalk.ts` (only if needed for fan-out proposal), `scripts/seed-production.sh:43-50,136-140`, `apps/backend/deploy/seed-level.sh` (if it lists files), `docs/SEEDING.md`
- Local only (gitignored): `prisma/seed-data/crosswalk-kaplan-l2-2026.json`, `crosswalk-premium-l2-2026.json`, `package-cfa-les-2027.json`, `crosswalk-cfa-les-2027.json`

**Interfaces:**
- Consumes: Tasks 2 to 4 package files, `level-2.json`, `crosswalk-mm-l2-2026.json`.
- Produces: `export function buildLes(mm: PackageFile, mmCrosswalk: CrosswalkFile, level: LevelFile, totalHours = 200): { pkg: PackageFile; crosswalk: CrosswalkFile }`. One unit per curriculum reading, ref `cfa-les/t<topic>/r<reading>`, one `notes` resource with `durationSeconds` = share of `totalHours*3600`, `sourceNote: "synthetic: Meldrum core share"`, `externalId` = deterministic 25+ char id derived from the ref (e.g. `les` + sha1 hex), `sizeKb: 0`. Core = lecture + eocq + review + update seconds (seminars and orientation excluded). Topic share = topic core / all core; module share inside a topic = reading core / topic core, where a Meldrum unit mapped to several readings splits its core evenly across them; readings with no Meldrum unit get an even share of their topic's hours. Crosswalk maps each unit to its own reading.

- [ ] Step 1: `build-les.test.ts`: with a fabricated 2-topic mm package, durations sum to exactly `totalHours*3600` (integer rounding remainder goes to the largest unit), topic split matches core share, a fan-out unit splits evenly, an uncovered reading gets the even share.
- [ ] Step 2: Run, expect FAIL; implement; PASS.
- [ ] Step 3: Propose crosswalks for Kaplan and Premium, then hand-edit: Kaplan R1 -> readings 1 to 4, R2 to R4 -> 5 to 7, R5 to R39 -> 8 to 42, R40 -> 43, R41 Standard units -> 44 to 50 one each, R42 -> 51; Premium Guidance unit -> 44 to 50, Code of Ethics -> 43, Application -> 51. `propose-crosswalk.ts check` passes for both with 0 uncovered.
- [ ] Step 4: Add the four new files to the REQUIRED list and expected totals in `seed-production.sh` and SEEDING.md (recompute totals by running the seed against the test DB and reading its report). Run `npx vitest run prisma tests/catalogue` and `npx tsc --noEmit`, expect PASS. Seed the dev DB (`pnpm db:seed:packages`) and confirm the report.
- [ ] Step 5: Commit `feat(seed): Kaplan, Premium and LES crosswalks and seeding`.
