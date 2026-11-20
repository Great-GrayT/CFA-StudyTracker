import { cn } from "@/lib/utils";
import type { Projection } from "@/lib/types";
import { budgetSplit, budgetTicks, formatHours, hourFigures } from "@/lib/pace-view";
import s from "./plan-metrics.module.css";

/** Every hour of the full plan in one bar: done, still ahead, saved by the faster pace, cut. */
export function BudgetBar({ p }: { p: Projection }) {
  const b = budgetSplit(p);
  const f = hourFigures(p);
  if (!b || !f || b.requiredMin <= 0) return null;
  const answered = p.totals?.questions.answered ?? 0;
  const crash = p.fit.crash;
  const cutBits = [
    b.cutReviewMin > 0 ? `${formatHours(b.cutReviewMin)} of review questions` : "",
    b.cutMocks > 0 ? `${b.cutMocks} ${b.cutMocks === 1 ? "mock" : "mocks"}` : "",
  ].filter(Boolean);
  const label = `Of ${formatHours(b.requiredMin)}: ${formatHours(b.doneMin)} done, ${formatHours(b.aheadMin)} scheduled ahead, ${formatHours(b.paceMin)} saved by faster pace, ${formatHours(b.cutMin)} cut`;
  const cards = [
    { cls: s.tDone, name: "Done", min: b.doneMin, text: answered > 0 ? `Logged so far, ${answered.toLocaleString("en-US")} questions answered.` : "Logged so far." },
    { cls: s.tAhead, name: "Scheduled ahead", min: b.aheadMin, text: f.workDays > 0 ? `Left on the schedule, about ${formatHours(f.perDaySchedule)} a day.` : "Left on the schedule." },
    {
      cls: s.tPace, name: "Saved by faster pace", min: b.paceMin,
      text: b.paceMin <= 0 ? "Nothing saved. Study runs at your normal pace." : crash > 1.001 ? `Study runs at ${(Math.round(crash * 10) / 10).toString()}x your normal pace, so the same work takes less time. Nothing dropped.` : "Work the schedule fits into fewer hours than the plan states.",
    },
    { cls: s.tCut, name: "Cut", min: b.cutMin, text: cutBits.length ? `${cutBits.join(" and ")}, lowest exam weight first.` : "Nothing cut." },
  ];
  const parts: [string, number, string, string?][] = [
    [s.tDone, b.doneMin, ""],
    [s.tAhead, b.aheadMin, `Scheduled ahead ${formatHours(b.aheadMin)}`, "in"],
    [s.tPace, b.paceMin, `Saved by pace ${formatHours(b.paceMin)}`, "lab"],
    [s.tCut, b.cutMin, `Cut ${formatHours(b.cutMin)}`, "lab"],
  ];
  return (
    <section aria-label="Hour budget">
      <div className={s.bb}>
        <div className={s.bbDone}>Done {formatHours(b.doneMin)}</div>
        <div className={s.bbBar} role="img" aria-label={label}>
          {parts.map(([cls, min, text, kind]) =>
            min > 0 ? (
              <div key={cls} className={cls} style={{ flex: min }} title={text || undefined}>
                {kind === "lab" ? <span className={s.lab}>{text}</span> : kind ? <span className={s.in}>{text}</span> : null}
              </div>
            ) : null,
          )}
        </div>
        <div className={s.bbTicks} aria-hidden>
          {budgetTicks(b.requiredMin).map((h, i, all) => (
            <span key={h} style={{ left: `${((h * 60) / b.requiredMin) * 100}%` }}>
              {Math.round(h)} h{i === all.length - 1 ? " in the full plan" : ""}
            </span>
          ))}
        </div>
      </div>
      <ul className={s.bbLeg}>
        {cards.map((c) => (
          <li key={c.name}>
            <span className={cn(s.sw, c.cls)} aria-hidden />
            {c.name}
            <b>{formatHours(c.min)}</b>
            <p>{c.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
