"use client";

import { Fragment } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Projection, ProjectionSection, Tally } from "@/lib/types";
import {
  STEP_LABEL,
  accuracy,
  formatHours,
  formatPercent,
  moduleHref,
  perfRows,
  reasonText,
  sectionHref,
  taskHref,
} from "@/lib/pace-view";
import { Tile } from "./tile";
import s from "./pace.module.css";

// Bars follow the plan's own step rules, falling back to the engine defaults.
const barQ = (p: Projection) => (p.rules?.accuracyTarget ?? 80) / 100;
const barMock = (p: Projection) => (p.rules?.mockPassTarget ?? 75) / 100;
const focus = "focus-visible:ring-ring rounded-sm outline-hidden focus-visible:ring-2";

/** Clear of the bar is green, within 5 points amber, below is red. */
function tone(a: number, bar: number): string {
  return a >= bar ? "var(--strong)" : a >= bar - 0.05 ? "var(--gate)" : "var(--alarm)";
}

function Score({ t, bar, label, empty }: { t: Tally | null; bar: number; label: string; empty: string }) {
  const a = accuracy(t);
  if (a === null) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className={s.cell} role="img" aria-label={`${label} ${formatPercent(a)}, ${t!.answered} questions, bar ${formatPercent(bar)}`}>
      <span className={s.meter}>
        <i style={{ width: `${a * 100}%`, background: tone(a, bar) }} />
        <s style={{ left: `calc(${bar * 100}% - 1px)` }} />
      </span>
      <span className="tabular-nums">{formatPercent(a)}</span>
    </span>
  );
}

function hasData(sec: ProjectionSection): boolean {
  const x = sec.performance;
  return !!(x.initial || x.review || x.mocks || x.extras.tasks > 0);
}

function Rows({ p }: { p: Projection }) {
  const active = p.sections.filter(hasData);
  const idle = p.sections.length - active.length;
  const lowest = (sec: ProjectionSection) => {
    const a = accuracy(sec.performance.initial);
    return a !== null && a < barQ(p) - 0.05;
  };
  return (
    <div className={s.pr}>
      <span className="text-muted-foreground">Section</span>
      <span className="text-muted-foreground">Initial Q</span>
      <span className="text-muted-foreground">Review Q</span>
      <span className={"text-muted-foreground max-[759px]:hidden"}>Mocks</span>
      <span className="text-muted-foreground">Extras</span>
      {active.map((sec) => (
        <Fragment key={sec.topicId}>
          <Link href={sectionHref(sec.topicId)} title={sec.name} className={cn(s.link, focus, "truncate max-md:py-3", lowest(sec) && "text-alarm-ink")}>
            {sec.name}
          </Link>
          <Score t={sec.performance.initial} bar={barQ(p)} label={`${sec.name} initial`} empty="Not yet" />
          <Score t={sec.performance.review} bar={barQ(p)} label={`${sec.name} review`} empty="Not yet" />
          <span className="max-[759px]:hidden">
            <Score t={sec.performance.mocks} bar={barMock(p)} label={`${sec.name} mocks`} empty="Not yet" />
          </span>
          {sec.performance.extras.tasks > 0 ? (
            <Link href="/today" className={cn(s.link, focus, "text-alarm-ink whitespace-nowrap")}>
              {sec.performance.extras.tasks} · {formatHours(sec.performance.extras.minutes)}
            </Link>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Fragment>
      ))}
      {idle > 0 ? <span className="text-muted-foreground col-span-full">{idle} more, not started</span> : null}
    </div>
  );
}

function Expanded({ p }: { p: Projection }) {
  const rows = perfRows(p);
  const scored = new Set(rows.map((r) => r.readingId));
  const modules = new Map(p.sections.flatMap((sec) => sec.modules.map((m) => [m.readingId, { m, sec }] as const)));
  const orphans = p.extras.filter((e) => !scored.has(e.readingId));
  const totalMin = p.extras.reduce((a, e) => a + e.minutes, 0);
  const questions = p.extras.reduce((a, e) => a + (e.questions ?? 0), 0);
  return (
    <>
      <p className="text-muted-foreground text-[12.5px]">
        {p.extras.length} extra {p.extras.length === 1 ? "task" : "tasks"}, {formatHours(totalMin)} added this plan
        {questions > 0 ? `, ${questions} extra questions` : ""}.
      </p>
      <div className={cn(s.panel, s.perf)} tabIndex={0} role="region" aria-label="Per-module question performance">
        <table className={s.tbl}>
          <caption className="sr-only">
            Each module with question attempts: step, answered, correct, accuracy, whether the practice time was enough,
            and any extra task with the reason it was added
          </caption>
          <thead>
            <tr>
              <th scope="col">Module</th>
              <th scope="col">Step</th>
              <th scope="col">Answered</th>
              <th scope="col">Correct</th>
              <th scope="col">Accuracy</th>
              <th scope="col">Enough?</th>
              <th scope="col">Extras and why</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-muted-foreground">
                  No questions answered yet. Modules appear here after their first attempt.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className={s.stickyCol}>
                  <Link href={moduleHref(r.topicId, r.readingId)} className={cn(s.link, focus)}>
                    {r.label}
                  </Link>
                </th>
                <td className="tabular-nums">{STEP_LABEL[r.step]}</td>
                <td className="tabular-nums">{r.answered}</td>
                <td className="tabular-nums">{r.correct}</td>
                <td className={cn("tabular-nums", r.low && "text-alarm-ink")}>{formatPercent(r.accuracy)}</td>
                <td className={cn("tabular-nums", !r.enough && "text-alarm-ink")}>
                  {r.enough ? "Yes" : "No"}, {r.minutes} of {r.adequateMin} min
                </td>
                <td className="whitespace-normal">
                  {r.extras.length === 0 ? (
                    <span className="text-muted-foreground">Passed first try</span>
                  ) : (
                    r.extras.map((e, i) => (
                      <div key={`${e.taskId ?? "x"}${i}`} className="min-w-[220px] py-0.5">
                        {e.taskId ? (
                          <Link href={taskHref(e.taskId)} className={cn(s.link, focus, "text-alarm-ink")}>
                            {e.text}
                          </Link>
                        ) : (
                          <span className="text-alarm-ink">{e.text}</span>
                        )}
                        <div className="text-muted-foreground text-[11.5px]">{e.reason}</div>
                      </div>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {orphans.length > 0 ? (
        <div className={s.panel}>
          <table className={s.tbl}>
            <caption className="sr-only">Extra tasks on modules with no scored questions</caption>
            <thead>
              <tr>
                <th scope="col">Other extras</th>
                <th scope="col">Step</th>
                <th scope="col">Size</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {orphans.map((e, i) => {
                const hit = modules.get(e.readingId);
                const label = hit ? `${hit.sec.name} · ${hit.m.name}` : "Module";
                return (
                  <tr key={`${e.taskId ?? "x"}${i}`}>
                    <td className="max-w-[300px] truncate">
                      {e.taskId ? (
                        <Link href={taskHref(e.taskId)} className={cn(s.link, focus, "text-alarm-ink")}>
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                    </td>
                    <td>{STEP_LABEL[e.step as 1] ?? e.step}</td>
                    <td>
                      {e.questions ? `${e.questions} questions, ` : ""}
                      {formatHours(e.minutes)}
                    </td>
                    <td className="whitespace-normal">{reasonText(e.reason)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

export function PerformanceTile({ p, className }: { p: Projection; className?: string }) {
  return (
    <Tile
      title="Performance"
      className={className}
      hint="Tick is the bar to clear: 80% on questions, 75% on mocks. Extras are tasks added because a bar was missed."
      expandedHint="Every module with question attempts: score, whether the practice time was enough, and any extra task with its reason."
      expanded={<Expanded p={p} />}
    >
      <Rows p={p} />
    </Tile>
  );
}
