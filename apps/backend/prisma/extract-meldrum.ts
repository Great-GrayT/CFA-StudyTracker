import { fileURLToPath } from "url";
import { dirname } from "path";
import { realpathSync } from "node:fs";
import {
  parseCount,
  parseSizeKb,
  driveId,
  parseTable,
  linkTarget,
  sectionLines,
} from "./lib/markdown.ts";
import type {
  PackageFile,
  UnitFile,
  ResourceFile,
  ExtractResult,
  ResourceKind,
} from "./lib/catalogue-types.ts";

const __filename = fileURLToPath(import.meta.url);

interface ModuleInfo {
  topicSlug: string;
  lmNumber: number;
  title: string;
  notesPageStart: number | null;
  notesPageCount: number | null;
  hasNotesExemption: boolean;
}

interface ResourceInfo {
  fileName: string;
  fileType: string;
  sizeKb: number;
  externalId: string | null;
  sourceTableLM?: number;
}

function parseModuleHeading(heading: string): ModuleInfo | null {
  const match = heading.match(
    /^#### (LM\d+):\s+(.+?)(?:\s+\(([^)]+)\))?$/
  );
  if (!match) return null;

  const lmNumber = parseInt(match[1].slice(2), 10);
  const title = match[2].trim();
  const notesText = match[3] || "";

  let notesPageStart: number | null = null;
  let notesPageCount: number | null = null;
  let hasNotesExemption = false;

  if (notesText.toLowerCase().includes("no notes pages")) {
    hasNotesExemption = true;
  } else if (notesText) {
    const pageMatch = notesText.match(/notes\s+p\.(\d+)/i);
    const countMatch = notesText.match(/~(\d+)\s+pages/i);

    if (pageMatch) {
      notesPageStart = parseInt(pageMatch[1], 10);
    }
    if (countMatch) {
      notesPageCount = parseInt(countMatch[1], 10);
    }
  }

  return {
    topicSlug: "", // Set by caller
    lmNumber,
    title,
    notesPageStart,
    notesPageCount,
    hasNotesExemption,
  };
}

function extractLMNumberFromFileName(fileName: string): number | null {
  const match = fileName.match(/LM(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

function resourceKindFromType(type: string): ResourceKind | null {
  const typeMap: Record<string, ResourceKind> = {
    Video: "lecture",
    EOCQ: "eocq",
    Review: "review",
    Seminar: "seminar",
    Update: "update",
    "Intro video": "orientation",
  };
  return typeMap[type] || null;
}

function findTableIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("|")) {
      return i;
    }
  }
  return -1;
}

function getTotalFileCount(markdown: string): number | null {
  // Try table format with videos count: | Total files | 158 (144 videos, 14 documents) |
  const videosMatch = markdown.match(
    /\|\s*Total files\s*\|[^|]*\((\d+(?:,\d+)*)\s+videos?/i
  );
  if (videosMatch) {
    return parseCount(videosMatch[1]);
  }

  // Try simple table format: | Total files | 2 |
  const tableMatch = markdown.match(/\|\s*Total files\s*\|\s*(\d+(?:[,\d]*)\d*)\s*\|/i);
  if (tableMatch) {
    return parseCount(tableMatch[1]);
  }

  // Try colon format: Total files: 144
  const colonMatch = markdown.match(/Total files[:\s]+(\d+(?:[,\d]*)\d+)/i);
  if (colonMatch) {
    return parseCount(colonMatch[1]);
  }

  return null;
}

function parseTypeHistogram(
  markdown: string
): Record<string, number> | null {
  const lines = sectionLines(
    markdown,
    /Video types and counts/i,
    /^##[^#]/ // Stop at next top-level section
  );

  if (lines.length === 0) {
    return null;
  }

  const tableStartIndex = findTableIndex(lines);
  if (tableStartIndex === -1) {
    return null;
  }

  const { rows } = parseTable(lines, tableStartIndex);
  const histogram: Record<string, number> = {};

  for (const row of rows) {
    const typeCell = row["Type"] || "";
    const countCell = row["Count"] || "";

    if (typeCell && countCell) {
      const kind = resourceKindFromType(typeCell);
      const count = parseCount(countCell);
      if (count !== null && kind !== null) {
        histogram[kind] = count;
      }
    }
  }

  return Object.keys(histogram).length > 0 ? histogram : null;
}

function extractOrientationVideos(
  markdown: string
): { fileName: string; sizeKb: number; externalId: string }[] {
  const lines = sectionLines(markdown, /## .*[Gg]etting.*[Ss]tart/, /##/);
  const videos: { fileName: string; sizeKb: number; externalId: string }[] =
    [];

  for (const line of lines) {
    if (line.includes(".mp4")) {
      // Extract link from markdown format [text](url)
      const linkMatch = line.match(/\[(.*?\.mp4)\]\(([^)]+)\)/i);
      if (linkMatch) {
        const fileName = linkMatch[1];
        const url = linkMatch[2];
        const id = driveId(url);

        if (id) {
          const sizeMatch = line.match(/\((\d+(?:\.\d+)?)\s+(MB|GB|KB)\)/);
          if (sizeMatch) {
            const sizeKb = parseSizeKb(sizeMatch[1] + " " + sizeMatch[2]);
            if (sizeKb !== null) {
              videos.push({
                fileName,
                sizeKb,
                externalId: id,
              });
            }
          }
        }
      }
    }
  }

  return videos;
}

function extractSeminarIndex(
  markdown: string
): {
  fileName: string;
  topicSlug?: string;
  lmNumber?: number;
  sizeKb: number;
  externalId: string;
}[] {
  const lines = sectionLines(markdown, /Seminars index/, /## /);

  const tableIndex = findTableIndex(lines);
  if (tableIndex === -1) {
    return [];
  }

  const { rows } = parseTable(lines, tableIndex);

  const seminars: {
    fileName: string;
    topicSlug?: string;
    lmNumber?: number;
    sizeKb: number;
    externalId: string;
  }[] = [];

  for (const row of rows) {
    const seminarCell = row["Seminar"] || "";
    const topicCell = row["Topic / LM folder"] || "";

    const link = linkTarget(seminarCell);
    if (!link.url) {
      continue;
    }

    const id = driveId(link.url);
    if (!id) {
      continue;
    }

    const sizeCell = row["Size"] || "";
    const sizeKb = parseSizeKb(sizeCell);
    if (sizeKb === null) {
      continue;
    }

    const topicParts = topicCell.split("/").map((s) => s.trim());
    const topicSlug = topicToSlug(topicParts[0]);

    if (topicParts.length > 1 && topicParts[1].match(/LM(\d+)/)) {
      const lmMatch = topicParts[1].match(/LM(\d+)/);
      seminars.push({
        fileName: link.text,
        topicSlug,
        lmNumber: parseInt(lmMatch![1], 10),
        sizeKb,
        externalId: id,
      });
    } else {
      seminars.push({
        fileName: link.text,
        topicSlug,
        sizeKb,
        externalId: id,
      });
    }
  }

  return seminars;
}

function topicToSlug(topicName: string): string {
  const slugMap: Record<string, string> = {
    "quantitative methods": "qm",
    "quantitative": "qm",
    economics: "ec",
    "financial statement analysis": "fsa",
    "corporate issuers": "ci",
    "equity valuation": "ev",
    "fixed income": "fi",
    derivatives: "dr",
    "alternative investments": "ai",
    "portfolio management": "pm",
    "ethical and professional standards": "et",
    ethics: "et",
  };

  const key = topicName.toLowerCase();
  return slugMap[key] || key.slice(0, 2).toLowerCase();
}

function extractModules(
  markdown: string
): {
  topicSlug: string;
  lmNumber: number;
  title: string;
  notesPageStart: number | null;
  notesPageCount: number | null;
  hasNotesExemption: boolean;
  resources: ResourceInfo[];
}[] {
  const modules: {
    topicSlug: string;
    lmNumber: number;
    title: string;
    notesPageStart: number | null;
    notesPageCount: number | null;
    hasNotesExemption: boolean;
    resources: ResourceInfo[];
  }[] = [];

  const lines = markdown.split("\n");

  let currentTopicSlug = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/^### /)) {
      const topicName = line.replace(/^### (?:\d+(?:\.\d+)?\s+)?/, "");
      currentTopicSlug = topicToSlug(topicName);
    }

    if (line.match(/^#### LM\d+:/)) {
      const moduleInfo = parseModuleHeading(line);
      if (moduleInfo) {
        moduleInfo.topicSlug = currentTopicSlug;

        // Find the table header line for this module
        let tableIndex = i + 1;
        while (
          tableIndex < lines.length &&
          !lines[tableIndex].startsWith("|")
        ) {
          tableIndex++;
        }

        // Verify this is a file table with the correct header
        if (
          tableIndex < lines.length &&
          lines[tableIndex].includes("File") &&
          lines[tableIndex].includes("Type") &&
          lines[tableIndex].includes("Size")
        ) {
          // Extract lines until next heading to avoid parsing other tables
          let moduleEndIndex = lines.length;
          for (let j = tableIndex + 1; j < lines.length; j++) {
            if (lines[j].match(/^(###|####)/)) {
              moduleEndIndex = j;
              break;
            }
          }

          const moduleLines = lines.slice(tableIndex, moduleEndIndex);
          const { rows } = parseTable(moduleLines, 0);
          const resources: ResourceInfo[] = [];

          for (const row of rows) {
            const fileCell = row["File"] || "";
            const typeCell = row["Type"] || "";
            const sizeCell = row["Size"] || "";

            const link = linkTarget(fileCell);
            if (link.text && link.url) {
              const id = driveId(link.url);
              const sizeKb = parseSizeKb(sizeCell);

              if (id && sizeKb !== null) {
                resources.push({
                  fileName: link.text,
                  fileType: typeCell,
                  sizeKb,
                  externalId: id,
                  sourceTableLM: moduleInfo.lmNumber,
                });
              }
            }
          }

          modules.push({
            ...moduleInfo,
            resources,
          });
        }
      }
    }
  }

  return modules;
}

export function extractMeldrum(markdown: string): ExtractResult<PackageFile> {
  const problems: string[] = [];

  const expectedTotal = getTotalFileCount(markdown);
  if (expectedTotal === null) {
    problems.push("Could not parse expected total file count");
    return { data: null, problems };
  }

  const orientationVideos = extractOrientationVideos(markdown);
  const rawModules = extractModules(markdown);
  const seminarIndex = extractSeminarIndex(markdown);
  const expectedHistogram = parseTypeHistogram(markdown);

  // Create map for resource collection
  const moduleResources: Map<
    string,
    {
      perTypeCounter: Record<string, number>;
      resources: ResourceFile[];
    }
  > = new Map();

  for (const rawModule of rawModules) {
    if (rawModule.notesPageStart === null && !rawModule.hasNotesExemption) {
      problems.push(
        `Module ${rawModule.topicSlug}/lm${rawModule.lmNumber} has no notes range and is not marked as exempt`
      );
    }

    if (
      rawModule.notesPageStart !== null &&
      rawModule.notesPageCount === null
    ) {
      problems.push(
        `Module ${rawModule.topicSlug}/lm${rawModule.lmNumber} has notes page start (${rawModule.notesPageStart}) but no page count`
      );
    }

    const key = `${rawModule.topicSlug}/lm${rawModule.lmNumber}`;
    moduleResources.set(key, {
      perTypeCounter: {},
      resources: [],
    });
  }

  // Process module table resources
  for (const rawModule of rawModules) {
    for (const resource of rawModule.resources) {
      const lmFromFile = extractLMNumberFromFileName(resource.fileName);
      const targetLM = lmFromFile !== null ? lmFromFile : resource.sourceTableLM;
      const targetKey = `${rawModule.topicSlug}/lm${targetLM}`;

      const moduleData = moduleResources.get(targetKey);
      if (!moduleData) {
        problems.push(
          `Could not find target module ${targetKey} for file: ${resource.fileName}`
        );
        continue;
      }

      const kind = resourceKindFromType(resource.fileType);
      if (kind === null) {
        problems.push(
          `Unrecognized type "${resource.fileType}" in file "${resource.fileName}"`
        );
        continue;
      }

      moduleData.perTypeCounter[kind] = (moduleData.perTypeCounter[kind] || 0) + 1;
      const counter = moduleData.perTypeCounter[kind];

      const resourceFile: ResourceFile = {
        ref: `${targetKey}/${kind}/${counter}`,
        kind,
        externalId: resource.externalId!,
        sizeKb: resource.sizeKb,
      };

      if (lmFromFile !== null && lmFromFile !== resource.sourceTableLM) {
        resourceFile.sourceNote = `LM${resource.sourceTableLM} folder`;
      }

      moduleData.resources.push(resourceFile);
    }
  }

  const units: UnitFile[] = [];
  for (const rawModule of rawModules) {
    const key = `${rawModule.topicSlug}/lm${rawModule.lmNumber}`;
    const moduleData = moduleResources.get(key)!;

    let notesPageStart = rawModule.notesPageStart;
    let notesPageCount = rawModule.notesPageCount;

    if (notesPageStart === null && rawModule.hasNotesExemption) {
      notesPageStart = 0;
      notesPageCount = 0;
    }

    if (notesPageStart !== null && notesPageCount !== null) {
      units.push({
        ref: key,
        title: rawModule.title,
        notesPageStart,
        notesPageCount,
        resources: moduleData.resources,
      });
    }
  }

  const editionResources: ResourceFile[] = [];
  let totalParsedVideos = 0;

  // Add orientation videos
  for (let i = 0; i < orientationVideos.length; i++) {
    editionResources.push({
      ref: `orientation/${i + 1}`,
      kind: "orientation",
      externalId: orientationVideos[i].externalId,
      sizeKb: orientationVideos[i].sizeKb,
    });
    totalParsedVideos++;
  }

  // Add module resources
  for (const unit of units) {
    totalParsedVideos += unit.resources.length;
  }

  // Track topic-level seminar counters
  const topicSeminarCounts: Record<string, number> = {};

  // Process seminars from index - only topic-level ones (module-level ones are already in module tables)
  for (const seminar of seminarIndex) {
    if (!seminar.lmNumber) {
      // Topic-level seminar only
      topicSeminarCounts[seminar.topicSlug!] =
        (topicSeminarCounts[seminar.topicSlug!] || 0) + 1;

      editionResources.push({
        ref: `${seminar.topicSlug}/seminar/${topicSeminarCounts[seminar.topicSlug!]}`,
        kind: "seminar",
        externalId: seminar.externalId,
        sizeKb: seminar.sizeKb,
      });
      totalParsedVideos++;
    }
    // Skip module-level seminars - they're already counted in the module tables
  }

  if (totalParsedVideos !== expectedTotal) {
    problems.push(
      `Total files mismatch: parsed ${totalParsedVideos}, expected ${expectedTotal}`
    );
  }

  // Validate type histogram - must be found and must reconcile
  if (expectedHistogram === null) {
    problems.push("Could not parse the expected type histogram");
  } else {
    const actualHistogram: Record<string, number> = {};

    for (const unit of units) {
      for (const resource of unit.resources) {
        actualHistogram[resource.kind] =
          (actualHistogram[resource.kind] || 0) + 1;
      }
    }

    for (const resource of editionResources) {
      actualHistogram[resource.kind] = (actualHistogram[resource.kind] || 0) + 1;
    }

    for (const [kind, expectedCount] of Object.entries(expectedHistogram)) {
      const actualCount = actualHistogram[kind] || 0;
      if (actualCount !== expectedCount) {
        problems.push(
          `Type histogram mismatch for ${kind}: parsed ${actualCount}, expected ${expectedCount}`
        );
      }
    }
  }

  const data: PackageFile = {
    package: {
      slug: "mm-l2",
      name: "Mark Meldrum CFA Level II 2026",
    },
    edition: {
      levelId: "II", // Level.id is the roman numeral the curriculum seeds, not "L2"
      year: "2026",
    },
    units,
    editionResources,
  };

  if (problems.length > 0) {
    return { data: null, problems };
  }

  return { data, problems: [] };
}

async function main() {
  const fs = await import("fs");

  const [, , sourceFile, outFile] = process.argv;

  if (!sourceFile || !outFile) {
    console.error("Usage: node extract-meldrum.ts <source.md> <out.json>");
    process.exit(1);
    return;
  }

  const markdown = (await fs.promises.readFile(sourceFile, "utf-8")) as string;
  const { data, problems } = extractMeldrum(markdown);

  if (problems.length > 0) {
    console.error("Problems found:");
    problems.forEach((p) => console.error("  -", p));
    process.exit(1);
  }

  if (data) {
    const units = data.units.length;
    const typeHistogram: Record<string, number> = {};

    data.units.forEach((u) => {
      u.resources.forEach((r) => {
        typeHistogram[r.kind] = (typeHistogram[r.kind] || 0) + 1;
      });
    });

    data.editionResources.forEach((r) => {
      typeHistogram[r.kind] = (typeHistogram[r.kind] || 0) + 1;
    });

    const total =
      data.units.reduce((sum, u) => sum + u.resources.length, 0) +
      data.editionResources.length;

    console.log(`Units: ${units}`);
    console.log("Type histogram:", typeHistogram);
    console.log(`Reconciliation: ${total} files`);

    await fs.promises.writeFile(outFile, JSON.stringify(data, null, 2));
    console.log(`Wrote: ${outFile}`);
  }
}

// Call main if this is the entry point (works under both node and tsx)
const isMain =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(__filename);

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
