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
 * curriculum text). If no seed-data files are present -- e.g. a fresh CI
 * checkout without the private data -- this script logs a warning and exits
 * 0, so `pnpm install` never fails on missing private data.
 */

import { PrismaClient } from "@prisma/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
type SeedLevel = { id: "I" | "II" | "III"; topics: SeedTopic[] };

const SEED_DATA_DIR = join(__dirname, "seed-data");

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
  await prisma.level.upsert({
    where: { id: level.id },
    create: { id: level.id },
    update: {},
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

async function main(): Promise<void> {
  const levels = loadSeedLevels();

  if (levels.length === 0) {
    console.warn(
      `No seed-data files found in ${SEED_DATA_DIR} (expected prisma/seed-data/level-*.json). Skipping seed.`,
    );
    return;
  }

  const counts: Counts = { levels: 0, topics: 0, readings: 0, los: 0 };

  for (const level of levels) {
    await seedLevel(level, counts);
  }

  console.log(
    `Seed complete: ${counts.levels} level(s), ${counts.topics} topic(s), ${counts.readings} reading(s), ${counts.los} LOS.`,
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
