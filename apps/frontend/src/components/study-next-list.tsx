"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { flattenCurriculum } from "@/lib/hooks";
import type { Curriculum, StudyNextItem } from "@/lib/types";
import { FlagConfidence, FlagStale, Untouched } from "./icons";
import styles from "./study-next-list.module.css";

// What to study next: flagged outcomes first (oldest rating first), then
// not-yet-started in curriculum order. The ordering is the backend's; this
// joins it against the cached tree to get the text, since /api/progress
// returns bare ids.

const MAX_ROWS = 6;

export function StudyNextList({
  items,
  curriculum,
  onLog,
}: {
  items: StudyNextItem[];
  curriculum: Curriculum | undefined;
  onLog?: (losId: string) => void;
}) {
  const byId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof flattenCurriculum>[number]>();
    for (const l of flattenCurriculum(curriculum)) map.set(l.id, l);
    return map;
  }, [curriculum]);

  if (items.length === 0) {
    return (
      <section className={styles.section}>
        <h2 className={styles.heading}>Study next</h2>
        <p className={styles.empty}>
          Everything is covered at least once. Flagged outcomes will appear here as they go stale.
        </p>
      </section>
    );
  }

  const rows = items.slice(0, MAX_ROWS);

  return (
    <section className={styles.section} aria-labelledby="study-next">
      <h2 id="study-next" className={styles.heading}>
        Study next
      </h2>
      <ul className={styles.list}>
        {/* popLayout, not the default: the logged outcome usually LEAVES this
            list, so the rows below it should close the gap rather than the
            exiting row holding its space. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {rows.map((item) => {
            const los = byId.get(item.losId);
            const stale = item.lastRatedAt
              ? Math.round(
                  (Date.now() - new Date(item.lastRatedAt).getTime()) / (24 * 60 * 60 * 1000),
                )
              : null;
            return (
              <motion.li
                key={item.losId}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className={styles.row}
              >
                <span
                  className={item.status === "flagged" ? styles.spineFlag : styles.spine}
                  aria-hidden="true"
                />
                <span className={styles.icon} aria-hidden="true">
                  {item.status === "flagged" ? (
                    stale !== null && stale >= 30 ? (
                      <FlagStale />
                    ) : (
                      <FlagConfidence />
                    )
                  ) : (
                    <Untouched />
                  )}
                </span>
                <span className={styles.content}>
                  <Link href={`/los/${item.losId}`} className={`${styles.text} prose`}>
                    {los?.text ?? "This outcome is not in the current curriculum."}
                  </Link>
                  <span className={styles.meta}>
                    {los ? los.topicName : "Unknown topic"}
                    {stale !== null ? `, rated ${stale}d ago` : ", not started"}
                  </span>
                </span>
                {onLog && (
                  <button
                    type="button"
                    className={styles.log}
                    onClick={() => onLog(item.losId)}
                    aria-label={`Record study for ${los?.text ?? "this outcome"}`}
                  >
                    Log
                  </button>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      {items.length > MAX_ROWS && (
        <Link href="/coverage" className={styles.more}>
          See all {items.length} outstanding outcomes
        </Link>
      )}
    </section>
  );
}
