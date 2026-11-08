/**
 * Structural check for a curriculum seed file, run before seeding.
 *
 * A seed file is several hundred hand-transcribed entries, and the failure
 * modes are quiet ones: a duplicated `order` silently reorders a topic, a
 * missing exam weight makes coverage maths wrong rather than erroring, and a
 * truncated outcome reads as real text. The seed script itself would accept
 * all three. This refuses them.
 *
 *   pnpm --filter backend exec tsx prisma/validate-seed.ts prisma/seed-data/level-2.json
 *
 * Exits non-zero on any error, so it can gate a seed in CI or a shell chain.
 */
import { readFileSync } from "node:fs";

type Los = { text: string; order: number };
type Reading = { name: string; order: number; los: Los[] };
type Topic = {
  name: string;
  order: number;
  examWeightMin: number;
  examWeightMax: number;
  readings: Reading[];
};
type Level = { id: string; version?: string; topics: Topic[] };

/**
 * The command verbs CFA Institute's outcomes actually open with, taken from
 * the Level I outline rather than guessed. Extend it if a later level
 * introduces a verb this set does not have; a warning is the cost of being
 * wrong, not a failed seed.
 */
const COMMAND_VERBS = new Set([
  "describe", "explain", "calculate", "compare", "identify", "contrast",
  "demonstrate", "define", "recommend", "analyze", "evaluate", "determine",
  "formulate", "estimate", "discuss", "interpret", "justify", "prepare",
  "construct", "classify", "derive",
]);

const errors: string[] = [];
const warnings: string[] = [];

function err(path: string, message: string): void {
  errors.push(`${path}: ${message}`);
}
function warn(path: string, message: string): void {
  warnings.push(`${path}: ${message}`);
}

/** Orders must be unique and gapless, since they are the only sort key. */
function checkOrders(path: string, orders: number[]): void {
  const seen = new Set<number>();
  for (const o of orders) {
    if (!Number.isInteger(o) || o < 1) err(path, `order ${o} is not a positive integer`);
    if (seen.has(o)) err(path, `order ${o} is used more than once`);
    seen.add(o);
  }
  const sorted = [...seen].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      warn(path, `orders are not 1..${sorted.length} (first gap at ${i + 1})`);
      break;
    }
  }
}

function validate(file: string): void {
  let data: Level;
  try {
    data = JSON.parse(readFileSync(file, "utf8")) as Level;
  } catch (e) {
    console.error(`Could not parse ${file}: ${(e as Error).message}`);
    process.exit(1);
  }

  if (!["I", "II", "III"].includes(data.id)) {
    err("level", `id must be I, II or III, got ${JSON.stringify(data.id)}`);
  }
  if (!data.version) {
    warn("level", "no version set, the seed will fall back to today's date");
  }
  if (!Array.isArray(data.topics) || data.topics.length === 0) {
    err("level", "no topics");
    report(file, data);
    return;
  }

  checkOrders("topics", data.topics.map((t) => t.order));

  // The weights are what coverage is measured against, so a set that cannot
  // reach 100 percent means every coverage figure will be wrong.
  let minSum = 0;
  let maxSum = 0;
  const topicNames = new Set<string>();

  for (const t of data.topics) {
    const tp = `topic "${t.name ?? "(unnamed)"}"`;
    if (!t.name?.trim()) err(tp, "missing name");
    if (topicNames.has(t.name)) err(tp, "duplicate topic name");
    topicNames.add(t.name);

    for (const [k, v] of [["examWeightMin", t.examWeightMin], ["examWeightMax", t.examWeightMax]] as const) {
      if (typeof v !== "number" || v < 0 || v > 100) err(tp, `${k} must be 0 to 100, got ${v}`);
    }
    if (t.examWeightMin > t.examWeightMax) err(tp, "examWeightMin exceeds examWeightMax");
    minSum += t.examWeightMin ?? 0;
    maxSum += t.examWeightMax ?? 0;

    if (!Array.isArray(t.readings) || t.readings.length === 0) {
      err(tp, "no readings");
      continue;
    }
    checkOrders(`${tp} readings`, t.readings.map((r) => r.order));

    const readingNames = new Set<string>();
    for (const r of t.readings) {
      const rp = `${tp} > reading "${r.name ?? "(unnamed)"}"`;
      if (!r.name?.trim()) err(rp, "missing name");
      if (readingNames.has(r.name)) err(rp, "duplicate reading name within this topic");
      readingNames.add(r.name);

      if (!Array.isArray(r.los) || r.los.length === 0) {
        err(rp, "no outcomes");
        continue;
      }
      checkOrders(`${rp} outcomes`, r.los.map((l) => l.order));

      for (const l of r.los) {
        const lp = `${rp} > outcome ${l.order}`;
        const text = (l.text ?? "").trim();
        if (!text) {
          err(lp, "empty text");
          continue;
        }
        // Every CFA outcome opens with a command verb, which is a far better
        // truncation signal than length: real outcomes are often as short as
        // "explain ethics", so a length threshold only produces false alarms.
        // A line that does NOT start with a command verb has usually lost its
        // beginning, or picked up a stray heading.
        const first = text.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
        if (!COMMAND_VERBS.has(first)) {
          warn(lp, `starts with "${first}", not a known command verb, check for transcription damage`);
        }
        if (/\.\.\.$|…$/.test(text)) warn(lp, "text ends in an ellipsis, likely truncated");
        if (/[a-z]-$/.test(text)) warn(lp, "text ends in a hyphen, likely a broken line join");
      }
    }
  }

  // 100 has to sit inside the summed range, or no assignment of weights can
  // ever total a whole exam.
  if (minSum > 100) err("weights", `minimum weights sum to ${minSum}, above 100`);
  if (maxSum < 100) err("weights", `maximum weights sum to ${maxSum}, below 100`);

  report(file, data);
}

function report(file: string, data: Level): void {
  const topics = data.topics?.length ?? 0;
  const readings = data.topics?.reduce((s, t) => s + (t.readings?.length ?? 0), 0) ?? 0;
  const los =
    data.topics?.reduce(
      (s, t) => s + (t.readings?.reduce((n, r) => n + (r.los?.length ?? 0), 0) ?? 0),
      0,
    ) ?? 0;

  console.log(`${file}`);
  console.log(`  level ${data.id}, version ${data.version ?? "(unset)"}`);
  console.log(`  ${topics} topics, ${readings} readings, ${los} outcomes`);

  for (const w of warnings) console.log(`  WARN  ${w}`);
  for (const e of errors) console.log(`  ERROR ${e}`);

  if (errors.length === 0) {
    console.log(warnings.length ? `  usable, with ${warnings.length} warning(s)` : "  valid");
  } else {
    console.log(`  ${errors.length} error(s), do not seed this file`);
    process.exit(1);
  }
}

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx prisma/validate-seed.ts <path-to-level-json>");
  process.exit(1);
}
validate(file);
