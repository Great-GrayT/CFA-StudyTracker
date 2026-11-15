"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";

import { usePlan, useCurriculum, useLogs } from "@/lib/hooks";
import { useRecord } from "@/components/record/record-provider";
import type { LogEntry } from "@/lib/types";
import styles from "./topic.module.css";


// The reading strip: one row per reading, subdivided into one segment per
// outcome. Chosen over a tree because 80 readings fit on a phone and 700
// outcomes do not, and because segment runs make a half-finished reading
// visible at a glance.

type Status = "confident" | "logged" | "flagged" | "untouched";

function statusOf(logs: LogEntry[]): Status {
  if (logs.length === 0) return "untouched";
  const latest = logs.reduce((a, b) => (a.date > b.date ? a : b));
  const answered = logs.reduce((s, l) => s + l.questionsAnswered, 0);
  const correct = logs.reduce((s, l) => s + l.questionsCorrect, 0);
  const stale =
    Date.now() - new Date(latest.date).getTime() > 30 * 24 * 60 * 60 * 1000;
  if (latest.confidence <= 2) return "flagged";
  if (answered >= 3 && correct / answered < 0.6) return "flagged";
  if (stale) return "flagged";
  return latest.confidence >= 4 ? "confident" : "logged";
}

export default function TopicPage({ params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = use(params);
  const record = useRecord();
  const [expanded, setExpanded] = useState<string | null>(null);

  const plan = usePlan();
  const curriculum = useCurriculum(plan.data?.levelId);
  const logs = useLogs(plan.data?.id);

  const topic = curriculum.data?.topics.find((t) => t.id === topicId);

  const logsByLos = useMemo(() => {
    const map = new Map<string, LogEntry[]>();
    for (const l of logs.data ?? []) {
      const list = map.get(l.losId);
      if (list) list.push(l);
      else map.set(l.losId, [l]);
    }
    return map;
  }, [logs.data]);

  if (!topic) {
    return (
      <div className="mx-auto w-full max-w-[44rem] min-w-0 p-4 md:p-8">
        <p className={styles.muted}>
          {curriculum.isLoading ? "Loading." : "That topic is not in the current curriculum."}
        </p>
      </div>
    );
  }

  const allIds = topic.readings.flatMap((r) => r.los.map((l) => l.id));
  const coveredCount = allIds.filter((id) => logsByLos.has(id)).length;

  return (
    <div className="mx-auto w-full max-w-[44rem] min-w-0 p-4 md:p-8">
      <Link href="/coverage" className={styles.back}>
        Back to coverage
      </Link>

      <header className={styles.header}>
        <h1 className={styles.title}>{topic.name}</h1>
        <p className={styles.weight}>
          {topic.examWeightMin} to {topic.examWeightMax}% of the exam
        </p>
        <p className={`${styles.count} tnum`}>
          {coveredCount} of {allIds.length} outcomes covered
        </p>
      </header>

      <ul className={styles.readings}>
        {topic.readings.map((reading) => {
          const statuses = reading.los.map((l) => statusOf(logsByLos.get(l.id) ?? []));
          const done = statuses.filter((s) => s !== "untouched").length;
          const flagged = statuses.filter((s) => s === "flagged").length;
          const open = expanded === reading.id;
          return (
            <li key={reading.id} className={styles.reading}>
              <button
                type="button"
                className={styles.readingHead}
                onClick={() => setExpanded(open ? null : reading.id)}
                aria-expanded={open}
                aria-label={`${reading.name}, ${done} of ${reading.los.length} covered${flagged > 0 ? `, ${flagged} flagged` : ""}`}
              >
                <span className={styles.readingName}>{reading.name}</span>
                <span className={styles.strip} aria-hidden="true">
                  {statuses.map((s, i) => (
                    <span key={i} className={`${styles.seg} ${styles[s]} data-fill`} />
                  ))}
                </span>
                <span className={`${styles.readingCount} tnum`}>
                  {done}/{reading.los.length}
                </span>
              </button>

              {open && (
                <ul className={styles.losList}>
                  {reading.los.map((los) => {
                    const s = statusOf(logsByLos.get(los.id) ?? []);
                    return (
                      <li key={los.id} className={styles.losRow}>
                        <span className={`${styles.dot} ${styles[s]}`} aria-hidden="true" />
                        <Link href={`/los/${los.id}`} className={`${styles.losText} prose`}>
                          {los.text}
                        </Link>
                        <button
                          type="button"
                          className={styles.logBtn}
                          onClick={() => {
                            record.open({ losId: los.id });
                          }}
                          aria-label={`Record study for ${los.text}`}
                        >
                          Log
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <ul className={styles.legend}>
        <li><span className={`${styles.swatch} ${styles.confident}`} /> Confident</li>
        <li><span className={`${styles.swatch} ${styles.logged}`} /> Recorded</li>
        <li><span className={`${styles.swatch} ${styles.flagged}`} /> Flagged</li>
        <li><span className={`${styles.swatch} ${styles.untouched}`} /> Not started</li>
      </ul>
    </div>
  );
}
