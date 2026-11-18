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
 * The four numbers on their own line under the row. Indented to sit under the
 * module name (status mark 12px + kind column 96px + three 12px gaps = 8.25rem
 * from md up, past the mark only on mobile), and wrapping, so a narrow column
 * costs height, never width.
 */
export function QuestionStatsBlock({ stats }: { stats: QuestionStats }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-0.5 pb-1.5 pl-6 text-[13px] tabular-nums md:pl-[8.25rem]">
      <StatValue stat={stats.progress} />
      {stats.total ? <StatValue stat={stats.total} /> : null}
      {stats.overall ? <StatValue stat={stats.overall} /> : null}
      {stats.round ? <StatValue stat={stats.round} /> : null}
    </div>
  );
}
