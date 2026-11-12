"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";

import { usePlan, useCurriculum, useLogs, usePackages, flattenCurriculum } from "@/lib/hooks";
import styles from "./los.module.css";
import dynamic from "next/dynamic";
import { ConfidenceMeter } from "@/components/confidence";

// Loaded on demand: the sheet renders nothing until it is opened, so its
// virtualized outcome list has no business in this route's first load.
const Composer = dynamic(() => import("@/components/composer").then((m) => m.Composer));

// One outcome, in full.
//
// This screen exists beyond the product spec because the spec tracks per
// outcome history but never gives it a home. Without it every review flag is
// unexplained, and a candidate cannot audit why the app is telling them to
// restudy something.

const STALE_DAYS = 30;
const pctFmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const plural = new Intl.PluralRules("en");

export default function LosPage({ params }: { params: Promise<{ losId: string }> }) {
  const { losId } = use(params);
  const [composing, setComposing] = useState(false);

  const plan = usePlan();
  const curriculum = useCurriculum(plan.data?.levelId);
  const logs = useLogs(plan.data?.id);
  const packages = usePackages();

  const los = useMemo(
    () => flattenCurriculum(curriculum.data).find((l) => l.id === losId),
    [curriculum.data, losId],
  );

  const mine = useMemo(
    () =>
      (logs.data ?? [])
        .filter((l) => l.losId === losId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [logs.data, losId],
  );

  const answered = mine.reduce((s, l) => s + l.questionsAnswered, 0);
  const correct = mine.reduce((s, l) => s + l.questionsCorrect, 0);
  const accuracy = answered > 0 ? (correct / answered) * 100 : null;
  const latest = mine[0];
  const daysSince = latest
    ? Math.round((Date.now() - new Date(latest.date).getTime()) / 86_400_000)
    : null;

  // The three flag conditions, named individually, because "flagged" without a
  // reason is exactly what this screen exists to fix.
  const reasons: string[] = [];
  if (latest && latest.confidence <= 2) reasons.push(`you rated it ${latest.confidence}`);
  if (accuracy !== null && answered >= 3 && accuracy < 60)
    reasons.push(`your accuracy is ${pctFmt.format(accuracy)}%`);
  if (daysSince !== null && daysSince >= STALE_DAYS)
    reasons.push(`it was last studied ${daysSince} days ago`);

  // Question sources: the evidence behind the diversity nudge, shown here
  // rather than as a floating sentence on Today.
  const sources = useMemo(() => {
    const byPackage = new Map<string, number>();
    for (const l of mine) {
      if (!l.packageId || l.questionsAnswered === 0) continue;
      byPackage.set(l.packageId, (byPackage.get(l.packageId) ?? 0) + l.questionsAnswered);
    }
    const named = [...byPackage.entries()].map(([id, count]) => ({
      id,
      count,
      name: packages.data?.find((p) => p.id === id)?.name ?? "Unknown",
    }));
    return named.sort((a, b) => b.count - a.count);
  }, [mine, packages.data]);

  const sourceTotal = sources.reduce((s, x) => s + x.count, 0);
  const monoculture =
    sourceTotal >= 20 && sources.length === 1 && (latest?.confidence ?? 5) < 4;

  if (!los && !curriculum.isLoading) {
    return (
      <AppShell onCompose={() => setComposing(true)}>
        <Link href="/coverage" className={styles.back}>
          Back to coverage
        </Link>
        <p className={styles.notFound}>
          This outcome is not in the current curriculum. It may have been renumbered in a yearly
          update.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell onCompose={() => setComposing(true)}>
      <Link href={los ? `/coverage/${los.topicId}` : "/coverage"} className={styles.back}>
        Back to {los?.topicName ?? "coverage"}
      </Link>

      <article>
        <h1 className={`${styles.statement} prose`}>{los?.text ?? "Loading."}</h1>
        {los && (
          <p className={styles.where}>
            {los.topicName}, {los.readingName}
          </p>
        )}

        {reasons.length > 0 && (
          <p className={styles.flag} role="status">
            Flagged for review because {reasons.join(", and ")}.
          </p>
        )}

        <div className={styles.metrics}>
          <section className={styles.metric}>
            <h2 className={styles.metricTitle}>Confidence</h2>
            {mine.length === 0 ? (
              <p className={styles.muted}>Not yet rated.</p>
            ) : (
              <>
                <Sparkline values={[...mine].reverse().map((l) => l.confidence)} />
                <p className={styles.metricMeta}>
                  {latest ? <ConfidenceMeter value={latest.confidence} label="Latest" /> : null}
                  {mine.length} {plural.select(mine.length) === "one" ? "rating" : "ratings"}
                </p>
              </>
            )}
          </section>

          <section className={styles.metric}>
            <h2 className={styles.metricTitle}>Accuracy</h2>
            {accuracy === null ? (
              <p className={styles.muted}>No questions answered.</p>
            ) : (
              <>
                <span
                  className={styles.donut}
                  style={{ ["--pct" as string]: `${accuracy}%` }}
                  role="img"
                  aria-label={`${pctFmt.format(accuracy)} percent accuracy`}
                />
                <p className={styles.metricMeta}>
                  {correct} of {answered} correct
                </p>
              </>
            )}
          </section>
        </div>

        {sources.length > 0 && (
          <section className={styles.sources}>
            <h2 className={styles.metricTitle}>Question sources</h2>
            <div className={styles.mix} aria-hidden="true">
              {sources.map((s, i) => (
                <span
                  key={s.id}
                  className={i === 0 ? styles.mixFirst : styles.mixRest}
                  style={{ width: `${(s.count / sourceTotal) * 100}%` }}
                />
              ))}
            </div>
            <p className={styles.metricMeta}>
              {sources.map((s) => `${s.name} ${s.count}`).join(", ")}
            </p>
            {monoculture && (
              <p className={styles.nudge}>
                All {sourceTotal} of your questions here come from {sources[0].name}. Practising
                with a second source is associated with better retention than drilling one bank.
              </p>
            )}
          </section>
        )}

        {daysSince !== null && (
          <section className={styles.staleWrap}>
            <h2 className={styles.metricTitle}>Freshness</h2>
            <div className={`${styles.staleTrack} data-surface`} aria-hidden="true">
              <span
                className={daysSince >= STALE_DAYS ? styles.staleBarOld : styles.staleBar}
                style={{ width: `${Math.min(100, (daysSince / STALE_DAYS) * 100)}%` }}
              />
            </div>
            <p className={styles.metricMeta}>
              {daysSince === 0
                ? "Studied today."
                : `${daysSince} ${plural.select(daysSince) === "one" ? "day" : "days"} since the last session. Outcomes are flagged at ${STALE_DAYS}.`}
            </p>
          </section>
        )}

        <section className={styles.history}>
          <h2 className={styles.metricTitle}>History</h2>
          {mine.length === 0 ? (
            <p className={styles.muted}>No sessions logged for this outcome yet.</p>
          ) : (
            <table className={`${styles.table} tnum`}>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Confidence</th>
                  <th scope="col">Questions</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((l) => (
                  <tr key={l.id}>
                    <th scope="row">{new Date(l.date).toLocaleDateString()}</th>
                    <td>
                      <ConfidenceMeter value={l.confidence} />
                    </td>
                    <td>
                      {l.questionsAnswered > 0
                        ? `${l.questionsCorrect} of ${l.questionsAnswered}`
                        : "none"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <button type="button" className={styles.primary} onClick={() => setComposing(true)}>
          Log a session
        </button>
      </article>

      <Composer
        open={composing}
        onClose={() => setComposing(false)}
        planId={plan.data?.id}
        curriculum={curriculum.data}
        packages={packages.data ?? []}
        suggestedLosId={losId}
      />
    </AppShell>
  );
}

/** Confidence over time. Five steps, so the shape is the trend. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const w = 120;
  const h = 32;
  const x = (i: number) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
  const y = (v: number) => h - ((v - 1) / 4) * (h - 4) - 2;
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={styles.spark} role="img" aria-label={`Confidence ratings: ${values.join(", ")}`}>
      <path d={d} fill="none" stroke="var(--claimed)" strokeWidth="2" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill="var(--claimed-ink)" />
      ))}
    </svg>
  );
}
