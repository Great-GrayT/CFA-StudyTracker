"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Projection, ProjectionWindow } from "@/lib/types";
import {
  PLAN_ZOOMS,
  STEP_LABEL,
  axisTicks,
  barGeometry,
  circlePos,
  day,
  hasWorkIn,
  moduleHref,
  planTotalsLine,
  pct,
  planWindow,
  sectionHref,
  sectionWindows,
  shortDate,
  inWindow,
  type PlanZoom,
  type Win,
} from "@/lib/pace-view";
import { Tile } from "./tile";
import { ZoomChips } from "./zoom-chips";
import s from "./pace.module.css";

const STEP_CLASS = { 1: s.s1, 2: s.s2, 3: s.s3, 4: s.s4 } as const;
const focus = "focus-visible:ring-ring rounded-sm outline-hidden focus-visible:ring-2";

function describe(windows: ProjectionWindow[]): string {
  return windows
    .map((w) => `${STEP_LABEL[w.step]} ${w.status === "done" ? `done${w.doneOn ? ` ${shortDate(w.doneOn)}` : ""}` : w.status === "overdue" ? `overdue, due ${shortDate(w.due)}` : `due ${shortDate(w.due)}`}`)
    .join(". ");
}

type Ctx = { win: Win; today: string; gate: string; holidays: Projection["holidays"] };

function Track({ windows, ctx }: { windows: ProjectionWindow[]; ctx: Ctx }) {
  const { win } = ctx;
  const t = day(ctx.today);
  const g = day(ctx.gate);
  return (
    <div className={s.trk} role="img" aria-label={describe(windows) || "No work planned"}>
      {ctx.holidays
        .filter((h) => !h.cancelled)
        .map((h) => {
          const geo = barGeometry(h.start, h.end, win);
          return geo ? <div key={h.id} className={s.hol} style={{ left: `${geo.left}%`, width: `${geo.width}%` }} /> : null;
        })}
      {windows.map((w) => {
        const geo = barGeometry(w.start, w.due, win);
        return geo ? (
          <div
            key={`b${w.step}`}
            className={cn(s.seg, STEP_CLASS[w.step], w.start && day(w.start) > t && s.fut)}
            style={{ left: `${geo.left}%`, width: `${geo.width}%` }}
          />
        ) : null;
      })}
      {inWindow(t, win) ? <div className={s.now} style={{ left: `${pct(t, win)}%` }} /> : null}
      {inWindow(g, win) ? <div className={s.gateLine} style={{ left: `${pct(g, win)}%` }} /> : null}
      {windows.map((w) => {
        const at = circlePos(w.due, win);
        return at === null ? null : (
          <div
            key={`m${w.step}`}
            title={`${STEP_LABEL[w.step]}, due ${shortDate(w.due)}`}
            className={cn(s.m, STEP_CLASS[w.step], w.status === "done" && s.mDone, w.status === "overdue" && s.mLate)}
            style={{ left: `${at}%` }}
          >
            {w.step}
          </div>
        );
      })}
    </div>
  );
}

function PlanBody({ p, zoom, openAll }: { p: Projection; zoom: PlanZoom; openAll: boolean }) {
  const today = p.asOf.slice(0, 10);
  const win = useMemo(() => planWindow(zoom, today, p.exam), [zoom, today, p.exam]);
  const ticks = useMemo(() => axisTicks(zoom, win), [zoom, win]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(openAll ? p.sections.map((x) => x.topicId) : []));
  const ctx: Ctx = { win, today, gate: p.gate, holidays: p.holidays };
  const toggle = (id: string) =>
    setOpen((cur) => {
      const n = new Set(cur);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const shown = p.sections.filter(
    (sec) => zoom === "exam" || hasWorkIn(sec.modules.flatMap((m) => m.windows), win),
  );

  return (
    <>
      <div className={s.tl}>
        <div />
        <div className={s.axis} aria-hidden>
          {ticks.map((tk) => (
            <span key={tk.label + tk.pct} style={{ left: `${tk.pct}%` }}>
              {tk.label}
            </span>
          ))}
        </div>
        {shown.map((sec) => {
          const isOpen = open.has(sec.topicId);
          return (
            <Row key={sec.topicId}>
              <div className="flex min-w-0 items-center gap-0.5">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Hide" : "Show"} modules of ${sec.name}`}
                  onClick={() => toggle(sec.topicId)}
                  className={cn("text-muted-foreground grid size-6 shrink-0 place-items-center max-md:size-11", focus)}
                >
                  {isOpen ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
                </button>
                <Link href={sectionHref(sec.topicId)} title={sec.name} className={cn(s.link, focus, "truncate text-[12px]")}>
                  {sec.name}
                </Link>
              </div>
              <Track windows={sectionWindows(sec.modules)} ctx={ctx} />
              {isOpen
                ? sec.modules.map((m) => (
                    <Row key={m.readingId}>
                      <Link
                        href={moduleHref(sec.topicId, m.readingId)}
                        title={m.name}
                        className={cn(s.link, focus, "truncate pl-6 text-[11.5px] max-md:py-3")}
                      >
                        {m.name}
                      </Link>
                      <Track windows={m.windows} ctx={ctx} />
                    </Row>
                  ))
                : null}
            </Row>
          );
        })}
      </div>
      {zoom !== "exam" ? (
        <p className="text-muted-foreground mt-2 text-[11.5px]">Only sections with work in this window are shown.</p>
      ) : null}
      {shown.length === 0 ? <p className="text-muted-foreground py-4 text-[13px]">Nothing is scheduled in this window.</p> : null}
    </>
  );
}

// A grid row without a wrapper element: display: contents keeps the two-column grid.
function Row({ children }: { children: React.ReactNode }) {
  return <div className="contents">{children}</div>;
}

function Legend({ gate }: { gate: string }) {
  return (
    <div className={s.legend}>
      {([1, 2, 3, 4] as const).map((n) => (
        <span key={n}>
          <i className={cn(s.sw, STEP_CLASS[n])} />
          {STEP_LABEL[n]}
        </span>
      ))}
      <span>
        <i className={cn(s.sw, s.swHol)} />
        Holiday
      </span>
      <span style={{ color: "var(--gate)" }}>Dashed amber line: mocks from {shortDate(gate)}</span>
      <span className="basis-full">
        Bar is when the step is worked. Circle is its deadline: filled when done, ring when planned, dashed red when overdue.
      </span>
    </div>
  );
}

export function PlanTile({ p, className }: { p: Projection; className?: string }) {
  const [zoom, setZoom] = useState<PlanZoom>("exam");
  const chips = <ZoomChips value={zoom} onChange={setZoom} options={PLAN_ZOOMS} label="Plan zoom" />;
  return (
    <Tile
      title="The plan"
      hint={planTotalsLine(p) ?? undefined}
      className={className}
      controls={chips}
      expandedHint="Every section opens into its modules."
      expanded={
        <>
          {chips}
          <div className="min-h-0 flex-1 overflow-auto">
            <PlanBody p={p} zoom={zoom} openAll />
            <Legend gate={p.gate} />
          </div>
        </>
      }
    >
      <PlanBody p={p} zoom={zoom} openAll={false} />
      <Legend gate={p.gate} />
    </Tile>
  );
}

