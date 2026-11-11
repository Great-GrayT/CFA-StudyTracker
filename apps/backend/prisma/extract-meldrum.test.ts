import { describe, it, expect } from "vitest";
import { extractMeldrum } from "./extract-meldrum.ts";

const FIXTURE = [
  "# Example Provider Inventory",
  "",
  "| Metric | Value |",
  "|---|---|",
  "| Total files | 5 |",
  "",
  "## 1. At a glance",
  "",
  "### Video types and counts",
  "",
  "| Type | Count |",
  "|---|---|",
  "| Video | 2 |",
  "| Seminar | 2 |",
  "| Intro video | 1 |",
  "",
  "## Getting started",
  "",
  "- [How to Use the Course.mp4](https://drive.google.com/file/d/1pppppppppppppppppppppppppppppppp/view) (41 MB)",
  "",
  "## Topic by topic",
  "",
  "### Quantitative Methods",
  "",
  "#### LM1: Example Topic One (notes p.10, ~8 pages)",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example QM LM1 Video.mp4](https://drive.google.com/file/d/1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq/view) | Video | 60 MB |",
  "| **Total** | 1 file | **60 MB** |",
  "",
  "#### LM2: Example Topic Two (notes p.18, ~12 pages)",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example QM LM2 Video.mp4](https://drive.google.com/file/d/1rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr/view) | Video | 90 MB |",
  "| [Example QM LM2 Seminar 1.mp4](https://drive.google.com/file/d/1ssssssssssssssssssssssssssssssss/view) | Seminar | 100 MB |",
  "| [Example QM LM2 Seminar 2.mp4](https://drive.google.com/file/d/1tttttttttttttttttttttttttttttttt/view) | Seminar | 30 MB |",
  "| **Total** | 3 files | **220 MB** |",
  "",
].join("\n");

const ETHICS_FIXTURE = [
  "# Example Provider Inventory",
  "",
  "| Metric | Value |",
  "|---|---|",
  "| Total files | 5 |",
  "",
  "## 1. At a glance",
  "",
  "### Video types and counts",
  "",
  "| Type | Count |",
  "|---|---|",
  "| Video | 2 |",
  "| Review | 1 |",
  "| EOCQ | 1 |",
  "| Update | 1 |",
  "",
  "## Topic by topic",
  "",
  "### Ethics",
  "",
  "#### LM1: Example Ethics Topic One (notes p.4, ~5 pages)",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example ET LM1 Video.mp4](https://drive.google.com/file/d/1uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu/view) | Video | 65 MB |",
  "| [Example ET LM2 Review.mp4](https://drive.google.com/file/d/1vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv/view) | Review | 68 MB |",
  "| [Example ET LM2 EOCQ.mp4](https://drive.google.com/file/d/1wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww/view) | EOCQ | 400 MB |",
  "| **Total** | 3 files | **533 MB** |",
  "",
  "#### LM2: Example Ethics Topic Two (notes p.9, ~55 pages)",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example ET LM2 Video.mp4](https://drive.google.com/file/d/1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/view) | Video | 900 MB |",
  "| [Example ET LM2 Update.mp4](https://drive.google.com/file/d/1yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy/view) | Update | 80 MB |",
  "| **Total** | 2 files | **980 MB** |",
  "",
].join("\n");

const FIXTURE_MISSING_ONE_EOCQ = [
  "# Example Provider Inventory",
  "",
  "| Metric | Value |",
  "|---|---|",
  "| Total files | 2 |",
  "",
  "## 1. At a glance",
  "",
  "### Video types and counts",
  "",
  "| Type | Count |",
  "|---|---|",
  "| Video | 2 |",
  "| EOCQ | 1 |",
  "",
  "## Topic by topic",
  "",
  "### Quantitative Methods",
  "",
  "#### LM1: Example Topic One (notes p.10, ~8 pages)",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example QM LM1 Video.mp4](https://drive.google.com/file/d/1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq/view) | Video | 60 MB |",
  "| **Total** | 1 file | **60 MB** |",
  "",
  "#### LM2: Example Topic Two (notes p.18, ~12 pages)",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example QM LM2 Video.mp4](https://drive.google.com/file/d/1rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr/view) | Video | 90 MB |",
  "| **Total** | 1 file | **90 MB** |",
  "",
].join("\n");

const FIXTURE_NO_NOTES_RANGE = [
  "# Example Provider Inventory",
  "",
  "| Metric | Value |",
  "|---|---|",
  "| Total files | 1 |",
  "",
  "## 1. At a glance",
  "",
  "### Video types and counts",
  "",
  "| Type | Count |",
  "|---|---|",
  "| Video | 1 |",
  "",
  "## Topic by topic",
  "",
  "### Quantitative Methods",
  "",
  "#### LM1: Example Topic One",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example QM LM1 Video.mp4](https://drive.google.com/file/d/1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq/view) | Video | 60 MB |",
  "| **Total** | 1 file | **60 MB** |",
  "",
].join("\n");

const FIXTURE_NOTES_EXEMPT = [
  "# Example Provider Inventory",
  "",
  "| Metric | Value |",
  "|---|---|",
  "| Total files | 1 |",
  "",
  "## 1. At a glance",
  "",
  "### Video types and counts",
  "",
  "| Type | Count |",
  "|---|---|",
  "| Video | 1 |",
  "",
  "## Topic by topic",
  "",
  "### Ethics",
  "",
  "#### LM3: Example Ethics Topic Three (video-only module, no notes pages)",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example ET LM3 Video.mp4](https://drive.google.com/file/d/1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/view) | Video | 1,500 MB |",
  "| **Total** | 1 file | **1,500 MB** |",
  "",
].join("\n");

const FIXTURE_WITH_SEMINARS = [
  "# Example Provider Inventory",
  "",
  "| Metric | Value |",
  "|---|---|",
  "| Total files | 7 |",
  "",
  "## 1. At a glance",
  "",
  "### Video types and counts",
  "",
  "| Type | Count |",
  "|---|---|",
  "| Video | 2 |",
  "| Seminar | 5 |",
  "",
  "## Topic by topic",
  "",
  "### 4.1 Quantitative Methods",
  "",
  "#### LM1: Example Topic One (notes p.10, ~8 pages)",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example QM LM1 Video.mp4](https://drive.google.com/file/d/1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq/view) | Video | 60 MB |",
  "| [Example QM LM1 Seminar.mp4](https://drive.google.com/file/d/1ssssssssssssssssssssssssssssssss/view) | Seminar | 100 MB |",
  "| **Total** | 2 files | **160 MB** |",
  "",
  "#### LM2: Example Topic Two (notes p.18, ~12 pages)",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example QM LM2 Video.mp4](https://drive.google.com/file/d/1rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr/view) | Video | 90 MB |",
  "| **Total** | 1 file | **90 MB** |",
  "",
  "## Seminars index",
  "",
  "| Seminar | Topic / LM folder | Size |",
  "|---|---|---|",
  "| [Example Seminar - Advanced Topic](https://drive.google.com/file/d/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/view) | Quantitative Methods / LM2 | 50 MB |",
  "| [Example Seminar - General Topic](https://drive.google.com/file/d/1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB/view) | Quantitative Methods | 45 MB |",
  "| [Example Seminar - Alternative A](https://drive.google.com/file/d/1CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/view) | Alternative Investments | 38 MB |",
  "| [Example Seminar - Alternative B](https://drive.google.com/file/d/1DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD/view) | Alternative Investments | 42 MB |",
  "",
].join("\n");

const SIMPLE_DECIMAL_FIXTURE = [
  "# Example Provider Inventory",
  "",
  "| Metric | Value |",
  "|---|---|",
  "| Total files | 2 |",
  "",
  "## 1. At a glance",
  "",
  "### Video types and counts",
  "",
  "| Type | Count |",
  "|---|---|",
  "| Video | 2 |",
  "",
  "## Topic by topic",
  "",
  "### 4.1 Quantitative Methods",
  "",
  "#### LM1: Example Topic One (notes p.2, ~4 pages)",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example QM LM1 Video.mp4](https://drive.google.com/file/d/1HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH/view) | Video | 60 MB |",
  "| **Total** | 1 file | **60 MB** |",
  "",
  "#### LM2: Example Topic Two (notes p.6, ~5 pages)",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example QM LM2 Video.mp4](https://drive.google.com/file/d/1IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII/view) | Video | 90 MB |",
  "| **Total** | 1 file | **90 MB** |",
  "",
].join("\n");

const SEMINAR_DEDUP_FIXTURE = [
  "# Example Provider Inventory",
  "",
  "| Metric | Value |",
  "|---|---|",
  "| Total files | 4 |",
  "",
  "## 1. At a glance",
  "",
  "### Video types and counts",
  "",
  "| Type | Count |",
  "|---|---|",
  "| Video | 1 |",
  "| Seminar | 3 |",
  "",
  "## Topic by topic",
  "",
  "### 1.1 Quantitative Methods",
  "",
  "#### LM1: Example Topic One (notes p.2, ~4 pages)",
  "",
  "| File | Type | Size |",
  "|---|---|---|",
  "| [Example QM LM1 Video.mp4](https://drive.google.com/file/d/1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq/view) | Video | 60 MB |",
  "| [Example Seminar - In Module](https://drive.google.com/file/d/1EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE/view) | Seminar | 45 MB |",
  "| **Total** | 2 files | **105 MB** |",
  "",
  "## Seminars index",
  "",
  "| Seminar | Topic / LM folder | Size |",
  "|---|---|---|",
  "| [Example Seminar - In Module](https://drive.google.com/file/d/1EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE/view) | Quantitative Methods / LM1 | 45 MB |",
  "| [Example Seminar - Topic A](https://drive.google.com/file/d/1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF/view) | Alternative Investments | 38 MB |",
  "| [Example Seminar - Topic B](https://drive.google.com/file/d/1GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG/view) | Alternative Investments | 42 MB |",
].join("\n");

const SEM_IN_MODULE = "1EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";

describe("extractMeldrum", () => {
  it("a module's resources carry its facts", () => {
    const { data, problems } = extractMeldrum(FIXTURE);
    expect(problems).toEqual([]);
    const lm2 = data!.units.find((u) => u.ref === "qm/lm2")!;
    expect(lm2.title).toBe("Example Topic Two");
    expect(lm2.notesPageStart).toBe(18);
    expect(lm2.notesPageCount).toBe(12);
    const lecture = lm2.resources.find((r) => r.kind === "lecture")!;
    expect(lecture.externalId).toBe("1rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr");
    expect(lecture.sizeKb).toBe(92160);
    expect(lecture.durationSeconds).toBeUndefined();
  });

  it("resource refs are unique and deterministic", () => {
    const { data } = extractMeldrum(FIXTURE);
    const refs = data!.units.flatMap((u) => u.resources.map((r) => r.ref));
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs).toContain("qm/lm2/seminar/2");
  });

  it("the Ethics LM1 folder's LM2 files are attributed to LM2", () => {
    const { data } = extractMeldrum(ETHICS_FIXTURE);
    const lm1 = data!.units.find((u) => u.ref === "et/lm1")!;
    const lm2 = data!.units.find((u) => u.ref === "et/lm2")!;
    expect(lm1.resources.map((r) => r.kind)).toEqual(["lecture"]);
    expect(
      lm2.resources.some(
        (r) => r.kind === "review" && r.sourceNote?.includes("LM1 folder")
      )
    ).toBe(true);
  });

  it("a type histogram that disagrees with the document is a problem", () => {
    const { data, problems } = extractMeldrum(FIXTURE_MISSING_ONE_EOCQ);
    expect(data).toBeNull();
    expect(problems.join(" ")).toMatch(/eocq/i);
  });

  it("a module with no notes range is a problem unless its heading says so", () => {
    expect(
      extractMeldrum(FIXTURE_NO_NOTES_RANGE).problems.join(" ")
    ).toMatch(/notes/i);
    expect(extractMeldrum(FIXTURE_NOTES_EXEMPT).problems).toEqual([]);
  });

  it("decimal topic headings like 4.1 parse correctly", () => {
    // Fixture with decimal heading (4.1) to verify regex handles \d+\.\d+ format
    const { data, problems } = extractMeldrum(SIMPLE_DECIMAL_FIXTURE);
    expect(problems).toEqual([]);
    expect(data).not.toBeNull();

    // Verify decimal heading didn't break unit parsing
    const lm1 = data!.units.find((u) => u.ref === "qm/lm1")!;
    expect(lm1).toBeDefined();
    expect(lm1.title).toBe("Example Topic One");

    // Verify LM2 was also parsed
    const lm2 = data!.units.find((u) => u.ref === "qm/lm2")!;
    expect(lm2).toBeDefined();
    expect(lm2.title).toBe("Example Topic Two");
  });

  it("seminars: module-level not double-counted, topic-level added as edition resources", () => {
    const { data, problems } = extractMeldrum(SEMINAR_DEDUP_FIXTURE);
    expect(problems).toEqual([]);
    expect(data).not.toBeNull();

    const all = [...data!.units.flatMap((u) => u.resources), ...data!.editionResources];
    const seminars = all.filter((r) => r.kind === "seminar");

    // Three seminars exist in total: one in a module table, two topic level.
    expect(seminars).toHaveLength(3);

    // The seminar listed in BOTH the module table and the index appears exactly
    // once. Counting it twice is what produced 1113 files instead of 144.
    expect(seminars.filter((r) => r.externalId === SEM_IN_MODULE)).toHaveLength(1);

    const lm1 = data!.units.find((u) => u.ref === "qm/lm1")!;
    expect(lm1.resources.filter((r) => r.kind === "seminar")).toHaveLength(1);

    // Topic-level seminars belong to no unit, so they are edition resources.
    expect(data!.editionResources.filter((r) => r.kind === "seminar")).toHaveLength(2);
  });
});
