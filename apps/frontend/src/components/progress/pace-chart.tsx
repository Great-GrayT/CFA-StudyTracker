"use client";

import { useId, useMemo, useState } from "react";
import type { Holiday } from "@/lib/types";
import { toISODate, type PacePoint } from "@/lib/pace";
import { cn } from "@/lib/utils";

// The pace field from components/pace-field.tsx, restyled on the theme. Still
// hand-drawn: no chart library ships a target line over a new coverage band
// with review stacked apart and the gap coloured by its sign.
//
// One change from the old field: ahead and behind are measured on new coverage
// alone, the figure the pace sentence and the rollups use. Measured on new plus
// review, re-drilling could paint a breadth shortfall green.

// Axis labels are HTML beside the plot, not SVG text: the plot stretches with
// preserveAspectRatio="none", which would distort any glyph drawn inside it.
const W = 640;
const H = 200;
const PAD = { top: 8, right: 0, bottom: 10, left: 0 };
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtDay = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`));

export function PaceChart({
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
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const hatchId = `${id}-hatch`;

  const geo = useMemo(() => {
    const maxY = Math.max(
      Math.max(1, totalOutcomes * 0.1),
      ...series.map((p) => Math.max(p.target, p.newCoverage + p.reviewWork)),
    );
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / Math.max(1, series.length - 1)) * innerW;
    const y = (v: number) => PAD.top + innerH - (v / maxY) * innerH;
    return { x, y, maxY };
  }, [series, totalOutcomes]);

  const { x, y, maxY } = geo;
  const last = series[series.length - 1];
  const summary = `${last.newCoverage} outcomes covered against a target of ${last.target} on ${fmtDay(last.date)}, with ${last.reviewWork} review sessions on top.`;

  const line = (get: (p: PacePoint) => number) =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(get(p)).toFixed(1)}`).join(" ");
  const area = (get: (p: PacePoint) => number) =>
    `${line(get)} L${x(series.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`;

  // The gap between target and new coverage, closed into a shape; drawn twice
  // so ahead and behind each take their own colour.
  const gapArea = (ahead: boolean) => {
    const top = series.map((p, i) => {
      const v = ahead ? Math.max(p.newCoverage, p.target) : Math.min(p.newCoverage, p.target);
      return `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    });
    const bottom = series
      .map((p, i) => {
        const v = ahead ? Math.min(p.newCoverage, p.target) : Math.max(p.newCoverage, p.target);
        return `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      })
      .reverse();
    return [...top, ...bottom, "Z"].join(" ");
  };

  const missedSet = new Set(missed);
  const hovered = hover === null ? null : series[Math.min(series.length - 1, Math.max(0, hover))];
  const holidayRanges = holidays.map((h) => ({
    from: series.findIndex((p) => p.date >= toISODate(new Date(h.startDate))),
    to: series.findIndex((p) => p.date > toISODate(new Date(h.endDate))),
  }));

  function pointTo(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    // The plot is inset by PAD, so remap the pointer onto the data range.
    const inner = (((event.clientX - box.left) / box.width) * W - PAD.left) / (W - PAD.left - PAD.right);
    setHover(Math.round(inner * (series.length - 1)));
  }

  const gap = hovered ? hovered.newCoverage - hovered.target : 0;

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
      <div aria-hidden className="relative w-7">
        {[0, 0.5, 1].map((f) => (
          <span
            key={f}
            className="text-muted-foreground absolute right-0 -translate-y-1/2 text-[12px] leading-none tabular-nums"
            style={{ top: `${(y(maxY * f) / H) * 100}%` }}
          >
            {Math.round(maxY * f)}
          </span>
        ))}
      </div>
      <div
        className="touch-pan-y"
        onPointerMove={pointTo}
        onPointerDown={pointTo}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-[180px] w-full md:h-[220px]"
          role="img"
          aria-label="Pace, target against covered"
          aria-describedby={`${id}-desc`}
          preserveAspectRatio="none"
        >
          <desc id={`${id}-desc`}>{summary}</desc>
          <defs>
            <pattern id={hatchId} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="var(--claimed)" strokeWidth="2" />
            </pattern>
          </defs>

          {/* Holidays under everything: context, not data. */}
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

          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(maxY * f)}
              y2={y(maxY * f)}
              stroke="var(--rule)"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Light enough that the lines underneath stay readable for the
              candidate who is furthest behind. */}
          <path d={gapArea(true)} fill="var(--strong)" opacity="0.16" />
          <path d={gapArea(false)} fill="var(--alarm)" opacity="0.14" />

          {/* Review stacked above new coverage, hatched, so growth from
              re-drilling never looks like growth in breadth. */}
          <path d={area((p) => p.newCoverage + p.reviewWork)} fill={`url(#${hatchId})`} opacity="0.5" />
          <path d={area((p) => p.newCoverage)} fill="var(--claimed)" opacity="0.85" />

          {/* Stroked lines too: at low coverage the areas are a pixel high.
              non-scaling-stroke keeps widths true under preserveAspectRatio="none". */}
          <path
            d={line((p) => p.target)}
            fill="none"
            stroke="var(--rule-strong)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={line((p) => p.newCoverage)}
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
                vectorEffect="non-scaling-stroke"
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

          {hover !== null && hovered ? (
            <line
              x1={x(Math.min(series.length - 1, Math.max(0, hover)))}
              x2={x(Math.min(series.length - 1, Math.max(0, hover)))}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--text)"
              opacity="0.5"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
      </div>
      <div aria-hidden className="text-muted-foreground col-start-2 flex justify-between pt-1 text-[12px] tabular-nums">
        <span>{fmtDay(series[0].date)}</span>
        <span className="max-sm:hidden">{fmtDay(series[Math.round((series.length - 1) / 2)].date)}</span>
        <span>{fmtDay(last.date)}</span>
      </div>
      </div>

      {/* A fixed readout, not a floating tooltip: on a phone there is no
          hover, and a tooltip would cover the lines it describes. */}
      <p className="min-h-5 text-[13px] tabular-nums" aria-live="polite">
        {hovered ? (
          <>
            <span className="font-medium">{fmtDay(hovered.date)}</span>
            {`, target ${hovered.target}, covered ${hovered.newCoverage}, review ${hovered.reviewWork}, `}
            <span className={cn(gap > 0 && "text-strong", gap < 0 && "text-alarm-ink")}>
              {gap === 0 ? "on pace" : `${Math.abs(gap)} ${gap > 0 ? "ahead" : "behind"}`}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Point at the chart for a day&rsquo;s figures.</span>
        )}
      </p>

      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="bg-primary inline-block size-2.5" /> New coverage
        </li>
        <li className="flex items-center gap-1.5">
          <svg aria-hidden width="10" height="10" className="inline-block">
            <rect width="10" height="10" fill={`url(#${hatchId})`} />
          </svg>
          Review
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="border-input inline-block w-3 border-t-[1.5px] border-dashed" /> Target
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="bg-destructive inline-block h-2.5 w-0.5" /> Missed day
        </li>
        {holidays.length > 0 ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="bg-border inline-block size-2.5" /> Holiday
          </li>
        ) : null}
      </ul>
    </figure>
  );
}
