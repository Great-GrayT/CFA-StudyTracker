import { describe, it, expect } from "vitest";
import { extractKaplan } from "./extract-kaplan.ts";

const id = (c: string) => `https://drive.google.com/file/d/${c.repeat(30)}/view?usp=drivesdk`;

function fixture(opts: { total?: string; ethicsQ?: string } = {}): string {
  const total = opts.total ?? "40";
  return [
    "# Example Qbank",
    "",
    "## 4. Totals at a glance",
    "",
    "| # | Topic | Readings | Qbank questions | Vignette sets | Share | Topic quiz questions | Qbank PDFs | Modules | Module PDFs |",
    "|---|---|---|---|---|---|---|---|---|---|",
    "| 1 | Quantitative Methods | 2 | 25 | 3 | 62% | 5 | 4 | 4 | 8 |",
    "| 10 | Ethical and Professional Standards | 3 (3 file pairs) | 15 | 1 | 38% | 6 | 6 | 2 | 4 |",
    `| | **Total** | **5 readings (5 file pairs)** | **${total}** | **4+** | 100% | **11** | **10** | **6** | **12** |`,
    "",
    "## 5. Qbank: topic-by-topic breakdown",
    "",
    "### 1. Quantitative Methods",
    "",
    "| Reading | Title | Questions | Vignette sets | Vignette Qs | Standalone | Questions file | Answers file | Q size | A size |",
    "|---|---|---|---|---|---|---|---|---|---|",
    `| R1 | Alpha Topic | **15** | >=2 | >=8 | <=7 | [Q](${id("a")}) | [A](${id("b")}) | 1,024 KB | 2.00 MB |`,
    `| R2 | Beta Topic | **10** | 1 | 4 | 6 | [Q](${id("c")}) | [A](${id("d")}) | 100 KB | 200 KB |`,
    "| | **Topic total** | **25** | 3+ | 12+ | | | | | |",
    "",
    "### 10. Ethical and Professional Standards",
    "",
    "| Reading | Title | Questions | Vignette sets | Vignette Qs | Standalone | Questions file | Answers file | Q size | A size |",
    "|---|---|---|---|---|---|---|---|---|---|",
    `| R41.1 | Standards I(A) | **5** | 0 | 0 | 5 | [Q](${id("e")}) | [A](${id("f")}) | 10 KB | 20 KB |`,
    `| R41.2 | Standards I(B) | **${opts.ethicsQ ?? "4"}** | 0 | 0 | 4 | [Q](${id("g")}) | [A](${id("h")}) | 10 KB | 20 KB |`,
    `| R41.3 | Standard II | **6** | 1 | 4 | 2 | [Q](${id("i")}) | [A](${id("j")}) | 10 KB | 20 KB |`,
    "| | **Topic total** | **15** | 1 | 4 | | | | | |",
    "",
    "## 6. Module quizzes",
    "",
    "## 7. Topic quizzes and Checkpoint Exams",
    "",
    "### 7.1 Topic quizzes ([folder](https://drive.google.com/drive/folders/1Aaaaaaaaaaaaaaaaaaaaaaaaaaaaa))",
    "",
    "| # | Topic | Questions | Item sets | Questions file | Q size | Answers file | A size |",
    "|---|---|---|---|---|---|---|---|",
    `| 1 | Quantitative Methods | **5** | 1 | [Q](${id("k")}) | 50 KB | [A](${id("l")}) | 60 KB |`,
    `| 10 | Ethical and Professional Standards | **6** | 1 | [Q](${id("m")}) | 50 KB | [A](${id("n")}) | 60 KB |`,
    "| | **Total** | **11** | 2 | | | | |",
    "",
    "### 7.2 Checkpoint Exams ([folder](https://drive.google.com/drive/folders/1Bbbbbbbbbbbbbbbbbbbbbbbbbbbbb))",
    "",
    "| Exam | Readings | Questions | Questions file | Q size | Answers file | A size |",
    "|---|---|---|---|---|---|---|",
    `| Checkpoint Exam 1 | 1-16 | 24 | [Q](${id("o")}) | 300 KB | [A](${id("p")}) | 800 KB |`,
    `| Checkpoint Exam 2 | 17-29 | 32 | [Q](${id("q")}) | 300 KB | [A](${id("r")}) | 800 KB |`,
    `| Checkpoint Exam 3 | 30-42 | 32 | [Q](${id("s")}) | 300 KB | [A](${id("t")}) | 800 KB |`,
    "| **Total** | 1-42 | **88** | | 900 KB | | 2,400 KB |",
    "",
    "## 8. Module and LOS mapping",
  ].join("\n");
}

describe("extractKaplan", () => {
  it("emits one unit per reading and groups Ethics 41.x per Standard", () => {
    const { data, problems } = extractKaplan(fixture());
    expect(problems).toEqual([]);
    const refs = data!.units.map((u) => u.ref);
    expect(refs).toEqual(["kaplan-l2/r1", "kaplan-l2/r2", "kaplan-l2/r41-std1", "kaplan-l2/r41-std2"]);
    expect(data!.package).toEqual({ slug: "kaplan-l2", name: "Kaplan Schweser" });
    expect(data!.edition).toMatchObject({ levelId: "II", year: "2026" });
    const std1 = data!.units.find((u) => u.ref === "kaplan-l2/r41-std1")!;
    expect(std1.resources).toHaveLength(4);
    expect(std1.resources.map((r) => r.kind)).toEqual(["question_set", "answer_set", "question_set", "answer_set"]);
    expect(data!.units.find((u) => u.ref === "kaplan-l2/r41-std2")!.resources).toHaveLength(2);
  });

  it("carries counts, sizes and marks lower-bound vignette cells", () => {
    const { data } = extractKaplan(fixture());
    const [q, a] = data!.units[0].resources;
    expect(q).toMatchObject({ questionCount: 15, vignetteCount: 2, sizeKb: 1024, sourceNote: "lower bound" });
    expect(a).toMatchObject({ questionCount: 15, sizeKb: 2048, sourceNote: "lower bound" });
    expect(data!.units[1].resources[0].sourceNote).toBeUndefined();
  });

  it("question counts sum to the stated total", () => {
    const { data } = extractKaplan(fixture());
    const sum = data!.units
      .flatMap((u) => u.resources)
      .filter((r) => r.kind === "question_set")
      .reduce((s, r) => s + (r.questionCount ?? 0), 0);
    expect(sum).toBe(40);
  });

  it("emits topic quizzes and checkpoint exams as edition resources", () => {
    const { data } = extractKaplan(fixture());
    const quizzes = data!.editionResources.filter((r) => r.kind === "quiz");
    expect(quizzes.map((r) => r.questionCount)).toEqual([5, 6]);
    const cps = data!.editionResources.filter((r) => r.kind === "checkpoint");
    expect(cps.map((r) => r.questionCount)).toEqual([24, 32, 32]);
    expect(cps.map((r) => r.sourceNote)).toEqual(["readings 1-16", "readings 17-29", "readings 30-42"]);
  });

  it("all drive ids match the validator pattern", () => {
    const { data } = extractKaplan(fixture());
    const all = [...data!.units.flatMap((u) => u.resources), ...data!.editionResources];
    for (const r of all) expect(r.externalId).toMatch(/^[A-Za-z0-9_-]{25,}$/);
  });

  it("a reading count that disagrees with the stated total is a problem and yields no data", () => {
    const { data, problems } = extractKaplan(fixture({ ethicsQ: "5" }));
    expect(data).toBeNull();
    expect(problems.some((p) => /question count mismatch/i.test(p))).toBe(true);
  });

  it("a wrong stated total is a problem", () => {
    const { data, problems } = extractKaplan(fixture({ total: "41" }));
    expect(data).toBeNull();
    expect(problems.length).toBeGreaterThan(0);
  });
});
