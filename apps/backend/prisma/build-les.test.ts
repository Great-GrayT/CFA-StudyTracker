import { describe, it, expect } from "vitest";
import { buildLes } from "./build-les.ts";
import type { LevelFile } from "./propose-crosswalk.ts";
import type { PackageFile, CrosswalkFile, ResourceFile } from "./lib/catalogue-types.ts";

const ID = "1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const rd = (name: string, order: number) => ({ name, order, los: [] });
const LEVEL: LevelFile = {
  id: "T2",
  version: "test-1",
  topics: [
    { name: "Alpha", order: 1, examWeightMin: 1, examWeightMax: 2, readings: [rd("A1", 1), rd("A2", 2), rd("A3", 3)] },
    { name: "Beta", order: 2, examWeightMin: 1, examWeightMax: 2, readings: [rd("B1", 1), rd("B2", 2)] },
  ],
};

const res = (kind: ResourceFile["kind"], durationSeconds: number, n: number): ResourceFile => ({
  ref: `x/${kind}/${n}`,
  kind,
  externalId: ID,
  sizeKb: 1,
  durationSeconds,
});

const MM: PackageFile = {
  package: { slug: "mm-test", name: "Test" },
  edition: { levelId: "T2", year: "2026" },
  editionResources: [],
  units: [
    // Alpha core 3000: A1 = 1000 alone, A2+A3 fan-out of 2000 split evenly.
    { ref: "a/1", title: "A1", resources: [res("lecture", 600, 1), res("eocq", 400, 2), res("seminar", 99999, 3)] },
    { ref: "a/23", title: "A23", resources: [res("lecture", 1500, 1), res("review", 500, 2)] },
    // Beta core 1000, only B1 covered: B2 is uncovered and takes an even share.
    { ref: "b/1", title: "B1", resources: [res("lecture", 900, 1), res("update", 100, 2), res("orientation", 5000, 3)] },
  ],
};

const rr = (t: number, r: number, name: string) => ({ topicOrder: t, readingOrder: r, readingName: name });
const CW: CrosswalkFile = {
  levelId: "T2",
  version: "test-1",
  packageSlug: "mm-test",
  map: [
    { unitRef: "a/1", readings: [rr(1, 1, "A1")] },
    { unitRef: "a/23", readings: [rr(1, 2, "A2"), rr(1, 3, "A3")] },
    { unitRef: "b/1", readings: [rr(2, 1, "B1")] },
  ],
  uncovered: [{ topicOrder: 2, readingOrder: 2, readingName: "B2" }],
};

const secs = (pkg: PackageFile, ref: string) =>
  pkg.units.find((u) => u.ref === ref)!.resources[0].durationSeconds!;

describe("buildLes", () => {
  const total = 4 * 3600;
  const { pkg, crosswalk } = buildLes(MM, CW, LEVEL, 4);

  it("emits one unit per reading with a notes resource", () => {
    expect(pkg.units.map((u) => u.ref)).toEqual([
      "cfa-les/t1/r1", "cfa-les/t1/r2", "cfa-les/t1/r3", "cfa-les/t2/r1", "cfa-les/t2/r2",
    ]);
    for (const u of pkg.units) {
      expect(u.resources).toHaveLength(1);
      expect(u.resources[0]).toMatchObject({ kind: "notes", sizeKb: 0, sourceNote: "synthetic: Meldrum core share" });
      expect(u.resources[0].externalId).toMatch(/^[A-Za-z0-9_-]{25,}$/);
    }
    expect(pkg.package).toMatchObject({ slug: "cfa-les", name: "CFA Institute LES" });
  });

  it("sums to exactly totalHours*3600", () => {
    const sum = pkg.units.reduce((s, u) => s + u.resources[0].durationSeconds!, 0);
    expect(sum).toBe(total);
  });

  it("splits topics by core share, excluding seminars and orientation", () => {
    const a = secs(pkg, "cfa-les/t1/r1") + secs(pkg, "cfa-les/t1/r2") + secs(pkg, "cfa-les/t1/r3");
    const b = secs(pkg, "cfa-les/t2/r1") + secs(pkg, "cfa-les/t2/r2");
    // core 3000 vs 1000 gives 3:1 of 14400
    expect(Math.abs(a - 10800)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - 3600)).toBeLessThanOrEqual(1);
  });

  it("splits a fan-out unit evenly and the lone unit by its own core", () => {
    const r2 = secs(pkg, "cfa-les/t1/r2");
    const r3 = secs(pkg, "cfa-les/t1/r3");
    expect(Math.abs(r2 - r3)).toBeLessThanOrEqual(1);
    // lone A1 core 1000 of 3000 core, A2 and A3 1000 each: a third of the topic
    expect(Math.abs(secs(pkg, "cfa-les/t1/r1") - 3600)).toBeLessThanOrEqual(1);
  });

  it("gives an uncovered reading the even share of its topic", () => {
    expect(Math.abs(secs(pkg, "cfa-les/t2/r2") - 1800)).toBeLessThanOrEqual(1);
  });

  it("maps each unit to its own reading", () => {
    expect(crosswalk.uncovered).toEqual([]);
    expect(crosswalk.map).toHaveLength(5);
    expect(crosswalk.map[3]).toEqual({
      unitRef: "cfa-les/t2/r1",
      readings: [{ topicOrder: 2, readingOrder: 1, readingName: "B1" }],
    });
    expect(crosswalk).toMatchObject({ levelId: "T2", version: "test-1", packageSlug: "cfa-les" });
  });

  it("is deterministic", () => {
    expect(buildLes(MM, CW, LEVEL, 4)).toEqual({ pkg, crosswalk });
  });
});
