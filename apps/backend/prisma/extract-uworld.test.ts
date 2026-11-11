import { describe, it, expect } from "vitest";
import { extractUworld } from "./extract-uworld.ts";

const FIXTURE = [
  "# Example Qbank",
  "",
  "## 4. Summary counts",
  "",
  "### 2025 set by topic",
  "",
  "| Topic | Readings | Vignettes | Questions | Calc Qs (approx) | A pages | A words |",
  "|---|---:|---:|---:|---:|---:|---:|",
  "| 1. Quantitative Methods | 2 | 6 | 25 | 5 | 52 | 8,800 |",
  "| **Total** | **2** | **6** | **25** | **5** | **52** | **8,800** |",
  "",
  "### 2024 set by topic",
  "",
  "| Topic | Vignettes | Questions (OCR) |",
  "|---|---:|---:|",
  "| Quant | 2 | 10 |",
  "| **Total** | **2** | **10** |",
  "",
  "## 5. Topic-by-topic breakdown (2025 set)",
  "",
  "### 1. Quantitative Methods",
  "",
  "| Reading | V | Q | Calc | Stmt | Q file | A file | A pages | A words | Exhibit images (A) |",
  "|---|---:|---:|---:|---:|---|---|---:|---:|---:|",
  "| R1 Example Topic A | 3 | 10 | 1 | 2 | [Questions](https://drive.google.com/file/d/1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/view) (6p, 110 KB) | [Answers](https://drive.google.com/file/d/1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/view) (260 KB) | 22 | 3,800 | 9 |",
  "| R2 Example Topic B | 3 | 15 | 4 | 2 | [Questions](https://drive.google.com/file/d/1cccccccccccccccccccccccccccccccc/view) (7p, 200 KB) | [Answers](https://drive.google.com/file/d/1dddddddddddddddddddddddddddddddd/view) (500 KB) | 30 | 5,000 | 18 |",
  "",
  "## 10. Full file index",
  "",
  "### 2025 set (4 files, added in bulk, last checked 2024-06-01)",
  "",
  "| Topic | File | Pages | Words | Size | File ID |",
  "|---|---|---:|---:|---:|---|",
  "| Quantitative Methods | [Reading 1 Example Topic A - Questions.pdf](https://drive.google.com/file/d/1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/view) | 6 | 900 | 110 KB | `1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |",
  "| Quantitative Methods | [Reading 1 Example Topic A - Answers.pdf](https://drive.google.com/file/d/1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/view) | 22 | 3,800 | 260 KB | `1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb` |",
  "| Quantitative Methods | [Reading 2 Example Topic B - Questions.pdf](https://drive.google.com/file/d/1cccccccccccccccccccccccccccccccc/view) | 7 | 1,100 | 200 KB | `1cccccccccccccccccccccccccccccccc` |",
  "| Quantitative Methods | [Reading 2 Example Topic B - Answers.pdf](https://drive.google.com/file/d/1dddddddddddddddddddddddddddddddd/view) | 30 | 5,000 | 500 KB | `1dddddddddddddddddddddddddddddddd` |",
  "",
  "### 2024 set (1 file, added in bulk, last checked 2024-01-15)",
  "",
  "| File | Pages | Size | File ID |",
  "|---|---:|---:|---|",
  "| [Example 2024 Topic Sheet.pdf](https://drive.google.com/file/d/1eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/view) | 68 | 3.00 MB | `1eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` |",
].join("\n");

const ESG_FIXTURE = [
  "# Example Qbank",
  "",
  "## 4. Summary counts",
  "",
  "### 2025 set by topic",
  "",
  "| Topic | Readings | Vignettes | Questions | Calc Qs (approx) | A pages | A words |",
  "|---|---:|---:|---:|---:|---:|---:|",
  "| 4. Corporate Issuers | 1 | 4 | 20 | 0 | 40 | 7,000 |",
  "| **Total** | **1** | **4** | **20** | **0** | **40** | **7,000** |",
  "",
  "### 2024 set by topic",
  "",
  "| Topic | Vignettes |",
  "|---|---:|",
  "| CorpIss | 12 |",
  "| **Total** | **12** |",
  "",
  "## 5. Topic-by-topic breakdown (2025 set)",
  "",
  "### 4. Corporate Issuers",
  "",
  "| Reading | V | Q | Calc | Stmt | Q file | A file | A pages | A words | Exhibit images (A) |",
  "|---|---:|---:|---:|---:|---|---|---:|---:|---:|",
  "| R2 Example Case Study | 4 | 20 | 0 | 3 | [Questions](https://drive.google.com/file/d/1ffffffffffffffffffffffffffffffff/view) (10p, 130 KB) | [Answers](https://drive.google.com/file/d/1gggggggggggggggggggggggggggggggg/view) (380 KB) | 40 | 7,000 | 15 |",
  "",
  "## 10. Full file index",
  "",
  "### 2025 set (2 files, added in bulk, last checked 2024-06-01)",
  "",
  "| Topic | File | Pages | Words | Size | File ID |",
  "|---|---|---:|---:|---:|---|",
  "| Corporate Issuers | [2. Example Case Study - Questions.pdf](https://drive.google.com/file/d/1ffffffffffffffffffffffffffffffff/view) | 10 | 1,500 | 130 KB | `1ffffffffffffffffffffffffffffffff` |",
  "| Corporate Issuers | [2. Example Case Study Considerations in Analysis.pdf](https://drive.google.com/file/d/1gggggggggggggggggggggggggggggggg/view) | 40 | 7,000 | 380 KB | `1gggggggggggggggggggggggggggggggg` |",
].join("\n");

const FIXTURE_BAD_TOTALS = [
  "# Example Qbank",
  "",
  "## 4. Summary counts",
  "",
  "### 2025 set by topic",
  "",
  "| Topic | Readings | Vignettes | Questions | Calc Qs (approx) | A pages | A words |",
  "|---|---:|---:|---:|---:|---:|---:|",
  "| 1. Quantitative Methods | 1 | 3 | 15 | 4 | 30 | 5,000 |",
  "| **Total** | **1** | **3** | **18** | **4** | **30** | **5,000** |",
  "",
  "### 2024 set by topic",
  "",
  "| Topic | Vignettes |",
  "|---|---:|",
  "| Quant | 17 |",
  "| **Total** | **17** |",
  "",
  "## 5. Topic-by-topic breakdown (2025 set)",
  "",
  "### 1. Quantitative Methods",
  "",
  "| Reading | V | Q | Calc | Stmt | Q file | A file | A pages | A words | Exhibit images (A) |",
  "|---|---:|---:|---:|---:|---|---|---:|---:|---:|",
  "| R2 Example Topic B | 3 | 15 | 4 | 2 | [Questions](https://drive.google.com/file/d/1cccccccccccccccccccccccccccccccc/view) (7p, 200 KB) | [Answers](https://drive.google.com/file/d/1dddddddddddddddddddddddddddddddd/view) (500 KB) | 30 | 5,000 | 18 |",
  "",
  "## 10. Full file index",
  "",
  "### 2025 set (2 files, added in bulk, last checked 2024-06-01)",
  "",
  "| Topic | File | Pages | Words | Size | File ID |",
  "|---|---|---:|---:|---:|---|",
  "| Quantitative Methods | [Reading 2 Example Topic B - Questions.pdf](https://drive.google.com/file/d/1cccccccccccccccccccccccccccccccc/view) | 7 | 1,100 | 200 KB | `1cccccccccccccccccccccccccccccccc` |",
  "| Quantitative Methods | [Reading 2 Example Topic B - Answers.pdf](https://drive.google.com/file/d/1dddddddddddddddddddddddddddddddd/view) | 30 | 5,000 | 500 KB | `1dddddddddddddddddddddddddddddddd` |",
].join("\n");

const QUANT_LOS_FIXTURE = [
  "# Example Qbank",
  "",
  "## 4. Summary counts",
  "",
  "### 2025 set by topic",
  "",
  "| Topic | Readings | Vignettes | Questions | Calc Qs (approx) | A pages | A words |",
  "|---|---:|---:|---:|---:|---:|---:|",
  "| 1. Quantitative Methods | 1 | 5 | 22 | 0 | 38 | 7,000 |",
  "| **Total** | **1** | **5** | **22** | **0** | **38** | **7,000** |",
  "",
  "### 2024 set by topic",
  "",
  "| Topic | Vignettes |",
  "|---|---:|",
  "| Quant | 17 |",
  "| **Total** | **17** |",
  "",
  "## 5. Topic-by-topic breakdown (2025 set)",
  "",
  "### 1. Quantitative Methods",
  "",
  "| Reading | V | Q | Calc | Stmt | Q file | A file | A pages | A words | Exhibit images (A) |",
  "|---|---:|---:|---:|---:|---|---|---:|---:|---:|",
  "| R6 Example Modeling Topic | 5 | 22 | 0 | 6 | [Questions](https://drive.google.com/file/d/1llllllllllllllllllllllllllllllll/view) (14p, 160 KB) | [Answers](https://drive.google.com/file/d/1mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm/view) (700 KB) | 38 | 7,000 | 20 |",
  "",
  "## 6. Quant LOS map",
  "",
  "**R6 Example Modeling Topic** (22 questions)",
  "",
  "| Questions | LOS |",
  "|---:|---|",
  "| 8 | Describe an example quantitative modelling framework and its typical business applications |",
  "| 5 | Explain an example estimation procedure and interpret its typical diagnostic output |",
  "| 4 | Describe common limitations encountered when applying this example technique |",
  "| 3 | Describe neural networks used in an experimental approach later dropped from the updated curriculum outline |",
  "| 2 | Describe an alternative example technique and compare it against the primary method covered in this reading |",
  "",
  "## 10. Full file index",
  "",
  "### 2025 set (2 files, added in bulk, last checked 2024-06-01)",
  "",
  "| Topic | File | Pages | Words | Size | File ID |",
  "|---|---|---:|---:|---:|---|",
  "| Quantitative Methods | [Reading 6 Example Modeling Topic - Questions.pdf](https://drive.google.com/file/d/1llllllllllllllllllllllllllllllll/view) | 14 | 2,400 | 160 KB | `1llllllllllllllllllllllllllllllll` |",
  "| Quantitative Methods | [Reading 6 Example Modeling Topic - Answers.pdf](https://drive.google.com/file/d/1mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm/view) | 38 | 7,000 | 700 KB | `1mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm` |",
].join("\n");

const QUANT_LOS_BAD_SUM_FIXTURE = [
  "# Example Qbank",
  "",
  "## 4. Summary counts",
  "",
  "### 2025 set by topic",
  "",
  "| Topic | Readings | Vignettes | Questions | Calc Qs (approx) | A pages | A words |",
  "|---|---:|---:|---:|---:|---:|---:|",
  "| 1. Quantitative Methods | 1 | 5 | 22 | 0 | 38 | 7,000 |",
  "| **Total** | **1** | **5** | **22** | **0** | **38** | **7,000** |",
  "",
  "### 2024 set by topic",
  "",
  "| Topic | Vignettes |",
  "|---|---:|",
  "| Quant | 17 |",
  "| **Total** | **17** |",
  "",
  "## 5. Topic-by-topic breakdown (2025 set)",
  "",
  "### 1. Quantitative Methods",
  "",
  "| Reading | V | Q | Calc | Stmt | Q file | A file | A pages | A words | Exhibit images (A) |",
  "|---|---:|---:|---:|---:|---|---|---:|---:|---:|",
  "| R6 Example Modeling Topic | 5 | 22 | 0 | 6 | [Questions](https://drive.google.com/file/d/1nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn/view) (14p, 160 KB) | [Answers](https://drive.google.com/file/d/1oooooooooooooooooooooooooooooooo/view) (700 KB) | 38 | 7,000 | 20 |",
  "",
  "## 6. Quant LOS map",
  "",
  "**R6 Example Modeling Topic** (22 questions)",
  "",
  "| Questions | LOS |",
  "|---:|---|",
  "| 8 | Describe an example quantitative modelling framework and its typical business applications |",
  "| 5 | Explain an example estimation procedure and interpret its typical diagnostic output |",
  "| 4 | Describe common limitations encountered when applying this example technique |",
  "| 1 | Describe an alternative example technique and compare it against the primary method covered in this reading |",
  "",
  "## 10. Full file index",
  "",
  "### 2025 set (2 files, added in bulk, last checked 2024-06-01)",
  "",
  "| Topic | File | Pages | Words | Size | File ID |",
  "|---|---|---:|---:|---:|---|",
  "| Quantitative Methods | [Reading 6 Example Modeling Topic - Questions.pdf](https://drive.google.com/file/d/1nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn/view) | 14 | 2,400 | 160 KB | `1nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn` |",
  "| Quantitative Methods | [Reading 6 Example Modeling Topic - Answers.pdf](https://drive.google.com/file/d/1oooooooooooooooooooooooooooooooo/view) | 38 | 7,000 | 700 KB | `1oooooooooooooooooooooooooooooooo` |",
].join("\n");

describe("extractUworld", () => {
  it("a reading's two resources carry the split facts", () => {
    const { data, problems } = extractUworld(FIXTURE);
    expect(problems).toEqual([]);
    expect(data).not.toBeNull();
    const r2 = data!.units.find((u) => u.ref === "uworld/quant/r2")!;
    const q = r2.resources.find((r) => r.kind === "question_set")!;
    const a = r2.resources.find((r) => r.kind === "answer_set")!;
    expect(q.questionCount).toBe(15);
    expect(q.vignetteCount).toBe(3);
    expect(q.calcCount).toBe(4);
    expect(a.pageCount).toBe(30);
    expect(a.wordCount).toBe(5000);
    expect(a.exhibitCount).toBe(18);
  });

  it("an answers file whose name lacks the suffix is still bound by drive id", () => {
    const { data, problems } = extractUworld(ESG_FIXTURE);
    expect(problems).toEqual([]);
    expect(data).not.toBeNull();
    const esg = data!.units.find((u) => u.ref === "uworld/corporate/r2")!;
    expect(esg.resources.filter((r) => r.kind === "answer_set")).toHaveLength(1);
  });

  it("column sums that disagree with the document's totals are a problem", () => {
    const result = extractUworld(FIXTURE_BAD_TOTALS);
    expect(result.problems.join(" ")).toMatch(/question/i);
  });

  it("the retired machine learning outcome is kept and flagged, not dropped", () => {
    const { data, problems } = extractUworld(QUANT_LOS_FIXTURE);
    expect(problems).toEqual([]);
    expect(data).not.toBeNull();
    const ml = data!.units.find((u) => u.ref === "uworld/quant/r6")!;
    const retired = ml.losRefinements!.find((l) =>
      l.sourceLabel.startsWith("Describe neural networks")
    )!;
    expect(retired.retired).toBe(true);
    expect(retired.questionCount).toBe(3);
  });

  it("a Quant LOS block sum that disagrees with its reading's question count is a problem", () => {
    // Covers the structural cross-check's failure path: only the
    // all-consistent fixture was exercised before, so a block-sum mismatch
    // could regress silently.
    const result = extractUworld(QUANT_LOS_BAD_SUM_FIXTURE);
    expect(result.problems.join(" ")).toMatch(/blocks sum/i);
  });
});
