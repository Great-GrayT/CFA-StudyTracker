"use client";

import { cn } from "@/lib/utils";
import type { PlanTotals, Projection } from "@/lib/types";
import { accuracyTarget, dailyNeed, formatHours, formatPercent, stepSlices, topicMetrics } from "@/lib/pace-view";
import { Tile } from "./tile";
import s from "./pace.module.css";

const COMPACT_ROWS = 5;
const STEP_CLASS = { "1": s.s1, "2": s.s2, "3": s.s3, "4": s.s4, "5": s.s5 } as const;
const n = (x: number) => x.toLocaleString("en-US");

function Figures({ t, target }: { t: PlanTotals; target: number }) {
  const need = dailyNeed(t);
  const q = t.questions;
  const acc = q.answered > 0 ? q.correct / q.answered : null;
  const low = acc !== null && q.correct * 100 < target * q.answered;
  return (
    <dl className={s.mFig}>
      <div>
        <dt>Hours required</dt>
        <dd>{formatHours(t.requiredMin)}</dd>
      </div>
      <div>
        <dt>Hours done</dt>
        <dd>{formatHours(t.doneMin)}</dd>
      </div>
      <div>
        <dt>Hours left</dt>
        <dd>{formatHours(t.leftMin)}<small>{t.daysLeft} days to the exam</small></dd>
      </div>
      <div>
        <dt>Hours per day, needed</dt>
        <dd className={cn(need.short && s.mShort)}>
          {formatHours(need.needed)}
          <small>
            {need.short
              ? `Over the ${formatHours(need.available)} a day you have: ${formatHours(need.needed - need.available)} short`
              : `Within the ${formatHours(need.available)} a day you have`}
          </small>
        </dd>
      </div>
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

function StepBar({ t }: { t: PlanTotals }) {
  const slices = stepSlices(t).filter((x) => x.requiredMin > 0);
  const summary = slices.map((x) => `${x.label} ${formatHours(x.doneMin)} of ${formatHours(x.requiredMin)}`).join(", ");
  return (
    <>
      <ul className={s.mBar} role="img" aria-label={`Required hours by step. ${summary}.`}>
        {slices.map((x) => (
          <li key={x.key} className={STEP_CLASS[x.key]} style={{ flexBasis: `${x.width}%` }}>
            <i style={{ width: `${x.done * 100}%` }} />
          </li>
        ))}
      </ul>
      <ul className={s.mKey} aria-hidden>
        {slices.map((x) => (
          <li key={x.key} className={STEP_CLASS[x.key]}>
            <i />
            {x.label} {formatHours(x.requiredMin)}
          </li>
        ))}
        <li>Solid is done, faded is left</li>
      </ul>
    </>
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
              <td>{r.examWeight}%</td>
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
          <Figures t={t} target={target} />
          <StepBar t={t} />
          <TopicTable p={p} />
        </div>
      }
    >
      <Figures t={t} target={target} />
      <StepBar t={t} />
      <TopicTable p={p} limit={COMPACT_ROWS} />
    </Tile>
  );
}
