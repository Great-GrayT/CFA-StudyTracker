# Provider Catalogue and Extraction Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the Mark Meldrum 2026 and UWorld 2025 Level II catalogues into the database, crosswalked to the seeded 2027 curriculum, so the scheduler built in the next plan has real resources with real facts to prescribe.

**Architecture:** Five new Prisma tables hanging off the existing `StudyPackage`, filled by three extractors over one shared markdown library. Each extractor turns a gitignored research document into a gitignored JSON seed file and refuses to emit anything whose self-checks disagree with the document's own stated totals. A separate loader, not the curriculum seed, upserts those files on real unique constraints.

**Tech Stack:** TypeScript on Node 22 (native type stripping, no `tsx` in the runtime image), Prisma 6, Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-daily-prescription-design.md`

## Scope note

The spec covers four subsystems. This plan is the first and stands alone: when it is done, the catalogue is queryable and verified, with nothing scheduling against it yet. The remaining three are **effort model and scheduler core**, **lifecycle** (review ladder, mocks, feasibility, calibration, contract tracking), and **API and day view**. Each needs the one before it, so they get their own plans once this lands.

## Global Constraints

- Every script under `prisma/` must run under plain `node` on Node 22. No `tsx` at runtime, because the deployed image does not have it.
- Every script derives its own directory from `import.meta.url`. `__dirname` is undefined: these files are reparsed as ES modules.
- Seed data stays in `apps/backend/prisma/seed-data/`, which is gitignored (`prisma/seed-data/*.json`). No provider unit title, file name, Drive id, size, page range or question count may be committed.
- Provider names, slugs and edition years may be committed. Nothing else about a provider may.
- Prose in code comments, docs and commit messages uses no em-dashes or double-dashes. Commas, colons, parentheses or a new sentence instead.
- Extractor tests must not read the research documents: those are gitignored and absent in CI. Tests use inline markdown fixtures.
- Loading is idempotent. A re-run updates provider facts in place and must never destroy a locally measured `durationSeconds`.

## Review Focus

Five failure modes the spec implies that no task's happy path exercises. Each has its test named in the task that owns the code.

1. **A reseed wiping a harvested video duration.** `durationSeconds` is measured by hand and lives only in the database; the seed file always has it null. A naive upsert overwrites it with null and the measurement is gone with no error. Pinned in Task 7.
2. **Thousands separators silently truncating a number to its first digit.** This bites twice, in both documents. Meldrum sizes read `1,005 MB`, so `parseInt` yields 1 and the two largest files in the course (Ethics LM2 and LM3) all but vanish. UWorld answer word counts read `3,304`, and summing them naively gives 378 instead of 396,032, which would collapse the 62.5 hours of explanation-review budget to nothing. Confirmed by reproducing both while writing this plan. Pinned in Task 2, for every numeric cell rather than for sizes alone.
3. **The loader running before the curriculum is seeded.** Crosswalk rows point at `Reading` ids the curriculum seed generates. Absent, the loader must fail loudly and name the missing level, never skip the way `seed.ts` deliberately does. Pinned in Task 7.
4. **A renumbered curriculum silently remapping the crosswalk.** Resolution is by topic and reading order, so a curriculum edition that moves a reading binds provider content to the wrong module while every row still loads. The stored name check must reject it. Pinned in Task 5.
5. **A Drive URL reaching a user who does not own the edition.** `GET /api/packages` returns every `userId: null` preset to every caller, and the catalogue hangs off exactly those presets. Edition ownership must gate catalogue reads independently of package presethood. Pinned in Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | Five new models, `StudyPackage.slug` |
| `prisma/migrations/<ts>_add_provider_catalogue/` (create) | The migration |
| `prisma/lib/markdown.ts` (create) | Shared parsing: tables, Drive ids, sizes |
| `prisma/lib/markdown.test.ts` (create) | Its tests |
| `prisma/lib/catalogue-types.ts` (create) | The seed file shapes, shared by extractors, validator and loader |
| `prisma/extract-meldrum.ts` (create) | Meldrum document to seed file |
| `prisma/extract-uworld.ts` (create) | UWorld document to seed file |
| `prisma/propose-crosswalk.ts` (create) | Proposes unit-to-reading matches for human review |
| `prisma/validate-packages.ts` (create) | Structural check on a package or crosswalk file |
| `prisma/seed-packages.ts` (create) | Loads package and crosswalk files |
| `tests/helpers/test-db.ts` (modify) | Delete the five new tables in FK-safe order |
| `tests/helpers/fixtures.ts` (modify) | `seedCatalogue` helper |
| `deploy/seed-level.sh` (modify) | Optional second phase |
| `docs/SEEDING.md` (modify) | Catalogue seeding runbook |

Extractors are separate files rather than one script with a mode flag: they share only the parsing library, and a reviewer rejecting the Meldrum self-checks should not have to re-review the UWorld ones.

---

### Task 1: Schema and migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/<timestamp>_add_provider_catalogue/migration.sql` (generated)
- Modify: `apps/backend/tests/helpers/test-db.ts`
- Test: `apps/backend/tests/catalogue/schema.test.ts`

**Interfaces:**
- Produces: Prisma models `PackageEdition`, `PackageUnit`, `PackageResource`, `PackageUnitReading`, `PackageUnitLos`; `StudyPackage.slug`. Every later task reads these through `db` from `src/lib/db`.

Models, with the fields the spec's data model section fixes:

- `PackageEdition`: `id`, `packageId`, `levelId`, `year`, `ownerUserId` (nullable), `sourceUrl`, `snapshotDate`, `note`, relations to `StudyPackage` and `Level`, `@@unique([packageId, levelId, year])`, `@@index([ownerUserId])`.
- `PackageUnit`: `id`, `editionId`, `ref`, `order`, `providerLabel`, `title`, `topicLabel`, `sourceUrl`, `notesPageStart`, `notesPageCount`, `@@unique([editionId, ref])`, `@@unique([editionId, order])`.
- `PackageResource`: `id`, `editionId`, `unitId` (nullable, for edition-level assets), `ref`, `kind`, `title`, `externalId`, `sourceUrl`, `sizeKb` (Int, nullable), `durationSeconds` (Int, nullable), `pageStart`, `pageCount`, `wordCount`, `questionCount`, `vignetteCount`, `calcCount`, `stmtCount`, `exhibitCount`, `sourceNote`, `@@unique([editionId, ref])`, `@@index([unitId, kind])`, `@@index([externalId])`.
- `PackageUnitReading`: `id`, `unitId`, `readingId`, `coverage` (default `"full"`), `note`, `@@unique([unitId, readingId])`, `@@index([readingId])`.
- `PackageUnitLos`: `id`, `unitId`, `sourceLabel`, `losId` (nullable), `questionCount`, `retired` (default false), `note`, `@@unique([unitId, sourceLabel])`, `@@index([losId])`.
- `StudyPackage.slug`: `String? @unique`. Nullable deliberately: `anyPresetPackage()` in `tests/helpers/fixtures.ts:230` creates a package with no slug, and a non-null column would break every suite that uses it.

Size is `sizeKb Int`, not `sizeBytes BigInt`. The source states whole megabytes, so bytes would be invented precision, and a `BigInt` column throws on `JSON.stringify` the first time any route returns a resource. Kilobytes keep the 40 KB worksheets, never overflow a 32-bit int, and serialize as an ordinary number.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/catalogue/schema.test.ts
test("a resource's natural key is unique within an edition", async () => {
  // create package, edition, unit, then two resources sharing ref "qm/lm1/lecture/1"
  await expect(createSecondResourceWithSameRef()).rejects.toThrow();
});

test("resetDb removes catalogue rows so a later suite starts clean", async () => {
  await seedOneEditionWithOneUnitAndResource();
  await resetDb();
  expect(await db.packageEdition.count()).toBe(0);
  expect(await db.packageResource.count()).toBe(0);
  expect(await db.packageUnitReading.count()).toBe(0);
});

// Review Focus 5
test("an edition records an owner so catalogue reads can be gated on it", async () => {
  const user = await registerUser();
  const pkg = await db.studyPackage.create({ data: { name: "Mark Meldrum", slug: "mark-meldrum", userId: null } });
  const ed = await db.packageEdition.create({
    data: { packageId: pkg.id, levelId: "II", year: "2026", ownerUserId: user.userId },
  });
  // The package is a shared preset, the edition is not.
  expect(pkg.userId).toBeNull();
  expect(ed.ownerUserId).toBe(user.userId);
  expect(await db.packageEdition.count({ where: { ownerUserId: null } })).toBe(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter backend exec vitest run tests/catalogue/schema.test.ts`
Expected: FAIL, `db.packageEdition` is undefined.

- [ ] **Step 3: Add the five models and `StudyPackage.slug` to `schema.prisma`**

Add back-relations on `StudyPackage`, `Level`, `Reading` and `LOS`. Comment each model with why it exists, not what its fields are; `ref` in particular needs the reason it is a deterministic string rather than a composite key (all seven Quant modules share one notes PDF, so a Drive id is not unique per resource, and a composite key containing a nullable column enforces nothing in Postgres).

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter backend exec prisma migrate dev --name add_provider_catalogue`
Expected: migration created, client regenerated.

- [ ] **Step 5: Add the five tables to `resetDb` in FK-safe order**

Children before parents, and the whole block before `studyPackage.deleteMany` and before `lOS` / `reading`: `packageUnitLos`, `packageUnitReading`, `packageResource`, `packageUnit`, `packageEdition`. Omitting this leaks rows that later make unrelated suites fail on foreign key constraints, which reads as flakiness rather than a missing cleanup.

- [ ] **Step 6: Run the new tests and the whole suite**

Run: `pnpm --filter backend test`
Expected: new tests PASS, existing 194 still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations apps/backend/tests/catalogue/schema.test.ts apps/backend/tests/helpers/test-db.ts
git commit -m "feat(db): add the provider catalogue tables"
```

---

### Task 2: Shared markdown parsing library

**Files:**
- Create: `apps/backend/prisma/lib/markdown.ts`
- Test: `apps/backend/prisma/lib/markdown.test.ts`

**Interfaces:**
- Produces:
  - `parseCount(text: string): number | null` accepting `"3,304"`, `"27"`, `""`, and used for every numeric table cell
  - `parseSizeKb(text: string): number | null` accepting `"1,005 MB"`, `"1.6 GB"`, `"40 KB"`, `"66 MB"`
  - `driveId(urlOrMarkdown: string): string | null` for both `/file/d/<id>/view` and `/drive/folders/<id>`
  - `parseTable(lines: string[], startIndex: number): { rows: Record<string, string>[]; endIndex: number }` keyed on the header cells
  - `linkTarget(cell: string): { text: string; url: string | null }` for a markdown link in a table cell
  - `sectionLines(markdown: string, heading: RegExp, stopAt: RegExp): string[]`

- [ ] **Step 1: Write the failing tests**

```ts
// Review Focus 2, half one: word counts. Summing these naively gives 378
// instead of 396,032 across the real document.
test.each([
  ["3,304", 3304],
  ["27", 27],
  ["10,744", 10744],
  ["", null],
])("parseCount(%j) is %j", (input, expected) => {
  expect(parseCount(input)).toBe(expected);
});

// Review Focus 2, half two: sizes, where the same defect hides the two
// largest files in the course.
test.each([
  ["1,005 MB", 1029120],
  ["1,590 MB", 1628160],
  ["66 MB", 67584],
  ["1.6 GB", 1677722],
  ["40 KB", 40],
  ["", null],
])("parseSizeKb(%j) is %j", (input, expected) => {
  expect(parseSizeKb(input)).toBe(expected);
});

test("driveId reads a file id and a folder id", () => {
  expect(driveId("https://drive.google.com/file/d/1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/view")).toBe("1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  expect(driveId("https://drive.google.com/drive/folders/1yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy")).toBe("1yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy");
  expect(driveId("not a url")).toBeNull();
});

test("parseTable keys rows on the header and stops at the first non-row", () => {
  const lines = ["| File | Type | Size |", "|---|---|---|", "| [a](u) | Video | 66 MB |", "", "next"];
  const { rows, endIndex } = parseTable(lines, 0);
  expect(rows).toEqual([{ File: "[a](u)", Type: "Video", Size: "66 MB" }]);
  expect(endIndex).toBe(3);
});

test("parseTable ignores a bold total row", () => {
  // Meldrum's per-module tables end with "| **Total** | 2 files | **86 MB** |"
  const lines = ["| File | Type | Size |", "|---|---|---|", "| [a](u) | Video | 66 MB |", "| **Total** | 2 files | **86 MB** |"];
  expect(parseTable(lines, 0).rows).toHaveLength(1);
});

test("linkTarget splits text from url", () => {
  expect(linkTarget("[2026 L2 XX LM1 Video.mp4](https://x/d/ABC/view)")).toEqual({
    text: "2026 L2 XX LM1 Video.mp4",
    url: "https://x/d/ABC/view",
  });
  expect(linkTarget("plain")).toEqual({ text: "plain", url: null });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter backend exec vitest run prisma/lib/markdown.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the six functions in `prisma/lib/markdown.ts`**

`parseCount` strips thousands separators and surrounding markdown emphasis before parsing, and is the only way any extractor reads a numeric cell. `parseSizeKb` builds on it, multiplying by unit (KB 1, MB 1024, GB 1024²) and rounding to an integer. A total row is one whose first cell contains `**Total**`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter backend exec vitest run prisma/lib/markdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/lib/markdown.ts apps/backend/prisma/lib/markdown.test.ts
git commit -m "feat(seed): add the shared markdown parsing library"
```

---

### Task 3: Meldrum extractor

**Files:**
- Create: `apps/backend/prisma/lib/catalogue-types.ts`
- Create: `apps/backend/prisma/extract-meldrum.ts`
- Test: `apps/backend/prisma/extract-meldrum.test.ts`

**Interfaces:**
- Consumes: `parseSizeKb`, `driveId`, `parseTable`, `linkTarget`, `sectionLines` from Task 2.
- Produces:
  - `catalogue-types.ts`: `type PackageFile = { package: { slug: string; name: string }; edition: { levelId: string; year: string; sourceUrl?: string; snapshotDate?: string }; units: UnitFile[]; editionResources: ResourceFile[] }`, `UnitFile`, `ResourceFile`, and `type ExtractResult<T> = { data: T | null; problems: string[] }`. Used by Tasks 4, 5, 6 and 7.
  - `extractMeldrum(markdown: string): ExtractResult<PackageFile>`

The extractor returns problems rather than throwing, so tests assert on them directly and the CLI wrapper exits non-zero when the list is non-empty. Resource `kind` is drawn from the closed vocabulary `lecture`, `eocq`, `review`, `seminar`, `update`, `orientation`, `notes`, `formula_sheet`, `worksheet`.

The document's three parts must all be read: 139 typed rows in the per-module tables, 3 topic-level seminars that appear only in the seminar index, and 2 orientation videos in the front matter. Reading only the module tables loses 5 files.

- [ ] **Step 1: Write the failing tests**

```ts
test("a module's resources carry its facts", () => {
  const { data, problems } = extractMeldrum(FIXTURE); // inline markdown, two modules
  expect(problems).toEqual([]);
  const lm2 = data!.units.find((u) => u.ref === "qm/lm2")!;
  expect(lm2.title).toBe("Evaluating Regression Model Fit and Interpreting Model Results");
  expect(lm2.notesPageStart).toBe(6);
  expect(lm2.notesPageCount).toBe(5);
  const lecture = lm2.resources.find((r) => r.kind === "lecture")!;
  expect(lecture.externalId).toBe("1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz");
  expect(lecture.sizeKb).toBe(96256);
  expect(lecture.durationSeconds).toBeUndefined();
});

test("resource refs are unique and deterministic", () => {
  const { data } = extractMeldrum(FIXTURE);
  const refs = data!.units.flatMap((u) => u.resources.map((r) => r.ref));
  expect(new Set(refs).size).toBe(refs.length);
  expect(refs).toContain("qm/lm2/seminar/2");
});

test("the Ethics LM1 folder's LM2 files are attributed to LM2", () => {
  // The source lists "2026 L2 XX LM2 Review.mp4" under LM1's table.
  const { data } = extractMeldrum(ETHICS_FIXTURE);
  const lm1 = data!.units.find((u) => u.ref === "et/lm1")!;
  const lm2 = data!.units.find((u) => u.ref === "et/lm2")!;
  expect(lm1.resources.map((r) => r.kind)).toEqual(["lecture"]);
  expect(lm2.resources.some((r) => r.kind === "review" && r.sourceNote?.includes("LM1 folder"))).toBe(true);
});

test("a type histogram that disagrees with the document is a problem", () => {
  const { data, problems } = extractMeldrum(FIXTURE_MISSING_ONE_EOCQ);
  expect(data).toBeNull();
  expect(problems.join(" ")).toMatch(/eocq/i);
});

test("a module with no notes range is a problem unless its heading says so", () => {
  expect(extractMeldrum(FIXTURE_NO_NOTES_RANGE).problems.join(" ")).toMatch(/notes/i);
  expect(extractMeldrum(FIXTURE_NOTES_EXEMPT).problems).toEqual([]); // heading reads "covered by video, no notes pages"
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter backend exec vitest run prisma/extract-meldrum.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `catalogue-types.ts` and `extractMeldrum`**

Expected counts are parameters with the document's stated values as defaults, so a fixture of two modules can assert the mechanism without asserting 45. The real run asserts: 45 module headings; lecture 45, eocq 42, review 31, seminar 20, update 1 (139 total); 23 seminar index entries of which exactly 3 are topic level; 2 orientation videos; and 139 + 3 + 2 = 144 against the document's own stated total.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter backend exec vitest run prisma/extract-meldrum.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the CLI wrapper and run it against the real document**

Usage: `node prisma/extract-meldrum.ts <source.md> <out.json>`. Prints the per-type counts and the reconciliation, exits 1 on any problem.

Run: `pnpm --filter backend exec tsx prisma/extract-meldrum.ts "../../Mark_Meldrum_L2_2026_Inventory.md" prisma/seed-data/package-mm-l2-2026.json`
Expected: 45 units, 144 files reconciled, exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/prisma/lib/catalogue-types.ts apps/backend/prisma/extract-meldrum.ts apps/backend/prisma/extract-meldrum.test.ts
git commit -m "feat(seed): extract the Meldrum catalogue from its inventory"
```

---

### Task 4: UWorld extractor

**Files:**
- Create: `apps/backend/prisma/extract-uworld.ts`
- Test: `apps/backend/prisma/extract-uworld.test.ts`

**Interfaces:**
- Consumes: Task 2's library, Task 3's `catalogue-types.ts`.
- Produces: `extractUworld(markdown: string): ExtractResult<PackageFile>`, with each reading emitting one `question_set` and one `answer_set` resource and an optional `losRefinements` array on the unit.

Role comes from the per-reading table, never from a filename: one answers file lacks the usual suffix, and inferring from the name drops it.

- [ ] **Step 1: Write the failing tests**

```ts
test("a reading's two resources carry the split facts", () => {
  const { data, problems } = extractUworld(FIXTURE);
  expect(problems).toEqual([]);
  const r2 = data!.units.find((u) => u.ref === "uworld/quant/r2")!;
  const q = r2.resources.find((r) => r.kind === "question_set")!;
  const a = r2.resources.find((r) => r.kind === "answer_set")!;
  expect(q.questionCount).toBe(12);
  expect(q.vignetteCount).toBe(2);
  expect(q.calcCount).toBe(3);
  expect(a.pageCount).toBe(27);
  expect(a.wordCount).toBe(4397);
  expect(a.exhibitCount).toBe(20);
});

test("an answers file whose name lacks the suffix is still bound by drive id", () => {
  // The ESG answers file is named without " - Answers".
  const { data, problems } = extractUworld(ESG_FIXTURE);
  expect(problems).toEqual([]);
  const esg = data!.units.find((u) => u.ref === "uworld/corporate/r2")!;
  expect(esg.resources.filter((r) => r.kind === "answer_set")).toHaveLength(1);
});

test("column sums that disagree with the document's totals are a problem", () => {
  expect(extractUworld(FIXTURE_BAD_TOTALS).problems.join(" ")).toMatch(/question/i);
});

test("the retired machine learning outcome is kept and flagged, not dropped", () => {
  const { data } = extractUworld(QUANT_LOS_FIXTURE);
  const ml = data!.units.find((u) => u.ref === "uworld/quant/r6")!;
  const retired = ml.losRefinements!.find((l) => l.sourceLabel.startsWith("Describe neural networks"))!;
  expect(retired.retired).toBe(true);
  expect(retired.questionCount).toBe(3);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter backend exec vitest run prisma/extract-uworld.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `extractUworld`**

Real-run assertions: 43 reading rows with no malformed row; column sums of 199 vignettes, 1064 questions, 256 calculation stems and 2178 answer pages against the document's stated totals; 86 files in the file index; every per-reading question and answer link resolving to exactly one file row by Drive id; derived words per question landing at 372 as an independent check the word column parsed; and for the Quant outcome map, 7 blocks, 40 rows, 120 questions, with exactly one row failing to match the seeded 2027 text. Any second unmatched row is an error, not a warning.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter backend exec vitest run prisma/extract-uworld.test.ts`
Expected: PASS.

- [ ] **Step 5: Run against the real document**

Run: `pnpm --filter backend exec tsx prisma/extract-uworld.ts "../../UWorld_CFA_L2_Qbank_Inventory.md" prisma/seed-data/package-uworld-l2-2025.json`
Expected: 43 units, 1064 questions, 86 files reconciled, exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/prisma/extract-uworld.ts apps/backend/prisma/extract-uworld.test.ts
git commit -m "feat(seed): extract the UWorld catalogue from its inventory"
```

---

### Task 5: Crosswalk proposal and completeness check

**Files:**
- Create: `apps/backend/prisma/propose-crosswalk.ts`
- Test: `apps/backend/prisma/propose-crosswalk.test.ts`
- Creates (gitignored, human-reviewed): `apps/backend/prisma/seed-data/crosswalk-l2-2027.json`

**Interfaces:**
- Consumes: Task 3's `PackageFile` type, the seeded `level-2.json`.
- Produces:
  - `type CrosswalkFile = { levelId: string; version: string; packageSlug: string; map: MapEntry[]; uncovered: UncoveredEntry[] }` where `MapEntry = { unitRef: string; readings: { topicOrder: number; readingOrder: number; readingName: string }[] }`
  - `proposeCrosswalk(pkg: PackageFile, level: LevelFile): { file: CrosswalkFile; unmatched: string[] }`
  - `checkCrosswalk(file: CrosswalkFile, level: LevelFile): string[]`

The proposer only drafts. The emitted file is reviewed by a human once and then is the record; the loader never name-matches. `checkCrosswalk` is what runs on every load.

- [ ] **Step 1: Write the failing tests**

```ts
test("map and uncovered together account for every reading exactly once", () => {
  expect(checkCrosswalk(GOOD, LEVEL)).toEqual([]);
  expect(checkCrosswalk(MISSING_ONE_READING, LEVEL).join(" ")).toMatch(/51|accounted/i);
  expect(checkCrosswalk(READING_CLAIMED_TWICE, LEVEL).join(" ")).toMatch(/twice|duplicate/i);
});

test("one unit may cover many readings", () => {
  // Ethics: Meldrum LM2 covers 2027 modules 2 through 8.
  const guidance = GOOD.map.find((m) => m.unitRef === "et/lm2")!;
  expect(guidance.readings).toHaveLength(7);
  expect(checkCrosswalk(GOOD, LEVEL)).toEqual([]);
});

// Review Focus 4
test("a stored name that no longer matches the curriculum is rejected", () => {
  const renumbered = structuredClone(GOOD);
  renumbered.map[0].readings[0].readingName = "Some Other Reading";
  expect(checkCrosswalk(renumbered, LEVEL).join(" ")).toMatch(/name/i);
});

test("the proposer reports a drifted title rather than guessing", () => {
  // "Evaluation Quality of Financial Reports" against "Evaluating Quality of Financial Reports"
  const { unmatched } = proposeCrosswalk(PKG_WITH_DRIFTED_TITLE, LEVEL);
  expect(unmatched).toContain("fsa/lm5");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter backend exec vitest run prisma/propose-crosswalk.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `proposeCrosswalk` and `checkCrosswalk`**

`checkCrosswalk` resolves by `(topicOrder, readingOrder)` and then asserts the stored `readingName` equals the level's, which is the whole defence against a renumbered curriculum. The proposer matches on normalised title (lowercased, collapsed whitespace, unified dashes) and reports anything it cannot match exactly rather than taking a near miss.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter backend exec vitest run prisma/propose-crosswalk.test.ts`
Expected: PASS.

- [ ] **Step 5: Propose, then review by hand, both crosswalks**

Run for each package. Expected after review: Meldrum 45 units covering all 51 readings with nothing uncovered, Ethics LM1 to module 1, LM2 to modules 2 through 8, LM3 to module 9. UWorld 43 units covering 49 readings, with exactly two uncovered: FSA Integration of Financial Statement Analysis Techniques and Ethics module 1.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/prisma/propose-crosswalk.ts apps/backend/prisma/propose-crosswalk.test.ts
git commit -m "feat(seed): propose and check the provider crosswalk"
```

---

### Task 6: Package file validator

**Files:**
- Create: `apps/backend/prisma/validate-packages.ts`
- Test: `apps/backend/prisma/validate-packages.test.ts`

**Interfaces:**
- Consumes: Task 3's types, Task 5's `checkCrosswalk`.
- Produces: `validatePackageFile(file: PackageFile): string[]` and a CLI taking one or more file paths, mirroring `validate-seed.ts`'s output shape and exit behaviour.

- [ ] **Step 1: Write the failing tests**

```ts
test("an unknown resource kind is rejected", () => {
  expect(validatePackageFile(withKind("podcast")).join(" ")).toMatch(/kind/i);
});

test("a kind must carry the facts it needs and none it cannot have", () => {
  expect(validatePackageFile(questionSetWithoutQuestionCount()).join(" ")).toMatch(/questionCount/i);
  expect(validatePackageFile(lectureWithQuestionCount()).join(" ")).toMatch(/questionCount/i);
});

test("unit order must be gapless and refs unique", () => {
  expect(validatePackageFile(withUnitOrders([1, 2, 4])).join(" ")).toMatch(/order/i);
  expect(validatePackageFile(withDuplicateRef()).join(" ")).toMatch(/ref/i);
});

test("a drive id that is not a drive id is rejected", () => {
  expect(validatePackageFile(withExternalId("nope")).join(" ")).toMatch(/externalId|drive/i);
});

test("a valid file produces no problems", () => {
  expect(validatePackageFile(GOOD_PACKAGE_FILE)).toEqual([]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter backend exec vitest run prisma/validate-packages.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `validatePackageFile` and the CLI**

Required and forbidden facts per kind are one table in the file, so adding a kind is one row. Drive ids match `^[A-Za-z0-9_-]{25,}$`.

- [ ] **Step 4: Run to verify they pass, then validate the two real files**

Run: `pnpm --filter backend exec vitest run prisma/validate-packages.test.ts`
Expected: PASS.

Run: `pnpm --filter backend exec tsx prisma/validate-packages.ts prisma/seed-data/package-mm-l2-2026.json prisma/seed-data/package-uworld-l2-2025.json prisma/seed-data/crosswalk-l2-2027.json`
Expected: counts printed, `valid`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/validate-packages.ts apps/backend/prisma/validate-packages.test.ts
git commit -m "feat(seed): validate provider catalogue files before loading"
```

---

### Task 7: Loader, deploy script and runbook

**Files:**
- Create: `apps/backend/prisma/seed-packages.ts`
- Test: `apps/backend/tests/catalogue/seed-packages.test.ts`
- Modify: `apps/backend/tests/helpers/fixtures.ts`
- Modify: `apps/backend/package.json` (add `db:seed:packages`)
- Modify: `apps/backend/deploy/seed-level.sh`
- Modify: `docs/SEEDING.md`

**Interfaces:**
- Consumes: Tasks 1, 3, 5, 6.
- Produces: `seedPackages(dir: string): Promise<SeedReport>` where `SeedReport = { editions: number; units: number; resources: number; mappings: number; refinements: number }`, plus `seedCatalogue(opts)` in `tests/helpers/fixtures.ts` for later plans.

Upserts on the real unique keys from Task 1 rather than hand-rolling find-then-create the way `seed.ts` must.

- [ ] **Step 1: Write the failing tests**

```ts
// Review Focus 1: the measurement that must survive a reseed.
test("a reseed preserves a locally measured duration", async () => {
  await seedPackages(FIXTURE_DIR);
  const ref = "qm/lm1/lecture/1";
  await db.packageResource.updateMany({ where: { ref }, data: { durationSeconds: 1860 } });
  await seedPackages(FIXTURE_DIR); // the file still carries null
  expect((await db.packageResource.findFirst({ where: { ref } }))!.durationSeconds).toBe(1860);
});

test("seeding twice creates no duplicate rows", async () => {
  const first = await seedPackages(FIXTURE_DIR);
  await seedPackages(FIXTURE_DIR);
  expect(await db.packageUnit.count()).toBe(first.units);
  expect(await db.packageResource.count()).toBe(first.resources);
});

test("a changed fact is updated in place", async () => {
  await seedPackages(FIXTURE_DIR);
  await seedPackages(FIXTURE_DIR_WITH_LARGER_LECTURE);
  expect((await db.packageResource.findFirst({ where: { ref: "qm/lm1/lecture/1" } }))!.sizeKb).toBe(99999);
});

// Review Focus 3
test("loading before the curriculum is seeded fails loudly", async () => {
  await resetDb(); // no Level II
  await expect(seedPackages(FIXTURE_DIR)).rejects.toThrow(/level II/i);
});

test("the crosswalk binds a unit to every reading it covers", async () => {
  await seedPackages(FIXTURE_DIR);
  const unit = await db.packageUnit.findFirst({ where: { ref: "et/lm2" }, include: { readings: true } });
  expect(unit!.readings).toHaveLength(7);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter backend exec vitest run tests/catalogue/seed-packages.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `seedPackages`**

Reads `package-*.json` and `crosswalk-*.json` from the directory, validates each before writing, upserts package then edition then units then resources then crosswalk then refinements. Resource upsert's update clause omits `durationSeconds` entirely so a null in the file cannot overwrite a measurement; that omission is the Review Focus 1 behaviour and needs a comment saying so. Throws naming the level when the crosswalk's level has no `Reading` rows.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter backend exec vitest run tests/catalogue/seed-packages.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `seedCatalogue` to `tests/helpers/fixtures.ts`**

A small edition with two units and a crosswalk, for the scheduler plan's tests to build on.

- [ ] **Step 6: Seed the real catalogues locally and verify**

Run: `pnpm --filter backend exec tsx prisma/seed-packages.ts prisma/seed-data`
Expected: 2 editions, 88 units, resources and mappings reported; Meldrum 51 readings covered, UWorld 49 with 2 uncovered.

- [ ] **Step 7: Extend `deploy/seed-level.sh` and `docs/SEEDING.md`**

An optional second phase that validates and loads staged package files when present, and a verification query printing edition, unit, resource and mapping counts. Mirror the existing "not in this image, skipping" tolerance. The runbook gains a catalogue section and the licensing line: provider names, slugs and edition years may be committed, nothing else may.

- [ ] **Step 8: Run the whole suite and commit**

Run: `pnpm --filter backend test && pnpm --filter backend exec tsc --noEmit`
Expected: all pass.

```bash
git add apps/backend/prisma/seed-packages.ts apps/backend/tests/catalogue apps/backend/tests/helpers/fixtures.ts apps/backend/package.json apps/backend/deploy/seed-level.sh docs/SEEDING.md
git commit -m "feat(seed): load the provider catalogue into the database"
```

---

## Self-Review

**Spec coverage.** Data model maps to Task 1. Extraction pipeline maps to Tasks 2, 3, 4. Crosswalk maps to Task 5. The validator the spec names maps to Task 6. Seeding, the four production gotchas and the deploy script map to Task 7. Licensing maps to the Global Constraints and Task 7's runbook step. The effort model, scheduler, phases, readiness gate, plan contract, material gaps and calibration are all out of scope here by the Scope note, and carry forward to the next three plans. Covered.

**Gaps found and fixed while reviewing:** `sizeBytes BigInt` became `sizeKb Int`, because the source is whole megabytes and a BigInt column throws on `JSON.stringify` the first time a route returns a resource. The Ethics LM1 folder misattribution had no test; it is now Task 3 Step 1. The `durationSeconds` preservation rule existed only as prose in the spec; it is now Review Focus 1 with a test that fails if the upsert is naive. The thousands-separator defect was scoped to Meldrum file sizes until it was reproduced against UWorld's word column while verifying this plan's totals, where a naive sum returns 378 instead of 396,032; `parseCount` now owns every numeric cell in both documents.

**Totals verified against the sources, not copied from their summaries:** UWorld 43 rows, 199 vignettes, 1064 questions, 256 calculation stems, 2178 answer pages, 396,032 answer words, 372.2 words per question. Curriculum 10 topics, 51 modules, 382 outcomes, already seeded. A wrong constant here would make a correct extractor refuse correct data, so each one in Tasks 3 and 4 was recomputed before being written down.

**Type consistency.** `PackageFile`, `UnitFile`, `ResourceFile`, `ExtractResult` and `CrosswalkFile` are defined once in `catalogue-types.ts` (Task 3) and consumed by name in Tasks 4, 5, 6 and 7. `ref` strings use the same scheme throughout (`qm/lm2`, `qm/lm2/seminar/2`, `uworld/quant/r2`). `sizeKb` is the only size field anywhere.

**Review Focus coverage.** Each of the five has a named test in the task owning the code: 1 and 3 in Task 7, 2 in Task 2, 4 in Task 5, 5 in Task 1.

**Proportion.** The plan is roughly a third of the spec's length and most of its blocks are test assertions rather than implementation bodies. Three bodies would have been transcripts and were cut to signatures plus the rule that determines them.

---

## Related

- [Daily prescription engine design](../specs/2026-11-10-daily-prescription-design.md): the spec this implements, and the three subsystems that follow.
- [Seeding a curriculum level](../../SEEDING.md): the loader contract and the four production gotchas this plan inherits.
