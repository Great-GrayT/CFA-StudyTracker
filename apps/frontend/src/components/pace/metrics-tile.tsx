"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { PlanTotals, Projection } from "@/lib/types";
import { accuracyTarget, calendarStrip, formatHours, formatPercent, formatWeight, hourFigures, shortDate, stepSlices, topicMetrics } from "@/lib/pace-view";
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

const anchor = (x: number): CSSProperties => (x > 70 ? { right: `${100 - x}%`, textAlign: "right" } : { left: `${x}%` });

/** Plan start to exam: holidays, today, the mock gate, mocks, and the planned load per day. */
function CalendarStrip({ p }: { p: Projection }) {
  const c = calendarStrip(p);
  return (
    <figure className={s.cal}>
      <div className={s.calPlot} role="img" aria-label={`Plan calendar. ${c.caption}`}>
        {c.today !== null ? (
          <span className={cn(s.calLab, s.calLabNow)} style={{ top: 0, ...anchor(c.today) }} aria-hidden>
            <b>Today</b>
          </span>
        ) : null}
        <span className={s.calLab} style={{ top: 0, right: `${100 - c.exam}%`, textAlign: "right" }} aria-hidden>
          <b>Exam</b> {shortDate(p.exam)}
        </span>
        {c.gate !== null ? (
          <span className={s.calLab} style={{ top: 16, right: `${100 - c.gate}%`, textAlign: "right" }} aria-hidden>
            Mocks from {shortDate(p.gate)}
          </span>
        ) : null}
        <div className={s.calTrack} />
        {c.holidays.map((h) => (
          <div
            key={h.id}
            className={cn(s.hol, h.cancelled && s.calHolX)}
            style={{ left: `${h.left}%`, width: `${h.width}%`, top: "var(--lab)", bottom: "auto", height: 28 }}
            title={`Holiday ${h.label}`}
          />
        ))}
        {c.gate !== null ? <i className={cn(s.calLine, s.gateLine)} style={{ left: `${c.gate}%` }} title={`Mocks from ${shortDate(p.gate)}`} /> : null}
        {c.today !== null ? <i className={cn(s.calLine, s.now)} style={{ left: `${c.today}%` }} title={`Today ${shortDate(p.asOf)}`} /> : null}
        <i className={cn(s.calLine, s.calExam)} style={{ left: `${c.exam}%` }} title={`Exam ${shortDate(p.exam)}`} />
        {c.mocks.map((m, i) => (
          <i key={i} className={cn(s.calDot, m.done && s.calDotDone, m.count > 1 && s.calDotMany)} style={{ left: `${m.pct}%` }} title={m.title}>
            {m.count > 1 ? m.count : null}
          </i>
        ))}
        <div className={s.calLoad} aria-hidden>
          {c.load.map((d, i) => (
            <i key={i} style={{ left: `${d.left}%`, width: `${d.width}%`, opacity: d.done ? 1 : d.opacity }} />
          ))}
        </div>
        <div className={s.calMonths} aria-hidden>
          {c.months.map((m) => (
            <span key={m.pct} style={{ left: `${m.pct}%` }}>{m.label}</span>
          ))}
        </div>
      </div>
      <figcaption className={s.calCap}>
        {c.caption} Hatched is a holiday, a ring is a planned mock, a filled dot a mock taken, solid blue is a day studied.
      </figcaption>
    </figure>
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
          <Figures p={p} t={t} target={target} />
          <StepBar t={t} />
          <TopicTable p={p} />
        </div>
      }
    >
      <CalendarStrip p={p} />
      <Figures p={p} t={t} target={target} />
      <StepBar t={t} />
      <TopicTable p={p} limit={COMPACT_ROWS} />
    </Tile>
  );
}
