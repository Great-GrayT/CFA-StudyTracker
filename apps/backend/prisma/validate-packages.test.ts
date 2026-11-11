import { describe, test, expect } from "vitest";
import { validatePackageFile, isLevelFile } from "./validate-packages.ts";
import type { PackageFile } from "./lib/catalogue-types.ts";

// Fabricated 33-character Drive ids for testing
const FAKE_DRIVE_ID_1 = "1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FAKE_DRIVE_ID_2 = "1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const FAKE_DRIVE_ID_3 = "1cccccccccccccccccccccccccccccccc";

function basePackageFile(): PackageFile {
  return {
    package: {
      slug: "test-provider",
      name: "Test Provider Package",
    },
    edition: {
      levelId: "L2",
      year: "2026",
    },
    units: [
      {
        ref: "test/lm1",
        title: "Test Unit",
        resources: [
          {
            ref: "test/lm1/lecture/1",
            kind: "lecture",
            externalId: FAKE_DRIVE_ID_1,
            sizeKb: 1024,
          },
        ],
      },
    ],
    editionResources: [],
  };
}

// These helpers deliberately build INVALID files, so each reaches through one
// narrow cast at the point of corruption rather than widening the whole file
// type and losing the checking everywhere else.
function corruptResource(file: PackageFile, unit = 0, res = 0): Record<string, unknown> {
  return file.units[unit].resources[res] as unknown as Record<string, unknown>;
}

function withKind(kind: string): PackageFile {
  const base = basePackageFile();
  corruptResource(base).kind = kind;
  return base;
}

function questionSetWithoutQuestionCount(): PackageFile {
  const base = basePackageFile();
  const r = corruptResource(base);
  r.kind = "question_set";
  delete r.questionCount;
  return base;
}

function lectureWithQuestionCount(): PackageFile {
  const base = basePackageFile();
  corruptResource(base).questionCount = 5;
  return base;
}

function withUnitOrders(orders: number[]): PackageFile {
  const base = basePackageFile();
  base.units = orders.map((order) => ({
    ref: `test/lm${order}`,
    title: `Test Unit ${order}`,
    resources: [
      {
        ref: `test/lm${order}/lecture/1`,
        kind: "lecture" as const,
        externalId: FAKE_DRIVE_ID_1,
        sizeKb: 1024,
      },
    ],
  }));
  return base;
}

function withDuplicateRef(): PackageFile {
  const base = basePackageFile();
  const resources = base.units[0].resources;
  resources.push({
    ref: resources[0].ref,
    kind: "lecture",
    externalId: FAKE_DRIVE_ID_2,
    sizeKb: 512,
  });
  return base;
}

function withExternalId(id: string): PackageFile {
  const base = basePackageFile();
  corruptResource(base).externalId = id;
  return base;
}

const GOOD_PACKAGE_FILE: PackageFile = {
  package: {
    slug: "inv-provider",
    name: "Invented Provider Package",
  },
  edition: {
    levelId: "L2",
    year: "2026",
  },
  units: [
    {
      ref: "test/lm1",
      title: "Unit One",
      resources: [
        {
          ref: "test/lm1/lecture/1",
          kind: "lecture",
          externalId: FAKE_DRIVE_ID_1,
          sizeKb: 2048,
        },
      ],
    },
    {
      ref: "test/lm2",
      title: "Unit Two",
      resources: [
        {
          ref: "test/lm2/question_set",
          kind: "question_set",
          externalId: FAKE_DRIVE_ID_2,
          sizeKb: 512,
          questionCount: 10,
          pageCount: 5,
        },
        {
          ref: "test/lm2/answer_set",
          kind: "answer_set",
          externalId: FAKE_DRIVE_ID_3,
          sizeKb: 1024,
          questionCount: 10,
          pageCount: 20,
          exhibitCount: 8,
        },
      ],
    },
  ],
  editionResources: [],
};

describe("validatePackageFile", () => {
  test("an unknown resource kind is rejected", () => {
    expect(validatePackageFile(withKind("podcast")).join(" ")).toMatch(/kind/i);
  });

  test("a kind must carry the facts it needs and none it cannot have", () => {
    expect(
      validatePackageFile(
        questionSetWithoutQuestionCount()
      ).join(" ")
    ).toMatch(/questionCount/i);
    expect(
      validatePackageFile(lectureWithQuestionCount())
        .join(" ")
    ).toMatch(/questionCount/i);
  });

  test("unit order must be gapless and refs unique", () => {
    expect(
      validatePackageFile(withUnitOrders([1, 2, 4]))
        .join(" ")
    ).toMatch(/order/i);
    expect(
      validatePackageFile(withDuplicateRef())
        .join(" ")
    ).toMatch(/ref/i);
  });

  test("a drive id that is not a drive id is rejected", () => {
    expect(
      validatePackageFile(withExternalId("nope"))
        .join(" ")
    ).toMatch(/externalId|drive/i);
  });

  test("a valid file produces no problems", () => {
    expect(validatePackageFile(GOOD_PACKAGE_FILE)).toEqual([]);
  });
});

describe("isLevelFile", () => {
  test("accepts a curriculum level file", () => {
    const level = { id: "II", version: "2027", topics: [{ order: 1, readings: [] }] };
    expect(isLevelFile(level)).toBe(true);
  });

  test("rejects a crosswalk file, which is the shape that used to crash", () => {
    // A crosswalk parses as valid JSON, so a naive parse accepted it as a
    // level and checkCrosswalk then died on "topics is not iterable".
    const crosswalk = { levelId: "II", packageSlug: "p", map: [], uncovered: [] };
    expect(isLevelFile(crosswalk)).toBe(false);
  });

  test("rejects a topics array whose entries are not readings-bearing", () => {
    expect(isLevelFile({ topics: [{ order: 1 }] })).toBe(false);
    expect(isLevelFile({ topics: "not an array" })).toBe(false);
    expect(isLevelFile(null)).toBe(false);
  });
});
