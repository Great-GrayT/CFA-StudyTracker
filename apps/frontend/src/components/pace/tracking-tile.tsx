"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Projection } from "@/lib/types";
import {
  STEP_LABEL,
  TRACK_ZOOMS,
  cumulative,
  day,
  formatHours,
  owedMinutes,
  reasonText,
  taskHref,
  trackingBuckets,
  type Bucket,
  type TrackZoom,
} from "@/lib/pace-view";
import { Tile } from "./tile";
import { ZoomChips } from "./zoom-chips";
import s from "./pace.module.css";

const W = 560;
const H = 124;
const BASE = 106;
const TOP = 6;

function Bars({ buckets, p, zoom }: { buckets: Bucket[]; p: Projection; zoom: Exclude<TrackZoom, "today"> }) {
  const todayMs = day(p.asOf);
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.plannedMin, b.doneMin)));
  const slot = (W - 12) / Math.max(1, buckets.length);
  const bw = slot * 0.72;
  const h = (m: number) => (m / max) * (BASE - TOP);
  const cum = zoom === "exam" ? cumulative(buckets, todayMs) : null;
  const total = cum ? Math.max(1, cum.planned[cum.planned.length - 1] ?? 1) : 1;
  const cy = (m: number) => BASE - (m / total) * (BASE - TOP);
  const cx = (i: number) => 6 + i * slot + slot / 2;
  const nowIdx = buckets.findIndex((b, i) => b.startMs <= todayMs && (i === buckets.length - 1 || buckets[i + 1].startMs > todayMs));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden>
      {buckets.map((b, i) => {
        const x = 6 + i * slot + (slot - bw) / 2;
        return (
          <g key={b.key}>
            <rect
              x={x}
              y={BASE - h(b.plannedMin)}
              width={bw}
              height={h(b.plannedMin)}
              fill={b.off ? "var(--rule)" : "color-mix(in srgb, var(--claimed) 22%, transparent)"}
            />
            <rect x={x} y={BASE - h(b.doneMin)} width={bw} height={h(b.doneMin)} fill="var(--claimed)" />
            {b.owedMin > 0 ? (
              <rect
                x={x}
                y={BASE - h(b.doneMin + b.owedMin)}
                width={bw}
                height={h(b.owedMin)}
                fill="none"
                stroke="var(--alarm)"
                strokeDasharray="3"
              />
            ) : null}
            <text x={cx(i)} y={H - 1} textAnchor="middle" fontSize="14" fill="var(--muted)">
              {b.label}
            </text>
          </g>
        );
      })}
      {cum ? (
        <>
          <polyline
            points={cum.planned.map((m, i) => `${cx(i)},${cy(m)}`).join(" ")}
            fill="none"
            stroke="var(--claimed)"
            strokeWidth="1.5"
            strokeDasharray="4"
          />
          <polyline
            points={cum.done.flatMap((m, i) => (m === null ? [] : [`${cx(i)},${cy(m)}`])).join(" ")}
            fill="none"
            stroke="var(--text)"
            strokeWidth="2.5"
          />
        </>
      ) : null}
      {nowIdx >= 0 ? (
        <line x1={cx(nowIdx)} x2={cx(nowIdx)} y1={0} y2={BASE} stroke="var(--alarm)" opacity="0.6" />
      ) : null}
    </svg>
  );
}

function TodayList({ p }: { p: Projection }) {
  const today = p.asOf.slice(0, 10);
  const d = p.daily.find((x) => x.date === today);
  const extrasToday = p.extras.filter((e) => e.date === today);
  if (!d || d.plannedMin === 0) {
    return <p className="text-muted-foreground py-3 text-[13px]">Nothing is planned for today.</p>;
  }
  return (
    <ul className="text-[12.5px]">
      {([1, 2, 3, 4] as const).map((n) => {
        const m = d.byStep[String(n) as "1"];
        return m > 0 ? (
          <li key={n} className="border-border flex justify-between border-b py-1">
            <span>{STEP_LABEL[n]}</span>
            <span className="tabular-nums">{formatHours(m)} planned</span>
          </li>
        ) : null;
      })}
      {d.byStep["5"] > 0 ? (
        <li className="border-border flex justify-between border-b py-1">
          <span>Mocks</span>
          <span className="tabular-nums">{formatHours(d.byStep["5"])} planned</span>
        </li>
      ) : null}
      {extrasToday.map((e, i) => (
        <li key={i} className="border-border text-alarm-ink flex justify-between gap-3 border-b py-1">
          {e.taskId ? (
            <Link href={taskHref(e.taskId)} className={cn(s.link, "focus-visible:ring-ring rounded-sm outline-hidden focus-visible:ring-2")}>
              Extra: {reasonText(e.reason)}
            </Link>
          ) : (
            <span>Extra: {reasonText(e.reason)}</span>
          )}
          <span className="tabular-nums">{formatHours(e.minutes)}</span>
        </li>
      ))}
      <li className="flex justify-between py-1 font-semibold">
        <span>Done so far</span>
        <span className="tabular-nums">
          {formatHours(d.doneMin)} of {formatHours(d.plannedMin)}
        </span>
      </li>
    </ul>
  );
}

function Kpis({ p, zoom, buckets }: { p: Projection; zoom: Exclude<TrackZoom, "today">; buckets: Bucket[] }) {
  const today = p.asOf.slice(0, 10);
  const owed = owedMinutes(p.daily, today);
  const answered = p.sections.reduce(
    (a, x) => a + (x.performance.initial?.answered ?? 0) + (x.performance.review?.answered ?? 0) + (x.performance.mocks?.answered ?? 0),
    0,
  );
  const planned = buckets.reduce((a, b) => a + b.plannedMin, 0);
  const done = buckets.reduce((a, b) => a + b.doneMin, 0);
  const k = "flex flex-col text-[12px] text-muted-foreground";
  const v = "text-[15px] font-semibold tabular-nums text-foreground";
  return (
    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
      <span className={k}>
        <b className={v}>
          {formatHours(done)} / {formatHours(planned)}
        </b>
        {zoom === "exam" ? "to exam" : zoom === "month" ? "this month" : "this week"}
      </span>
      {zoom === "week" ? (
        <span className={k}>
          <b className={v}>{buckets.filter((b) => b.owedMin > 0).length}</b>
          {buckets.filter((b) => b.owedMin > 0).length === 1 ? "day missed" : "days missed"}
        </span>
      ) : (
        <Link href="/plan?tab=calendar" className={cn(k, s.link, "focus-visible:ring-ring outline-hidden focus-visible:ring-2")}>
          <b className={cn(v, owed > 0 ? "text-alarm-ink" : "text-strong")}>{owed > 0 ? `−${formatHours(owed)}` : "On plan"}</b>
          vs plan to date
        </Link>
      )}
      <span className={k}>
        <b className={v}>{answered}</b>
        questions answered
      </span>
    </div>
  );
}

function Body({ p, zoom }: { p: Projection; zoom: TrackZoom }) {
  const today = p.asOf.slice(0, 10);
  const buckets = useMemo(
    () => (zoom === "today" ? [] : trackingBuckets(zoom, p.daily, p.holidays, today)),
    [zoom, p.daily, p.holidays, today],
  );
  if (zoom === "today") return <TodayList p={p} />;
  if (buckets.every((b) => b.plannedMin === 0 && b.doneMin === 0)) {
    return <p className="text-muted-foreground py-3 text-[13px]">No hours are planned in this window.</p>;
  }
  return (
    <>
      <Bars buckets={buckets} p={p} zoom={zoom} />
      <table className="sr-only">
        <caption>Hours planned, done and owed per {zoom === "exam" ? "month" : zoom === "month" ? "week" : "day"}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Planned</th>
            <th scope="col">Done</th>
            <th scope="col">Owed</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.label}</th>
              <td>{formatHours(b.plannedMin)}</td>
              <td>{formatHours(b.doneMin)}</td>
              <td>{formatHours(b.owedMin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground mt-1 text-[11.5px]">Pale is planned, solid is done, dashed red is owed.</p>
      <Kpis p={p} zoom={zoom} buckets={buckets} />
    </>
  );
}

export function TrackingTile({ p, className }: { p: Projection; className?: string }) {
  const [zoom, setZoom] = useState<TrackZoom>("exam");
  const chips = <ZoomChips value={zoom} onChange={setZoom} options={TRACK_ZOOMS} label="Tracking zoom" />;
  return (
    <Tile
      title="Tracking"
      className={className}
      controls={chips}
      expandedHint="Hours planned against hours done, at the zoom you pick."
      expanded={
        <>
          {chips}
          <div className="min-h-0 flex-1 overflow-auto">
            <Body p={p} zoom={zoom} />
          </div>
        </>
      }
    >
      <Body p={p} zoom={zoom} />
    </Tile>
  );
}
