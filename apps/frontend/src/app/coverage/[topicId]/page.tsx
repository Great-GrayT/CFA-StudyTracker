"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";

import { usePlan, useCurriculum, useLogs, usePackages } from "@/lib/hooks";
import type { LogEntry } from "@/lib/types";
import styles from "./topic.module.css";
import dynamic from "next/dynamic";

// Loaded on demand: the sheet renders nothing until it is opened, so its
// virtualized outcome list has no business in this route's first load.
const Composer = dynamic(() => import("@/components/composer").then((m) => m.Composer));

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
  const [composing, setComposing] = useState(false);
  const [suggested, setSuggested] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<string | null>(null);

  const plan = usePlan();
  const curriculum = useCurriculum(plan.data?.levelId);
  const logs = useLogs(plan.data?.id);
  const packages = usePackages();

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
      <AppShell onCompose={() => setComposing(true)}>
        <p className={styles.muted}>
          {curriculum.isLoading ? "Loading." : "That topic is not in the current curriculum."}
        </p>
      </AppShell>
    );
  }

  const allIds = topic.readings.flatMap((r) => r.los.map((l) => l.id));
  const coveredCount = allIds.filter((id) => logsByLos.has(id)).length;

  return (
    <AppShell onCompose={() => setComposing(true)}>
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
                            setSuggested(los.id);
                            setComposing(true);
                          }}
                          aria-label={`Log a session for ${los.text}`}
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
        <li><span className={`${styles.swatch} ${styles.logged}`} /> Logged</li>
        <li><span className={`${styles.swatch} ${styles.flagged}`} /> Flagged</li>
        <li><span className={`${styles.swatch} ${styles.untouched}`} /> Not started</li>
      </ul>

      <Composer
        open={composing}
        onClose={() => setComposing(false)}
        planId={plan.data?.id}
        curriculum={curriculum.data}
        packages={packages.data ?? []}
        suggestedLosId={suggested}
      />
    </AppShell>
  );
}
