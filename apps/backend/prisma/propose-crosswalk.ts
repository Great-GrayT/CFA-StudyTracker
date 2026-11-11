/**
 * Proposes, and then validates, the crosswalk binding a provider package's
 * units to the readings of a seeded curriculum level.
 *
 * The crosswalk is seeded and human-reviewed, never derived by name matching
 * at load time: name matching fails on the exact drift present in this data
 * ("Corporate Finance" vs "Corporate Issuers", Meldrum's "Evaluation Quality
 * of Financial Reports" vs the curriculum's "Evaluating Quality"), and a
 * near-miss matcher is worse than none because it is silently wrong.
 *
 * proposeCrosswalk drafts matches on an exact normalised title and reports
 * everything it cannot match confidently rather than guessing. A human
 * reviews the draft once; the reviewed file is then the record.
 *
 * checkCrosswalk is what runs on every load. It resolves every claim by
 * (topicOrder, readingOrder) and then verifies the stored name against the
 * level's current name, which is the whole defence against a renumbered
 * curriculum silently rebinding provider content to the wrong module.
 */
import { fileURLToPath } from "url";
import { realpathSync } from "node:fs";
import type { PackageFile, UnitFile, LosRefinement } from "./lib/catalogue-types.ts";
import type { CrosswalkFile, MapEntry, UncoveredEntry, LosMapEntry } from "./lib/catalogue-types.ts";

const __filename = fileURLToPath(import.meta.url);

// Mirrors the seed-data/level-N.json shape built by extract-curriculum.ts.
// Kept local rather than shared: each consumer of that shape (extract-curriculum.ts,
// validate-seed.ts) already defines its own copy rather than a shared export.
export interface LevelOutcome {
  text: string;
  order: number;
}
export interface LevelReading {
  name: string;
  order: number;
  los: LevelOutcome[];
}
export interface LevelTopic {
  name: string;
  order: number;
  examWeightMin: number;
  examWeightMax: number;
  readings: LevelReading[];
}
export interface LevelFile {
  id: string;
  version: string;
  topics: LevelTopic[];
}

export interface ProposeResult {
  file: CrosswalkFile;
  unmatched: string[];
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐-―−]/g, "-") // unify dash variants to a plain hyphen
    .replace(/\s+/g, " ")
    .trim();
}

// Fuzzy enough to absorb trivial wording drift ("a" vs "the", singular vs
// plural, an inserted "describe") without absorbing an actually different
// outcome. Word order is NOT normalised away: an earlier version sorted
// tokens, which made this a bag-of-words matcher and let two genuinely
// different outcomes built from the same words in a different order collide.
// Measured against the real data, the sort bought nothing (both known drifts
// differ only by an article and a plural, never by order) and cost precision,
// so order is preserved and only the stopword/stem folding remains.
const LOS_STOPWORDS = new Set(["a", "an", "the", "describe"]);

// Folds a trailing "s" off any token over three characters, not just plural
// nouns: "analysis" -> "analysi", "bias" -> "bia", "focus" -> "focu". That is
// deliberately crude, not a real stemmer. It is applied identically to both
// sides of every comparison, so a genuine match still matches (both sides
// over-fold the same way); the risk it does not guard against is two
// DIFFERENT words that happen to collide once over-folded, which is a
// trade-off accepted here rather than a claimed narrowness.
function normalizeLos(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !LOS_STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t))
    .join(" ");
}

function readingKey(topicOrder: number, readingOrder: number): string {
  return `${topicOrder}:${readingOrder}`;
}

function losKey(topicOrder: number, readingOrder: number, losOrder: number): string {
  return `${topicOrder}:${readingOrder}:${losOrder}`;
}

export function proposeCrosswalk(pkg: PackageFile, level: LevelFile): ProposeResult {
  const unmatched: string[] = [];

  const titleIndex = new Map<
    string,
    { topicOrder: number; readingOrder: number; readingName: string }[]
  >();
  for (const topic of level.topics) {
    for (const reading of topic.readings) {
      const key = normalizeTitle(reading.name);
      const hits = titleIndex.get(key) ?? [];
      hits.push({ topicOrder: topic.order, readingOrder: reading.order, readingName: reading.name });
      titleIndex.set(key, hits);
    }
  }

  const map: MapEntry[] = [];
  const coveredKeys = new Set<string>();

  for (const unit of pkg.units) {
    const hits = titleIndex.get(normalizeTitle(unit.title)) ?? [];
    // Zero hits is a drifted or absent title; more than one is an ambiguous
    // title. Both need a human, not a guess.
    if (hits.length !== 1) {
      unmatched.push(unit.ref);
      continue;
    }
    const hit = hits[0];
    map.push({ unitRef: unit.ref, readings: [hit] });
    coveredKeys.add(readingKey(hit.topicOrder, hit.readingOrder));
  }

  const uncovered: UncoveredEntry[] = [];
  for (const topic of level.topics) {
    for (const reading of topic.readings) {
      if (!coveredKeys.has(readingKey(topic.order, reading.order))) {
        uncovered.push({ topicOrder: topic.order, readingOrder: reading.order, readingName: reading.name });
      }
    }
  }

  const losMap = proposeLosMap(pkg, level, map, unmatched);

  const file: CrosswalkFile = {
    levelId: level.id,
    version: level.version,
    packageSlug: pkg.package.slug,
    map,
    uncovered,
    ...(losMap.length > 0 ? { losMap } : {}),
  };

  return { file, unmatched };
}

// Only units the title pass already bound get an outcome proposal: a unit
// still in `unmatched` has no settled (topicOrder, readingOrder) to anchor
// its outcomes to, so its refinements wait on the same human review.
function proposeLosMap(
  pkg: PackageFile,
  level: LevelFile,
  map: MapEntry[],
  unmatched: string[],
): LosMapEntry[] {
  const losMap: LosMapEntry[] = [];
  const unitsByRef = new Map<string, UnitFile>(pkg.units.map((u) => [u.ref, u]));

  for (const entry of map) {
    const unit = unitsByRef.get(entry.unitRef);
    if (!unit?.losRefinements || unit.losRefinements.length === 0) continue;

    // Invariant: entry.readings has exactly one element here. The proposer
    // itself only ever emits single-reading map entries (fan-out entries like
    // et/lm2 -> 7 readings are added later, by hand, during review), so this
    // function never runs against a fan-out entry. If that ever changes,
    // this anchor needs to pick a reading explicitly rather than assume [0].
    const { topicOrder, readingOrder } = entry.readings[0];
    const topic = level.topics.find((t) => t.order === topicOrder);
    const reading = topic?.readings.find((r) => r.order === readingOrder);
    if (!reading) continue; // already reported via the map/uncovered reconciliation

    for (const refinement of unit.losRefinements) {
      const proposed = proposeOneLos(entry.unitRef, refinement, topicOrder, readingOrder, reading);
      if (proposed) {
        losMap.push(proposed);
      } else {
        unmatched.push(`${entry.unitRef} los: ${refinement.sourceLabel}`);
      }
    }
  }

  return losMap;
}

// Unresolved refinements are left out of the draft entirely, the same way an
// ambiguous unit title never gets a map entry: only the unmatched list flags
// them, so a human adds the binding (or the retired flag) rather than the
// proposer emitting a half-formed entry of its own.
function proposeOneLos(
  unitRef: string,
  refinement: LosRefinement,
  topicOrder: number,
  readingOrder: number,
  reading: LevelReading,
): LosMapEntry | null {
  if (refinement.retired) {
    return { unitRef, sourceLabel: refinement.sourceLabel, retired: true };
  }

  const target = normalizeLos(refinement.sourceLabel);
  const candidates = reading.los.filter((l) => normalizeLos(l.text) === target);

  if (candidates.length !== 1) {
    return null;
  }

  const los = candidates[0];
  return {
    unitRef,
    sourceLabel: refinement.sourceLabel,
    topicOrder,
    readingOrder,
    losOrder: los.order,
    losText: los.text,
  };
}

export function checkCrosswalk(file: CrosswalkFile, level: LevelFile): string[] {
  const errors: string[] = [];

  // Refuse before comparing anything else. A crosswalk checked against the
  // wrong level usually produces a flood of "no reading at topic N" noise, but
  // not always, and a partial accidental overlap would validate content bound
  // to the wrong curriculum entirely.
  if (file.levelId !== level.id) {
    errors.push(
      `crosswalk is for level ${file.levelId} but the curriculum given is level ${level.id}`,
    );
    return errors;
  }

  const levelReadingByKey = new Map<string, { name: string }>();
  const levelLosByKey = new Map<string, { text: string }>();
  for (const topic of level.topics) {
    for (const reading of topic.readings) {
      levelReadingByKey.set(readingKey(topic.order, reading.order), { name: reading.name });
      for (const los of reading.los) {
        levelLosByKey.set(losKey(topic.order, reading.order, los.order), { text: los.text });
      }
    }
  }

  // Claims per valid level key, so "claimed twice" and "missing from both
  // lists" can never be confused with each other: a key the level does not
  // even have gets its own error below and is never counted here.
  const claims = new Map<string, string[]>();

  function claim(topicOrder: number, readingOrder: number, readingName: string, claimant: string): void {
    const key = readingKey(topicOrder, readingOrder);
    const levelReading = levelReadingByKey.get(key);
    if (!levelReading) {
      errors.push(`${claimant}: no reading at topic ${topicOrder} reading ${readingOrder} in the level`);
      return;
    }
    if (levelReading.name !== readingName) {
      errors.push(
        `${claimant}: stored reading name "${readingName}" for topic ${topicOrder} reading ${readingOrder} ` +
          `does not match the level's current name "${levelReading.name}"`,
      );
    }
    const list = claims.get(key) ?? [];
    list.push(claimant);
    claims.set(key, list);
  }

  for (const entry of file.map) {
    if (entry.readings.length === 0) {
      errors.push(`unit ${entry.unitRef} maps to no readings`);
    }
    for (const r of entry.readings) {
      claim(r.topicOrder, r.readingOrder, r.readingName, `unit ${entry.unitRef}`);
    }
  }

  for (const entry of file.uncovered) {
    claim(entry.topicOrder, entry.readingOrder, entry.readingName, "the uncovered list");
  }

  const missing: string[] = [];
  for (const key of levelReadingByKey.keys()) {
    const claimants = claims.get(key) ?? [];
    if (claimants.length === 0) {
      missing.push(key);
    } else if (claimants.length > 1) {
      errors.push(`reading ${key} is claimed twice (duplicate), by: ${claimants.join(", ")}`);
    }
  }

  if (missing.length > 0) {
    const accountedFor = levelReadingByKey.size - missing.length;
    errors.push(
      `map and uncovered together have accounted for ${accountedFor} of ${levelReadingByKey.size} readings; ` +
        `missing: ${missing.join(", ")}`,
    );
  }

  const seenLosClaims = new Set<string>();
  for (const entry of file.losMap ?? []) {
    // Checked before the retired/bound split so two identical retired
    // entries are caught too, not just two identical bound ones.
    const dedupeKey = `${entry.unitRef}::${entry.sourceLabel}`;
    if (seenLosClaims.has(dedupeKey)) {
      errors.push(`losMap entry for unit ${entry.unitRef} ("${entry.sourceLabel}") appears twice (duplicate)`);
    }
    seenLosClaims.add(dedupeKey);

    if ("retired" in entry && entry.retired === true) {
      if (!entry.unitRef || !entry.sourceLabel) {
        errors.push("a retired losMap entry is missing unitRef or sourceLabel");
      }
      continue;
    }

    const bound = entry as Extract<LosMapEntry, { losOrder: number }>;
    if (
      typeof bound.topicOrder !== "number" ||
      typeof bound.readingOrder !== "number" ||
      typeof bound.losOrder !== "number"
    ) {
      errors.push(
        `losMap entry for unit ${entry.unitRef} ("${entry.sourceLabel}") is neither bound to an outcome nor marked retired`,
      );
      continue;
    }

    const key = losKey(bound.topicOrder, bound.readingOrder, bound.losOrder);
    const levelLos = levelLosByKey.get(key);
    if (!levelLos) {
      errors.push(
        `losMap entry for unit ${entry.unitRef}: no outcome at topic ${bound.topicOrder} reading ${bound.readingOrder} ` +
          `los ${bound.losOrder} in the level`,
      );
    } else if (bound.losText !== levelLos.text) {
      errors.push(
        `losMap entry for unit ${entry.unitRef}: stored outcome text for topic ${bound.topicOrder} reading ${bound.readingOrder} ` +
          `los ${bound.losOrder} does not match the level's current text`,
      );
    }
  }

  return errors;
}

function countReadingsCovered(map: MapEntry[]): number {
  return new Set(map.flatMap((m) => m.readings.map((r) => readingKey(r.topicOrder, r.readingOrder)))).size;
}

function usage(): void {
  console.error(
    "usage:\n" +
      "  tsx prisma/propose-crosswalk.ts propose <package.json> <level.json> <out.json>\n" +
      "  tsx prisma/propose-crosswalk.ts check <crosswalk.json> <level.json>",
  );
}

async function runPropose(packagePath: string, levelPath: string, outPath: string): Promise<void> {
  const fs = await import("fs");
  const pkg = JSON.parse(await fs.promises.readFile(packagePath, "utf-8")) as PackageFile;
  const level = JSON.parse(await fs.promises.readFile(levelPath, "utf-8")) as LevelFile;

  const { file, unmatched } = proposeCrosswalk(pkg, level);

  const readingsCovered = countReadingsCovered(file.map);

  console.log(`Package: ${pkg.package.slug}`);
  console.log(`Units: ${pkg.units.length}`);
  console.log(`Draft map entries: ${file.map.length}, covering ${readingsCovered} readings`);
  console.log(`Draft uncovered: ${file.uncovered.length}`);
  console.log(`Needs human review (unmatched): ${unmatched.length}`);
  for (const u of unmatched) console.log(`  - ${u}`);

  await fs.promises.writeFile(outPath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  console.log(`Wrote draft: ${outPath}`);
}

async function runCheck(crosswalkPath: string, levelPath: string): Promise<void> {
  const fs = await import("fs");
  const file = JSON.parse(await fs.promises.readFile(crosswalkPath, "utf-8")) as CrosswalkFile;
  const level = JSON.parse(await fs.promises.readFile(levelPath, "utf-8")) as LevelFile;

  const errors = checkCrosswalk(file, level);

  const readingsCovered = countReadingsCovered(file.map);

  console.log(`Package: ${file.packageSlug}`);
  console.log(`Units: ${file.map.length}, covering ${readingsCovered} readings`);
  console.log(`Uncovered: ${file.uncovered.length}`);
  if (file.losMap) console.log(`LOS bindings: ${file.losMap.length}`);

  if (errors.length > 0) {
    console.error(`${errors.length} problem(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log("checkCrosswalk: all clear");
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (command === "propose" && rest.length === 3) {
    await runPropose(rest[0], rest[1], rest[2]);
    return;
  }

  if (command === "check" && rest.length === 2) {
    await runCheck(rest[0], rest[1]);
    return;
  }

  usage();
  process.exit(1);
}

// Call main if this is the entry point (works under both node and tsx).
// import.meta.main is true under node but undefined under tsx, so it cannot
// be used here.
const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename);

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
