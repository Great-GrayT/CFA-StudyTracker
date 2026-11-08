"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";

import { WeightGap } from "@/components/weight-gap";
import { usePlan, useCurriculum, useLogs, usePackages, useProgress } from "@/lib/hooks";
import { weightedCoveragePercent, type TopicCoverage } from "@/lib/coverage";
import styles from "./coverage.module.css";
import dynamic from "next/dynamic";

// Loaded on demand: the sheet renders nothing until it is opened, so its
// virtualized outcome list has no business in this route's first load.
const Composer = dynamic(() => import("@/components/composer").then((m) => m.Composer));

const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function CoveragePage() {
  const router = useRouter();
  const [composing, setComposing] = useState(false);

  const plan = usePlan();
  const curriculum = useCurriculum(plan.data?.levelId);
  const logs = useLogs(plan.data?.id);
  const packages = usePackages();
  const progress = useProgress(plan.data?.id);

  // Coverage is reconstructed from the log history, NOT from studyNext: the
  // backend's studyNextList filters covered outcomes out entirely, so it can
  // never tell you what is already done.
  const topics: TopicCoverage[] = useMemo(() => {
    if (!curriculum.data || !logs.data) return [];
    const covered = new Set(logs.data.map((l) => l.losId));
    return curriculum.data.topics.map((t) => {
      const ids = t.readings.flatMap((r) => r.los.map((l) => l.id));
      return {
        topicId: t.id,
        name: t.name,
        weightMin: t.examWeightMin,
        weightMax: t.examWeightMax,
        covered: ids.filter((id) => covered.has(id)).length,
        total: ids.length,
      };
    });
  }, [curriculum.data, logs.data]);

  // Accuracy per topic: a topic you have covered but answer badly is a
  // different problem from one you have not started, so it gets its own list.
  const accuracy = useMemo(() => {
    if (!curriculum.data || !logs.data) return [];
    const topicOf = new Map<string, string>();
    for (const t of curriculum.data.topics) {
      for (const r of t.readings) for (const l of r.los) topicOf.set(l.id, t.id);
    }
    const tally = new Map<string, { answered: number; correct: number }>();
    for (const log of logs.data) {
      const topicId = topicOf.get(log.losId);
      if (!topicId || log.questionsAnswered === 0) continue;
      const row = tally.get(topicId) ?? { answered: 0, correct: 0 };
      row.answered += log.questionsAnswered;
      row.correct += log.questionsCorrect;
      tally.set(topicId, row);
    }
    return curriculum.data.topics
      .map((t) => {
        const row = tally.get(t.id);
        return row && row.answered >= 3
          ? { id: t.id, name: t.name, pct: (row.correct / row.answered) * 100, answered: row.answered }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.pct - b.pct);
  }, [curriculum.data, logs.data]);

  const loading = plan.isLoading || curriculum.isLoading || logs.isLoading;

  return (
    <AppShell onCompose={() => setComposing(true)}>
      <h1 className={styles.title}>Coverage</h1>

      {loading ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading coverage">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={styles.skelRow} />
          ))}
        </div>
      ) : (
        <>
          <p className={styles.summary}>
            <span className={`${styles.big} tnum`}>{pct.format(weightedCoveragePercent(topics))}%</span>
            <span className={styles.summaryLabel}>
              of exam weight covered. Weighted by each topic&apos;s official exam weight, not by a
              flat outcome count.
            </span>
          </p>

          <WeightGap topics={topics} onSelect={(id) => router.push(`/coverage/${id}`)} />

          {accuracy.length > 0 && (
            <section className={styles.accuracy} aria-labelledby="accuracy-heading">
              <h2 id="accuracy-heading" className={styles.sectionTitle}>
                Question accuracy
              </h2>
              <p className={styles.sectionHint}>
                Weakest first. Only topics with at least three answered questions appear.
              </p>
              <ul className={styles.accList}>
                {accuracy.map((a) => (
                  <li key={a.id} className={styles.accRow}>
                    <span className={styles.accName}>{a.name}</span>
                    <span className={`${styles.accTrack} data-surface`} aria-hidden="true">
                      <span
                        className={a.pct < 60 ? styles.accBarLow : styles.accBar}
                        style={{ width: `${a.pct}%` }}
                      />
                      {/* The 60 percent review threshold, drawn so a bar near
                          it is readable against the rule that governs it. */}
                      <span className={styles.accThreshold} />
                    </span>
                    <span className={`${styles.accPct} tnum`}>{pct.format(a.pct)}%</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className={styles.exploreWrap}>
            <a className={styles.explore} href="/coverage/explore">
              Explore in 3D
            </a>
          </p>
        </>
      )}

      <Composer
        open={composing}
        onClose={() => setComposing(false)}
        planId={plan.data?.id}
        curriculum={curriculum.data}
        packages={packages.data ?? []}
        suggestedLosId={progress.data?.studyNext[0]?.losId}
      />
    </AppShell>
  );
}
