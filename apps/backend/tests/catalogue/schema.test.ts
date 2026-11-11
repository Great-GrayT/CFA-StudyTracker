import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { db } from "../../src/lib/db";
import { registerUser, ensureLevel } from "../helpers/fixtures";

beforeEach(async () => {
  await resetDb();
});

/**
 * Helper: create a package, edition, unit, and two resources sharing the same ref.
 * The second one should fail the unique constraint.
 */
async function createSecondResourceWithSameRef(): Promise<void> {
  const pkg = await db.studyPackage.create({
    data: { name: "Test Package", userId: null },
  });

  await ensureLevel("II");

  const edition = await db.packageEdition.create({
    data: {
      packageId: pkg.id,
      levelId: "II",
      year: "2026",
    },
  });

  const unit = await db.packageUnit.create({
    data: {
      editionId: edition.id,
      ref: "unit-1",
      order: 1,
      providerLabel: "Unit 1",
      title: "First Unit",
    },
  });

  // Create first resource
  await db.packageResource.create({
    data: {
      editionId: edition.id,
      unitId: unit.id,
      ref: "qm/lm1/lecture/1",
      kind: "video",
      title: "First Lecture",
    },
  });

  // Try to create second resource with same ref - should fail
  await db.packageResource.create({
    data: {
      editionId: edition.id,
      unitId: unit.id,
      ref: "qm/lm1/lecture/1",
      kind: "video",
      title: "Duplicate Ref",
    },
  });
}

test("a resource's natural key is unique within an edition", async () => {
  await expect(createSecondResourceWithSameRef()).rejects.toThrow();
});

/**
 * Helper: create one edition with one unit and one resource.
 */
async function seedOneEditionWithOneUnitAndResource(): Promise<void> {
  const pkg = await db.studyPackage.create({
    data: { name: "Test Package", userId: null },
  });

  await ensureLevel("I");

  const edition = await db.packageEdition.create({
    data: {
      packageId: pkg.id,
      levelId: "I",
      year: "2026",
    },
  });

  const unit = await db.packageUnit.create({
    data: {
      editionId: edition.id,
      ref: "unit-1",
      order: 1,
      providerLabel: "Unit 1",
      title: "First Unit",
    },
  });

  await db.packageResource.create({
    data: {
      editionId: edition.id,
      unitId: unit.id,
      ref: "resource-1",
      kind: "video",
      title: "Lecture",
    },
  });
}

test("resetDb removes catalogue rows so a later suite starts clean", async () => {
  await seedOneEditionWithOneUnitAndResource();
  await resetDb();
  expect(await db.packageEdition.count()).toBe(0);
  expect(await db.packageResource.count()).toBe(0);
  expect(await db.packageUnitReading.count()).toBe(0);
});

test("an edition records an owner so catalogue reads can be gated on it", async () => {
  await ensureLevel("II");
  const user = await registerUser();
  const pkg = await db.studyPackage.create({ data: { name: "Mark Meldrum", slug: "mark-meldrum", userId: null } });
  const ed = await db.packageEdition.create({
    data: { packageId: pkg.id, levelId: "II", year: "2026", ownerUserId: user.id },
  });
  // The package is a shared preset, the edition is not.
  expect(pkg.userId).toBeNull();
  expect(ed.ownerUserId).toBe(user.id);
  expect(await db.packageEdition.count({ where: { ownerUserId: null } })).toBe(0);
});
