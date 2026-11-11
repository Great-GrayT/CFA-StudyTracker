import { fileURLToPath } from "url";
import { realpathSync } from "node:fs";
import {
  parseCount,
  parseSizeKb,
  driveId,
  parseTableAfter,
  linkTarget,
  sectionLines,
} from "./lib/markdown.ts";
import type {
  PackageFile,
  UnitFile,
  ResourceFile,
  LosRefinement,
  ExtractResult,
} from "./lib/catalogue-types.ts";

const __filename = fileURLToPath(import.meta.url);

interface ReadingInfo {
  topicSlug: string;
  readingNumber: number;
  title: string;
  vignetteCount: number;
  questionCount: number;
  calcCount: number;
  answerPageCount: number;
  answerWordCount: number;
  exhibitCount: number;
  questionsDriveId: string | null;
  answersDriveId: string | null;
}

interface FileInfo {
  driveId: string;
  fileName: string;
  pageCount: number;
  wordCount: number;
  sizeKb: number;
}

interface LoSMapEntry {
  topicSlug: string;
  readingNumber: number;
  readingTitle: string;
  readingQuestions: number;
  blocks: LoSBlock[];
}

interface LoSBlock {
  losText: string;
  questionCount: number;
}

function topicNameToSlug(topicName: string): string {
  const slugMap: Record<string, string> = {
    "quantitative methods": "quant",
    quantitative: "quant",
    economics: "econ",
    "financial statement analysis": "fsa",
    "corporate issuers": "corporate",
    "equity valuation": "equity",
    "fixed income": "fi",
    derivatives: "deriv",
    "alternative investments": "altinv",
    "portfolio management": "pm",
    "ethical and professional standards": "ethics",
  };

  const key = topicName.toLowerCase();
  return slugMap[key] || key.slice(0, 2).toLowerCase();
}

// Section 5's Q file / A file cells carry a trailing annotation after the
// link, e.g. "[Questions](url) (5p, 105 KB)". linkTarget requires the cell
// to END with the link, so it never matches here; pull the url out directly.
function cellDriveId(cell: string): string | null {
  const match = cell.match(/\]\(([^)]+)\)/);
  if (!match) return null;
  return driveId(match[1]);
}

function extractTotalCounts(markdown: string): {
  readingCount: number;
  vignettes: number;
  questions: number;
  calcStems: number;
  answerPages: number;
} | null {
  // Section 4 holds two tables: "2025 set by topic" (in scope) and "2024 set
  // by topic" (out of scope), each ending in its own bold Total row. Scoping
  // to the 2025 subsection by heading, not by table position, is what keeps
  // the 2024 total from being picked up instead.
  const lines = sectionLines(markdown, /^### 2025 set by topic/, /^### /);
  const table = parseTableAfter(lines, 0);
  if (!table || !table.totalRow) {
    return null;
  }
  const { totalRow } = table;

  const readingCount = parseCount(totalRow["Readings"] || "");
  const vignettes = parseCount(totalRow["Vignettes"] || "");
  const questions = parseCount(totalRow["Questions"] || "");
  const calcStems = parseCount(totalRow["Calc Qs (approx)"] || "");
  const answerPages = parseCount(totalRow["A pages"] || "");

  if (
    readingCount === null ||
    vignettes === null ||
    questions === null ||
    calcStems === null ||
    answerPages === null
  ) {
    return null;
  }

  return { readingCount, vignettes, questions, calcStems, answerPages };
}

function extractReadings(markdown: string): ReadingInfo[] {
  const readings: ReadingInfo[] = [];

  // Scoping to section 5 means the only "| Reading | ..." tables in range
  // are the 10 real per-topic breakdowns: section 8 has lookalike tables
  // ("| Reading | Topic | Calc / Q | Share |") that this scope excludes, so
  // no extra guard against them is needed here.
  const lines = sectionLines(markdown, /^## 5\.\s+Topic-by-topic breakdown/, /^## 6\./);

  let currentTopicSlug = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const topicMatch = line.match(/^###\s+\d+\.\s+(.+)/);
    if (topicMatch) {
      currentTopicSlug = topicNameToSlug(topicMatch[1]);
      continue;
    }

    if (!line.match(/^\|\s*Reading\s*\|/i)) {
      continue;
    }

    const table = parseTableAfter(lines, i);
    if (!table) {
      continue;
    }

    for (const row of table.rows) {
      const readingCell = row["Reading"] || "";
      if (!readingCell) {
        continue;
      }

      const vCell = row["V"] || "";
      const qCell = row["Q"] || "";
      const calcCell = row["Calc"] || "";
      const qFileCell = row["Q file"] || "";
      const aFileCell = row["A file"] || "";
      const aPagesCell = row["A pages"] || "";
      const aWordsCell = row["A words"] || "";
      const exhibitCell = row["Exhibit images (A)"] || "";

      const v = parseCount(vCell);
      const q = parseCount(qCell);
      const calc = parseCount(calcCell);
      const aPages = parseCount(aPagesCell);
      const aWords = parseCount(aWordsCell);
      const exhibits = parseCount(exhibitCell);

      if (v === null || q === null || calc === null || aPages === null || aWords === null || exhibits === null) {
        continue;
      }

      const readingMatch = readingCell.match(/^R(\d+)\s+(.+)/);
      if (!readingMatch) {
        continue;
      }

      const readingNumber = parseInt(readingMatch[1], 10);
      const title = readingMatch[2].trim();

      readings.push({
        topicSlug: currentTopicSlug,
        readingNumber,
        title,
        vignetteCount: v,
        questionCount: q,
        calcCount: calc,
        answerPageCount: aPages,
        answerWordCount: aWords,
        exhibitCount: exhibits,
        // Role comes from these two named columns, never from a file name:
        // the ESG answers file lacks the usual " - Answers" suffix, so
        // name-based inference would silently drop it.
        questionsDriveId: cellDriveId(qFileCell),
        answersDriveId: cellDriveId(aFileCell),
      });
    }
  }

  return readings;
}

function extractFileIndex(markdown: string): FileInfo[] {
  const files: FileInfo[] = [];

  // Anchored stop: an unanchored "## " also matches the "### 2024 set"
  // subheading inside this same section and truncates it early. The 2024
  // table's header has no "Topic" column, so the header predicate alone
  // already keeps this scoped to the 2025 table; parseTable's own
  // stop-at-first-non-row-line rule then bounds it at the blank line before
  // "### 2024 set" without any further end-boundary search.
  const lines = sectionLines(markdown, /## 10\.\s+Full file index/, /^## /);

  const table = parseTableAfter(lines, 0, (l) => l.startsWith("| Topic |"));
  if (!table) {
    return files;
  }

  for (const row of table.rows) {
    const fileCell = row["File"] || "";
    const pagesCell = row["Pages"] || "";
    const wordsCell = row["Words"] || "";
    const sizeCell = row["Size"] || "";

    if (!fileCell) {
      continue;
    }

    const fileLink = linkTarget(fileCell);
    const id = fileLink.url ? driveId(fileLink.url) : null;

    if (!id) {
      continue;
    }

    const pages = parseCount(pagesCell);
    const words = parseCount(wordsCell);
    const sizeKb = parseSizeKb(sizeCell);

    if (pages === null || words === null || sizeKb === null) {
      continue;
    }

    files.push({
      driveId: id,
      fileName: fileLink.text,
      pageCount: pages,
      wordCount: words,
      sizeKb,
    });
  }

  return files;
}

function extractQuantLosMap(markdown: string): LoSMapEntry[] {
  const entries: LoSMapEntry[] = [];

  const lines = sectionLines(markdown, /## 6\.\s+Quant LOS map/, /^## /);

  for (let i = 0; i < lines.length; i++) {
    const readingMatch = lines[i].match(/^\*\*R(\d+)\s+(.+?)\*\*\s+\((\d+)\s+questions\)/);
    if (!readingMatch) {
      continue;
    }

    const readingNumber = parseInt(readingMatch[1], 10);
    const readingTitle = readingMatch[2];
    const readingQuestions = parseInt(readingMatch[3], 10);

    const currentReading: LoSMapEntry = {
      topicSlug: "quant",
      readingNumber,
      readingTitle,
      readingQuestions,
      blocks: [],
    };
    entries.push(currentReading);

    const table = parseTableAfter(lines, i + 1);
    if (!table) {
      continue;
    }

    for (const row of table.rows) {
      const questionsCell = row["Questions"] || "";
      const losCell = row["LOS"] || "";

      if (!losCell) {
        continue;
      }

      const qCount = parseCount(questionsCell);
      if (qCount === null) {
        continue;
      }

      currentReading.blocks.push({
        losText: losCell,
        questionCount: qCount,
      });
    }
  }

  return entries;
}

export function extractUworld(markdown: string): ExtractResult<PackageFile> {
  const problems: string[] = [];

  const expectedTotals = extractTotalCounts(markdown);
  if (!expectedTotals) {
    problems.push("Could not parse expected totals from section 4");
    return { data: null, problems };
  }

  const readings = extractReadings(markdown);
  if (readings.length === 0) {
    problems.push("Could not parse any readings from section 5");
    return { data: null, problems };
  }

  if (readings.length !== expectedTotals.readingCount) {
    problems.push(
      `Reading count mismatch: parsed ${readings.length}, expected ${expectedTotals.readingCount}`
    );
  }

  const files = extractFileIndex(markdown);
  if (files.length === 0) {
    problems.push("Could not parse any files from section 10");
    return { data: null, problems };
  }

  const filesByDriveId = new Map(files.map((f) => [f.driveId, f]));

  let totalVignettes = 0;
  let totalQuestions = 0;
  let totalCalcStems = 0;
  let totalAnswerPages = 0;
  let totalAnswerWords = 0;
  const matchedDriveIds = new Set<string>();

  const units: UnitFile[] = [];

  for (const reading of readings) {
    if (!reading.questionsDriveId || !reading.answersDriveId) {
      problems.push(
        `Reading ${reading.topicSlug}/r${reading.readingNumber} missing drive IDs for questions or answers`
      );
      continue;
    }

    const qFile = filesByDriveId.get(reading.questionsDriveId);
    const aFile = filesByDriveId.get(reading.answersDriveId);

    if (!qFile) {
      problems.push(
        `No file found for questions drive ID ${reading.questionsDriveId}`
      );
      continue;
    }

    if (!aFile) {
      problems.push(
        `No file found for answers drive ID ${reading.answersDriveId}`
      );
      continue;
    }

    matchedDriveIds.add(reading.questionsDriveId);
    matchedDriveIds.add(reading.answersDriveId);

    const resources: ResourceFile[] = [
      {
        ref: `uworld/${reading.topicSlug}/r${reading.readingNumber}/question_set`,
        kind: "question_set",
        externalId: reading.questionsDriveId,
        sizeKb: qFile.sizeKb,
        questionCount: reading.questionCount,
        vignetteCount: reading.vignetteCount,
        calcCount: reading.calcCount,
        pageCount: qFile.pageCount,
        wordCount: qFile.wordCount,
      },
      {
        ref: `uworld/${reading.topicSlug}/r${reading.readingNumber}/answer_set`,
        kind: "answer_set",
        externalId: reading.answersDriveId,
        sizeKb: aFile.sizeKb,
        questionCount: reading.questionCount,
        vignetteCount: reading.vignetteCount,
        calcCount: reading.calcCount,
        pageCount: aFile.pageCount,
        wordCount: aFile.wordCount,
        exhibitCount: reading.exhibitCount,
      },
    ];

    totalVignettes += reading.vignetteCount;
    totalQuestions += reading.questionCount;
    totalCalcStems += reading.calcCount;
    totalAnswerPages += reading.answerPageCount;
    totalAnswerWords += reading.answerWordCount;

    units.push({
      ref: `uworld/${reading.topicSlug}/r${reading.readingNumber}`,
      title: reading.title,
      resources,
    });
  }

  if (totalVignettes !== expectedTotals.vignettes) {
    problems.push(
      `Vignette count mismatch: parsed ${totalVignettes}, expected ${expectedTotals.vignettes}`
    );
  }

  if (totalQuestions !== expectedTotals.questions) {
    problems.push(
      `Question count mismatch: parsed ${totalQuestions}, expected ${expectedTotals.questions}`
    );
  }

  if (totalCalcStems !== expectedTotals.calcStems) {
    problems.push(
      `Calculation stem count mismatch: parsed ${totalCalcStems}, expected ${expectedTotals.calcStems}`
    );
  }

  if (totalAnswerPages !== expectedTotals.answerPages) {
    problems.push(
      `Answer page count mismatch: parsed ${totalAnswerPages}, expected ${expectedTotals.answerPages}`
    );
  }

  // Independent check that the Words column parsed correctly: derived from a
  // different pair of columns (words, questions) than the ones already
  // reconciled above, against the document's own stated average.
  if (totalQuestions >= 100 && totalAnswerWords > 0) {
    const derivedWordsPerQuestion = totalAnswerWords / totalQuestions;
    if (Math.round(derivedWordsPerQuestion) !== 372) {
      problems.push(
        `Words per question check failed: got ${Math.round(derivedWordsPerQuestion)}, expected 372`
      );
    }
  }

  if (matchedDriveIds.size !== files.length) {
    problems.push(
      `File index mismatch: matched ${matchedDriveIds.size} files, index contains ${files.length}`
    );
  }

  const losMap = extractQuantLosMap(markdown);

  for (const losEntry of losMap) {
    const unit = units.find(
      (u) => u.ref === `uworld/${losEntry.topicSlug}/r${losEntry.readingNumber}`
    );

    if (!unit) {
      problems.push(
        `Quant LOS map reading R${losEntry.readingNumber} has no matching unit from section 5`
      );
      continue;
    }

    // Document-internal second witness: the blocks' own question counts must
    // sum to the number the reading's heading claims, and to section 5's
    // count for the same reading.
    const blockSum = losEntry.blocks.reduce((sum, b) => sum + b.questionCount, 0);
    if (blockSum !== losEntry.readingQuestions) {
      problems.push(
        `Quant LOS map R${losEntry.readingNumber}: blocks sum to ${blockSum} questions, heading says ${losEntry.readingQuestions}`
      );
    }

    const sectionFiveCount = unit.resources.find((r) => r.kind === "question_set")?.questionCount;
    if (sectionFiveCount !== undefined && sectionFiveCount !== losEntry.readingQuestions) {
      problems.push(
        `Quant LOS map R${losEntry.readingNumber}: heading says ${losEntry.readingQuestions} questions, section 5 says ${sectionFiveCount}`
      );
    }

    const losRefinements: LosRefinement[] = losEntry.blocks.map((block) => {
      // The 2027 curriculum retired this learning outcome; UWorld's 2025
      // qbank still tests it, so it is kept and flagged rather than dropped.
      const retired = block.losText.toLowerCase().startsWith("describe neural networks");
      return retired
        ? { sourceLabel: block.losText, questionCount: block.questionCount, retired: true }
        : { sourceLabel: block.losText, questionCount: block.questionCount };
    });

    unit.losRefinements = losRefinements;
  }

  if (problems.length > 0) {
    return { data: null, problems };
  }

  const data: PackageFile = {
    package: {
      slug: "uw-l2-2025",
      name: "UWorld CFA Level II Qbank 2025",
    },
    edition: {
      levelId: "II", // Level.id is the roman numeral the curriculum seeds, not "L2"
      year: "2025",
    },
    units,
    editionResources: [],
  };

  return { data, problems: [] };
}

async function main() {
  const fs = await import("fs");

  const [, , sourceFile, outFile] = process.argv;

  if (!sourceFile || !outFile) {
    console.error("Usage: node extract-uworld.ts <source.md> <out.json>");
    process.exit(1);
    return;
  }

  const markdown = (await fs.promises.readFile(sourceFile, "utf-8")) as string;
  const { data, problems } = extractUworld(markdown);

  if (problems.length > 0) {
    console.error("Problems found:");
    problems.forEach((p) => console.error("  -", p));
    process.exit(1);
  }

  if (data) {
    const readingsCount = data.units.length;
    let vignettes = 0;
    let questions = 0;
    let calcStems = 0;
    let answerPages = 0;
    let answerWords = 0;
    let filesReconciled = 0;

    for (const unit of data.units) {
      const q = unit.resources.find((r) => r.kind === "question_set");
      const a = unit.resources.find((r) => r.kind === "answer_set");
      if (q) {
        vignettes += q.vignetteCount || 0;
        questions += q.questionCount || 0;
        calcStems += q.calcCount || 0;
        filesReconciled++;
      }
      if (a) {
        answerPages += a.pageCount || 0;
        answerWords += a.wordCount || 0;
        filesReconciled++;
      }
    }

    const wordsPerQuestion = questions > 0 ? Math.round(answerWords / questions) : 0;

    console.log(`Readings: ${readingsCount}`);
    console.log(`Vignettes: ${vignettes}`);
    console.log(`Questions: ${questions}`);
    console.log(`Calc stems: ${calcStems}`);
    console.log(`Answer pages: ${answerPages}`);
    console.log(`Files reconciled: ${filesReconciled}`);
    console.log(`Words per question: ${wordsPerQuestion}`);

    await fs.promises.writeFile(outFile, JSON.stringify(data, null, 2));
    console.log(`Wrote: ${outFile}`);
  }
}

// Call main if this is the entry point (works under both node and tsx).
// import.meta.main is true under node but undefined under tsx, so it cannot
// be used here.
const isMain =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(__filename);

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
