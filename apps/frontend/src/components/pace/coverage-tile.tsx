"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Projection, ProjectionSection, ProjectionWindow } from "@/lib/types";
import {
  STEPS,
  STEP_LABEL,
  accuracy,
  formatPercent,
  moduleHref,
  sectionBehindMin,
  sectionHref,
  shortDate,
  sortModules,
  stepFractions,
  type SortMode,
} from "@/lib/pace-view";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tile } from "./tile";
import s from "./pace.module.css";

const STEP_CLASS = { 1: s.s1, 2: s.s2, 3: s.s3, 4: s.s4 } as const;
const focus = "focus-visible:ring-ring rounded-sm outline-hidden focus-visible:ring-2";

function Meter({ sec, step }: { sec: ProjectionSection; step: 1 | 2 | 3 | 4 }) {
  const row = sec.steps.find((x) => x.step === step);
  const f = row ? stepFractions(row) : { done: 0, spent: 0, tick: 0 };
  return (
    <div
      className={cn(s.mb, STEP_CLASS[step])}
      role="img"
      aria-label={`${sec.name}, ${STEP_LABEL[step]}: ${formatPercent(f.done)} done and passed, ${formatPercent(f.spent)} spent not passed, plan today ${formatPercent(f.tick)}`}
    >
      <i style={{ width: `${f.done * 100}%` }} />
      {f.spent > 0 ? <b style={{ left: `${f.done * 100}%`, width: `${f.spent * 100}%` }} /> : null}
      <s style={{ left: `calc(${f.tick * 100}% - 1px)` }} />
    </div>
  );
}

function CoverageGrid({ p }: { p: Projection }) {
  return (
    <div className={s.cv}>
      <span />
      {STEPS.map((n) => (
        <span key={n} className={cn(s.hh, STEP_CLASS[n])}>
          {STEP_LABEL[n]}
        </span>
      ))}
      <abbr title="Exam weight" className="text-muted-foreground text-right text-[11.5px] no-underline">Wt</abbr>
      {p.sections.map((sec) => (
        <Fragment key={sec.topicId}>
          <Link
            href={sectionHref(sec.topicId)}
            title={sec.name}
            className={cn(s.link, focus, "truncate text-[12px] max-md:py-3", sectionBehindMin(sec) > 0 && "text-alarm-ink")}
          >
            {sec.name}
          </Link>
          {STEPS.map((n) => (
            <Meter key={n} sec={sec} step={n} />
          ))}
          <span className="text-muted-foreground text-right text-[11.5px] tabular-nums">
            {Math.round(sec.examWeight * 100)}%
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function cellText(w: ProjectionWindow | undefined): { text: string; cls: string; dot: string } {
  if (!w || (!w.due && !w.doneOn)) return { text: "", cls: "", dot: "" };
  if (w.status === "done") return { text: w.doneOn ? shortDate(w.doneOn) : "Done", cls: "", dot: s.dotDone };
  if (w.status === "overdue") return { text: `due ${shortDate(w.due)}`, cls: "text-alarm-ink", dot: s.dotLate };
  return { text: shortDate(w.due), cls: "", dot: "" };
}

const SORTS: { value: SortMode; label: string }[] = [
  { value: "curriculum", label: "Curriculum order" },
  { value: "behind", label: "Most behind first" },
  { value: "only-behind", label: "Only behind" },
];

function CoverageTable({ p }: { p: Projection }) {
  const today = p.asOf.slice(0, 10);
  const [sort, setSort] = useState<SortMode>("curriculum");
  const [open, setOpen] = useState<Set<string>>(() => new Set(p.sections.slice(0, 1).map((x) => x.topicId)));
  const toggle = (id: string) =>
    setOpen((cur) => {
      const n = new Set(cur);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const rows = p.sections
    .map((sec) => ({ sec, mods: sortModules(sec.modules, sort, today) }))
    .filter((r) => sort !== "only-behind" || r.mods.length > 0);
  return (
    <>
      <ToggleGroup
        type="single"
        variant="outline"
        value={sort}
        onValueChange={(v) => v && setSort(v as SortMode)}
        aria-label="Sort modules"
        className="flex-wrap"
      >
        {SORTS.map((o) => (
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            className="h-7 px-2.5 text-[12px] max-md:h-11 data-[state=on]:bg-accent data-[state=on]:font-semibold"
          >
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className={s.panel}>
        <table className={s.tbl}>
          <caption className="sr-only">Coverage by module: each step with its done or due date</caption>
          <thead>
            <tr>
              <th scope="col">Module</th>
              {STEPS.map((n) => (
                <th key={n} scope="col">
                  {n} {STEP_LABEL[n]}
                </th>
              ))}
              <th scope="col">Mocks</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted-foreground">
                  No module is behind.
                </td>
              </tr>
            ) : null}
            {rows.map(({ sec, mods }) => {
              const isOpen = open.has(sec.topicId);
              const past1 = sec.modules.filter((m) => m.windows.find((w) => w.step === 1)?.status === "done").length;
              const mock = accuracy(sec.performance.mocks);
              return (
                <Fragment key={sec.topicId}>
                  <tr className={s.secRow}>
                    <td colSpan={5}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Hide" : "Show"} modules of ${sec.name}`}
                        onClick={() => toggle(sec.topicId)}
                        className={cn("mr-1 inline-grid size-6 place-items-center align-middle max-md:size-11", focus)}
                      >
                        {isOpen ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
                      </button>
                      <Link href={sectionHref(sec.topicId)} className={cn(s.link, focus)}>
                        {sec.name}
                      </Link>
                      <span className="text-muted-foreground font-normal">
                        , {past1} of {sec.modules.length} past step 1
                      </span>
                    </td>
                    <td className="text-muted-foreground font-normal">{mock === null ? "None yet" : formatPercent(mock)}</td>
                  </tr>
                  {isOpen
                    ? mods.map((m) => (
                        <tr key={m.readingId}>
                          <td className="max-w-[260px] truncate">
                            <Link href={moduleHref(sec.topicId, m.readingId)} title={m.name} className={cn(s.link, focus)}>
                              {m.name}
                            </Link>
                          </td>
                          {STEPS.map((n) => {
                            const c = cellText(m.windows.find((w) => w.step === n));
                            return (
                              <td key={n} className={c.cls}>
                                {c.text ? (
                                  <>
                                    <span className={cn(s.dot, STEP_CLASS[n], c.dot)} aria-hidden />
                                    {c.text}
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">Not planned</span>
                                )}
                              </td>
                            );
                          })}
                          <td />
                        </tr>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function CoverageTile({ p, className }: { p: Projection; className?: string }) {
  return (
    <Tile
      title="Coverage"
      className={className}
      hint="Step hours done and passed. Hatched is spent, not passed yet. Tick is plan today."
      expandedHint="Sections open into modules with the date each step was done or is due."
      expanded={<CoverageTable p={p} />}
    >
      <CoverageGrid p={p} />
    </Tile>
  );
}
