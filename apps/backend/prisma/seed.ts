/**
 * Curriculum seed script.
 *
 * Reads every `prisma/seed-data/level-*.json` file present and loads it into
 * the Level / Topic / Reading / LOS tables. Each file holds one level's data
 * shaped as:
 *
 * type SeedLevel = {
 *   id: "I" | "II" | "III"
 *   topics: Array<{
 *     name: string
 *     order: number
 *     examWeightMin: number
 *     examWeightMax: number
 *     readings: Array<{
 *       name: string
 *       order: number
 *       los: Array<{ text: string; order: number }>
 *     }>
 *   }>
 * }
 *
 * Upsert-by-natural-key: records are matched on a natural key, not on their
 * generated id, so re-running this script after a curriculum text refresh
 * updates rows in place instead of duplicating them:
 *   - Level:   matched by `id` (the level code itself)
 *   - Topic:   matched by (levelId, order)
 *   - Reading: matched by (topicId, order)
 *   - LOS:     matched by (readingId, order)
 *
 * The Topic/Reading/LOS tables carry no DB-level unique constraint on those
 * natural keys (see the Task 2 schema), so Prisma's `.upsert()` can't target
 * them directly; this script implements the same find-then-create-or-update
 * behavior itself.
 *
 * `prisma/seed-data/*.json` is gitignored (private, licensed CFA Institute
 * curriculum text). If no seed-data files are present (a fresh CI checkout
 * without the private data, for example), this script logs a warning and exits
 * 0, so `pnpm install` never fails on missing private data.
 *
 * Pass `--prune` to also delete rows this level has in the database but not in
 * its file. Off by default, because deleting curriculum rows is destructive and
 * a seed should never do that implicitly.
 *
 * Why it exists: matching on `order` means the key is positional, so if a
 * later edition of a file changes a topic's or reading's position, every child
 * row silently reattaches to whatever now occupies that number, and any
 * surplus is simply left behind. That is not theoretical. The Level I data in
 * development had Fixed Income readings filed under Equities and an Equity
 * reading under Corporate Finance, plus 118 outcomes belonging to no reading
 * in the current file, all from an earlier file with a different split. The
 * damage is invisible: every screen renders, and only the exam-weight share
 * (which divides a topic's weight by its outcome count) comes out wrong.
 */

import { PrismaClient } from "@prisma/client";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const prisma = new PrismaClient();

type SeedLOS = { text: string; order: number };
type SeedReading = { name: string; order: number; los: SeedLOS[] };
type SeedTopic = {
  name: string;
  order: number;
  examWeightMin: number;
  examWeightMax: number;
  readings: SeedReading[];
};
type SeedLevel = {
  id: "I" | "II" | "III";
  /**
   * Which curriculum edition this file holds, e.g. "2027". Echoed by
   * /api/curriculum so a client holding a cached tree can tell when the
   * outcome ids it knows are no longer the ones the server has. Optional so an
   * older seed file still loads, falling back to the file's own date.
   */
  version?: string;
  topics: SeedTopic[];
};

// Resolved without __dirname, which does not exist in an ES module. Node 22
// strips types natively but reparses this file as ESM (it has import syntax
// and the package has no "type" field), so __dirname was undefined at run
// time and the seed could not find its own data. Deriving the directory from
// import.meta.url works under tsx and plain node alike.
const SEED_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "seed-data");

type Counts = { levels: number; topics: number; readings: number; los: number };

function loadSeedLevels(): SeedLevel[] {
  let entries: string[];
  try {
    entries = readdirSync(SEED_DATA_DIR);
  } catch {
    return [];
  }

  return entries
    .filter((f) => /^level-\d+\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(SEED_DATA_DIR, f), "utf-8")) as SeedLevel);
}

async function seedLevel(level: SeedLevel, counts: Counts): Promise<void> {
  // The version is written on every run, not just on create: a reseed with a
  // new curriculum edition must update it, or cached clients would never learn
  // their outcome ids changed.
  const version = level.version ?? new Date().toISOString().slice(0, 10);
  await prisma.level.upsert({
    where: { id: level.id },
    create: { id: level.id, version },
    update: { version },
  });
  counts.levels += 1;

  for (const topic of level.topics) {
    const existingTopic = await prisma.topic.findFirst({
      where: { levelId: level.id, order: topic.order },
    });
    const topicData = {
      levelId: level.id,
      name: topic.name,
      order: topic.order,
      examWeightMin: topic.examWeightMin,
      examWeightMax: topic.examWeightMax,
    };
    const topicRow = existingTopic
      ? await prisma.topic.update({ where: { id: existingTopic.id }, data: topicData })
      : await prisma.topic.create({ data: topicData });
    counts.topics += 1;

    for (const reading of topic.readings) {
      const existingReading = await prisma.reading.findFirst({
        where: { topicId: topicRow.id, order: reading.order },
      });
      const readingData = {
        topicId: topicRow.id,
        name: reading.name,
        order: reading.order,
      };
      const readingRow = existingReading
        ? await prisma.reading.update({ where: { id: existingReading.id }, data: readingData })
        : await prisma.reading.create({ data: readingData });
      counts.readings += 1;

      for (const los of reading.los) {
        const existingLos = await prisma.lOS.findFirst({
          where: { readingId: readingRow.id, order: los.order },
        });
        const losData = { readingId: readingRow.id, text: los.text, order: los.order };
        if (existingLos) {
          await prisma.lOS.update({ where: { id: existingLos.id }, data: losData });
        } else {
          await prisma.lOS.create({ data: losData });
        }
        counts.los += 1;
      }
    }
  }
}

/**
 * Deletes rows belonging to `level` that its file no longer defines.
 *
 * Refuses rather than cascading when a doomed outcome carries study log
 * entries: those are the candidate's own work, and silently destroying them to
 * tidy the curriculum would be the worse bug. The operator is told exactly
 * what blocks the prune and can decide.
 *
 * Returns true when the level was left alone.
 */
async function pruneLevel(level: SeedLevel, dryRun: boolean): Promise<boolean> {
  // The file's positional keys, which are what the seed matched on above.
  const keepTopics = new Set(level.topics.map((t) => t.order));
  const keepReadings = new Set<string>();
  const keepLos = new Set<string>();
  for (const t of level.topics) {
    for (const r of t.readings) {
      keepReadings.add(`${t.order}/${r.order}`);
      for (const l of r.los) keepLos.add(`${t.order}/${r.order}/${l.order}`);
    }
  }

  const topics = await prisma.topic.findMany({
    where: { levelId: level.id },
    select: {
      id: true,
      order: true,
      readings: {
        select: {
          id: true,
          order: true,
          los: { select: { id: true, order: true, _count: { select: { logs: true } } } },
        },
      },
    },
  });

  const doomedTopics: string[] = [];
  const doomedReadings: string[] = [];
  const doomedLos: string[] = [];
  let blockedBy = 0;

  for (const t of topics) {
    const topicGoes = !keepTopics.has(t.order);
    if (topicGoes) doomedTopics.push(t.id);
    for (const r of t.readings) {
      const readingGoes = topicGoes || !keepReadings.has(`${t.order}/${r.order}`);
      if (readingGoes) doomedReadings.push(r.id);
      for (const l of r.los) {
        if (!readingGoes && keepLos.has(`${t.order}/${r.order}/${l.order}`)) continue;
        doomedLos.push(l.id);
        blockedBy += l._count.logs;
      }
    }
  }

  if (doomedLos.length === 0 && doomedReadings.length === 0 && doomedTopics.length === 0) {
    console.log(`  prune: level ${level.id} already matches its file exactly`);
    return true;
  }

  console.log(
    `  prune: level ${level.id} has ${doomedTopics.length} topic(s), ` +
      `${doomedReadings.length} reading(s) and ${doomedLos.length} outcome(s) not in its file`,
  );

  if (blockedBy > 0) {
    console.error(
      `  prune: REFUSED for level ${level.id}. ${blockedBy} study log entr(ies) reference outcomes that ` +
        `would be deleted. Reassign or export them first; nothing was changed.`,
    );
    return false;
  }

  if (dryRun) {
    console.log(`  prune: dry run, nothing deleted (no study logs would block it)`);
    return true;
  }

  // Children first: the schema has no cascade, so a parent delete would fail
  // on its own foreign keys.
  await prisma.lOS.deleteMany({ where: { id: { in: doomedLos } } });
  await prisma.reading.deleteMany({ where: { id: { in: doomedReadings } } });
  await prisma.topic.deleteMany({ where: { id: { in: doomedTopics } } });
  console.log(`  prune: level ${level.id} now matches its file`);
  return true;
}

async function main(): Promise<void> {
  const prune = process.argv.includes("--prune");
  // Pairing --prune with --dry-run reports what would go without touching it,
  // which is the only safe way to inspect positional drift on a database whose
  // history you do not know.
  const dryRun = process.argv.includes("--dry-run");
  const levels = loadSeedLevels();

  if (levels.length === 0) {
    console.warn(
      `No seed-data files found in ${SEED_DATA_DIR} (expected prisma/seed-data/level-*.json). Skipping seed.`,
    );
    return;
  }

  const counts: Counts = { levels: 0, topics: 0, readings: 0, los: 0 };

  let refused = false;
  for (const level of levels) {
    await seedLevel(level, counts);
    // After seeding, never before: pruning first would delete rows this run is
    // about to write back, turning a reseed into a needless churn of ids.
    if (prune && !(await pruneLevel(level, dryRun))) refused = true;
  }

  console.log(
    `Seed complete: ${counts.levels} level(s), ${counts.topics} topic(s), ${counts.readings} reading(s), ${counts.los} LOS.`,
  );

  if (refused) {
    console.error("One or more levels could not be pruned; see above.");
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
