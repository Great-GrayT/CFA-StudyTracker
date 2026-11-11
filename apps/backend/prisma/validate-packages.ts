/**
 * Structural check for a provider package file, run before seeding.
 *
 * A package file is machine-generated from an inventory document. This checks
 * for shape violations that the load would silently corrupt: missing required
 * fields, forbidden fields for a kind, invalid Drive ids, and non-gapless
 * unit orders.
 *
 *   pnpm --filter backend exec tsx prisma/validate-packages.ts <file.json> [<file.json> ...]
 *
 * Exits non-zero on any error, so it can gate a seed in CI or a shell chain.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "url";
import { realpathSync } from "node:fs";
import type {
  PackageFile,
  ResourceFile,
  UnitFile,
  CrosswalkFile,
  ResourceKind,
} from "./lib/catalogue-types.ts";
import { checkCrosswalk } from "./propose-crosswalk.ts";
// One definition of a level file, owned by the module that validates against
// it. A second narrower copy here drifted from it and broke the typecheck.
import type { LevelFile } from "./propose-crosswalk.ts";

const __filename = fileURLToPath(import.meta.url);

// The Drive id format: at least 25 characters, alphanumeric, underscore, or hyphen.
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{25,}$/;

// Required and forbidden fields for each resource kind, derived from what
// the extractors (extract-meldrum.ts, extract-uworld.ts) actually emit.
// Adding a kind is one row.
const RESOURCE_KIND_RULES: Record<
  ResourceKind,
  { required: Set<keyof ResourceFile>; forbidden: Set<keyof ResourceFile> }
> = {
  lecture: {
    required: new Set(["externalId", "sizeKb"]),
    forbidden: new Set(["questionCount", "vignetteCount", "calcCount", "exhibitCount"]),
  },
  eocq: {
    required: new Set(["externalId", "sizeKb"]),
    forbidden: new Set(["questionCount", "vignetteCount", "calcCount", "exhibitCount"]),
  },
  review: {
    required: new Set(["externalId", "sizeKb"]),
    forbidden: new Set(["questionCount", "vignetteCount", "calcCount", "exhibitCount"]),
  },
  seminar: {
    required: new Set(["externalId", "sizeKb"]),
    forbidden: new Set(["questionCount", "vignetteCount", "calcCount", "exhibitCount"]),
  },
  update: {
    required: new Set(["externalId", "sizeKb"]),
    forbidden: new Set(["questionCount", "vignetteCount", "calcCount", "exhibitCount"]),
  },
  orientation: {
    required: new Set(["externalId", "sizeKb"]),
    forbidden: new Set(["questionCount", "vignetteCount", "calcCount", "exhibitCount"]),
  },
  notes: {
    required: new Set(["externalId", "sizeKb"]),
    forbidden: new Set(["questionCount", "vignetteCount", "calcCount", "exhibitCount"]),
  },
  formula_sheet: {
    required: new Set(["externalId", "sizeKb"]),
    forbidden: new Set(["questionCount", "vignetteCount", "calcCount", "exhibitCount"]),
  },
  worksheet: {
    required: new Set(["externalId", "sizeKb"]),
    forbidden: new Set(["questionCount", "vignetteCount", "calcCount", "exhibitCount"]),
  },
  question_set: {
    required: new Set(["externalId", "sizeKb", "questionCount"]),
    forbidden: new Set(["exhibitCount"]),
  },
  answer_set: {
    required: new Set(["externalId", "sizeKb", "questionCount"]),
    forbidden: new Set(),
  },
};

function isValidDriveId(id: string): boolean {
  return DRIVE_ID_PATTERN.test(id);
}

function validateResource(resource: ResourceFile, unitRef: string): string[] {
  const errors: string[] = [];

  if (!resource.ref || typeof resource.ref !== "string") {
    errors.push(`unit ${unitRef}: resource has no ref`);
  }

  if (!resource.kind || typeof resource.kind !== "string") {
    errors.push(`unit ${unitRef}: resource has no kind`);
    return errors;
  }

  if (!(resource.kind in RESOURCE_KIND_RULES)) {
    errors.push(`unit ${unitRef}: unknown resource kind "${resource.kind}"`);
    return errors;
  }

  const rules = RESOURCE_KIND_RULES[resource.kind as ResourceKind];

  for (const field of rules.required) {
    if (!(field in resource) || resource[field] === null || resource[field] === undefined) {
      errors.push(`unit ${unitRef} (kind ${resource.kind}): missing required field ${field}`);
    }
  }

  for (const field of rules.forbidden) {
    if (field in resource && resource[field] !== null && resource[field] !== undefined) {
      errors.push(
        `unit ${unitRef} (kind ${resource.kind}): forbidden field ${field} is present`
      );
    }
  }

  if (!isValidDriveId(resource.externalId)) {
    errors.push(`unit ${unitRef}: externalId is not a valid drive id: ${resource.externalId}`);
  }

  return errors;
}

function validateUnit(unit: UnitFile, unitIndex: number): string[] {
  const errors: string[] = [];

  if (!unit.ref || typeof unit.ref !== "string") {
    errors.push(`unit ${unitIndex}: unit has no ref`);
  }

  if (!Array.isArray(unit.resources) || unit.resources.length === 0) {
    errors.push(`unit ${unitIndex}: no resources`);
    return errors;
  }

  const seenRefs = new Set<string>();
  for (const resource of unit.resources) {
    errors.push(...validateResource(resource, unit.ref || `${unitIndex}`));

    if (resource.ref && typeof resource.ref === "string") {
      if (seenRefs.has(resource.ref)) {
        errors.push(`unit ${unit.ref || unitIndex}: resource ref "${resource.ref}" is used more than once`);
      }
      seenRefs.add(resource.ref);
    }
  }

  return errors;
}

export function validatePackageFile(file: PackageFile): string[] {
  const errors: string[] = [];

  if (!file.package || typeof file.package !== "object") {
    errors.push("missing package metadata");
    return errors;
  }

  if (!file.package.slug || typeof file.package.slug !== "string") {
    errors.push("package.slug is missing or invalid");
  }

  if (!file.package.name || typeof file.package.name !== "string") {
    errors.push("package.name is missing or invalid");
  }

  if (!file.edition || typeof file.edition !== "object") {
    errors.push("missing edition metadata");
    return errors;
  }

  if (!file.edition.levelId || typeof file.edition.levelId !== "string") {
    errors.push("edition.levelId is missing or invalid");
  }

  if (!file.edition.year || typeof file.edition.year !== "string") {
    errors.push("edition.year is missing or invalid");
  }

  if (!Array.isArray(file.units) || file.units.length === 0) {
    errors.push("units: no units");
    return errors;
  }

  // Collect unit orders per topic to check for gapless sequence per topic.
  const ordersByTopic = new Map<string, Map<number, string>>();

  for (let i = 0; i < file.units.length; i++) {
    const unit = file.units[i];
    errors.push(...validateUnit(unit, i));

    if (unit.ref && typeof unit.ref === "string") {
      // Extract topic prefix and order from the ref (e.g., "qm/lm5" -> topic "qm", order 5).
      const match = unit.ref.match(/^([^/]+)\/lm(\d+)$/);
      if (match) {
        const topic = match[1];
        const order = parseInt(match[2], 10);

        if (!ordersByTopic.has(topic)) {
          ordersByTopic.set(topic, new Map());
        }

        const orders = ordersByTopic.get(topic)!;
        if (orders.has(order)) {
          errors.push(`topic ${topic}: duplicate unit order ${order} ("${orders.get(order)}" and "${unit.ref}")`);
        }
        orders.set(order, unit.ref);
      }
    }
  }

  // Check for gapless sequence within each topic.
  for (const [topic, orders] of ordersByTopic.entries()) {
    if (orders.size > 0) {
      const maxOrder = Math.max(...orders.keys());
      for (let i = 1; i <= maxOrder; i++) {
        if (!orders.has(i)) {
          errors.push(`topic ${topic}: unit orders are not gapless (missing order ${i})`);
          break;
        }
      }
    }
  }

  // Validate edition resources if present.
  if (Array.isArray(file.editionResources)) {
    for (const resource of file.editionResources) {
      errors.push(...validateResource(resource, "edition"));
    }
  }

  return errors;
}

function isCrosswalkFile(data: unknown): data is CrosswalkFile {
  if (typeof data !== "object" || data === null) return false;
  return "map" in data;
}

/**
 * Shape guard for a curriculum level file.
 *
 * Parsing alone is not enough. Any valid JSON parses, including a crosswalk
 * file, and `checkCrosswalk` then walks `level.topics` and dies on an
 * unhelpful "topics is not iterable". That actually happened: the level path
 * is derived by rewriting the crosswalk's own file name, and when the rewrite
 * does not match, the derived path IS the crosswalk, which loads cleanly as a
 * "level" with no topics. A tool whose whole job is clear pre-load rejection
 * must name that, not crash.
 */
export function isLevelFile(data: unknown): data is LevelFile {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.topics)) return false;
  return d.topics.every(
    (t) => typeof t === "object" && t !== null && Array.isArray((t as Record<string, unknown>).readings),
  );
}

function tryParseLevelFile(levelPath: string): LevelFile | null {
  try {
    const data: unknown = JSON.parse(readFileSync(levelPath, "utf8"));
    return isLevelFile(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Where to look for the curriculum a crosswalk claims to bind to.
 *
 * Returns the input path unchanged when it cannot tell, which the caller
 * treats as a hard error rather than loading the crosswalk as its own level.
 */
const LEVEL_FILE_NUMBER: Record<string, string> = { I: "1", II: "2", III: "3" };

function deriveLevelPath(filePath: string, levelId: string): string {
  const n = LEVEL_FILE_NUMBER[levelId];
  // An unknown level id yields the path unchanged, which the caller treats as
  // a hard error. Guessing level-2.json for every crosswalk happened to work
  // only because every file shipped so far is Level II, and it would have
  // validated a Level I or III crosswalk against the wrong curriculum.
  if (!n) return filePath;
  return filePath.replace(/crosswalk-[^\\/]+\.json$/, `level-${n}.json`);
}

function validateFile(filePath: string, levelPathOverride?: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    return [`Could not parse ${filePath}: ${(e as Error).message}`];
  }

  if (isCrosswalkFile(data)) {
    const levelFilePath = levelPathOverride ?? deriveLevelPath(filePath, data.levelId);
    if (levelFilePath === filePath) {
      return [
        `Could not work out which level file to validate ${filePath} against. ` +
          `Pass one explicitly with --level <path>.`,
      ];
    }
    const level = tryParseLevelFile(levelFilePath);
    if (!level) {
      return [
        `Could not load a curriculum level file for crosswalk ${filePath}. ` +
          `Tried ${levelFilePath}. Pass one explicitly with --level <path>.`,
      ];
    }

    return checkCrosswalk(data, level);
  }

  const errors = validatePackageFile(data as PackageFile);
  return errors;
}

function report(file: string, data: PackageFile | CrosswalkFile, errors: string[]): void {
  console.log(file);

  if (isCrosswalkFile(data)) {
    const crosswalk = data as CrosswalkFile;
    const readingsCovered = new Set(
      crosswalk.map.flatMap((m) => m.readings.map((r) => `${r.topicOrder}:${r.readingOrder}`))
    ).size;
    console.log(`  package ${crosswalk.packageSlug}`);
    console.log(`  map entries: ${crosswalk.map.length}, readings covered: ${readingsCovered}`);
    console.log(`  uncovered: ${crosswalk.uncovered.length}`);
    if (crosswalk.losMap) console.log(`  los bindings: ${crosswalk.losMap.length}`);
  } else {
    const pkg = data as PackageFile;
    let totalResources = 0;
    for (const unit of pkg.units) {
      totalResources += unit.resources?.length ?? 0;
    }
    console.log(`  package ${pkg.package.slug}`);
    console.log(`  level ${pkg.edition.levelId}, year ${pkg.edition.year}`);
    console.log(`  ${pkg.units.length} units, ${totalResources} resources`);
  }

  for (const e of errors) console.log(`  ERROR ${e}`);

  if (errors.length === 0) {
    console.log("  valid");
  } else {
    console.log(`  ${errors.length} error(s), do not load this file`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  // Optional, because the level is normally found next to the crosswalk. It
  // exists so a crosswalk staged anywhere else is still checkable instead of
  // being rejected for a reason the operator cannot act on.
  const levelFlag = argv.indexOf("--level");
  const levelPathOverride = levelFlag >= 0 ? argv[levelFlag + 1] : undefined;
  // Guard the index comparison on the flag being present at all. Without it,
  // a missing flag gives -1 and drops argv[0], which is the only file in the
  // common single-file invocation.
  const files = argv.filter((_, i) => levelFlag < 0 || (i !== levelFlag && i !== levelFlag + 1));

  if (files.length === 0 || (levelFlag >= 0 && !levelPathOverride)) {
    console.error(
      "usage: node prisma/validate-packages.ts [--level <level.json>] <file.json> [<file.json> ...]",
    );
    process.exit(1);
    return;
  }

  let hasErrors = false;

  for (const filePath of files) {
    let data: unknown;
    const errors = validateFile(filePath, levelPathOverride);

    try {
      data = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      console.log(filePath);
      console.log(`  Could not parse file`);
      console.log(`  1 error(s), do not load this file`);
      hasErrors = true;
      continue;
    }

    if (data && typeof data === "object") {
      report(filePath, data as PackageFile | CrosswalkFile, errors);
    }

    if (errors.length > 0) {
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }
}

// Call main if this is the entry point (works under both node and tsx).
// import.meta.main is true under node but undefined under tsx, so it cannot
// be used here.
const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename);

if (isMain) {
  main();
}
