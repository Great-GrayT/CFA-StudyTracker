"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Paging for the tables that grow without bound.
 *
 * A campaign produces thirty-odd weekly rollup rows, a mock log fills up over
 * a season, and one outcome's history grows every time it is re-drilled.
 * Rendering all of them pushes everything below the table off the screen,
 * which on a phone means the reader never finds out the rest of the page
 * exists.
 *
 * Deliberately not virtualisation: these are tens of rows, not thousands, and
 * a paged table can still be read by the browser's own find, and printed,
 * which a windowed one cannot.
 *
 * The arithmetic is split out from the hook so it can be tested as plain
 * functions. The test environment here is "node" with no DOM, so a test that
 * needed to render a hook could not run at all.
 */

/** Pages needed for `total` rows. Always at least one, even for none. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/**
 * The page index to actually show.
 *
 * A list can shrink under a reader: deleting mock exams while on the last
 * page, or a filter narrowing. Without this they are left looking at an
 * empty table with no clue why, so the index is pulled back to the last page
 * that exists.
 */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(0, page), pageCount(total, pageSize) - 1);
}

export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const safe = clampPage(page, rows.length, pageSize);
  return rows.slice(safe * pageSize, safe * pageSize + pageSize);
}

export function usePaged<T>(rows: readonly T[], pageSize = 10) {
  const [page, setPage] = useState(0);
  const pages = pageCount(rows.length, pageSize);
  const safePage = clampPage(page, rows.length, pageSize);

  // Keep the stored index honest as well as the rendered one, so the pager's
  // disabled states agree with what is on screen.
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const slice = useMemo(
    () => pageSlice(rows, safePage, pageSize),
    [rows, safePage, pageSize],
  );

  return { page: safePage, pages, slice, setPage, pageSize, total: rows.length };
}
