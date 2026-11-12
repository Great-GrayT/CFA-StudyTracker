"use client";

import { useId, useMemo, useState } from "react";
import type { Holiday, LogEntry, Plan } from "@/lib/types";
import { splitWork, startOfUTCDay, addUTCDays, toISODate, hoursBetween } from "@/lib/pace";
import styles from "./pace-field.module.css";

// Target against actual over the whole plan, hand-authored because no chart
// library ships this encoding: the actual band is SPLIT into new coverage and
// review work, which the product spec requires never be blended, and the gap
// between target and actual is filled in two different colours depending on
// its sign.

export type PacePoint = {
  date: string;
  target: number;
  newCoverage: number;
  reviewWork: number;
};

/**
 * Daily series from the log history.
 *
 * Built client side rather than from ProgressSnapshot, which stores only two
 * integers per day and so cannot carry the new versus review split at all.
 */
export function buildSeries(opts: {
  plan: Plan;
  logs: LogEntry[];
  totalOutcomes: number;
  holidays: Holiday[];
  to?: Date;
}): PacePoint[] {
  const { plan, logs, totalOutcomes } = opts;
  const start = startOfUTCDay(new Date(plan.startDate));
  const exam = startOfUTCDay(new Date(plan.examDate));
  const end = startOfUTCDay(opts.to ?? new Date());
  const last = end.getTime() < exam.getTime() ? end : exam;

  const holidays = opts.holidays.map((h) => ({
    start: startOfUTCDay(new Date(h.startDate)),
    end: startOfUTCDay(new Date(h.endDate)),
  }));

  const totalHours = hoursBetween(plan.weeklyAvailability, start, exam, holidays);
  const rate = totalHours > 0 ? totalOutcomes / totalHours : 0;

  const byDate = new Map<string, LogEntry[]>();
  for (const l of logs) {
    const key = toISODate(new Date(l.date));
    const list = byDate.get(key);
    if (list) list.push(l);
    else byDate.set(key, [l]);
  }

  const out: PacePoint[] = [];
  let cursor = start;
  let runningNew = 0;
  let runningReview = 0;
  const seen = new Set<string>();

  while (cursor.getTime() <= last.getTime()) {
    const key = toISODate(cursor);
    for (const l of byDate.get(key) ?? []) {
      if (seen.has(l.losId)) runningReview += 1;
      else {
        seen.add(l.losId);
        runningNew += 1;
      }
    }
    const elapsedHours = hoursBetween(plan.weeklyAvailability, start, cursor, holidays);
    out.push({
      date: key,
      target: Math.max(0, Math.min(totalOutcomes, Math.round(rate * elapsedHours))),
      newCoverage: runningNew,
      reviewWork: runningReview,
    });
    cursor = addUTCDays(cursor, 1);
  }
  return out;
}

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 28, left: 40 };

export function PaceField({
  series,
  missed,
  holidays,
  totalOutcomes,
}: {
  series: PacePoint[];
  missed: string[];
  holidays: Holiday[];
  totalOutcomes: number;
}) {
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();

  const geometry = useMemo(() => {
    if (series.length === 0) return null;
    const maxY = Math.max(
      totalOutcomes * 0.1,
      ...series.map((p) => Math.max(p.target, p.newCoverage + p.reviewWork)),
    );
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / Math.max(1, series.length - 1)) * innerW;
    const y = (v: number) => PAD.top + innerH - (v / maxY) * innerH;
    return { x, y, maxY, innerW, innerH };
  }, [series, totalOutcomes]);

  if (series.length === 0 || !geometry) {
    return (
      <p className={styles.empty}>
        The pace line needs about a week of history before it means much.
      </p>
    );
  }

  const { x, y, maxY } = geometry;
  const last = series[series.length - 1];
  const actual = last.newCoverage + last.reviewWork;
  const summary = `Pace: ${actual} outcomes covered against a target of ${last.target}.`;

  const line = (get: (p: PacePoint) => number) =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(get(p)).toFixed(1)}`).join(" ");

  // The gap between target and actual, closed into a fillable shape. Drawn in
  // two passes so ahead and behind can carry different colours.
  const gapArea = (ahead: boolean) => {
    const top = series.map((p, i) => {
      const a = p.newCoverage + p.reviewWork;
      const v = ahead ? Math.max(a, p.target) : Math.min(a, p.target);
      return `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    });
    const bottom = [...series]
      .reverse()
      .map((p, i) => {
        const idx = series.length - 1 - i;
        const a = p.newCoverage + p.reviewWork;
        const v = ahead ? Math.min(a, p.target) : Math.max(a, p.target);
        return `L${x(idx).toFixed(1)} ${y(v).toFixed(1)}`;
      });
    return [...top, ...bottom, "Z"].join(" ");
  };

  const missedSet = new Set(missed);
  const hovered = hover === null ? null : series[Math.min(series.length - 1, Math.max(0, hover))];

  /** Which day the pointer is over, from its position across the plot. */
  function pointTo(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const frac = (event.clientX - box.left) / box.width;
    // The plot is inset by PAD, so the fraction has to be remapped onto the
    // data range or every reading is offset by the left gutter.
    const inner = (frac * W - PAD.left) / (W - PAD.left - PAD.right);
    setHover(Math.round(inner * (series.length - 1)));
  }
  const holidayRanges = holidays.map((h) => ({
    from: series.findIndex((p) => p.date >= toISODate(new Date(h.startDate))),
    to: series.findIndex((p) => p.date > toISODate(new Date(h.endDate))),
  }));

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        <span id={titleId}>Target against actual</span>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
        >
          {asTable ? "Chart" : "Table"}
        </button>
      </figcaption>

      {asTable ? (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} tnum`}>
            <caption className="visually-hidden">{summary}</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Target</th>
                <th scope="col">New</th>
                <th scope="col">Review</th>
              </tr>
            </thead>
            <tbody>
              {/* Weekly rows: a daily table of 250 rows is not readable. */}
              {series
                .filter((_, i) => i % 7 === 0 || i === series.length - 1)
                .map((p) => (
                  <tr key={p.date}>
                    <th scope="row">{p.date}</th>
                    <td>{p.target}</td>
                    <td>{p.newCoverage}</td>
                    <td>{p.reviewWork}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className={styles.chartWrap}
          onPointerMove={pointTo}
          onPointerDown={pointTo}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className={styles.svg}
            role="img"
            aria-labelledby={titleId}
            aria-describedby={`${titleId}-desc`}
            preserveAspectRatio="none"
          >
            <desc id={`${titleId}-desc`}>{summary}</desc>

            <defs>
              <pattern id="review-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="4" stroke="var(--claimed)" strokeWidth="2" />
              </pattern>
            </defs>

            {/* Holidays first, under everything: they are context, not data. */}
            {holidayRanges.map((r, i) =>
              r.from >= 0 ? (
                <rect
                  key={i}
                  x={x(r.from)}
                  y={PAD.top}
                  width={Math.max(2, x(r.to < 0 ? series.length - 1 : r.to) - x(r.from))}
                  height={H - PAD.top - PAD.bottom}
                  fill="var(--rule)"
                  opacity="0.5"
                />
              ) : null,
            )}

            {/* The shortfall, at a weight that does not swallow the chart.
                At 0.28 this was a solid wash over the whole plot for anyone
                meaningfully behind, which is exactly the candidate who most
                needs to read the lines underneath it. */}
            <g className="data-fill">
              <path d={gapArea(true)} fill="var(--strong)" opacity="0.16" />
              <path d={gapArea(false)} fill="var(--alarm)" opacity="0.14" />
            </g>

            {/* Review work sits above new coverage in the stack, over a hatch,
                so growth driven by re-drilling is visibly different from
                growth driven by new breadth. */}
            <path
              d={`${line((p) => p.newCoverage + p.reviewWork)} L${x(series.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`}
              fill="url(#review-hatch)"
              opacity="0.55"
            />
            <path
              d={`${line((p) => p.newCoverage)} L${x(series.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`}
              fill="var(--claimed)"
              opacity="0.85"
            />

            {/* Both series get a stroked line of their own. The areas alone
                were unreadable at low coverage: two outcomes against a
                target of a hundred is a sliver one pixel high, so the actual
                simply was not on the chart. vectorEffect keeps every stroke
                at its stated width despite preserveAspectRatio="none", which
                otherwise stretches strokes and dashes with the box. */}
            <path
              d={line((p) => p.target)}
              fill="none"
              stroke="var(--rule-strong)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={line((p) => p.newCoverage + p.reviewWork)}
              fill="none"
              stroke="var(--claimed-ink)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />

            {series.map((p, i) =>
              missedSet.has(p.date) ? (
                <line
                  key={p.date}
                  x1={x(i)}
                  x2={x(i)}
                  y1={H - PAD.bottom}
                  y2={H - PAD.bottom + 6}
                  stroke="var(--alarm)"
                  strokeWidth="2"
                />
              ) : null,
            )}

            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={H - PAD.bottom}
              y2={H - PAD.bottom}
              stroke="var(--rule-strong)"
              vectorEffect="non-scaling-stroke"
            />

            {/* Four values up the side rather than two. The old axis gave the
                top and the bottom, which tells you the range and nothing
                about where a point sits inside it. */}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                {f > 0 ? (
                  <line
                    x1={PAD.left}
                    x2={W - PAD.right}
                    y1={y(maxY * f)}
                    y2={y(maxY * f)}
                    stroke="var(--rule)"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                <text x={PAD.left - 6} y={y(maxY * f) + 4} textAnchor="end" className={styles.tick}>
                  {Math.round(maxY * f)}
                </text>
              </g>
            ))}

            {/* Dates along the bottom. There were none at all, so the x axis
                was an unlabelled run of pixels. */}
            {[0, 0.5, 1].map((f) => {
              const i = Math.round((series.length - 1) * f);
              return (
                <text
                  key={f}
                  x={x(i)}
                  y={H - PAD.bottom + 18}
                  textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
                  className={styles.tick}
                >
                  {new Date(`${series[i].date}T00:00:00Z`).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  })}
                </text>
              );
            })}
            {hover !== null && hovered ? (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="var(--text)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                opacity="0.5"
              />
            ) : null}
          </svg>

          {/* A fixed readout, not a floating tooltip: this chart is read on a
              phone, where there is no hover at all and a tooltip would cover
              the lines it describes. Touch drives it through onPointerDown. */}
          <p className={`${styles.readout} tnum`} aria-live="polite">
            {hovered ? (
              <>
                <span className={styles.readoutDate}>
                  {new Date(`${hovered.date}T00:00:00Z`).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  })}
                </span>
                {" target "}
                {hovered.target}
                {", actual "}
                {hovered.newCoverage + hovered.reviewWork}
                {", "}
                {hovered.newCoverage + hovered.reviewWork - hovered.target >= 0 ? "ahead " : "behind "}
                {Math.abs(hovered.newCoverage + hovered.reviewWork - hovered.target)}
              </>
            ) : (
              <span className={styles.readoutIdle}>
                Point at the chart for a day&rsquo;s figures.
              </span>
            )}
          </p>

          <ul className={styles.legend}>
            <li><span className={styles.swatchNew} /> New coverage</li>
            <li><span className={styles.swatchReview} /> Review</li>
            <li><span className={styles.swatchTarget} /> Target</li>
            <li><span className={styles.swatchMissed} /> Missed day</li>
          </ul>
        </div>
      )}
    </figure>
  );
}

/** The small Today variant: the gap over time, nothing else. */
export function DeviationSparkline({ series }: { series: PacePoint[] }) {
  const titleId = useId();
  if (series.length < 2) return null;

  const deltas = series.map((p) => p.newCoverage + p.reviewWork - p.target);
  const bound = Math.max(1, ...deltas.map((d) => Math.abs(d)));
  const w = 320;
  const h = 48;
  const x = (i: number) => (i / (series.length - 1)) * w;
  const y = (d: number) => h / 2 - (d / bound) * (h / 2 - 4);

  const path = deltas.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(d).toFixed(1)}`).join(" ");
  const latest = deltas[deltas.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={styles.spark} role="img" aria-labelledby={titleId}>
      <title id={titleId}>
        {latest === 0
          ? "Exactly on pace"
          : `${Math.abs(latest)} outcomes ${latest > 0 ? "ahead of" : "behind"} pace`}
      </title>
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="var(--rule-strong)" strokeWidth="1" />
      <path
        d={`${path} L${w} ${h / 2} L0 ${h / 2} Z`}
        fill={latest < 0 ? "var(--alarm)" : "var(--strong)"}
        opacity="0.3"
      />
      <path d={path} fill="none" stroke={latest < 0 ? "var(--alarm)" : "var(--strong)"} strokeWidth="1.5" />
    </svg>
  );
}

export { splitWork };
