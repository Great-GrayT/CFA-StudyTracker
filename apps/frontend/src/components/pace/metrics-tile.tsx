"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import type { PlanTotals, Projection } from "@/lib/types";
import { accuracyTarget, formatHours, formatPercent, formatWeight, hourFigures, planVsSchedule, topicMetrics } from "@/lib/pace-view";
import { CalendarStrip } from "./calendar-strip";
import { Tile } from "./tile";
import s from "./pace.module.css";

const COMPACT_ROWS = 5;
const STEP_CLASS = { "1": s.s1, "2": s.s2, "3": s.s3, "4": s.s4, "5": s.s5 } as const;
const n = (x: number) => x.toLocaleString("en-US");

function Figures({ p, t, target }: { p: Projection; t: PlanTotals; target: number }) {
  const f = hourFigures(p);
  const q = t.questions;
  const acc = q.answered > 0 ? q.correct / q.answered : null;
  const low = acc !== null && q.correct * 100 < target * q.answered;
  const perDay = (h: number, over: boolean) => (
    <>
      {formatHours(h)}
      <small>
        {over
          ? `Over the ${formatHours(f!.available)} a day you have: ${formatHours(h - f!.available)} short`
          : `Within the ${formatHours(f!.available)} a day you have`}
      </small>
    </>
  );
  return (
    <dl className={s.mFig}>
      {f ? (
        <>
          <div>
            <dt>Required, full rules</dt>
            <dd>{formatHours(f.required)}</dd>
          </div>
          <div>
            <dt>Scheduled to the exam</dt>
            <dd>{formatHours(f.scheduled)}<small>{t.daysLeft} days to the exam</small></dd>
          </div>
          <div>
            <dt>Done</dt>
            <dd>{formatHours(f.done)}</dd>
          </div>
          <div>
            <dt>Left on schedule</dt>
            <dd>{formatHours(f.left)}</dd>
          </div>
          <div>
            <dt>Not in schedule</dt>
            <dd className={cn(f.unscheduled > 0 && s.mShort)}>
              {formatHours(f.unscheduled)}
              {f.reason ? <small>{f.reason}</small> : null}
            </dd>
          </div>
          {f.workDays > 0 ? (
            <>
              <div>
                <dt>Hours per day, on schedule</dt>
                <dd className={cn(f.shortSchedule && s.mShort)}>{perDay(f.perDaySchedule, f.shortSchedule)}</dd>
              </div>
              <div>
                <dt>Hours per day, to finish everything</dt>
                <dd className={cn(f.shortAll && s.mShort)}>{perDay(f.perDayAll, f.shortAll)}</dd>
              </div>
            </>
          ) : null}
        </>
      ) : null}
      <div>
        <dt>Questions answered</dt>
        <dd>{n(q.answered)} of {n(q.required)}</dd>
      </div>
      <div>
        <dt>Accuracy</dt>
        <dd className={cn(low && s.mShort)}>
          {acc === null ? "Not yet" : formatPercent(acc)}
          <small>
            {acc === null ? `Target ${target}%` : `${low ? "Below" : "Meets"} the ${target}% target`}
          </small>
        </dd>
      </div>
    </dl>
  );
}

/** What the plan originally asked for per step against what the schedule holds; hatched is cut. */
function PlanVsSchedule({ p }: { p: Projection }) {
  const id = useId();
  const v = planVsSchedule(p);
  if (!v) return null;
  return (
    <section className={s.pv} aria-labelledby={id}>
      <h3 id={id}>Original plan vs your schedule</h3>
      <ul>
        {v.rows.map((r) => (
          <li key={r.key} className={STEP_CLASS[r.key]}>
            <span className={s.pvName}>{r.label}</span>
            <span className={cn(s.pvBar, r.whole && s.pvWhole)} aria-hidden>
              <i style={{ width: `${r.kept * 100}%` }} />
            </span>
            <span className={cn(s.pvTxt, !r.whole && s.pvCut)}>{r.text}</span>
          </li>
        ))}
      </ul>
      {v.note ? <p className={s.pvNote}>{v.note}</p> : null}
      <p className={s.pvKey}>Solid is scheduled, hatched is cut. Full width is the original requirement.</p>
    </section>
  );
}

function TopicTable({ p, limit }: { p: Projection; limit?: number }) {
  const target = accuracyTarget(p);
  const all = topicMetrics(p).sort((a, b) => b.examWeight - a.examWeight);
  const rows = limit ? all.slice(0, limit) : all;
  return (
    <div className={s.mScroll}>
      <table className={s.mTbl}>
        <caption>
          {limit && all.length > limit ? `Topics by exam weight, top ${limit} of ${all.length}` : "Topics by exam weight"}
        </caption>
        <thead>
          <tr>
            <th scope="col">Topic</th>
            <th scope="col">Weight</th>
            <th scope="col">Hours planned</th>
            <th scope="col">Hours done</th>
            <th scope="col">Questions required</th>
            <th scope="col">Answered</th>
            <th scope="col">Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.topicId}>
              <th scope="row" className="font-normal">{r.name}</th>
              <td>{formatWeight(r.examWeight)}</td>
              <td>{formatHours(r.plannedMin)}</td>
              <td>{formatHours(r.doneMin)}</td>
              <td>{n(r.required)}</td>
              <td>{n(r.answered)}</td>
              <td className={cn(r.below && s.mLow)}>
                {r.accuracy === null ? "Not yet" : formatPercent(r.accuracy)}
                {r.below ? (
                  <>
                    <span aria-hidden> ▼</span>
                    <span className="sr-only"> below the {target}% target</span>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the plan asks for in hours and questions, what is done, and where each topic stands. */
export function MetricsTile({ p, className }: { p: Projection; className?: string }) {
  const t = p.totals;
  if (!t) return null;
  const target = accuracyTarget(p);
  return (
    <Tile
      title="Plan metrics"
      hint="What the plan requires, what is done, and what is left."
      className={className}
      expandedHint="Every topic with its hours and questions."
      expanded={
        <div className="min-h-0 flex-1 overflow-auto">
          <CalendarStrip p={p} />
          <PlanVsSchedule p={p} />
          <Figures p={p} t={t} target={target} />
          <TopicTable p={p} />
        </div>
      }
    >
      <CalendarStrip p={p} />
      <PlanVsSchedule p={p} />
      <Figures p={p} t={t} target={target} />
      <TopicTable p={p} limit={COMPACT_ROWS} />
    </Tile>
  );
}
