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
  reasonText,
  sectionHref,
  taskHref,
} from "@/lib/pace-view";
import { Tile } from "./tile";
import s from "./pace.module.css";

const BAR_Q = 0.8;
const BAR_MOCK = 0.75;
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
    return a !== null && a < BAR_Q - 0.05;
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
          <Score t={sec.performance.initial} bar={BAR_Q} label={`${sec.name} initial`} empty="Not yet" />
          <Score t={sec.performance.review} bar={BAR_Q} label={`${sec.name} review`} empty="Not yet" />
          <span className="max-[759px]:hidden">
            <Score t={sec.performance.mocks} bar={BAR_MOCK} label={`${sec.name} mocks`} empty="Not yet" />
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
  const modules = new Map(p.sections.flatMap((sec) => sec.modules.map((m) => [m.readingId, { m, sec }] as const)));
  const totalMin = p.extras.reduce((a, e) => a + e.minutes, 0);
  const questions = p.extras.reduce((a, e) => a + (e.questions ?? 0), 0);
  return (
    <>
      <p className="text-muted-foreground text-[12.5px]">
        {p.extras.length} extra {p.extras.length === 1 ? "task" : "tasks"}, {formatHours(totalMin)} added this plan
        {questions > 0 ? `, ${questions} extra questions` : ""}.
      </p>
      <div className={s.panel}>
        <table className={s.tbl}>
          <caption className="sr-only">Question scores per section, then each extra task and why it exists</caption>
          <thead>
            <tr>
              <th scope="col">Section</th>
              <th scope="col">Initial</th>
              <th scope="col">Review</th>
              <th scope="col">Mocks</th>
              <th scope="col">Extras</th>
            </tr>
          </thead>
          <tbody>
            {p.sections.map((sec) => {
              const cell = (t: Tally | null) => {
                const a = accuracy(t);
                return a === null ? (
                  <span className="text-muted-foreground">Not yet</span>
                ) : (
                  <span>
                    {formatPercent(a)}, {t!.correct} of {t!.answered}
                  </span>
                );
              };
              return (
                <tr key={sec.topicId}>
                  <td>
                    <Link href={sectionHref(sec.topicId)} className={cn(s.link, focus)}>
                      {sec.name}
                    </Link>
                  </td>
                  <td>{cell(sec.performance.initial)}</td>
                  <td>{cell(sec.performance.review)}</td>
                  <td>{cell(sec.performance.mocks)}</td>
                  <td>
                    {sec.performance.extras.tasks > 0
                      ? `${sec.performance.extras.tasks}, ${formatHours(sec.performance.extras.minutes)}`
                      : <span className="text-muted-foreground">None</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={s.panel}>
        <table className={s.tbl}>
          <caption className="sr-only">Extra tasks with the module, step and reason</caption>
          <thead>
            <tr>
              <th scope="col">Extra task</th>
              <th scope="col">Step</th>
              <th scope="col">Size</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {p.extras.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted-foreground">
                  No extra tasks. Every step cleared its bar.
                </td>
              </tr>
            ) : null}
            {p.extras.map((e, i) => {
              const hit = modules.get(e.readingId);
              const label = hit ? `${hit.sec.name} · ${hit.m.name}` : "Module";
              return (
                <tr key={`${e.taskId ?? "x"}${i}`}>
                  <td className="max-w-[300px] truncate">
                    {e.taskId ? (
                      <Link href={taskHref(e.taskId)} className={cn(s.link, focus, "text-alarm-ink")}>
                        {label}
                      </Link>
                    ) : hit ? (
                      <Link href={moduleHref(hit.sec.topicId, e.readingId)} className={cn(s.link, focus)}>
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
    </>
  );
}

export function PerformanceTile({ p, className }: { p: Projection; className?: string }) {
  return (
    <Tile
      title="Performance"
      className={className}
      hint="Tick is the bar to clear: 80% on questions, 75% on mocks. Extras are tasks added because a bar was missed."
      expandedHint="Scores per section, then every extra task with the reason it was added."
      expanded={<Expanded p={p} />}
    >
      <Rows p={p} />
    </Tile>
  );
}
