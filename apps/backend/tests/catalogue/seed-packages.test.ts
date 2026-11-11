import { beforeEach, describe, test, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDb } from "../helpers/test-db";
import { db } from "../../src/lib/db";
import { seedPackages } from "../../prisma/seed-packages.ts";
import type { PackageFile, CrosswalkFile } from "../../prisma/lib/catalogue-types.ts";

const FAKE_ID_1 = "1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FAKE_ID_2 = "1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/**
 * A level whose shape mirrors the real curriculum closely enough to exercise
 * the loader: two topics, and a second topic with seven readings so the
 * fan-out case (one provider unit covering many readings) is real rather than
 * hypothetical.
 */
async function seedTinyLevel(): Promise<void> {
  await db.level.create({ data: { id: "II", version: "test" } });
  const qm = await db.topic.create({
    data: { levelId: "II", name: "Quantitative Methods", order: 1, examWeightMin: 5, examWeightMax: 10 },
  });
  const r1 = await db.reading.create({ data: { topicId: qm.id, name: "Reading One", order: 1 } });
  await db.lOS.create({ data: { readingId: r1.id, text: "describe the first outcome", order: 1 } });
  await db.lOS.create({ data: { readingId: r1.id, text: "explain the second outcome", order: 2 } });
  const et = await db.topic.create({
    data: { levelId: "II", name: "Ethics", order: 2, examWeightMin: 10, examWeightMax: 15 },
  });
  for (let i = 1; i <= 7; i++) {
    await db.reading.create({ data: { topicId: et.id, name: `Guidance ${i}`, order: i } });
  }
}

function packageFile(lectureSizeKb: number): PackageFile {
  return {
    package: { slug: "test-provider", name: "Test Provider" },
    edition: { levelId: "II", year: "2026" },
    units: [
      {
        ref: "qm/lm1",
        title: "Unit One",
        resources: [
          { ref: "qm/lm1/lecture/1", kind: "lecture", externalId: FAKE_ID_1, sizeKb: lectureSizeKb },
        ],
      },
      {
        // Deliberately the same ref-derived number as qm/lm1. Ten real units
        // share ref-order 1, so an order taken from the ref would violate
        // @@unique([editionId, order]) on the second unit written.
        ref: "et/lm1",
        title: "Unit Two",
        resources: [{ ref: "et/lm1/lecture/1", kind: "lecture", externalId: FAKE_ID_2, sizeKb: 2048 }],
      },
    ],
    editionResources: [],
  };
}

function crosswalkFile(): CrosswalkFile {
  return {
    levelId: "II",
    version: "2027",
    packageSlug: "test-provider",
    map: [
      { unitRef: "qm/lm1", readings: [{ topicOrder: 1, readingOrder: 1, readingName: "Reading One" }] },
      {
        unitRef: "et/lm1",
        readings: Array.from({ length: 7 }, (_, i) => ({
          topicOrder: 2,
          readingOrder: i + 1,
          readingName: `Guidance ${i + 1}`,
        })),
      },
    ],
    uncovered: [],
    losMap: [
      {
        unitRef: "qm/lm1",
        sourceLabel: "Provider label for outcome one",
        topicOrder: 1,
        readingOrder: 1,
        losOrder: 1,
        losText: "describe the first outcome",
      },
      { unitRef: "qm/lm1", sourceLabel: "A label the curriculum dropped", retired: true },
    ],
  };
}

function writeFixtureDir(lectureSizeKb = 1024): string {
  const dir = mkdtempSync(join(tmpdir(), "seedpkg-"));
  writeFileSync(join(dir, "package-test.json"), JSON.stringify(packageFile(lectureSizeKb)));
  writeFileSync(join(dir, "crosswalk-test.json"), JSON.stringify(crosswalkFile()));
  return dir;
}

let dir: string;

beforeEach(async () => {
  await resetDb();
  dir = writeFixtureDir();
});

describe("seedPackages", () => {
  test("loads units, resources and crosswalk bindings", async () => {
    await seedTinyLevel();
    const report = await seedPackages(dir);

    expect(report.editions).toBe(1);
    expect(report.units).toBe(2);
    expect(report.resources).toBe(2);
    expect(report.mappings).toBe(8);
    expect(await db.packageUnit.count()).toBe(2);
  });

  test("a unit covering many readings binds to every one of them", async () => {
    await seedTinyLevel();
    await seedPackages(dir);

    const unit = await db.packageUnit.findFirst({ where: { ref: "et/lm1" }, include: { readings: true } });
    expect(unit!.readings).toHaveLength(7);
  });

  test("two units sharing a ref-derived number still get distinct orders", async () => {
    // The real files have ten units at ref-order 1, so an order read from the
    // ref collides on @@unique([editionId, order]). Order must come from a
    // sequence over the whole edition.
    await seedTinyLevel();
    await seedPackages(dir);

    const units = await db.packageUnit.findMany({ orderBy: { order: "asc" } });
    expect(units.map((u) => u.order)).toEqual([1, 2]);
  });

  test("a reseed preserves a locally measured duration", async () => {
    await seedTinyLevel();
    await seedPackages(dir);
    await db.packageResource.updateMany({
      where: { ref: "qm/lm1/lecture/1" },
      data: { durationSeconds: 1860 },
    });

    await seedPackages(dir); // the file still carries no duration

    const row = await db.packageResource.findFirst({ where: { ref: "qm/lm1/lecture/1" } });
    expect(row!.durationSeconds).toBe(1860);
  });

  test("seeding twice creates no duplicate rows", async () => {
    await seedTinyLevel();
    const first = await seedPackages(dir);
    await seedPackages(dir);

    expect(await db.packageUnit.count()).toBe(first.units);
    expect(await db.packageResource.count()).toBe(first.resources);
    expect(await db.packageUnitReading.count()).toBe(first.mappings);
  });

  test("a changed fact is updated in place", async () => {
    await seedTinyLevel();
    await seedPackages(dir);

    const bigger = writeFixtureDir(99999);
    await seedPackages(bigger);
    rmSync(bigger, { recursive: true, force: true });

    const row = await db.packageResource.findFirst({ where: { ref: "qm/lm1/lecture/1" } });
    expect(row!.sizeKb).toBe(99999);
  });

  test("loading before the curriculum is seeded fails loudly and names the level", async () => {
    // No level rows at all. seed.ts deliberately skips when its data is
    // absent; this loader must not, because its foreign keys point at rows the
    // curriculum seed generates.
    await expect(seedPackages(dir)).rejects.toThrow(/level II/i);
  });

  test("a crosswalk naming a reading the curriculum does not have fails loudly", async () => {
    await seedTinyLevel();
    const bad = mkdtempSync(join(tmpdir(), "seedpkg-bad-"));
    writeFileSync(join(bad, "package-test.json"), JSON.stringify(packageFile(1024)));
    const cw = crosswalkFile();
    cw.map[0].readings[0].readingName = "A Reading That Moved";
    writeFileSync(join(bad, "crosswalk-test.json"), JSON.stringify(cw));

    await expect(seedPackages(bad)).rejects.toThrow(/A Reading That Moved|name/i);
    rmSync(bad, { recursive: true, force: true });
  });

  test("outcome refinements bind to the curriculum, and a retired one binds to nothing", async () => {
    await seedTinyLevel();
    const report = await seedPackages(dir);

    expect(report.refinements).toBe(2);
    const rows = await db.packageUnitLos.findMany({ orderBy: { sourceLabel: "asc" } });
    const retired = rows.find((r) => r.retired)!;
    const bound = rows.find((r) => !r.retired)!;

    expect(retired.losId).toBeNull();
    expect(bound.losId).not.toBeNull();
    const los = await db.lOS.findUnique({ where: { id: bound.losId! } });
    expect(los!.text).toBe("describe the first outcome");
    expect(los!.order).toBe(1);
  });

  test("an outcome whose stored text no longer matches the curriculum fails loudly", async () => {
    // The same positional hazard as a renumbered reading. Outcomes resolve by
    // order, so a reseed that reorders them inside a reading would otherwise
    // rebind a provider question count to a different outcome in silence.
    await seedTinyLevel();
    const bad = mkdtempSync(join(tmpdir(), "seedpkg-los-"));
    writeFileSync(join(bad, "package-test.json"), JSON.stringify(packageFile(1024)));
    const cw = crosswalkFile();
    const bound = cw.losMap!.find((l) => !("retired" in l))! as { losText: string };
    bound.losText = "an outcome that was reordered away";
    writeFileSync(join(bad, "crosswalk-test.json"), JSON.stringify(cw));

    await expect(seedPackages(bad)).rejects.toThrow(/reordered away|Re-review/i);
    rmSync(bad, { recursive: true, force: true });
  });
});
