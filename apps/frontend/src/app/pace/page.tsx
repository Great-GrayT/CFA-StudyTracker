"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PaceField, buildSeries } from "@/components/pace-field";
import {
  usePlan,
  useLogs,
  useHolidays,
  useCurriculum,
  flattenCurriculum,
} from "@/lib/hooks";
import {
  readPace,
  missedDays,
  startOfUTCDay,
  addUTCDays,
  toISODate,
} from "@/lib/pace";
import styles from "./pace.module.css";

const hours = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const plural = new Intl.PluralRules("en");
const outcomeWord = (n: number) =>
  plural.select(n) === "one" ? "outcome" : "outcomes";

type TimeRange = "30d" | "90d" | "all";

type SeriesPoint = {
  date: string;
  target: number;
  newCoverage: number;
  reviewWork: number;
};

function sliceSeries(
  series: SeriesPoint[],
  range: TimeRange,
): SeriesPoint[] {
  if (range === "all") return series;

  const days = range === "30d" ? 30 : 90;
  const cutoffIndex = Math.max(0, series.length - days);
  return series.slice(cutoffIndex);
}

function computeRollups(
  series: SeriesPoint[],
  type: "week" | "month",
): Array<{
  label: string;
  covered: number;
  target: number;
  delta: number;
}> {
  if (series.length === 0) return [];

  const rollups: Array<{
    label: string;
    covered: number;
    target: number;
    delta: number;
  }> = [];
  let current: { label: string; covered: number; target: number } | null = null;
  let pointCount = 0;

  for (let i = series.length - 1; i >= 0; i--) {
    const point = series[i];
    const date = new Date(point.date);
    let label: string;

    if (type === "week") {
      const weekStart = addUTCDays(
        startOfUTCDay(date),
        -(date.getUTCDay() + 6) % 7,
      );
      label = `Week of ${toISODate(weekStart)}`;
    } else {
      const monthStart = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
      );
      label = monthStart.toLocaleDateString("en", {
        month: "long",
        year: "numeric",
      });
    }

    if (!current || current.label !== label) {
      if (current) {
        rollups.unshift({
          label: current.label,
          covered: current.covered,
          target: current.target,
          delta: current.covered - current.target,
        });
      }
      current = { label, covered: 0, target: 0 };
      pointCount = 0;
    }

    if (pointCount === 0) {
      current.target = point.target;
      current.covered = point.newCoverage + point.reviewWork;
    }
    pointCount += 1;
  }

  if (current) {
    rollups.unshift({
      label: current.label,
      covered: current.covered,
      target: current.target,
      delta: current.covered - current.target,
    });
  }

  return rollups;
}

export default function PacePage() {
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [showTable, setShowTable] = useState<"week" | "month" | null>(null);

  const plan = usePlan();
  const planId = plan.data?.id;
  const curriculum = useCurriculum(plan.data?.levelId);
  const logs = useLogs(planId);
  const holidays = useHolidays(planId);

  const totalOutcomes = useMemo(
    () => flattenCurriculum(curriculum.data).length,
    [curriculum.data],
  );

  const ready = plan.data && logs.data && holidays.data && totalOutcomes > 0;

  const fullSeries = useMemo(() => {
    if (!ready) return [];
    return buildSeries({
      plan: plan.data!,
      logs: logs.data!,
      totalOutcomes,
      holidays: holidays.data!,
    });
  }, [ready, plan.data, logs.data, totalOutcomes, holidays.data]);

  const series = useMemo(
    () => sliceSeries(fullSeries, timeRange),
    [fullSeries, timeRange],
  );

  const pace = useMemo(() => {
    if (!ready) return null;
    return readPace({
      plan: plan.data!,
      logs: logs.data!,
      totalOutcomes,
      holidays: holidays.data!,
    });
  }, [ready, plan.data, logs.data, totalOutcomes, holidays.data]);

  const missed = useMemo(() => {
    if (!ready || fullSeries.length === 0) return [];
    const today = startOfUTCDay(new Date());
    const rangeStart = series[0] ? new Date(series[0].date) : today;
    return missedDays({
      plan: plan.data!,
      logs: logs.data!,
      holidays: holidays.data!,
      from: rangeStart,
      to: today,
    });
  }, [ready, plan.data, logs.data, holidays.data, fullSeries, series]);

  const weeklyRollups = useMemo(
    () => computeRollups(series, "week"),
    [series],
  );

  const monthlyRollups = useMemo(
    () => computeRollups(series, "month"),
    [series],
  );

  if (plan.isLoading || curriculum.isLoading) {
    return (
      <AppShell>
        <div className={styles.skeleton} aria-busy="true">
          <div className={styles.skelLine} />
          <div className={styles.skelBlock} />
          <div className={styles.skelBlock} />
        </div>
      </AppShell>
    );
  }

  const examPassed =
    plan.data &&
    startOfUTCDay(new Date(plan.data.examDate)) < startOfUTCDay(new Date());

  if (examPassed) {
    return (
      <AppShell>
        <section className={styles.container} aria-labelledby="pace-heading">
          <div className={styles.header}>
            <h1 id="pace-heading" className={styles.title}>
              Pace
            </h1>
          </div>
          <p className={styles.empty}>
            Your exam was on{" "}
            {new Date(plan.data!.examDate).toLocaleDateString()}. Start a new
            plan when you are ready.
          </p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className={styles.container} aria-labelledby="pace-heading">
        <div className={styles.header}>
          <h1 id="pace-heading" className={styles.title}>
            Pace
          </h1>
          <div className={styles.rangeControl} role="group" aria-label="Time range">
            {(["30d", "90d", "all"] as const).map((range) => (
              <button
                key={range}
                type="button"
                className={`${styles.rangeButton} ${
                  timeRange === range ? styles.rangeButtonActive : ""
                }`}
                onClick={() => setTimeRange(range)}
                aria-pressed={timeRange === range}
              >
                {range === "30d" ? "30d" : range === "90d" ? "90d" : "All"}
              </button>
            ))}
          </div>
        </div>

        {pace && (
          <div className={styles.hero}>
            {pace.delta === 0 ? (
              <p className={styles.paceText}>You are exactly on pace.</p>
            ) : pace.delta < 0 ? (
              <p className={styles.paceText}>
                {Math.abs(pace.delta)} {outcomeWord(Math.abs(pace.delta))}{" "}
                behind, about {hours.format(pace.hoursBehind)} hours of work.
              </p>
            ) : (
              <p className={styles.paceText}>
                {pace.delta} {outcomeWord(pace.delta)} ahead.
              </p>
            )}
          </div>
        )}

        {!pace?.realistic && pace && (
          <p className={styles.unrealistic} role="alert">
            Finishing by{" "}
            {new Date(plan.data!.examDate).toLocaleDateString()} needs about{" "}
            {hours.format(pace.requiredDailyHours)} hours a day from here, more
            than your plan sets aside. Moving the exam date or adding study
            hours are the two things that change this.
          </p>
        )}

        {series.length > 0 && plan.data && (
          <PaceField
            series={series}
            missed={missed}
            holidays={holidays.data ?? []}
            totalOutcomes={totalOutcomes}
          />
        )}

        {series.length > 0 && (
          <>
            <div className={styles.rollupControls} role="group" aria-label="Rollup view">
              <button
                type="button"
                className={`${styles.rollupButton} ${
                  showTable === "week" ? styles.rollupButtonActive : ""
                }`}
                onClick={() => setShowTable(showTable === "week" ? null : "week")}
                aria-pressed={showTable === "week"}
              >
                Week
              </button>
              <button
                type="button"
                className={`${styles.rollupButton} ${
                  showTable === "month" ? styles.rollupButtonActive : ""
                }`}
                onClick={() =>
                  setShowTable(showTable === "month" ? null : "month")
                }
                aria-pressed={showTable === "month"}
              >
                Month
              </button>
            </div>

            {showTable === "week" && weeklyRollups.length > 0 && (
              <div className={styles.tableWrap}>
                <table className={`${styles.table} tnum`}>
                  <caption className="visually-hidden">
                    Weekly outcomes covered against target
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Week</th>
                      <th scope="col">Covered</th>
                      <th scope="col">Target</th>
                      <th scope="col">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyRollups.map((row) => (
                      <tr key={row.label}>
                        <th scope="row" className={styles.tableLabel}>
                          {row.label}
                        </th>
                        <td>{row.covered}</td>
                        <td>{row.target}</td>
                        <td
                          className={
                            row.delta < 0
                              ? styles.tableDeltaBehind
                              : row.delta > 0
                                ? styles.tableDeltaAhead
                                : ""
                          }
                        >
                          {row.delta > 0 ? "+" : ""}{row.delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {showTable === "month" && monthlyRollups.length > 0 && (
              <div className={styles.tableWrap}>
                <table className={`${styles.table} tnum`}>
                  <caption className="visually-hidden">
                    Monthly outcomes covered against target
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      <th scope="col">Covered</th>
                      <th scope="col">Target</th>
                      <th scope="col">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyRollups.map((row) => (
                      <tr key={row.label}>
                        <th scope="row" className={styles.tableLabel}>
                          {row.label}
                        </th>
                        <td>{row.covered}</td>
                        <td>{row.target}</td>
                        <td
                          className={
                            row.delta < 0
                              ? styles.tableDeltaBehind
                              : row.delta > 0
                                ? styles.tableDeltaAhead
                                : ""
                          }
                        >
                          {row.delta > 0 ? "+" : ""}{row.delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
