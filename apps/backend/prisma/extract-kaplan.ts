import { fileURLToPath } from "url";
import { realpathSync } from "node:fs";
import {
  parseCount,
  parseSizeKb,
  driveId,
  parseTableAfter,
  sectionLines,
} from "./lib/markdown.ts";
import type { PackageFile, UnitFile, ResourceFile, ExtractResult } from "./lib/catalogue-types.ts";

const __filename = fileURLToPath(import.meta.url);

const SLUG = "kaplan-l2";
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
// Ethics R41.n file number -> Standard index (1-based into ROMAN). Fixed by
// the curriculum, not derivable from the inventory's abbreviated titles.
const STANDARD_OF_FILE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 3, 5: 3, 6: 3, 7: 4, 8: 5, 9: 6, 10: 7,
};

interface QbankRow {
  reading: number;
  sub: number | null;
  title: string;
  questions: number;
  vignetteSets: number;
  lowerBound: boolean;
  qId: string;
  aId: string;
  qSizeKb: number;
  aSizeKb: number;
}

// Tolerant of trailing annotation after the link, same as UWorld's.
function cellDriveId(cell: string): string | null {
  const match = cell.match(/\]\(([^)]+)\)/);
  return match ? driveId(match[1]) : null;
}

// ">=21" and "182+" are lower bounds; strip the markers, keep the number.
const num = (cell: string | undefined): number | null =>
  parseCount((cell ?? "").replace(/[<>=+]/g, ""));

function parseQbank(
  markdown: string,
  problems: string[],
): { rows: QbankRow[]; topicTotals: number[]; topicSums: number[] } {
  const lines = sectionLines(markdown, /^## 5\./, /^## 6\./);
  const rows: QbankRow[] = [];
  const topicTotals: number[] = [];
  const topicSums: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/^\|\s*Reading\s*\|/.test(lines[i])) continue;
    const table = parseTableAfter(lines, i);
    if (!table) continue;
    let sum = 0;
    // The bold topic total has an empty Reading cell, which parseTable does
    // not treat as a total row (it only looks for "**Total**" in cell 0).
    for (const row of table.rows) {
      const readingCell = row["Reading"] ?? "";
      if (!readingCell) {
        const t = num(row["Questions"]);
        if (t !== null) topicTotals.push(t);
        continue;
      }
      const m = readingCell.match(/^R(\d+)(?:\.(\d+))?$/);
      const qId = cellDriveId(row["Questions file"] ?? "");
      const aId = cellDriveId(row["Answers file"] ?? "");
      const questions = num(row["Questions"]);
      const qSize = parseSizeKb(row["Q size"] ?? "");
      const aSize = parseSizeKb(row["A size"] ?? "");
      if (!m || !qId || !aId || questions === null || qSize === null || aSize === null) {
        problems.push(`Unparseable Qbank row: ${readingCell}`);
        continue;
      }
      sum += questions;
      rows.push({
        reading: parseInt(m[1], 10),
        sub: m[2] ? parseInt(m[2], 10) : null,
        title: (row["Title"] ?? "").trim(),
        questions,
        vignetteSets: num(row["Vignette sets"]) ?? 0,
        lowerBound: /[>=]/.test(row["Vignette sets"] ?? ""),
        qId,
        aId,
        qSizeKb: qSize,
        aSizeKb: aSize,
      });
    }
    topicSums.push(sum);
  }
  return { rows, topicTotals, topicSums };
}

function qaResources(base: string, r: QbankRow): ResourceFile[] {
  const common = {
    questionCount: r.questions,
    vignetteCount: r.vignetteSets,
    ...(r.lowerBound ? { sourceNote: "lower bound" } : {}),
  };
  return [
    { ref: `${base}/question_set`, kind: "question_set", externalId: r.qId, sizeKb: r.qSizeKb, ...common },
    { ref: `${base}/answer_set`, kind: "answer_set", externalId: r.aId, sizeKb: r.aSizeKb, ...common },
  ];
}

function buildUnits(rows: QbankRow[], problems: string[]): UnitFile[] {
  const units: UnitFile[] = [];
  const standards = new Map<number, UnitFile>();

  for (const r of rows) {
    if (r.reading === 41) {
      const std = r.sub !== null ? STANDARD_OF_FILE[r.sub] : undefined;
      if (!std) {
        problems.push(`Unknown Ethics file R41.${r.sub}`);
        continue;
      }
      let unit = standards.get(std);
      if (!unit) {
        unit = { ref: `${SLUG}/r41-std${std}`, title: `Standard ${ROMAN[std - 1]}`, resources: [] };
        standards.set(std, unit);
        units.push(unit);
      }
      unit.resources.push(...qaResources(`${unit.ref}/r41.${r.sub}`, r));
    } else {
      const ref = `${SLUG}/r${r.reading}`;
      units.push({ ref, title: r.title, resources: qaResources(ref, r) });
    }
  }
  return units;
}

function parseQuizzes(
  markdown: string,
  problems: string[],
): { resources: ResourceFile[]; quizTotal: number | null; cpTotal: number | null } {
  const resources: ResourceFile[] = [];

  const quizTable = parseTableAfter(sectionLines(markdown, /^### 7\.1/, /^##/), 0);
  if (!quizTable) problems.push("Could not parse topic quizzes from section 7.1");
  let quizTotal: number | null = null;
  for (const row of quizTable?.rows ?? []) {
    const n = parseCount(row["#"] ?? "");
    if (n === null) {
      quizTotal = num(row["Questions"]);
      continue;
    }
    const id = cellDriveId(row["Questions file"] ?? "");
    const size = parseSizeKb(row["Q size"] ?? "");
    const q = num(row["Questions"]);
    if (!id || size === null || q === null) {
      problems.push(`Unparseable topic quiz row ${n}`);
      continue;
    }
    resources.push({
      ref: `${SLUG}/quiz/t${n}`,
      kind: "quiz",
      externalId: id,
      sizeKb: size,
      questionCount: q,
      title: row["Topic"],
    });
  }

  const cpTable = parseTableAfter(sectionLines(markdown, /^### 7\.2/, /^##/), 0);
  if (!cpTable) problems.push("Could not parse checkpoint exams from section 7.2");
  for (const row of cpTable?.rows ?? []) {
    const m = (row["Exam"] ?? "").match(/Checkpoint Exam (\d+)/);
    if (!m) continue;
    const id = cellDriveId(row["Questions file"] ?? "");
    const size = parseSizeKb(row["Q size"] ?? "");
    const q = num(row["Questions"]);
    if (!id || size === null || q === null) {
      problems.push(`Unparseable checkpoint exam ${m[1]}`);
      continue;
    }
    resources.push({
      ref: `${SLUG}/checkpoint/${m[1]}`,
      kind: "checkpoint",
      externalId: id,
      sizeKb: size,
      questionCount: q,
      sourceNote: `readings ${(row["Readings"] ?? "").trim()}`,
      title: row["Exam"],
    });
  }
  const cpTotal = cpTable?.totalRow ? num(cpTable.totalRow["Questions"]) : null;

  return { resources, quizTotal, cpTotal };
}

export function extractKaplan(markdown: string): ExtractResult<PackageFile> {
  const problems: string[] = [];

  // The section 4 total row has an empty first cell, so parseTable files it
  // under rows rather than totalRow; find it by its Topic cell.
  const s4 = parseTableAfter(sectionLines(markdown, /^## 4\./, /^## 5\./), 0);
  const totals = s4?.rows.find((r) => (r["Topic"] ?? "").includes("Total"));
  const expQuestions = num(totals?.["Qbank questions"]);
  const expQuizQs = num(totals?.["Topic quiz questions"]);
  const expPdfs = num(totals?.["Qbank PDFs"]);
  if (expQuestions === null || expPdfs === null) {
    return { data: null, problems: ["Could not parse totals from section 4"] };
  }

  const { rows, topicTotals, topicSums } = parseQbank(markdown, problems);
  if (rows.length === 0) {
    return { data: null, problems: [...problems, "Could not parse any readings from section 5"] };
  }

  const units = buildUnits(rows, problems);
  const { resources: editionResources, quizTotal, cpTotal } = parseQuizzes(markdown, problems);

  const totalQuestions = rows.reduce((s, r) => s + r.questions, 0);
  if (totalQuestions !== expQuestions) {
    problems.push(`Question count mismatch: parsed ${totalQuestions}, expected ${expQuestions}`);
  }
  if (rows.length * 2 !== expPdfs) {
    problems.push(`Qbank file count mismatch: parsed ${rows.length * 2}, expected ${expPdfs}`);
  }
  if (topicTotals.length !== topicSums.length) {
    problems.push(`Topic total rows: found ${topicTotals.length} for ${topicSums.length} tables`);
  } else {
    topicSums.forEach((sum, i) => {
      if (sum !== topicTotals[i]) {
        problems.push(`Topic ${i + 1} question count mismatch: parsed ${sum}, expected ${topicTotals[i]}`);
      }
    });
  }

  const quizQs = editionResources
    .filter((r) => r.kind === "quiz")
    .reduce((s, r) => s + (r.questionCount ?? 0), 0);
  if (expQuizQs !== null && quizQs !== expQuizQs) {
    problems.push(`Topic quiz question mismatch: parsed ${quizQs}, expected ${expQuizQs}`);
  }
  if (quizTotal !== null && quizQs !== quizTotal) {
    problems.push(`Topic quiz total mismatch: parsed ${quizQs}, section 7.1 says ${quizTotal}`);
  }
  const cpQs = editionResources
    .filter((r) => r.kind === "checkpoint")
    .reduce((s, r) => s + (r.questionCount ?? 0), 0);
  if (cpTotal !== null && cpQs !== cpTotal) {
    problems.push(`Checkpoint question mismatch: parsed ${cpQs}, section 7.2 says ${cpTotal}`);
  }

  const ids = [...units.flatMap((u) => u.resources), ...editionResources].map((r) => r.externalId);
  if (new Set(ids).size !== ids.length) problems.push("Duplicate drive ids across resources");

  if (problems.length > 0) return { data: null, problems };

  return {
    data: {
      package: { slug: SLUG, name: "Kaplan Schweser" },
      edition: { levelId: "II", year: "2026" },
      units,
      editionResources,
    },
    problems: [],
  };
}

async function main() {
  const fs = await import("fs");
  const [, , sourceFile, outFile] = process.argv;
  if (!sourceFile || !outFile) {
    console.error("Usage: tsx extract-kaplan.ts <source.md> <out.json>");
    process.exit(1);
    return;
  }
  const markdown = (await fs.promises.readFile(sourceFile, "utf-8")) as string;
  const { data, problems } = extractKaplan(markdown);
  if (problems.length > 0 || !data) {
    console.error("Problems found:");
    problems.forEach((p) => console.error("  -", p));
    process.exit(1);
    return;
  }
  const qs = data.units.flatMap((u) => u.resources).filter((r) => r.kind === "question_set");
  console.log(`Units: ${data.units.length}`);
  console.log(
    `Resources: ${data.units.reduce((s, u) => s + u.resources.length, 0)} unit, ${data.editionResources.length} edition`,
  );
  console.log(`Questions: ${qs.reduce((s, r) => s + (r.questionCount ?? 0), 0)}`);
  await fs.promises.writeFile(outFile, JSON.stringify(data, null, 2));
  console.log(`Wrote: ${outFile}`);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
