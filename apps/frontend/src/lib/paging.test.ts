import { describe, expect, test } from "vitest";
import { clampPage, pageCount, pageSlice } from "./paging";

const rows = Array.from({ length: 23 }, (_, i) => i);

describe("pageCount", () => {
  test("rounds up, because a remainder still needs a page", () => {
    expect(pageCount(23, 8)).toBe(3);
    expect(pageCount(24, 8)).toBe(3);
    expect(pageCount(25, 8)).toBe(4);
  });

  // pages: 0 would render "of 0" in the pager and drive the index negative.
  test("an empty list is one empty page, not zero pages", () => {
    expect(pageCount(0, 8)).toBe(1);
  });
});

describe("pageSlice", () => {
  test("takes the page's own rows", () => {
    expect(pageSlice(rows, 0, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(pageSlice(rows, 1, 8)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
  });

  test("the last page is the remainder, not a padded full page", () => {
    expect(pageSlice(rows, 2, 8)).toEqual([16, 17, 18, 19, 20, 21, 22]);
  });

  test("a page past the end falls back to the last real one", () => {
    // The case this guards: a reader on page 3 of the mock exams deletes
    // enough rows that page 3 stops existing. Returning [] would leave them
    // staring at an empty table with no explanation.
    expect(pageSlice(rows.slice(0, 9), 2, 8)).toEqual([8]);
  });

  test("an empty list yields an empty page rather than throwing", () => {
    expect(pageSlice([], 0, 8)).toEqual([]);
  });
});

describe("clampPage", () => {
  test("holds the index inside the range that exists", () => {
    expect(clampPage(5, 23, 8)).toBe(2);
    expect(clampPage(-3, 23, 8)).toBe(0);
    expect(clampPage(1, 23, 8)).toBe(1);
  });
});
