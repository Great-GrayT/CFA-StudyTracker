/**
 * Builds a `seed-data/level-N.json` file from a curriculum research document.
 *
 *   pnpm --filter backend exec tsx prisma/extract-curriculum.ts \
 *     "../../CFA_Level_II_2027_Curriculum_Deep_Research.md" II 2027 \
 *     prisma/seed-data/level-2.json
 *
 * Why this exists rather than hand-transcription: a level is 51 modules and
 * 382 outcomes, and docs/SEEDING.md records that the failure mode of typing
 * them is silent loss. Nothing downstream can tell a dropped outcome from one
 * that was never in the outline.
 *
 * The defence is triangulation. The source document states its own per-topic
 * module and outcome counts in a summary table, lists every module name a
 * second time in a separate index, and then repeats both in the body as
 * headings and checklists. Those three are written independently of each
 * other, so this script parses all three and refuses to emit anything unless
 * they agree exactly, plus a hardcoded total as the fourth witness. A parser
 * that drifts, or a document edited in one place only, fails loudly here
 * instead of producing a plausible short file.
 *
 * Emits the shape `seed.ts` documents and `validate-seed.ts` enforces; run
 * the validator afterwards, which is a separate check on text quality rather
 * than a repeat of these structural ones.
 */
import { readFileSync, writeFileSync } from "node:fs";

type Los = { text: string; order: number };
type Reading = { name: string; order: number; los: Los[] };
type Topic = {
  name: string;
  order: number;
  examWeightMin: number;
  examWeightMax: number;
  readings: Reading[];
};
type Level = { id: string; version: string; topics: Topic[] };

/** What the document's own summary table claims for one topic. */
type Expectation = {
  order: number;
  name: string;
  weightMin: number;
  weightMax: number;
  modules: number;
  los: number;
};

const problems: string[] = [];
function fail(message: string): void {
  problems.push(message);
}

/** `5-10%` or `10-15%`, in a heading or a table cell. */
function parseWeight(text: string): { min: number; max: number } | null {
  const m = /(\d+)\s*(?:-|to)\s*(\d+)\s*%/.exec(text);
  return m ? { min: Number(m[1]), max: Number(m[2]) } : null;
}

/**
 * Witness 1: the "Topic weights and module map" table, which is the only
 * place the document states expected counts numerically.
 */
function parseSummaryTable(lines: string[]): Expectation[] {
  const out: Expectation[] = [];
  for (const line of lines) {
    // | 1 | Quantitative Methods | Quantitative Methods | 5-10% | 4-8 | 7 | 39 |
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 9) continue;
    const order = Number(cells[1]);
    if (!Number.isInteger(order) || order < 1 || order > 10) continue;
    const weight = parseWeight(cells[4]);
    const modules = Number(cells[6]);
    const los = Number(cells[7]);
    if (!weight || !Number.isInteger(modules) || !Number.isInteger(los)) continue;
    out.push({ order, name: cells[2], weightMin: weight.min, weightMax: weight.max, modules, los });
  }
  return out;
}

/**
 * Witness 2: the "Full module list" index, where every module is named a
 * second time under a bold topic heading. Catches a mistyped body heading,
 * which no count check can see.
 */
function parseModuleIndex(lines: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string | null = null;
  let started = false;

  for (const line of lines) {
    if (/^###\s+Full module list/.test(line)) {
      started = true;
      continue;
    }
    if (!started) continue;
    // The index ends at the blueprint caveat that follows it.
    if (/^\*\*Not on the Level II blueprint\*\*/.test(line)) break;

    const topic = /^\*\*(.+?)\*\*\s*$/.exec(line);
    if (topic) {
      current = topic[1].trim();
      out.set(current, []);
      continue;
    }
    const module = /^\s*\d+\.\s+(.+?)\s*$/.exec(line);
    if (module && current) {
      out.get(current)!.push(module[1].trim());
    }
  }
  return out;
}

/**
 * Witness 3: the body. Each topic is a `## N. Name (W%)` section holding
 * `### N.M Name` modules, each followed by its outcomes as `- [ ]` items.
 *
 * `sectionRange` bounds which `##` sections are topics. Sections outside it
 * are prose, and section 15 in particular ("Practical Skills Modules") must
 * stay out: those modules are not examined and carry no exam weight, so
 * emitting them as topics would push the weight sums past what
 * `validate-seed.ts` can accept.
 */
function parseBody(lines: string[], sectionRange: [number, number]): Topic[] {
  const topics: Topic[] = [];
  let topic: Topic | null = null;
  let reading: Reading | null = null;

  for (const raw of lines) {
    const section = /^##\s+(\d+)\.\s+(.+?)\s*$/.exec(raw);
    if (section) {
      const n = Number(section[1]);
      if (n < sectionRange[0] || n > sectionRange[1]) {
        topic = null;
        reading = null;
        continue;
      }
      const heading = section[2];
      const weight = parseWeight(heading);
      if (!weight) fail(`topic heading "${heading}" has no exam weight range`);
      topic = {
        name: heading.replace(/\s*\([^)]*%\)\s*$/, "").trim(),
        order: n - sectionRange[0] + 1,
        examWeightMin: weight?.min ?? 0,
        examWeightMax: weight?.max ?? 0,
        readings: [],
      };
      topics.push(topic);
      reading = null;
      continue;
    }

    const module = /^###\s+(\d+)\.(\d+)\s+(.+?)\s*$/.exec(raw);
    if (module && topic) {
      reading = { name: module[3].trim(), order: Number(module[2]), los: [] };
      topic.readings.push(reading);
      continue;
    }

    const los = /^-\s+\[\s?\]\s+(.+?)\s*$/.exec(raw);
    if (los) {
      if (!reading) {
        fail(`outcome found outside any module: "${los[1].slice(0, 60)}"`);
        continue;
      }
      reading.los.push({ text: los[1].trim(), order: reading.los.length + 1 });
    }
  }
  return topics;
}

/** Comparable form, so a stray double space or dash style is not a mismatch. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();
}

function crossCheck(
  topics: Topic[],
  expectations: Expectation[],
  index: Map<string, string[]>,
  expectedTotals: { modules: number; los: number },
): void {
  if (expectations.length !== topics.length) {
    fail(`body has ${topics.length} topics, summary table has ${expectations.length}`);
  }

  for (const expected of expectations) {
    const topic = topics.find((t) => t.order === expected.order);
    if (!topic) {
      fail(`summary table lists topic ${expected.order} (${expected.name}) but the body has no such section`);
      continue;
    }
    if (normalize(topic.name) !== normalize(expected.name)) {
      fail(`topic ${expected.order}: body calls it "${topic.name}", summary table calls it "${expected.name}"`);
    }
    if (topic.examWeightMin !== expected.weightMin || topic.examWeightMax !== expected.weightMax) {
      fail(
        `topic "${topic.name}": heading weight ${topic.examWeightMin}-${topic.examWeightMax}% ` +
          `disagrees with the summary table's ${expected.weightMin}-${expected.weightMax}%`,
      );
    }
    if (topic.readings.length !== expected.modules) {
      fail(`topic "${topic.name}": parsed ${topic.readings.length} modules, summary table says ${expected.modules}`);
    }
    const losCount = topic.readings.reduce((n, r) => n + r.los.length, 0);
    if (losCount !== expected.los) {
      fail(`topic "${topic.name}": parsed ${losCount} outcomes, summary table says ${expected.los}`);
    }

    // Witness 2, matched by topic name rather than position: the index is
    // ordered by topic but not numbered, so position would be a weaker check.
    const indexEntry = [...index.entries()].find(([name]) => normalize(name) === normalize(topic.name));
    if (!indexEntry) {
      fail(`topic "${topic.name}" is missing from the full module list`);
    } else {
      const [, names] = indexEntry;
      if (names.length !== topic.readings.length) {
        fail(
          `topic "${topic.name}": ${topic.readings.length} module headings in the body, ` +
            `${names.length} entries in the full module list`,
        );
      }
      topic.readings.forEach((r, i) => {
        const listed = names[i];
        if (listed && normalize(listed) !== normalize(r.name)) {
          fail(`topic "${topic.name}" module ${r.order}: heading "${r.name}" but the module list says "${listed}"`);
        }
      });
    }

    for (const r of topic.readings) {
      if (r.los.length === 0) fail(`module "${r.name}" has no outcomes`);
    }
    topic.readings.forEach((r, i) => {
      if (r.order !== i + 1) fail(`topic "${topic.name}": module orders are not sequential at "${r.name}"`);
    });
  }

  // Witness 4: constants, so a document edited consistently but wrongly in
  // both its table and its body still cannot pass unnoticed.
  const modules = topics.reduce((n, t) => n + t.readings.length, 0);
  const los = topics.reduce((n, t) => n + t.readings.reduce((m, r) => m + r.los.length, 0), 0);
  if (modules !== expectedTotals.modules) {
    fail(`expected ${expectedTotals.modules} modules in total, parsed ${modules}`);
  }
  if (los !== expectedTotals.los) {
    fail(`expected ${expectedTotals.los} outcomes in total, parsed ${los}`);
  }
}

function main(): void {
  const [source, levelId, version, out] = process.argv.slice(2);
  if (!source || !levelId || !version || !out) {
    console.error(
      "usage: tsx prisma/extract-curriculum.ts <source.md> <levelId> <version> <out.json>\n" +
        "  example: tsx prisma/extract-curriculum.ts ../../CFA_Level_II_2027_Curriculum_Deep_Research.md II 2027 prisma/seed-data/level-2.json",
    );
    process.exit(1);
  }

  const lines = readFileSync(source, "utf8").split(/\r?\n/);

  // Topic sections run 5 to 14 in this document: 1 to 4 are front matter and
  // 15 onward are the unweighted practical-skills modules and study advice.
  const topics = parseBody(lines, [5, 14]);
  const expectations = parseSummaryTable(lines);
  const index = parseModuleIndex(lines);
  crossCheck(topics, expectations, index, { modules: 51, los: 382 });

  const level: Level = { id: levelId, version, topics };

  console.log(`${source} -> ${out}`);
  console.log(`  level ${levelId}, version ${version}`);
  for (const t of topics) {
    const los = t.readings.reduce((n, r) => n + r.los.length, 0);
    console.log(
      `  ${String(t.order).padStart(2)}. ${t.name.padEnd(36)} ` +
        `${t.examWeightMin}-${t.examWeightMax}%  ${String(t.readings.length).padStart(2)} modules  ${String(los).padStart(3)} outcomes`,
    );
  }
  const modules = topics.reduce((n, t) => n + t.readings.length, 0);
  const los = topics.reduce((n, t) => n + t.readings.reduce((m, r) => m + r.los.length, 0), 0);
  console.log(`  total: ${topics.length} topics, ${modules} modules, ${los} outcomes`);

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s), nothing written:`);
    for (const p of problems) console.error(`  ERROR ${p}`);
    process.exit(1);
  }

  writeFileSync(out, `${JSON.stringify(level, null, 2)}\n`, "utf8");
  console.log(`  all four witnesses agree, written`);
}

main();
