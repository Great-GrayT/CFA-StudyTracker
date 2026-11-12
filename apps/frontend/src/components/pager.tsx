"use client";

import styles from "./pager.module.css";

export { usePaged } from "../lib/paging";

export function Pager({
  page,
  pages,
  total,
  pageSize,
  onPage,
  label,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  /** What is being paged, for the screen reader: "weeks", "logs". */
  label: string;
}) {
  // One page is not a pager. Showing disabled arrows over a five row table
  // is noise that implies there is more to see.
  if (pages <= 1) return null;

  const first = page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);

  return (
    <nav className={styles.pager} aria-label={`${label} pages`}>
      <button
        type="button"
        className={styles.button}
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
        aria-label={`Previous ${label}`}
      >
        ‹
      </button>
      <p className={`${styles.count} tnum`} aria-live="polite">
        {first} to {last} of {total}
      </p>
      <button
        type="button"
        className={styles.button}
        onClick={() => onPage(page + 1)}
        disabled={page >= pages - 1}
        aria-label={`Next ${label}`}
      >
        ›
      </button>
    </nav>
  );
}
