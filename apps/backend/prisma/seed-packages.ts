/**
 * Provider catalogue loader.
 *
 * Reads every `package-*.json` and `crosswalk-*.json` in a directory and loads
 * them into the PackageEdition / PackageUnit / PackageResource tables, binding
 * each provider unit to the curriculum readings it covers.
 *
 * Separate from `seed.ts`, not an extension of it, for one structural reason:
 * the crosswalk's foreign keys point at Reading and LOS rows whose ids the
 * curriculum seed generates. `seed.ts` deliberately skips when its data is
 * absent so a CI install never fails on missing private files. This loader must
 * do the opposite and fail loudly, because loading a catalogue against a level
 * that is not there cannot produce anything useful.
 *
 * Unlike `seed.ts`, these tables carry real unique constraints, so this upserts
 * directly instead of hand-rolling find-then-create-or-update.
 *
 *   node prisma/seed-packages.ts [dir]
 *
 * `prisma/seed-data/*.json` is gitignored: provider catalogue data is private.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import type { PackageFile, CrosswalkFile, ResourceFile } from "./lib/catalogue-types.ts";

const prisma = new PrismaClient();

export type SeedReport = {
  editions: number;
  units: number;
  resources: number;
  mappings: number;
  refinements: number;
};

const SEED_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "seed-data");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function filesMatching(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir)
    .filter((f) => pattern.test(f))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * The resource facts a seed file owns, and may therefore overwrite on a reseed.
 *
 * `durationSeconds` is deliberately absent. It is measured by hand against the
 * provider's own player and lives nowhere else, while the seed file always
 * carries null. Including it here would silently destroy that measurement on
 * the next reseed, with no error and no way to notice.
 */
function resourceFacts(r: ResourceFile, editionId: string, unitId: string | null) {
  return {
    editionId,
    unitId,
    kind: r.kind,
    externalId: r.externalId,
    sizeKb: r.sizeKb,
    pageCount: r.pageCount ?? null,
    wordCount: r.wordCount ?? null,
    questionCount: r.questionCount ?? null,
    vignetteCount: r.vignetteCount ?? null,
    calcCount: r.calcCount ?? null,
    exhibitCount: r.exhibitCount ?? null,
    sourceNote: r.sourceNote ?? null,
  };
}

async function loadPackage(file: PackageFile): Promise<{ editionId: string; units: number; resources: number }> {
  const level = await prisma.level.findUnique({ where: { id: file.edition.levelId } });
  if (!level) {
    throw new Error(
      `Cannot load ${file.package.slug}: level ${file.edition.levelId} is not seeded. ` +
        `Run the curriculum seed first (pnpm --filter backend db:seed).`,
    );
  }

  const pkg = await prisma.studyPackage.upsert({
    where: { slug: file.package.slug },
    create: { slug: file.package.slug, name: file.package.name, userId: null },
    update: { name: file.package.name },
  });

  const edition = await prisma.packageEdition.upsert({
    where: {
      packageId_levelId_year: {
        packageId: pkg.id,
        levelId: file.edition.levelId,
        year: file.edition.year,
      },
    },
    create: {
      packageId: pkg.id,
      levelId: file.edition.levelId,
      year: file.edition.year,
      sourceUrl: file.edition.sourceUrl ?? null,
      snapshotDate: file.edition.snapshotDate ? new Date(file.edition.snapshotDate) : null,
    },
    update: {
      sourceUrl: file.edition.sourceUrl ?? null,
      snapshotDate: file.edition.snapshotDate ? new Date(file.edition.snapshotDate) : null,
    },
  });

  let resources = 0;

  for (const [index, unit] of file.units.entries()) {
    // Order comes from position in the file, never from the ref. Refs are
    // numbered per topic, so ten units really do parse to "1", and a
    // ref-derived order would collide on @@unique([editionId, order]) at the
    // second unit written.
    const unitRow = await prisma.packageUnit.upsert({
      where: { editionId_ref: { editionId: edition.id, ref: unit.ref } },
      create: {
        editionId: edition.id,
        ref: unit.ref,
        order: index + 1,
        title: unit.title ?? null,
        notesPageStart: unit.notesPageStart ?? null,
        notesPageCount: unit.notesPageCount ?? null,
      },
      update: {
        order: index + 1,
        title: unit.title ?? null,
        notesPageStart: unit.notesPageStart ?? null,
        notesPageCount: unit.notesPageCount ?? null,
      },
    });

    for (const r of unit.resources) {
      const facts = resourceFacts(r, edition.id, unitRow.id);
      await prisma.packageResource.upsert({
        where: { editionId_ref: { editionId: edition.id, ref: r.ref } },
        create: { ...facts, ref: r.ref },
        update: facts,
      });
      resources += 1;
    }
  }

  for (const r of file.editionResources) {
    const facts = resourceFacts(r, edition.id, null);
    await prisma.packageResource.upsert({
      where: { editionId_ref: { editionId: edition.id, ref: r.ref } },
      create: { ...facts, ref: r.ref },
      update: facts,
    });
    resources += 1;
  }

  return { editionId: edition.id, units: file.units.length, resources };
}

async function loadCrosswalk(file: CrosswalkFile): Promise<{ mappings: number; refinements: number }> {
  const pkg = await prisma.studyPackage.findUnique({ where: { slug: file.packageSlug } });
  if (!pkg) {
    throw new Error(`Crosswalk names package "${file.packageSlug}", which has not been loaded.`);
  }
  const edition = await prisma.packageEdition.findFirst({
    where: { packageId: pkg.id, levelId: file.levelId },
  });
  if (!edition) {
    throw new Error(`No edition of "${file.packageSlug}" for level ${file.levelId}.`);
  }

  let mappings = 0;
  let refinements = 0;

  for (const entry of file.map) {
    const unit = await prisma.packageUnit.findUnique({
      where: { editionId_ref: { editionId: edition.id, ref: entry.unitRef } },
    });
    if (!unit) {
      throw new Error(`Crosswalk names unit "${entry.unitRef}", which is not in this edition.`);
    }

    for (const target of entry.readings) {
      const topic = await prisma.topic.findFirst({
        where: { levelId: file.levelId, order: target.topicOrder },
      });
      const reading = topic
        ? await prisma.reading.findFirst({ where: { topicId: topic.id, order: target.readingOrder } })
        : null;
      if (!reading) {
        throw new Error(
          `Crosswalk points at topic ${target.topicOrder} reading ${target.readingOrder}, which level ${file.levelId} does not have.`,
        );
      }
      // Positional resolution is only safe if the name still agrees. A
      // curriculum edition that renumbers a reading would otherwise bind this
      // provider's content to a different module, silently and permanently.
      if (reading.name !== target.readingName) {
        throw new Error(
          `Crosswalk expects topic ${target.topicOrder} reading ${target.readingOrder} to be ` +
            `"${target.readingName}" but the seeded curriculum has "${reading.name}". ` +
            `Re-review the crosswalk against the current curriculum.`,
        );
      }

      await prisma.packageUnitReading.upsert({
        where: { unitId_readingId: { unitId: unit.id, readingId: reading.id } },
        create: { unitId: unit.id, readingId: reading.id },
        update: {},
      });
      mappings += 1;
    }
  }

  for (const entry of file.losMap ?? []) {
    const unit = await prisma.packageUnit.findUnique({
      where: { editionId_ref: { editionId: edition.id, ref: entry.unitRef } },
    });
    if (!unit) {
      throw new Error(`Outcome map names unit "${entry.unitRef}", which is not in this edition.`);
    }

    const retired = "retired" in entry;
    let losId: string | null = null;
    if (!retired) {
      const topic = await prisma.topic.findFirst({
        where: { levelId: file.levelId, order: entry.topicOrder },
      });
      const reading = topic
        ? await prisma.reading.findFirst({ where: { topicId: topic.id, order: entry.readingOrder } })
        : null;
      const los = reading
        ? await prisma.lOS.findFirst({ where: { readingId: reading.id, order: entry.losOrder } })
        : null;
      if (!los) {
        throw new Error(
          `Outcome map points at topic ${entry.topicOrder} reading ${entry.readingOrder} outcome ${entry.losOrder}, which level ${file.levelId} does not have.`,
        );
      }
      // The same positional hazard as the reading binding above, and it gets
      // the same guard. Outcomes are resolved by order, so a curriculum reseed
      // that reorders them inside a reading would otherwise rebind a
      // provider's question counts to a different outcome, silently.
      if (los.text !== entry.losText) {
        throw new Error(
          `Outcome map expects topic ${entry.topicOrder} reading ${entry.readingOrder} outcome ${entry.losOrder} to be ` +
            `"${entry.losText}" but the seeded curriculum has "${los.text}". ` +
            `Re-review the crosswalk against the current curriculum.`,
        );
      }
      losId = los.id;
    }

    await prisma.packageUnitLos.upsert({
      where: { unitId_sourceLabel: { unitId: unit.id, sourceLabel: entry.sourceLabel } },
      create: {
        unitId: unit.id,
        sourceLabel: entry.sourceLabel,
        losId,
        retired,
      },
      update: { losId, retired },
    });
    refinements += 1;
  }

  return { mappings, refinements };
}

export async function seedPackages(dir: string = SEED_DATA_DIR): Promise<SeedReport> {
  const report: SeedReport = { editions: 0, units: 0, resources: 0, mappings: 0, refinements: 0 };

  // Packages before crosswalks, always: a crosswalk binds units that the
  // package load creates.
  for (const path of filesMatching(dir, /^package-.*\.json$/)) {
    const loaded = await loadPackage(readJson<PackageFile>(path));
    report.editions += 1;
    report.units += loaded.units;
    report.resources += loaded.resources;
  }

  for (const path of filesMatching(dir, /^crosswalk-.*\.json$/)) {
    const loaded = await loadCrosswalk(readJson<CrosswalkFile>(path));
    report.mappings += loaded.mappings;
    report.refinements += loaded.refinements;
  }

  return report;
}

async function main(): Promise<void> {
  const dir = process.argv[2] ?? SEED_DATA_DIR;
  const report = await seedPackages(dir);
  console.log(
    `Catalogue seed complete: ${report.editions} edition(s), ${report.units} unit(s), ` +
      `${report.resources} resource(s), ${report.mappings} mapping(s), ${report.refinements} outcome refinement(s).`,
  );
}

// Works under both plain node and tsx. `import.meta.main` is true under node
// and undefined under tsx, so a guard using it makes the CLI a silent no-op.
const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main()
    .catch((err) => {
      console.error(`Catalogue seed failed: ${(err as Error).message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
