import { cn } from "@/lib/utils";
import type { Projection } from "@/lib/types";
import { accuracyTarget, budgetSplit, formatPercent, formatWeight, stepLedger, topicMetrics } from "@/lib/pace-view";
import { SEG_CLASS } from "./plan-shared";
import s from "./plan-metrics.module.css";

const n = (x: number) => x.toLocaleString("en-US");
const h = (min: number) => (min / 60).toFixed(1);
const dash = (min: number) => (min > 0 ? h(min) : "0.0");

/** Per step, then per topic: where the hours of the full plan went, in numbers. */
export function PlanLedger({ p }: { p: Projection }) {
  const rows = stepLedger(p);
  const b = budgetSplit(p);
  const target = accuracyTarget(p);
  const topics = topicMetrics(p).sort((a, c) => c.examWeight - a.examWeight);
  const widest = Math.max(1, ...rows.map((r) => r.fullMin));
  return (
    <>
      {b && rows.length ? (
        <>
          <h3 className={s.sub}>Ledger by step</h3>
          <div className={s.tw}>
            <table className={s.tbl}>
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col" className={s.n}>Full plan h</th>
                  <th scope="col" className={s.n}>Done h</th>
                  <th scope="col" className={s.n}>Scheduled h</th>
                  <th scope="col" className={s.n}>Saved by pace h</th>
                  <th scope="col" className={s.n}>Cut h</th>
                  <th scope="col">Split</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row">
                      <span className={s.stepName}>
                        <span className={cn(s.sw, SEG_CLASS[r.key])} aria-hidden />
                        {r.label}
                      </span>
                    </th>
                    <td className={s.n}>{h(r.fullMin)}</td>
                    <td className={s.n}>{dash(r.doneMin)}</td>
                    <td className={s.n}>{dash(r.aheadMin)}</td>
                    <td className={s.n}>{dash(r.paceMin)}</td>
                    <td className={s.n}>
                      {dash(r.cutMin)}
                      {r.cutMocks > 0 ? <small>{r.cutMocks} {r.cutMocks === 1 ? "mock" : "mocks"}</small> : null}
                    </td>
                    <td>
                      <div className={s.split} style={{ width: `${(r.fullMin / widest) * 150}px` }} aria-hidden>
                        {([[s.tDone, r.doneMin], [s.tAhead, r.aheadMin], [s.tPace, r.paceMin], [s.tCut, r.cutMin]] as const).map(([cls, min]) =>
                          min > 0 ? <i key={cls} className={cls} style={{ flex: min }} /> : null,
                        )}
                      </div>
                    </td>
                    <td className={s.why}>{r.why}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className={s.n}>{h(b.requiredMin)}</td>
                  <td className={s.n}>{h(b.doneMin)}</td>
                  <td className={s.n}>{h(b.aheadMin)}</td>
                  <td className={s.n}>{h(b.paceMin)}</td>
                  <td className={s.n}>{h(b.cutMin)}</td>
                  <td />
                  <td className={s.why}>Mocks cut count as two sessions each.</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : null}
      <h3 className={s.sub}>Ledger by topic</h3>
      <div className={s.tw}>
        <table className={s.tbl}>
          <thead>
            <tr>
              <th scope="col">Topic</th>
              <th scope="col" className={s.n}>Weight</th>
              <th scope="col" className={s.n}>Hours planned</th>
              <th scope="col" className={s.n}>Hours done</th>
              <th scope="col" className={s.n}>Questions required</th>
              <th scope="col" className={s.n}>Answered</th>
              <th scope="col" className={s.n}>Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((r) => (
              <tr key={r.topicId}>
                <th scope="row">{r.name}</th>
                <td className={s.n}>{formatWeight(r.examWeight)}</td>
                <td className={s.n}>{h(r.plannedMin)}</td>
                <td className={s.n}>{h(r.doneMin)}</td>
                <td className={s.n}>{n(r.required)}</td>
                <td className={s.n}>{n(r.answered)}</td>
                <td className={cn(s.n, r.below && s.low)}>
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
    </>
  );
}
