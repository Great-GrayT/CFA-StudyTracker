import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Projection } from "@/lib/types";
import { formatHours, formatReadiness, owedMinutes, sectionHref, shortDate, weakestSection, formatPercent } from "@/lib/pace-view";
import s from "./pace.module.css";

const big = "text-[18px] leading-none font-semibold tabular-nums";
// Every figure is a link or plain text; a link keeps the 44px touch row on phone.
const cell = "flex min-w-0 flex-col gap-0.5 max-md:min-h-11";

/** Readiness against plan, hours behind, mocks, extras, weakest section. Each names its page. */
export function VerdictStrip({ p }: { p: Projection }) {
  const today = p.asOf.slice(0, 10);
  const behind = owedMinutes(p.daily, today);
  const extraMin = p.extras.reduce((a, e) => a + e.minutes, 0);
  const weak = weakestSection(p.sections);
  const slow = p.readiness < p.readinessPlanToday - 0.0005;
  const mocksTotal = p.mocks.done + p.mocks.planned;
  const link = cn(s.link, "focus-visible:ring-ring rounded-sm outline-hidden focus-visible:ring-2");
  return (
    <section aria-label="Verdict" className="grid grid-cols-2 gap-x-6 gap-y-3 px-0.5 md:flex md:flex-wrap md:items-baseline md:gap-x-8">
      <div className={cell}>
        <span className={cn(big, slow ? "text-alarm-ink" : "text-strong")}>{formatReadiness(p.readiness)}</span>
        <span className="text-muted-foreground text-[12px]">ready, plan today {formatReadiness(p.readinessPlanToday)}</span>
      </div>
      <Link href="/plan?tab=calendar" className={cn(cell, link)}>
        <span className={cn(big, behind > 0 ? "text-alarm-ink" : "text-strong")}>
          {behind > 0 ? formatHours(behind) : "On plan"}
        </span>
        <span className="text-muted-foreground text-[12px]">{behind > 0 ? "behind" : "no hours owed"}</span>
      </Link>
      <Link href="/progress?tab=mocks" className={cn(cell, link)}>
        <span className={big}>
          {p.mocks.done} / {mocksTotal}
        </span>
        <span className="text-muted-foreground text-[12px]">
          mock sessions{p.mocks.firstDate ? `, first ${shortDate(p.mocks.firstDate)}` : ""}
        </span>
      </Link>
      <Link href="/today" className={cn(cell, link)}>
        <span className={cn(big, p.extras.length > 0 && "text-alarm-ink")}>
          {p.extras.length}
          <span className="text-[13px] font-normal"> extra {p.extras.length === 1 ? "task" : "tasks"}</span>
        </span>
        <span className="text-muted-foreground text-[12px]">{formatHours(extraMin)} added</span>
      </Link>
      <div className={cell}>
        {weak ? (
          <Link href={sectionHref(weak.topicId)} className={cn(big, link, "text-alarm-ink")}>
            {weak.name} {formatPercent(weak.accuracy)}
          </Link>
        ) : (
          <span className={cn(big, "text-muted-foreground")}>None yet</span>
        )}
        <span className="text-muted-foreground text-[12px]">weakest section</span>
      </div>
    </section>
  );
}
