"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatHours, type PlanDay } from "@/lib/pace-view";
import { SEG_CLASS } from "./plan-shared";
import s from "./plan-metrics.module.css";

const CHIP = { today: s.chipToday, exam: s.chipExam, gate: s.chipGate, mock: s.chipMock, holiday: "" } as const;

/**
 * One day cursor for a ribbon or a calendar: hover or tap a day (data-i on its element), or focus the
 * root and use the arrow keys. The root is the single tab stop, so keyboard moves are announced through
 * a polite live region instead of moving focus between hundreds of days.
 */
export function useDayCursor(days: PlanDay[]) {
  const n = days.length;
  const todayIdx = Math.max(0, days.findIndex((d) => d.today));
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const byKey = useRef(false);
  const [cur, setCur] = useState(todayIdx);
  const [on, setOn] = useState(false);
  const [live, setLive] = useState("");
  const [pos, setPos] = useState({ x: 0, y: 0, flip: false });

  const show = (i: number, speak = false) => {
    const k = Math.max(0, Math.min(n - 1, i));
    setCur(k);
    setOn(true);
    if (speak) {
      byKey.current = true;
      setLive(days[k]?.text ?? "");
    }
  };
  const hide = () => {
    setOn(false);
    setLive("");
  };
  const at = (e: { target: EventTarget }) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    return el && root.current?.contains(el) ? Number(el.dataset.i) : null;
  };

  // The card is placed by transform, above the day or flipped below when there is no room.
  useLayoutEffect(() => {
    const r = root.current, c = card.current;
    const el = r?.querySelector<HTMLElement>(`[data-i="${cur}"]`);
    if (!on || !r || !c || !el) return;
    if (byKey.current) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      byKey.current = false;
    }
    const rr = r.getBoundingClientRect(), er = el.getBoundingClientRect();
    const w = c.offsetWidth, h = c.offsetHeight;
    const x = Math.max(0, Math.min(rr.width - w, er.left - rr.left + er.width / 2 - w / 2));
    const above = er.top - rr.top - h - 8;
    setPos(above >= 0 ? { x, y: above, flip: false } : { x, y: er.bottom - rr.top + 8, flip: true });
  }, [on, cur]);

  useEffect(() => {
    if (!on) return;
    const off = (e: globalThis.PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) hide();
    };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [on]);

  const rootProps = {
    ref: root,
    role: "group" as const,
    tabIndex: 0,
    onPointerOver: (e: PointerEvent) => {
      const i = e.pointerType === "mouse" ? at(e) : null;
      if (i !== null) show(i);
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === "mouse") setOn(false);
    },
    onClick: (e: React.MouseEvent) => {
      const i = at(e);
      if (i !== null) show(i);
    },
    onFocus: (e: FocusEvent) => {
      if (e.target === e.currentTarget && e.currentTarget.matches(":focus-visible")) show(cur);
    },
    onBlur: (e: FocusEvent) => {
      if (e.target === e.currentTarget) hide();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Escape") return hide();
      const next = ({ ArrowLeft: cur - 1, ArrowRight: cur + 1, ArrowUp: cur - 7, ArrowDown: cur + 7, Home: 0, End: n - 1 } as Record<string, number>)[e.key];
      if (next === undefined) return;
      e.preventDefault();
      show(next, true);
    },
  };

  const d = days[cur];
  const cardEl: ReactNode = d ? (
    <div
      ref={card}
      className={cn(s.card, on && s.cardOn, pos.flip && s.cardFlip)}
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      aria-hidden
    >
      <div className={s.cardIn}>
        <b className={s.cardHead}>{d.label}</b>
        <p className={s.cardSub}>{d.plannedMin > 0 ? `${formatHours(d.plannedMin)} planned` : "Nothing planned"}</p>
        {d.steps.map((x) => (
          <div key={x.key} className={s.cardRow}>
            <span className={cn(s.sw, SEG_CLASS[x.key])} />
            {x.label}
            <em>{formatHours(x.min)}</em>
          </div>
        ))}
        {d.doneMin !== null ? <p className={s.cardDone}>{d.doneMin > 0 ? `${formatHours(d.doneMin)} done` : "Nothing done"}</p> : null}
        {d.events.length ? (
          <div className={s.chips}>
            {d.events.map((e, i) => (
              <span key={i} className={cn(s.chip, CHIP[e.kind])}>
                {e.text}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  const liveEl = (
    <div className="sr-only" aria-live="polite">
      {live}
    </div>
  );
  return { rootProps, cur, on, card: cardEl, live: liveEl, root };
}
