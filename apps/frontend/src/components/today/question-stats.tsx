"use client";

import { Check, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Stat } from "@/lib/question-stats";
import type { QuestionStats } from "@/lib/question-stats";

/**
 * One number with its verdict. Colour is never the only cue: a check or cross
 * and a spoken "met" or "not met" ride with it. Focusable so the rule behind
 * the number is reachable from a keyboard, not only on hover.
 */
export function StatValue({ stat, className }: { stat: Stat; className?: string }) {
  const verdict = stat.met === null ? null : stat.met ? "met" : "not met";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="group"
          aria-label={`${stat.text}${verdict ? `, ${verdict}` : ""}. ${stat.hint}`}
          className={cn(
            "focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm whitespace-nowrap outline-hidden focus-visible:ring-2",
            stat.met === true && "text-strong",
            stat.met === false && "text-alarm-ink",
            stat.met === null && "text-muted-foreground",
            className,
          )}
        >
          {stat.met === true ? <Check aria-hidden="true" className="size-3 shrink-0" /> : null}
          {stat.met === false ? <X aria-hidden="true" className="size-3 shrink-0" /> : null}
          <span aria-hidden="true">{stat.text}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-xs">
        {stat.hint}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Desktop: three columns (n / m, module total, rates stacked). Below lg the
 * block drops to its own line under the row, indented past the status mark.
 */
export function QuestionStatsBlock({ stats }: { stats: QuestionStats }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-start gap-x-4 text-[13px] tabular-nums",
        "max-lg:order-last max-lg:basis-full max-lg:flex-wrap max-lg:pl-6",
      )}
    >
      <StatValue stat={stats.progress} className="lg:w-20" />
      {stats.total ? <StatValue stat={stats.total} className="lg:w-20" /> : <span className="lg:w-20" />}
      <span className="flex flex-col gap-0.5 lg:w-28">
        {stats.overall ? <StatValue stat={stats.overall} /> : null}
        {stats.round ? <StatValue stat={stats.round} /> : null}
      </span>
    </span>
  );
}
