import { describe, test, expect } from "vitest";
import {
  parseCount,
  parseSizeKb,
  driveId,
  parseTable,
  parseTableAfter,
  linkTarget,
  sectionLines,
} from "./markdown.ts";

describe("parseCount", () => {
  test.each([
    ["3,304", 3304],
    ["27", 27],
    ["10,744", 10744],
    ["", null],
  ])("parseCount(%j) is %j", (input, expected) => {
    expect(parseCount(input)).toBe(expected);
  });
});

describe("parseSizeKb", () => {
  test.each([
    ["1,005 MB", 1029120],
    ["1,590 MB", 1628160],
    ["66 MB", 67584],
    ["1.6 GB", 1677722],
    ["40 KB", 40],
    ["**66 MB**", 67584],
    ["", null],
  ])("parseSizeKb(%j) is %j", (input, expected) => {
    expect(parseSizeKb(input)).toBe(expected);
  });
});

describe("driveId", () => {
  test("driveId reads a file id and a folder id", () => {
    expect(
      driveId(
        "https://drive.google.com/file/d/1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/view"
      )
    ).toBe("1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(
      driveId(
        "https://drive.google.com/drive/folders/1yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
      )
    ).toBe("1yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy");
    expect(driveId("not a url")).toBeNull();
  });
});

describe("parseTable", () => {
  test("parseTable keys rows on the header and stops at the first non-row", () => {
    const lines = [
      "| File | Type | Size |",
      "|---|---|---|",
      "| [a](u) | Video | 66 MB |",
      "",
      "next",
    ];
    const { rows, endIndex } = parseTable(lines, 0);
    expect(rows).toEqual([{ File: "[a](u)", Type: "Video", Size: "66 MB" }]);
    expect(endIndex).toBe(3);
  });

  test("parseTable ignores a bold total row", () => {
    // Meldrum's per-module tables end with "| **Total** | 2 files | **86 MB** |"
    const lines = [
      "| File | Type | Size |",
      "|---|---|---|",
      "| [a](u) | Video | 66 MB |",
      "| **Total** | 2 files | **86 MB** |",
    ];
    expect(parseTable(lines, 0).rows).toHaveLength(1);
  });

  test("parseTable endIndex points after the total row", () => {
    const lines = [
      "| File | Type | Size |",
      "|---|---|---|",
      "| [a](u) | Video | 66 MB |",
      "| **Total** | 2 files | **86 MB** |",
    ];
    const { endIndex } = parseTable(lines, 0);
    expect(endIndex).toBe(4);
  });

  test("parseTable returns the total row separately from the data rows", () => {
    // UWorld's section 4 needs the total row as the source of truth, not
    // noise to discard: the data rows alone cannot answer "what is the
    // document's own stated total".
    const lines = [
      "| Topic | Vignettes | Questions |",
      "|---|---:|---:|",
      "| 1. Quant | 4 | 20 |",
      "| **Total** | **4** | **20** |",
    ];
    const { rows, totalRow } = parseTable(lines, 0);
    expect(rows).toEqual([{ Topic: "1. Quant", Vignettes: "4", Questions: "20" }]);
    expect(totalRow).toEqual({ Topic: "**Total**", Vignettes: "**4**", Questions: "**20**" });
  });

  test("parseTable returns a null total row when the table has none", () => {
    const lines = [
      "| File | Type | Size |",
      "|---|---|---|",
      "| [a](u) | Video | 66 MB |",
    ];
    expect(parseTable(lines, 0).totalRow).toBeNull();
  });
});

describe("parseTableAfter", () => {
  test("finds the header at or after fromIndex and parses from there", () => {
    const lines = [
      "Some prose before the table.",
      "| File | Type | Size |",
      "|---|---|---|",
      "| [a](u) | Video | 66 MB |",
    ];
    const result = parseTableAfter(lines, 0)!;
    expect(result.rows).toEqual([{ File: "[a](u)", Type: "Video", Size: "66 MB" }]);
  });

  test("stops at a blank line without needing an explicit end pattern", () => {
    // This is the bug class that cost two red-suite rounds: three different
    // hand-rolled "find where the table ends" implementations, each with its
    // own edge case. parseTable already stops at the first non-row line, so
    // a table followed by a blank line and then unrelated content must not
    // leak into the parsed rows.
    const lines = [
      "| File | Type | Size |",
      "|---|---|---|",
      "| [a](u) | Video | 66 MB |",
      "",
      "### Unrelated heading with | a pipe | in it |",
      "| File | Type | Size |",
      "|---|---|---|",
      "| [b](u) | Video | 10 MB |",
    ];
    const result = parseTableAfter(lines, 0)!;
    expect(result.rows).toEqual([{ File: "[a](u)", Type: "Video", Size: "66 MB" }]);
  });

  test("accepts a custom header predicate to skip past a lookalike table", () => {
    const lines = [
      "| Reading | Topic | Share |",
      "|---|---|---:|",
      "| R1 Example | 1. Topic | 10% |",
      "",
      "| Reading | V | Q |",
      "|---|---:|---:|",
      "| R1 Example | 2 | 8 |",
    ];
    const result = parseTableAfter(lines, 0, (l) => l.startsWith("| Reading | V |"))!;
    expect(result.rows).toEqual([{ Reading: "R1 Example", V: "2", Q: "8" }]);
  });

  test("returns null when no matching header exists", () => {
    const lines = ["no table here", "still no table"];
    expect(parseTableAfter(lines, 0)).toBeNull();
  });
});

describe("linkTarget", () => {
  test("linkTarget splits text from url", () => {
    expect(
      linkTarget("[2026 L2 XX LM1 Video.mp4](https://x/d/ABC/view)")
    ).toEqual({
      text: "2026 L2 XX LM1 Video.mp4",
      url: "https://x/d/ABC/view",
    });
    expect(linkTarget("plain")).toEqual({ text: "plain", url: null });
  });

  test("linkTarget handles brackets within link text", () => {
    expect(
      linkTarget("[File [v2].mp4](https://x/d/ABC/view)")
    ).toEqual({
      text: "File [v2].mp4",
      url: "https://x/d/ABC/view",
    });
  });
});

describe("sectionLines", () => {
  test("sectionLines returns lines between heading and stop pattern, exclusive of both", () => {
    const markdown = `# Start

## My Section
Line 1
Line 2

## Next Section
Line 3`;

    const result = sectionLines(
      markdown,
      /^## My Section/m,
      /^## Next Section/m
    );

    expect(result).toEqual(["Line 1", "Line 2"]);
  });

  test("sectionLines works with empty section", () => {
    const markdown = `# Start

## Empty Section

## Next Section
Line 3`;

    const result = sectionLines(
      markdown,
      /^## Empty Section/m,
      /^## Next Section/m
    );

    expect(result).toEqual([]);
  });

  test("sectionLines handles section at end with no stopAt match", () => {
    const markdown = `# Start

## My Section
Final line 1
Final line 2`;

    const result = sectionLines(
      markdown,
      /^## My Section/m,
      /^## Nonexistent/m
    );

    expect(result).toEqual(["Final line 1", "Final line 2"]);
  });
});
