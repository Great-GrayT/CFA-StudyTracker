import { fileURLToPath } from "url";
import { realpathSync } from "node:fs";
import {
  parseCount,
  parseTableAfter,
  linkTarget,
  driveId,
  sectionLines,
} from "./lib/markdown.ts";
import type {
  PackageFile,
  UnitFile,
  ResourceFile,
  ExtractResult,
} from "./lib/catalogue-types.ts";
import type { LevelFile } from "./propose-crosswalk.ts";

const __filename = fileURLToPath(import.meta.url);

const MOCK_QUESTIONS = 44;

type Result = ExtractResult<PackageFile> & { warnings: string[] };

// Inventory topic labels (full and abbreviated) -> curriculum topic name.
// The curriculum renames Corporate Issuers, Equity Valuation and Portfolio
// Management, so every label goes through here before a level lookup.
const CANON: Record<string, string> = {
  quant: "quantitative methods",
  "quantitative methods": "quantitative methods",
  econ: "economics",
  economics: "economics",
  fsa: "financial statement analysis",
  "financial statement analysis": "financial statement analysis",
  corpiss: "corporate finance",
  "corporate issuers": "corporate finance",
  "corporate finance": "corporate finance",
  eqval: "equities",
  "equity valuation": "equities",
  equities: "equities",
  fi: "fixed income",
  "fixed income": "fixed income",
  deriv: "derivatives",
  derivatives: "derivatives",
  alts: "alternative investments",
  "alternative investments": "alternative investments",
  pm: "portfolio construction",
  "portfolio management": "portfolio construction",
  "portfolio construction": "portfolio construction",
  ethics: "ethical and professional standards",
  "ethical and professional standards": "ethical and professional standards",
};

const SLUG: Record<string, string> = {
  "quantitative methods": "quant",
  economics: "econ",
  "financial statement analysis": "fsa",
  "corporate finance": "corporate",
  equities: "equity",
  "fixed income": "fi",
  derivatives: "deriv",
  "alternative investments": "altinv",
  "portfolio construction": "pm",
  "ethical and professional standards": "ethics",
};

function canon(label: string): string | null {
  return CANON[label.replace(/\*\*/g, "").trim().toLowerCase()] ?? null;
}

interface FileRow {
  id: string;
  name: string;
  bytes: number;
  basis: string;
}

function fileRows(markdown: string, heading: RegExp): FileRow[] {
  const lines = sectionLines(markdown, heading, /^#{2,3} /);
  const table = parseTableAfter(lines, 0);
  const out: FileRow[] = [];
  for (const row of table?.rows ?? []) {
    const { text, url } = linkTarget(row["File"] ?? "");
    // Some index tables link the file, others only list the id in a column.
    const idCell = (row["File ID"] ?? "").match(/`([^`]+)`/);
    const id = (url ? driveId(url) : null) ?? idCell?.[1] ?? null;
    out.push({
      id: id ?? "",
      name: text,
      bytes: parseCount(row["Bytes"] ?? "") ?? 0,
      basis: (row["Basis"] ?? "").toLowerCase(),
    });
  }
  return out;
}

const kb = (bytes: number) => Math.round(bytes / 1024);

interface MockRow {
  label: string;
  session: number;
  cells: Record<string, number>;
  total: number | null;
}

function mockRows(markdown: string, heading: RegExp, problems: string[], tag: string): MockRow[] {
  const lines = sectionLines(markdown, heading, /^#{2,3} /);
  const table = parseTableAfter(lines, 0);
  const rows: MockRow[] = [];
  if (!table) {
    problems.push(`${tag}: topic mix table not found`);
    return rows;
  }
  for (const row of table.rows) {
    const name = (row["Session"] ?? "").trim();
    // Share row and anything else that is not a session is skipped.
    const m = name.match(/^Mock (\w+) (?:S(\d)|(Morning|Afternoon))$/);
    if (!m) continue;
    const session = m[2] ? parseInt(m[2], 10) : m[3] === "Morning" ? 1 : 2;
    const cells: Record<string, number> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === "Session" || k === "Total") continue;
      const n = parseCount(v);
      if (n === null) problems.push(`${tag} ${name}: bad cell ${k}`);
      else cells[k] = n;
    }
    rows.push({ label: m[1], session, cells, total: parseCount(row["Total"] ?? "") });
  }
  return rows;
}

export function extractPremium(markdown: string, level: LevelFile): Result {
  const problems: string[] = [];
  const warnings: string[] = [];
  const fail = (): Result => ({ data: null, problems, warnings });

  const topicOrder = new Map<string, number>();
  for (const t of level.topics) topicOrder.set(t.name.toLowerCase(), t.order);
  const orderOf = (label: string, where: string): number | null => {
    const c = canon(label);
    const o = c ? topicOrder.get(c) : undefined;
    if (o === undefined) {
      problems.push(`${where}: topic "${label}" does not resolve to the curriculum`);
      return null;
    }
    return o;
  };

  // Section 4a: stated practice totals, per topic and overall.
  const totals = parseTableAfter(
    sectionLines(markdown, /^### 4a\./, /^#{2,3} /),
    0,
  );
  const statedTotal = totals?.totalRow;
  if (!totals || !statedTotal) {
    problems.push("Could not parse Practice Pack totals (section 4a)");
    return fail();
  }
  const statedByTopic = new Map<string, number>();
  for (const r of totals.rows) {
    const c = canon(r["Topic"] ?? "");
    const q = parseCount(r["Questions"] ?? "");
    if (c && q !== null) statedByTopic.set(c, q);
  }
  const statedQuestions = parseCount(statedTotal["Questions"] ?? "");
  const statedReadings = parseCount(statedTotal["Readings"] ?? "");

  // Shared per-topic PDF ids from the file index.
  const packFiles = new Map<string, FileRow & { topic: string }>();
  {
    const lines = sectionLines(markdown, /^### Practice Pack/, /^#{2,3} /);
    const t = parseTableAfter(lines, 0);
    for (const r of t?.rows ?? []) {
      const c = canon(r["Topic"] ?? "");
      const idMatch = (r["File ID"] ?? "").match(/`([^`]+)`/);
      if (c && idMatch) {
        packFiles.set(c, {
          id: idMatch[1],
          name: "",
          bytes: parseCount(r["Bytes"] ?? "") ?? 0,
          basis: "",
          topic: c,
        });
      }
    }
  }

  // Section 5: one unit per tagged reading.
  const units: UnitFile[] = [];
  let sumQuestions = 0;
  let sumCalc = 0;
  let sumStmt = 0;
  const s5 = sectionLines(markdown, /^## 5\./, /^## 6\./);
  let topic: string | null = null;
  for (let i = 0; i < s5.length; i++) {
    const h = s5[i].match(/^###\s+\d+\.\s+(.+?)\s*$/);
    if (h) {
      topic = canon(h[1]);
      if (!topic) problems.push(`Section 5: unknown topic "${h[1]}"`);
      continue;
    }
    if (!/^\|\s*Reading\s*\|/i.test(s5[i]) || !topic) continue;

    const table = parseTableAfter(s5, i);
    if (!table) continue;
    const file = packFiles.get(topic);
    if (!file) {
      problems.push(`No shared file id for topic "${topic}"`);
      continue;
    }

    let n = 0;
    let topicQuestions = 0;
    for (const row of table.rows) {
      const title = (row["Reading"] ?? "").trim();
      const q = parseCount(row["Q"] ?? "");
      if (!title || q === null) continue;
      topicQuestions += q;
      sumQuestions += q;

      // Untagged question: belongs to no reading, so it never becomes a unit.
      if (/^no reading tag/i.test(title)) {
        warnings.push(`Dropped ${q} untagged question(s) in ${topic}: "${title}"`);
        continue;
      }

      const calc = parseCount(row["Calc"] ?? "");
      const stmt = parseCount(row["Stmt"] ?? "");
      const words = parseCount(row["Words"] ?? "");
      sumCalc += calc ?? 0;
      sumStmt += stmt ?? 0;
      n++;

      const res: ResourceFile = {
        ref: `premium-l2/${SLUG[topic]}/${n}/question_set`,
        kind: "question_set",
        externalId: file.id,
        sizeKb: kb(file.bytes),
        questionCount: q,
        calcCount: calc ?? 0,
        sourceNote: "shared topic file",
      };
      if (stmt !== null) res.stmtCount = stmt;
      if (words !== null) res.wordCount = words;
      units.push({ ref: `premium-l2/${SLUG[topic]}/${n}`, title, resources: [res] });
    }

    const stated = parseCount(table.totalRow?.["Q"] ?? "");
    if (stated !== null && stated !== topicQuestions) {
      problems.push(`${topic}: rows sum to ${topicQuestions} questions, table total says ${stated}`);
    }
    const s4 = statedByTopic.get(topic);
    if (s4 !== undefined && s4 !== topicQuestions) {
      problems.push(`${topic}: parsed ${topicQuestions} questions, section 4a says ${s4}`);
    }
  }

  if (units.length === 0) {
    problems.push("Could not parse any readings from section 5");
    return fail();
  }
  if (statedQuestions !== null && sumQuestions !== statedQuestions) {
    problems.push(`Question count mismatch: parsed ${sumQuestions}, expected ${statedQuestions}`);
  }
  if (statedReadings !== null && units.length !== statedReadings) {
    problems.push(`Reading count mismatch: parsed ${units.length}, expected ${statedReadings}`);
  }
  const statedCalc = parseCount(statedTotal["Calc Qs"] ?? "");
  const statedStmt = parseCount(statedTotal["Stmt Qs"] ?? "");
  if (statedCalc !== null && sumCalc !== statedCalc) {
    problems.push(`Calc count mismatch: parsed ${sumCalc}, expected ${statedCalc}`);
  }
  if (statedStmt !== null && sumStmt !== statedStmt) {
    problems.push(`Stmt count mismatch: parsed ${sumStmt}, expected ${statedStmt}`);
  }

  // Mocks.
  const r26 = mockRows(markdown, /^### 6b\./, problems, "2026 mocks");
  const r25 = mockRows(markdown, /^### 7b\./, problems, "2025 mocks");

  const files26 = fileRows(markdown, /^### 2026 mocks/);
  const files25 = fileRows(markdown, /^### 2025 mocks/);
  const key26 = (name: string): { role: string; key: string } | null => {
    const m = name.match(/^Mock (\w+) Session (\d) - (Questions|Answers)/);
    return m ? { role: m[3], key: `${m[1]}-${m[2]}` } : null;
  };
  const q26 = new Map<string, FileRow>();
  const a26 = new Set<string>();
  for (const f of files26) {
    const k = key26(f.name);
    if (!k || !f.id) continue;
    if (k.role === "Questions") q26.set(k.key, f);
    else a26.add(k.key);
  }
  const hasResults = new Set<string>();
  {
    const t = parseTableAfter(sectionLines(markdown, /^### 6c\./, /^#{2,3} /), 0);
    for (const r of t?.rows ?? []) {
      const m = (r["Answers file"] ?? "").match(/^Mock (\w+) Session (\d)/);
      if (m) hasResults.add(`${m[1]}-${m[2]}`);
    }
  }
  // Scanned mocks 1 to 3 are named by number; Mock 4 files by time of day.
  const q25 = new Map<string, FileRow>();
  for (const f of files25) {
    if (!f.id) continue;
    const num = f.name.match(/^mock (\d+) session (\d)/i);
    if (num) q25.set(`${num[1]}-${num[2]}`, f);
    else if (/que/i.test(f.name) && /morn/i.test(f.name)) q25.set("4-1", f);
    else if (/que/i.test(f.name) && /aft/i.test(f.name)) q25.set("4-2", f);
  }

  const editionResources: ResourceFile[] = [];
  const build = (
    year: string,
    rows: MockRow[],
    files: Map<string, FileRow>,
    noteFor: (key: string, file: FileRow) => string[],
  ) => {
    for (const r of rows) {
      const key = `${r.label}-${r.session}`;
      const where = `${year} Mock ${r.label} S${r.session}`;
      const file = files.get(key);
      if (!file) {
        problems.push(`${where}: no questions file in the file index`);
        continue;
      }
      const topicMix: Record<string, number> = {};
      let sum = 0;
      for (const [label, count] of Object.entries(r.cells)) {
        sum += count;
        if (count === 0) continue;
        const o = orderOf(label, where);
        if (o !== null) topicMix[String(o)] = (topicMix[String(o)] ?? 0) + count;
      }
      if (sum !== MOCK_QUESTIONS || r.total !== MOCK_QUESTIONS) {
        problems.push(`${where}: topics sum to ${sum}, total says ${r.total}, expected ${MOCK_QUESTIONS}`);
      }
      const res: ResourceFile = {
        ref: `premium-l2/mock/${year}-${r.label.toLowerCase()}-s${r.session}`,
        kind: "mock_session",
        title: `${year} Mock ${r.label}, Session ${r.session}`,
        externalId: file.id,
        sizeKb: kb(file.bytes),
        questionCount: MOCK_QUESTIONS,
        topicMix,
      };
      const notes = noteFor(key, file);
      if (notes.length > 0) res.sourceNote = notes.join("; ");
      editionResources.push(res);
    }
  };
  build("2026", r26, q26, (key) => {
    if (!a26.has(key)) return ["no answers file"];
    if (!hasResults.has(key)) return ["answers file is a results screen"];
    return [];
  });
  build("2025", r25, q25, (_key, file) => (file.basis === "ocr" ? ["OCR counts"] : []));

  // Session counts against section 4c.
  {
    const t = parseTableAfter(sectionLines(markdown, /^### 4c\./, /^#{2,3} /), 0);
    let s26 = 0;
    let s25 = 0;
    for (const r of t?.rows ?? []) {
      const set = r["Set"] ?? "";
      const n = parseCount(r["Sessions"] ?? "") ?? 0;
      if (/^2026 mocks/.test(set)) s26 += n;
      else if (/^2025 mocks/.test(set)) s25 += n;
    }
    if (s26 !== r26.length) problems.push(`2026 sessions: parsed ${r26.length}, section 4c says ${s26}`);
    if (s25 !== r25.length) problems.push(`2025 sessions: parsed ${r25.length}, section 4c says ${s25}`);
  }

  // Each table's own bold Total row must agree with its session rows.
  for (const [tag, heading, rows] of [
    ["2026 mocks", /^### 6b\./, r26],
    ["2025 mocks", /^### 7b\./, r25],
  ] as const) {
    const t = parseTableAfter(sectionLines(markdown, heading, /^#{2,3} /), 0);
    const stated = parseCount(t?.totalRow?.["Total"] ?? "");
    const parsed = rows.reduce((s, r) => s + (r.total ?? 0), 0);
    if (stated !== null && stated !== parsed) {
      problems.push(`${tag}: sessions sum to ${parsed} questions, table total says ${stated}`);
    }
  }

  if (problems.length > 0) return fail();

  const data: PackageFile = {
    package: { slug: "premium-l2", name: "Premium Pack" },
    edition: { levelId: "II", year: "2026" },
    units,
    editionResources,
  };
  return { data, problems: [], warnings };
}

async function main() {
  const fs = await import("fs");
  const [, , sourceFile, levelFile, outFile] = process.argv;
  if (!sourceFile || !levelFile || !outFile) {
    console.error("Usage: tsx extract-premium.ts <source.md> <level.json> <out.json>");
    process.exit(1);
    return;
  }

  const markdown = await fs.promises.readFile(sourceFile, "utf-8");
  const level = JSON.parse(await fs.promises.readFile(levelFile, "utf-8")) as LevelFile;
  const { data, problems, warnings } = extractPremium(markdown, level);

  warnings.forEach((w) => console.log(`Warning: ${w}`));
  if (problems.length > 0 || !data) {
    console.error("Problems found:");
    problems.forEach((p) => console.error("  -", p));
    process.exit(1);
  }

  const questions = data.units.reduce(
    (s, u) => s + u.resources.reduce((a, r) => a + (r.questionCount ?? 0), 0),
    0,
  );
  const mocks = data.editionResources.filter((r) => r.kind === "mock_session");
  console.log(`Units: ${data.units.length}`);
  console.log(`Tagged questions: ${questions}`);
  console.log(`Mock sessions: ${mocks.length}`);
  console.log(`Mock questions: ${mocks.reduce((s, r) => s + (r.questionCount ?? 0), 0)}`);

  await fs.promises.writeFile(outFile, JSON.stringify(data, null, 2));
  console.log(`Wrote: ${outFile}`);
}

// import.meta.main is unset under tsx, so compare entry paths instead.
const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
