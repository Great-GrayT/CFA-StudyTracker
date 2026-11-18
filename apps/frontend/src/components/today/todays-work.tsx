"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeclareSheet, type DeclareTarget } from "@/components/record/declare-sheet";
import { stepForTask } from "@/lib/record";
import { useState } from "react";
import { useProjection } from "@/lib/hooks";
import { findModule, penaltyExtraQuestions, questionStats } from "@/lib/question-stats";
import { QuestionStatsBlock } from "./question-stats";
import { useRecord } from "@/components/record/record-provider";
import { useUndoRecord } from "@/components/record/use-undo-record";
import { cn } from "@/lib/utils";
import { kindLabel, minutesShort, postponedLabel, sortCells } from "@/lib/today";
import type { PrescribedDay, PrescribedMaterial, PrescribedTask } from "@/lib/types";
import { RegionError } from "@/components/states/region-states";
import { TruncatedText } from "@/components/states/truncated-text";

const shortDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const isDone = (t: PrescribedTask) => t.status === "done" || t.status === "completed";

export function TodaysWork({
  day,
  date,
  todayISO,
  planId,
  loading,
  error,
  online,
  onRetry,
}: {
  day: PrescribedDay | undefined;
  /** The day shown, picked in the week strip. */
  date: string;
  todayISO: string;
  planId: string;
  loading: boolean;
  error: unknown;
  online: boolean;
  onRetry: () => void;
}) {
  const heading =
    date === todayISO ? "Today's work" : `Work for ${shortDay.format(new Date(`${date}T00:00:00Z`))}`;
  // A day not yet lived cannot be recorded against.
  const recordable = date <= todayISO;
  const [declare, setDeclare] = useState<DeclareTarget | null>(null);

  return (
    <section aria-labelledby="todays-work" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="todays-work" className="text-[16px] font-semibold">
          {heading}
        </h2>
        {day && day.totalMinutes > 0 ? (
          <p className="text-muted-foreground text-[13px] tabular-nums">{minutesShort(day.totalMinutes)}</p>
        ) : null}
      </div>

      {loading ? (
        <ul aria-hidden="true" className="border-border border-t">
          {[0, 1, 2].map((i) => (
            <li key={i} className="border-border flex min-h-11 items-center gap-3 border-b md:min-h-9">
              <Skeleton className="size-3 rounded-none" />
              <Skeleton className="h-3.5 w-16 rounded-sm" />
              <Skeleton className="h-3.5 flex-1 rounded-sm" />
              <Skeleton className="h-3.5 w-10 rounded-sm" />
            </li>
          ))}
        </ul>
      ) : !day && error ? (
        <RegionError error={error} online={online} onRetry={onRetry} />
      ) : !day || day.tasks.length === 0 ? (
        <p className="text-muted-foreground py-2 text-[14px]">
          Nothing scheduled for this day.{" "}
          <Link href="/plan?tab=setup" className="text-claimed-ink underline underline-offset-4">
            Set your study hours
          </Link>
        </p>
      ) : (
        <ul className="border-border border-t">
          {sortCells(day.tasks).map((task) => (
            <WorkRow
              key={task.id}
              task={task}
              date={date}
              planId={planId}
              recordable={recordable}
              onDeclare={setDeclare}
            />
          ))}
        </ul>
      )}
      <DeclareSheet planId={planId} target={declare} onOpenChange={(o) => !o && setDeclare(null)} />
    </section>
  );
}

function WorkRow({
  task,
  date,
  planId,
  recordable,
  onDeclare,
}: {
  task: PrescribedTask;
  date: string;
  planId: string;
  recordable: boolean;
  onDeclare: (t: DeclareTarget) => void;
}) {
  const record = useRecord();
  const { undo, pending } = useUndoRecord(planId);
  const done = isDone(task);
  const partial = task.status === "partial";
  const recorded = done || partial;
  const moduleName = [task.topicName, task.moduleTitle].filter(Boolean).join(", ") || "Unassigned work";
  const step = stepForTask(task);
  const readingId = task.readingIds[0];
  // Question rows of step 2 and 4 carry the module's numbers; the projection is shared across rows.
  const statStep = task.kind === "questions" && (step === 2 || step === 4) ? step : null;
  const projection = useProjection(statStep && readingId ? planId : undefined);
  const mod = statStep ? findModule(projection.data, readingId) : undefined;
  const stats = statStep
    ? questionStats(
        statStep,
        statStep === 2 ? mod?.performance.s2 : mod?.performance.s4,
        mod?.totals,
        mod?.performance.s2,
        mod?.performance.s4,
        penaltyExtraQuestions(task),
      )
    : null;
  const canDeclare = !recorded && !task.offPlan && step !== null && !!readingId;

  return (
    <li className="border-border border-b">
    {/* The main line is the same for every row; stats never share it, so they cannot squeeze the name. */}
    <div
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-1.5 md:min-h-9 md:flex-nowrap md:py-1",
        // Settles into its recorded look rather than snapping.
        "transition-colors duration-(--dur-move) ease-(--ease-settle) motion-reduce:transition-none",
      )}
    >
      {/* Data mark: empty square planned, half partway, full done. */}
      <span
        aria-hidden="true"
        className={cn(
          "border-foreground/60 relative size-3 shrink-0 border",
          done && "bg-primary border-primary",
          partial && "border-primary bg-[linear-gradient(to_top,var(--claimed)_50%,transparent_50%)]",
        )}
      />
      <span className="text-muted-foreground w-24 shrink-0 text-[13px] max-md:w-auto">{kindLabel(task.kind)}</span>

      <span className="flex min-w-0 flex-1 basis-40 items-center gap-2">
        <TruncatedText text={moduleName} className={cn("text-[14px]", recorded && "text-muted-foreground")} />
      </span>

      {task.postponedFrom || task.offPlan ? (
        <span className="flex shrink-0 gap-1.5 max-md:order-last max-md:basis-full max-md:pl-6">
          {task.postponedFrom ? (
            <Badge variant="outline" className="rounded-sm px-1.5 text-[12px] font-medium">
              {postponedLabel(task.postponedFrom)}
            </Badge>
          ) : null}
          {task.offPlan ? (
            <Badge variant="outline" className="text-muted-foreground rounded-sm px-1.5 text-[12px] font-medium">
              Off plan
            </Badge>
          ) : null}
        </span>
      ) : null}

      <span className="text-muted-foreground shrink-0 text-right text-[13px] tabular-nums md:w-24">
        {done
          ? `done ${minutesShort(task.actualMinutes ?? task.estimatedMinutes)}`
          : partial
            ? `${minutesShort(task.actualMinutes ?? 0)} of ${minutesShort(task.estimatedMinutes)}`
            : minutesShort(task.estimatedMinutes)}
      </span>

      <span className="flex shrink-0 items-center gap-1">
        {canDeclare ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground rounded-sm text-[13px] max-md:h-11"
            onClick={() => onDeclare({ readingId, moduleName, step })}
            aria-label={`Did this before: ${moduleName}`}
          >
            Did this before
          </Button>
        ) : null}
        <Materials materials={task.materials} moduleName={moduleName} />
        {recorded ? (
          task.offPlan ? (
            // An off-plan cell is the record itself; undoing it would leave a
            // pending cell the plan never asked for.
            <span className="w-16" />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-16 rounded-sm text-[13px] max-md:h-11"
              disabled={pending}
              onClick={() => void undo(task.id)}
              aria-label={`Undo record of ${moduleName}`}
            >
              Undo
            </Button>
          )
        ) : recordable ? (
          <Button
            variant="outline"
            size="sm"
            className="w-16 rounded-sm text-[13px] max-md:h-11"
            onClick={() => record.open({ taskId: task.id, date })}
            aria-label={`Record ${kindLabel(task.kind).toLowerCase()} for ${moduleName}`}
          >
            Record
          </Button>
        ) : (
          <span className="w-16" />
        )}
      </span>
    </div>
    {stats ? <QuestionStatsBlock stats={stats} /> : null}
    </li>
  );
}

function Materials({ materials, moduleName }: { materials: PrescribedMaterial[]; moduleName: string }) {
  if (materials.length === 0) return <span className="size-8 max-md:size-11" />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-8 rounded-sm max-md:size-11"
          aria-label={`Materials for ${moduleName}`}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[min(22rem,calc(100vw-2rem))]">
        {materials.map((m, i) => {
          const meta = [
            m.questionCount !== null
              ? m.action === "Review answers"
                ? `answers to ${m.questionCount} questions`
                : `${m.questionCount} questions`
              : null,
            m.packageName || null,
          ]
            .filter(Boolean)
            .join(", ");
          const body = (
            <span className="flex min-w-0 flex-col">
              <span className="truncate">
                {m.action ? `${m.action} ` : ""}
                {m.label}
              </span>
              {meta ? <span className="text-muted-foreground truncate text-[12px]">{meta}</span> : null}
            </span>
          );
          return m.url ? (
            <DropdownMenuItem key={i} asChild>
              <a href={m.url} target="_blank" rel="noopener noreferrer">
                {body}
              </a>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={i} disabled>
              {body}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
