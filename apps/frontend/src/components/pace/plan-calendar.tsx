"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { formatHours, monthGrid, type PlanDay } from "@/lib/pace-view";
import { useDayCursor } from "./day-cursor";
import { SEG_CLASS } from "./plan-shared";
import s from "./plan-metrics.module.css";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHIP = { today: s.chipToday, exam: s.chipExam, gate: s.chipGate, mock: s.chipMock, holiday: "" } as const;

function hours(d: PlanDay): string {
  if (d.past) return d.doneMin && d.doneMin > 0 ? `${formatHours(d.doneMin)} done` : d.total > 0 ? "None done" : "";
  return d.total > 0 ? formatHours(d.total) : "";
}

/** Month by month, Monday first. Each day is a mini stacked bar, its hours and event chips. */
export function PlanCalendar({ days }: { days: PlanDay[] }) {
  const months = useMemo(() => monthGrid(days), [days]);
  const c = useDayCursor(days);
  const scroller = useRef<HTMLDivElement>(null);
  const todayKey = days.find((d) => d.today)?.date.slice(0, 7);

  // Open on the month that holds today instead of the plan start.
  useLayoutEffect(() => {
    const sc = scroller.current;
    const m = sc?.querySelector<HTMLElement>(`[data-month="${todayKey}"]`);
    if (sc && m) sc.scrollTop = m.offsetTop;
  }, [todayKey]);

  return (
    <div ref={scroller} className={s.cmScroll}>
      <div
        {...c.rootProps}
        className={s.cm}
        aria-label="Plan calendar. Use the arrow keys to read each day: left and right move a day, up and down a week."
      >
        {months.map((m) => (
          <section key={m.key} data-month={m.key}>
            <h4>{m.label}</h4>
            <div className={s.cmGrid}>
              {WEEK.map((w) => (
                <div key={w} className={s.cmWh} aria-hidden>
                  {w}
                </div>
              ))}
              {Array.from({ length: m.lead }, (_, i) => (
                <div key={`b${i}`} className={cn(s.mc, s.mcBlank)} aria-hidden />
              ))}
              {m.days.map((d) => (
                <div
                  key={d.idx}
                  data-i={d.idx}
                  aria-hidden
                  className={cn(s.mc, d.past && s.mcPast, d.today && s.mcToday, d.holiday && s.mcHol, d.exam && s.mcExam, c.on && c.cur === d.idx && s.mcCur)}
                >
                  <span className={s.mcDay}>{Number(d.date.slice(8))}</span>
                  {d.total > 0 ? (
                    <>
                      <div className={s.mcBar} style={{ width: `${Math.min(100, (d.total / 180) * 100)}%` }}>
                        {d.steps.map((x) => (
                          <i key={x.key} className={SEG_CLASS[x.key]} style={{ flex: x.min }} />
                        ))}
                      </div>
                      <span className={s.mcHrs}>{hours(d)}</span>
                    </>
                  ) : null}
                  {d.events.length ? (
                    <div className={s.chips}>
                      {d.events.map((e, i) => (
                        <span key={i} className={cn(s.chip, CHIP[e.kind])}>
                          {e.kind === "mock" ? e.text.replace(/, taken$/, "") : e.short}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ))}
        {c.card}
        {c.live}
      </div>
    </div>
  );
}
