"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { clusterMocks, monthMarks, shortDate, type PlanDay } from "@/lib/pace-view";
import { useDayCursor } from "./day-cursor";
import { SEG_CLASS } from "./plan-shared";
import s from "./plan-metrics.module.css";

export type RibbonZoom = "all" | "month" | "week";
const COL = { month: 22, week: 56 } as const;
const WD = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric" });

/** One column per day, height is hours, stacked by step. Scrolls inside its box; the whole-plan view opens at the exam. */
export function PlanRibbon({ days, gate, height, zoom = "all" }: { days: PlanDay[]; gate: string; height: number; zoom?: RibbonZoom }) {
  const N = days.length;
  const c = useDayCursor(days);
  const scroller = useRef<HTMLDivElement>(null);
  const X = (i: number) => `${(((i + 0.5) / N) * 100).toFixed(3)}%`;
  const today = days.find((d) => d.today);
  const exam = days.find((d) => d.exam);
  const gateDay = days.find((d) => d.date === gate.slice(0, 10));
  const maxMin = Math.max(60, ...days.map((d) => d.total));
  const sessions = days.filter((d) => d.mock).map((d) => ({ idx: d.idx, done: d.mock!.done }));
  const rings = zoom === "all" ? clusterMocks(sessions) : sessions.map((m) => ({ ...m, count: 1 }));
  const holidays: { from: number; to: number }[] = [];
  for (const d of days) {
    const last = holidays[holidays.length - 1];
    if (!d.holiday) continue;
    if (last && last.to === d.idx - 1) last.to = d.idx;
    else holidays.push({ from: d.idx, to: d.idx });
  }
  const width = zoom === "all" ? `max(100%, ${N * 5}px)` : `${N * COL[zoom]}px`;

  // Whole plan opens at the exam end; zoomed views centre today.
  useLayoutEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    sc.scrollLeft = zoom === "all" || !today ? sc.scrollWidth : ((today.idx + 0.5) / N) * sc.scrollWidth - sc.clientWidth / 3;
  }, [zoom, N, today]);

  return (
    <div
      {...c.rootProps}
      className={s.rb}
      style={{ "--n": N, "--h": `${height}px`, "--axis": zoom === "all" ? "20px" : "38px" } as CSSProperties}
      aria-label="Plan ribbon, one column per day. Use the left and right arrow keys to read each day, up and down to move a week."
    >
      <div ref={scroller} className={s.rbScroll}>
        <div className={s.rbTrack} style={{ width }}>
          <div className={s.rbTop} />
          <div className={s.rbLane}>
            {rings.map((r, i) => (
              <span key={i} className={cn(s.rbRing, r.done && s.rbRingDone)} style={{ left: X(r.idx) }} aria-hidden>
                {r.count > 1 ? <b>{r.count}</b> : null}
              </span>
            ))}
          </div>
          <div className={s.rbBars}>
            {days.map((d) => (
              <div
                key={d.idx}
                data-i={d.idx}
                aria-hidden
                className={cn(
                  s.rbDay,
                  !d.past && s.rbFut,
                  d.past && !(d.doneMin && d.doneMin > 0) && s.rbMiss,
                  d.holiday && s.rbHolDay,
                  c.on && c.cur === d.idx && s.rbCur,
                )}
              >
                {d.steps.map((x) => (
                  <i key={x.key} className={SEG_CLASS[x.key]} style={{ height: `${(x.min / maxMin) * 100}%` }} />
                ))}
              </div>
            ))}
          </div>
          <div className={s.rbAxis} aria-hidden>
            {monthMarks(days).map((m) => (
              <span key={m.idx} style={{ left: `${(m.idx / N) * 100}%` }}>
                {m.label}
              </span>
            ))}
            {zoom !== "all"
              ? days.map((d) => (
                  <span key={d.idx} className={s.rbDn} style={{ left: X(d.idx) }}>
                    {zoom === "week" ? WD.format(new Date(Date.parse(`${d.date}T00:00:00Z`))).replace(",", "") : Number(d.date.slice(8))}
                  </span>
                ))
              : null}
          </div>
          <div className={s.rbOv} aria-hidden>
            {holidays.map((h) => (
              <div key={h.from} className={cn(s.rbHol, s.rbHolDay)} style={{ left: `${(h.from / N) * 100}%`, width: `${((h.to - h.from + 1) / N) * 100}%` }}>
                <span>Holiday</span>
              </div>
            ))}
            {today ? (
              <>
                <span className={cn(s.rbLine, s.rbLineToday)} style={{ left: X(today.idx) }} />
                <span className={cn(s.rbTag, s.rbTagToday, today.idx > N * 0.85 && s.rbTagFlip)} style={{ left: X(today.idx) }}>
                  Today {shortDate(today.date)}
                </span>
              </>
            ) : null}
            {gateDay ? (
              <>
                <span className={cn(s.rbLine, s.rbLineGate)} style={{ left: X(gateDay.idx) }} />
                <span className={cn(s.rbTag, s.rbTagGate)} style={{ left: X(gateDay.idx) }}>
                  Mocks from {shortDate(gateDay.date)}
                </span>
              </>
            ) : null}
            {exam ? (
              <>
                <span className={s.rbPost} style={{ left: X(exam.idx) }} />
                <span className={s.rbFlag} style={{ left: X(exam.idx) }}>
                  Exam {shortDate(exam.date)}
                  <small>{today ? `${Math.max(0, exam.idx - today.idx)} days away` : ""}</small>
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <p className={s.rbHint}>Scroll the ribbon sideways. It starts at the exam.</p>
      {c.card}
      {c.live}
    </div>
  );
}
