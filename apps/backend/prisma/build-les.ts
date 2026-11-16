/**
 * Builds the synthetic CFA Institute LES package: one notes unit per
 * curriculum reading, with study hours apportioned from Meldrum's core
 * runtime. The LES has no published per-reading hours, so Meldrum's lecture,
 * EOCQ, review and update time is the best available proxy for relative
 * reading weight. Seminars and orientation are not reading content.
 *
 *   tsx prisma/build-les.ts <mm-package> <mm-crosswalk> <level> <out-package> <out-crosswalk>
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PackageFile, CrosswalkFile, MapEntry, ResourceKind } from "./lib/catalogue-types.ts";
import type { LevelFile } from "./propose-crosswalk.ts";

const CORE_KINDS = new Set<ResourceKind>(["lecture", "eocq", "review", "update"]);

function syntheticId(ref: string): string {
  return `les${createHash("sha1").update(ref).digest("hex")}`;
}

export function buildLes(
  mm: PackageFile,
  mmCrosswalk: CrosswalkFile,
  level: LevelFile,
  totalHours = 200,
): { pkg: PackageFile; crosswalk: CrosswalkFile } {
  const totalSeconds = totalHours * 3600;
  const key = (t: number, r: number) => `${t}:${r}`;

  const coreByUnit = new Map<string, number>();
  for (const u of mm.units) {
    let core = 0;
    for (const r of u.resources) if (CORE_KINDS.has(r.kind)) core += r.durationSeconds ?? 0;
    coreByUnit.set(u.ref, core);
  }

  // A fan-out unit splits its core evenly across the readings it covers.
  const readingCore = new Map<string, number>();
  for (const e of mmCrosswalk.map) {
    const share = (coreByUnit.get(e.unitRef) ?? 0) / e.readings.length;
    for (const r of e.readings) {
      const k = key(r.topicOrder, r.readingOrder);
      readingCore.set(k, (readingCore.get(k) ?? 0) + share);
    }
  }

  const topicCore = new Map<number, number>();
  let allCore = 0;
  for (const t of level.topics) {
    let sum = 0;
    for (const r of t.readings) sum += readingCore.get(key(t.order, r.order)) ?? 0;
    topicCore.set(t.order, sum);
    allCore += sum;
  }
  if (allCore <= 0) throw new Error("Meldrum package has no core duration to apportion");

  const rows: { ref: string; title: string; topic: number; reading: number; seconds: number }[] = [];
  for (const t of level.topics) {
    const topicSeconds = (totalSeconds * (topicCore.get(t.order) ?? 0)) / allCore;
    const covered = t.readings.filter((r) => readingCore.has(key(t.order, r.order)));
    const uncovered = t.readings.length - covered.length;
    // Uncovered readings take an even share of the topic; covered ones split the rest by core.
    const evenShare = topicSeconds / t.readings.length;
    const coveredPool = topicSeconds - evenShare * uncovered;
    const coveredCore = covered.reduce((s, r) => s + (readingCore.get(key(t.order, r.order)) ?? 0), 0);
    for (const r of t.readings) {
      const core = readingCore.get(key(t.order, r.order));
      const seconds =
        core === undefined ? evenShare : coveredCore > 0 ? (coveredPool * core) / coveredCore : evenShare;
      rows.push({ ref: `cfa-les/t${t.order}/r${r.order}`, title: r.name, topic: t.order, reading: r.order, seconds });
    }
  }

  // Floor, then give the rounding remainder to the largest unit so the sum is exact.
  const floored = rows.map((r) => Math.floor(r.seconds));
  const remainder = totalSeconds - floored.reduce((a, b) => a + b, 0);
  let largest = 0;
  floored.forEach((s, i) => {
    if (s > floored[largest]) largest = i;
  });
  floored[largest] += remainder;

  const pkg: PackageFile = {
    package: { slug: "cfa-les", name: "CFA Institute LES" },
    edition: { levelId: level.id, year: level.version },
    units: rows.map((r, i) => ({
      ref: r.ref,
      title: r.title,
      resources: [
        {
          ref: `${r.ref}/notes/1`,
          kind: "notes" as const,
          externalId: syntheticId(r.ref),
          sizeKb: 0,
          durationSeconds: floored[i],
          sourceNote: "synthetic: Meldrum core share",
        },
      ],
    })),
    editionResources: [],
  };

  const map: MapEntry[] = rows.map((r) => ({
    unitRef: r.ref,
    readings: [{ topicOrder: r.topic, readingOrder: r.reading, readingName: r.title }],
  }));

  return {
    pkg,
    crosswalk: { levelId: level.id, version: level.version, packageSlug: "cfa-les", map, uncovered: [] },
  };
}

async function main(): Promise<void> {
  const fs = await import("node:fs/promises");
  const [mmPath, cwPath, levelPath, outPkg, outCw] = process.argv.slice(2);
  if (!outCw) {
    console.error("usage: tsx prisma/build-les.ts <mm-package> <mm-crosswalk> <level> <out-package> <out-crosswalk>");
    process.exit(1);
  }
  const read = async <T>(p: string) => JSON.parse(await fs.readFile(p, "utf-8")) as T;
  const { pkg, crosswalk } = buildLes(
    await read<PackageFile>(mmPath),
    await read<CrosswalkFile>(cwPath),
    await read<LevelFile>(levelPath),
  );
  await fs.writeFile(outPkg, `${JSON.stringify(pkg, null, 2)}\n`);
  await fs.writeFile(outCw, `${JSON.stringify(crosswalk, null, 2)}\n`);
  const hours = pkg.units.reduce((s, u) => s + (u.resources[0].durationSeconds ?? 0), 0) / 3600;
  console.log(`Wrote ${pkg.units.length} units, ${hours} hours`);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
