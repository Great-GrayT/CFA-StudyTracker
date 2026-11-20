"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import type { Projection } from "@/lib/types";
import { calendarStrip, dayInfo, DAY, formatHours, iso, shortDate } from "@/lib/pace-view";
import s from "./pace.module.css";

const STEP_CLASS = { "1": s.s1, "2": s.s2, "3": s.s3, "4": s.s4, "5": s.s5 } as const;
const anchor = (x: number): CSSProperties => (x > 70 ? { right: `${100 - x}%`, textAlign: "right" } : { left: `${x}%` });
const clamp = (i: number, n: number) => Math.max(0, Math.min(n - 1, i));

/** Plan start to exam: holidays, today, the mock gate, mocks, and the planned load per day, with a day cursor. */
export function CalendarStrip({ p }: { p: Projection }) {
  const c = calendarStrip(p);
  const n = c.days;
  const plot = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(0);
  const [on, setOn] = useState(false);
  // The column glides between days only once shown, so it never slides in from its last spot.
  const [glide, setGlide] = useState(false);
  const [live, setLive] = useState("");
  const [side, setSide] = useState<"above" | "below">("above");

  const info = dayInfo(p, iso(c.win.start + cur * DAY));
  const examIso = p.exam.slice(0, 10);
  const todayIdx = Math.round((Date.parse(p.asOf.slice(0, 10)) - c.win.start) / DAY);
  const examIdx = n - 1;

  const show = useCallback(
    (i: number, speak = false) => {
      const k = clamp(i, n);
      setCur(k);
      setOn(true);
      if (speak) setLive(dayInfo(p, iso(c.win.start + k * DAY)).text);
    },
    [n, p, c.win.start],
  );
  const hide = () => {
    setOn(false);
    setLive("");
  };

  const at = (e: PointerEvent) => {
    const r = plot.current!.getBoundingClientRect();
    return Math.floor(((e.clientX - r.left) / r.width) * n);
  };

  // The card follows by transform only: clamped inside the tile, flipped below when there is no room above.
  useLayoutEffect(() => {
    const pl = plot.current, cd = card.current;
    if (!on || !pl || !cd) return;
    const w = pl.offsetWidth, cw = cd.offsetWidth;
    const mid = ((cur + 0.5) / n) * w;
    const gutter = parseFloat(getComputedStyle(pl).marginRight) || 0;
    cd.style.transform = `translateX(${Math.max(0, Math.min(w + gutter - cw, mid - cw / 2))}px)`;
    let top = 0;
    for (let el: HTMLElement | null = pl.parentElement; el; el = el.parentElement) {
      const o = getComputedStyle(el).overflowY;
      if (o === "auto" || o === "scroll") {
        top = el.getBoundingClientRect().top;
        break;
      }
    }
    setSide(pl.getBoundingClientRect().top - top < cd.offsetHeight + 12 ? "below" : "above");
  }, [on, cur, n]);

  useEffect(() => {
    if (!on) {
      setGlide(false);
      return;
    }
    setGlide(true);
    const off = (e: globalThis.PointerEvent) => {
      if (!plot.current?.contains(e.target as Node)) hide();
    };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [on]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      hide();
      return;
    }
    const base = on ? cur : clamp(todayIdx, n);
    const next = ({ ArrowLeft: base - 1, ArrowRight: base + 1, Home: 0, End: examIdx } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    show(next, true);
  };

  const colW = 100 / n;
  return (
    <figure className={s.cal}>
      <div
        ref={plot}
        className={s.calPlot}
        role="group"
        tabIndex={0}
        aria-label={`Plan calendar. ${c.caption} Use the left and right arrow keys to read each day.`}
        onPointerMove={(e) => {
          if (e.pointerType !== "touch") show(at(e));
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "touch") show(at(e));
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "touch") setOn(false);
        }}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) show(clamp(todayIdx, n));
        }}
        onBlur={hide}
        onKeyDown={onKey}
      >
        {c.today !== null ? (
          <span className={cn(s.calLab, s.calLabNow)} style={{ top: 0, ...anchor(c.today) }} aria-hidden>
            <b>Today</b>
          </span>
        ) : null}
        <span className={cn(s.calLab, s.calLabExam)} style={{ top: 0, right: `${100 - c.exam}%`, textAlign: "right" }} aria-hidden>
          <b>Exam</b> {shortDate(p.exam)}
        </span>
        {c.gate !== null ? (
          <span className={s.calLab} style={{ top: 16, right: `${100 - c.gate}%`, textAlign: "right" }} aria-hidden>
            Mocks from {shortDate(p.gate)}
          </span>
        ) : null}
        <div className={s.calTrack} />
        <i className={s.calExamDay} style={{ left: `${100 - colW}%`, width: `${colW}%` }} aria-hidden />
        {c.holidays.map((h) => (
          <div
            key={h.id}
            className={cn(s.hol, h.cancelled && s.calHolX)}
            style={{ left: `${h.left}%`, width: `${h.width}%`, top: "var(--lab)", bottom: "auto", height: 28 }}
          />
        ))}
        {c.gate !== null ? <i className={cn(s.calLine, s.gateLine)} style={{ left: `${c.gate}%` }} /> : null}
        {c.today !== null ? <i className={cn(s.calLine, s.now)} style={{ left: `${c.today}%` }} /> : null}
        <i className={cn(s.calLine, s.calExam)} style={{ left: `${c.exam}%` }} />
        {c.mocks.map((m, i) => (
          <i key={i} className={cn(s.calDot, m.done && s.calDotDone, m.count > 1 && s.calDotMany)} style={{ left: `${m.pct}%` }}>
            {m.count > 1 ? m.count : null}
          </i>
        ))}
        <i className={s.calFlag} style={{ left: `${c.exam}%` }} aria-hidden />
        <div className={s.calLoad} aria-hidden>
          {c.load.map((d) => (
            <i
              key={d.date}
              className={cn(d.date === examIso && s.calLoadExam)}
              style={{ left: `${d.left}%`, width: `${d.width}%`, opacity: on && d.date === info.date ? 1 : d.done ? 1 : d.opacity }}
            />
          ))}
        </div>
        <div className={s.calMonths} aria-hidden>
          {c.months.map((m) => (
            <span key={m.pct} style={{ left: `${m.pct}%` }}>
              {m.label}
            </span>
          ))}
        </div>
        <i
          className={cn(s.calCol, on && s.calColOn, glide && s.calGlide)}
          style={{ width: `${colW}%`, transform: `translateX(${cur * 100}%)` }}
          aria-hidden
        />
        <div ref={card} className={cn(s.calCard, on && s.calCardOn)} data-side={side} aria-hidden>
          <div className={s.calCardIn}>
            <b>{info.label}</b>
            <p>{info.plannedMin > 0 ? `${formatHours(info.plannedMin)} planned` : "Nothing planned"}</p>
            {info.steps.length ? (
              <ul>
                {info.steps.map((x) => (
                  <li key={x.key} className={STEP_CLASS[x.key]}>
                    <i />
                    {x.label} {formatHours(x.min)}
                  </li>
                ))}
              </ul>
            ) : null}
            {info.doneMin !== null ? <p>{formatHours(info.doneMin)} done</p> : null}
            {info.events.length ? (
              <ul className={s.calEv}>
                {info.events.map((e, i) => (
                  <li key={i} data-kind={e.kind}>
                    {e.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
      <div className="sr-only" aria-live="polite">
        {live}
      </div>
      <figcaption className={s.calCap}>
        {c.caption} Hatched is a holiday, a ring is a planned mock session (a number counts several), a filled dot one taken, the diamond is the exam day, solid blue is a day studied.
      </figcaption>
    </figure>
  );
}
