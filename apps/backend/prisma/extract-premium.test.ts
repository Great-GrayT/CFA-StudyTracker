import { describe, it, expect } from "vitest";
import { extractPremium } from "./extract-premium.ts";
import type { LevelFile } from "./propose-crosswalk.ts";

const ID = (c: string) => c.repeat(28);

const level = {
  id: "II",
  version: "2026",
  topics: [
    { order: 1, name: "Quantitative Methods", readings: [] },
    { order: 4, name: "Corporate Finance", readings: [] },
    { order: 10, name: "Ethical and Professional Standards", readings: [] },
  ],
} as unknown as LevelFile;

const link = (text: string, c: string) =>
  `[${text}](https://drive.google.com/file/d/${ID(c)}/view)`;
const code = (c: string) => "`" + ID(c) + "`";

function build(opts: { totalQ?: number; mockTotal?: number } = {}): string {
  const totalQ = opts.totalQ ?? 31;
  const mockTotal = opts.mockTotal ?? 44;
  return [
    "# Example Pack",
    "",
    "## 4. Totals at a glance",
    "",
    "### 4a. Practice Pack content by topic",
    "",
    "| Topic | Readings | Questions | Share of pack | CFA weight* | Calc Qs | Stmt Qs |",
    "|---|---:|---:|---:|---:|---:|---:|",
    "| Quantitative Methods | 2 | 12 | 10% | 5-10% | 3 (25.0%) | 1 (8.3%) |",
    "| Corporate Issuers | 1 | 9 | 10% | 5-10% | 2 (22.2%) | 0 (0.0%) |",
    "| Ethical and Professional Standards | 2 | 10 | 10% | 10-15% | 0 (0.0%) | 2 (20.0%) |",
    `| **Total** | **5** | **${totalQ}** | 100.0% | | **5** (16.1%) | **3** (9.7%) |`,
    "",
    "### 4c. All sets",
    "",
    "| Set | Files | Sessions | Questions |",
    "|---|---:|---:|---:|",
    "| Practice Pack | 3 | n/a | 31 |",
    "| 2026 mocks | 7 | 4 | 176 |",
    "| 2025 mocks, Mock 1 to 3 (OCR) | 1 | 1 | 44 |",
    "| 2025 mocks, Mock 4 | 2 | 2 | 88 |",
    "",
    "## 5. Practice Pack: topic-by-topic breakdown",
    "",
    "### 1. Quantitative Methods",
    "",
    "| Reading | Q | Calc | Stmt | Qs with image | Images | Words |",
    "|---|---:|---:|---:|---:|---:|---:|",
    "| Example Regression Basics | 7 | 2 | 1 | 1 | 1 | 410 |",
    "| Example Time Series | 5 | 1 | 0 | 0 | 0 | 220 |",
    "| **Total** | **12** | **3** | **1** | **1** | **1** | **630** |",
    "",
    "### 2. Corporate Issuers",
    "",
    "| Reading | Q | Calc | Stmt | Qs with image | Images | Words |",
    "|---|---:|---:|---:|---:|---:|---:|",
    "| Example Dividends | 9 | 2 | n/c | 3 | 3 | 500 |",
    "| **Total** | **9** | **2** | **0** | **3** | **3** | **500** |",
    "",
    "### 3. Ethical and Professional Standards",
    "",
    "| Reading | Q | Calc | Stmt | Qs with image | Images | Words |",
    "|---|---:|---:|---:|---:|---:|---:|",
    "| Guidance for Standards I-VII | 6 | 0 | 1 | 0 | 0 | 700 |",
    "| Application of the Code | 3 | 0 | 1 | 0 | 0 | 300 |",
    "| No reading tag (question 64) | 1 | 0 | 0 | 0 | 0 | 100 |",
    "| **Total** | **10** | **0** | **2** | **0** | **0** | **1,100** |",
    "",
    "## 6. 2026 mocks",
    "",
    "### 6b. Topic mix by session (questions)",
    "",
    "| Session | Quant | CorpIss | Ethics | Total |",
    "|---|---:|---:|---:|---:|",
    `| Mock 1 S1 | 20 | 12 | 12 | ${mockTotal} |`,
    "| Mock 1 S2 | 16 | 16 | 12 | 44 |",
    "| Mock 4 S1 | 20 | 12 | 12 | 44 |",
    "| Mock 4 S2 | 24 | 12 | 8 | 44 |",
    "| **Total** | **80** | **52** | **44** | **176** |",
    "| **Share** | 45% | 30% | 25% | 100.0% |",
    "",
    "### 6c. Correct-answer letters in the answers files",
    "",
    "| Answers file | A | B | C | Total |",
    "|---|---:|---:|---:|---:|",
    "| Mock 1 Session 1 | 13 | 17 | 14 | 44 |",
    "| Mock 1 Session 2 | 12 | 18 | 14 | 44 |",
    "",
    "## 7. 2025 mocks",
    "",
    "### 7a. File measures",
    "",
    "| File | Basis | Bytes | Pages | Words |",
    "|---|---|---:|---:|---:|",
    `| ${link("mock 1 session 1.pdf", "p")} | OCR | 4,679,077 | 29 | 9,972 |`,
    `| ${link("Aft-Que.pdf", "q")} | text | 609,237 | 14 | 3,656 |`,
    "",
    "### 7b. Topic mix by session (questions)",
    "",
    "| Session | Quant | CorpIss | Ethics | Total |",
    "|---|---:|---:|---:|---:|",
    "| Mock 1 S1 | 20 | 12 | 12 | 44 |",
    "| Mock 4 Afternoon | 24 | 12 | 8 | 44 |",
    "| Mock 4 Morning | 20 | 16 | 8 | 44 |",
    "| **Total** | **64** | **40** | **28** | **132** |",
    "",
    "## 10. Full file index",
    "",
    "### Practice Pack (3 files)",
    "",
    "| Topic | File | Pages | Questions | Bytes | File ID |",
    "|---|---|---:|---:|---:|---|",
    `| Quantitative Methods | ${link("a.pdf", "a")} | 21 | 12 | 1,133,891 | ${code("a")} |`,
    `| Corporate Issuers | ${link("b.pdf", "b")} | 25 | 9 | 752,568 | ${code("b")} |`,
    `| Ethical and Professional Standards | ${link("c.pdf", "c")} | 33 | 10 | 227,355 | ${code("c")} |`,
    "",
    "### 2025 mocks (3 files)",
    "",
    "| File | Basis | Pages | Bytes | File ID |",
    "|---|---|---:|---:|---|",
    `| ${link("mock 1 session 1.pdf", "p")} | OCR | 29 | 4,679,077 | ${code("p")} |`,
    `| ${link("Aft-Que.pdf", "q")} | text | 14 | 609,237 | ${code("q")} |`,
    `| ${link("Morn-Que.pdf", "r")} | text | 13 | 774,047 | ${code("r")} |`,
    "",
    "### 2026 mocks (7 files)",
    "",
    "| File | Pages | Bytes | File ID |",
    "|---|---:|---:|---|",
    `| Mock 1 Session 1 - Questions | 17 | 286,576 | ${code("1")} |`,
    `| Mock 1 Session 1 - Answers | 11 | 238,046 | ${code("2")} |`,
    `| Mock 1 Session 2 - Questions | 14 | 228,061 | ${code("3")} |`,
    `| Mock 1 Session 2 - Answers | 12 | 257,752 | ${code("4")} |`,
    `| Mock 4 Session 1 - Questions | 24 | 38,901 | ${code("5")} |`,
    `| Mock 4 Session 1 - Answers | 28 | 2,886,441 | ${code("6")} |`,
    `| Mock 4 Session 2 - Questions | 24 | 39,870 | ${code("7")} |`,
    "| Mock 4 Session 2 - Answers | not in folder | | |",
  ].join("\n");
}

describe("extractPremium", () => {
  it("builds one unit per tagged reading with shared topic file ids", () => {
    const { data, problems } = extractPremium(build(), level);
    expect(problems).toEqual([]);
    expect(data!.package).toEqual({ slug: "premium-l2", name: "Premium Pack" });
    expect(data!.edition).toEqual({ levelId: "II", year: "2026" });
    expect(data!.units.map((u) => u.ref)).toEqual([
      "premium-l2/quant/1",
      "premium-l2/quant/2",
      "premium-l2/corporate/1",
      "premium-l2/ethics/1",
      "premium-l2/ethics/2",
    ]);
    const u = data!.units[0];
    expect(u.title).toBe("Example Regression Basics");
    expect(u.resources[0]).toMatchObject({
      kind: "question_set",
      questionCount: 7,
      calcCount: 2,
      stmtCount: 1,
      wordCount: 410,
      externalId: ID("a"),
      sourceNote: "shared topic file",
    });
    expect(u.resources[0].externalId).toMatch(/^[A-Za-z0-9_-]{25,}$/);
  });

  it("omits stmtCount when n/c and drops the untagged question with a warning", () => {
    const r = extractPremium(build(), level);
    expect(r.data!.units[2].resources[0].stmtCount).toBeUndefined();
    const total = r.data!.units.reduce((s, x) => s + (x.resources[0].questionCount ?? 0), 0);
    expect(total).toBe(30);
    expect(r.warnings.join(" ")).toMatch(/untagged/i);
  });

  it("emits mock sessions with topicMix resolved through aliases and summing to 44", () => {
    const { data } = extractPremium(build(), level);
    const mocks = data!.editionResources;
    expect(mocks).toHaveLength(4 + 3);
    const m = mocks.find((x) => x.ref === "premium-l2/mock/2026-1-s1")!;
    expect(m).toMatchObject({
      kind: "mock_session",
      title: "2026 Mock 1, Session 1",
      questionCount: 44,
      externalId: ID("1"),
    });
    // Corporate Issuers -> Corporate Finance (order 4), Ethics -> 10
    expect(m.topicMix).toEqual({ "1": 20, "4": 12, "10": 12 });
    for (const x of mocks) {
      expect(Object.values(x.topicMix!).reduce((a, b) => a + b, 0)).toBe(44);
    }
    expect(mocks.find((x) => x.ref === "premium-l2/mock/2025-4-s1")!.title).toBe(
      "2025 Mock 4, Session 1",
    );
  });

  it("flags missing answers, results-screen answers and OCR counts in sourceNote", () => {
    const { data } = extractPremium(build(), level);
    const get = (ref: string) => data!.editionResources.find((x) => x.ref === ref)!;
    expect(get("premium-l2/mock/2026-4-s2").sourceNote).toMatch(/no answers file/);
    expect(get("premium-l2/mock/2026-4-s1").sourceNote).toMatch(/results screen/);
    expect(get("premium-l2/mock/2025-1-s1").sourceNote).toMatch(/OCR/);
    expect(get("premium-l2/mock/2026-1-s1").sourceNote).toBeUndefined();
  });

  it("returns data null when the practice total disagrees", () => {
    const r = extractPremium(build({ totalQ: 99 }), level);
    expect(r.data).toBeNull();
    expect(r.problems.join(" ")).toMatch(/question/i);
  });

  it("returns data null when a session does not total 44", () => {
    const r = extractPremium(build({ mockTotal: 40 }), level);
    expect(r.data).toBeNull();
    expect(r.problems.join(" ")).toMatch(/44/);
  });
});
