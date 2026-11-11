// Shared markdown parsing for extractors. All functions are pure.
// This module parses facts from markdown research documents.

export function parseCount(text: string): number | null {
  if (!text || text.trim() === "") {
    return null;
  }

  let cleaned = text.replace(/\*\*/g, "");
  cleaned = cleaned.replace(/,/g, "");

  const num = parseFloat(cleaned.trim());

  if (isNaN(num)) {
    return null;
  }

  return num;
}

export function parseSizeKb(text: string): number | null {
  if (!text || text.trim() === "") {
    return null;
  }

  // Strip emphasis to match behavior of parseCount
  let cleaned = text.replace(/\*\*/g, "");

  const match = cleaned.match(/^([\d,.\s]+)\s*(KB|MB|GB)$/i);
  if (!match) {
    return null;
  }

  const numStr = match[1];
  const unit = match[2].toUpperCase();

  // Use parseCount to normalize the numeric part (handles commas, etc.)
  const num = parseCount(numStr);
  if (num === null) {
    return null;
  }

  let factor = 1;
  if (unit === "MB") {
    factor = 1024;
  } else if (unit === "GB") {
    factor = 1024 * 1024;
  }

  return Math.round(num * factor);
}

export function driveId(urlOrMarkdown: string): string | null {
  const fileMatch = urlOrMarkdown.match(/\/file\/d\/([^\/]+)\/view/);
  if (fileMatch) {
    return fileMatch[1];
  }

  // Single pattern handles folder URLs with or without trailing slash/query params
  const folderMatch = urlOrMarkdown.match(/\/drive\/folders\/([^\/\?]+)/);
  if (folderMatch) {
    return folderMatch[1];
  }

  return null;
}

export function parseTable(
  lines: string[],
  startIndex: number
): {
  rows: Record<string, string>[];
  totalRow: Record<string, string> | null;
  endIndex: number;
} {
  const rows: Record<string, string>[] = [];
  let totalRow: Record<string, string> | null = null;

  const headerLine = lines[startIndex];
  if (!headerLine || !headerLine.startsWith("|")) {
    return { rows, totalRow, endIndex: startIndex };
  }

  const headers = headerLine
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

  let currentIndex = startIndex + 2;

  while (currentIndex < lines.length) {
    const line = lines[currentIndex];

    if (!line || !line.startsWith("|")) {
      break;
    }

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] || "";
    });

    // A bold total row is noise for some callers (Meldrum's per-module
    // tables) and the contract for others (UWorld's section totals), so it
    // is kept out of `rows` but surfaced separately rather than discarded.
    if (cells[0] && cells[0].includes("**Total**")) {
      totalRow = row;
      currentIndex++;
      continue;
    }

    rows.push(row);
    currentIndex++;
  }

  return { rows, totalRow, endIndex: currentIndex };
}

// Replaces three divergent hand-rolled "find the table, then find where it
// ends" implementations that each got the end boundary slightly wrong.
// parseTable already stops at the first line that is not a table row, so no
// separate end-boundary search is needed: scan forward for the header, then
// hand straight off to parseTable.
export function parseTableAfter(
  lines: string[],
  fromIndex: number,
  isHeader: (line: string) => boolean = (line) => line.startsWith("|")
): { rows: Record<string, string>[]; totalRow: Record<string, string> | null } | null {
  let headerIndex = -1;
  for (let i = fromIndex; i < lines.length; i++) {
    if (isHeader(lines[i])) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return null;
  }

  const { rows, totalRow } = parseTable(lines, headerIndex);
  return { rows, totalRow };
}

export function linkTarget(
  cell: string
): { text: string; url: string | null } {
  // Greedy match captures text up to the LAST ]( before url)
  const match = cell.match(/^\[(.*)\]\(([^)]+)\)$/);

  if (match) {
    return {
      text: match[1],
      url: match[2],
    };
  }

  return {
    text: cell,
    url: null,
  };
}

export function sectionLines(
  markdown: string,
  heading: RegExp,
  stopAt: RegExp
): string[] {
  const lines = markdown.split("\n");

  let headingIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (heading.test(lines[i])) {
      headingIndex = i;
      break;
    }
  }

  if (headingIndex === -1) {
    return [];
  }

  let stopIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (stopAt.test(lines[i])) {
      stopIndex = i;
      break;
    }
  }

  const result = lines.slice(headingIndex + 1, stopIndex);

  while (result.length > 0 && result[result.length - 1] === "") {
    result.pop();
  }

  return result;
}
