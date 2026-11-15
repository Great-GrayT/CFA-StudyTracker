"use client";

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { daysLeft, minutesShort, zoneSuffix } from "@/lib/today";
import type { PrescribedDay } from "@/lib/types";

// Calendar dates are UTC midnights; formatting in UTC keeps the day from
// shifting west of Greenwich.
const longDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function clockLabel(ms: number): string {
  const minutes = Math.ceil(ms / 60000);
  return minutesShort(minutes);
}

export function DayHeader({
  todayISO,
  examDate,
  day,
  loading,
  msLeft,
  debrief,
  timeZone,
}: {
  todayISO: string;
  examDate: string;
  /** Today's cells; undefined while loading or when the fetch failed. */
  day: PrescribedDay | undefined;
  loading: boolean;
  /** Until the day closes at the debrief; null until the clock mounts. */
  msLeft: number | null;
  debrief: string;
  /** The plan's zone, which the debrief time is wall time in. */
  timeZone: string;
}) {
  // Device zone is only known in the browser; read after mount.
  const [zone, setZone] = useState("");
  useEffect(() => {
    setZone(zoneSuffix(timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone));
  }, [timeZone]);
  const at = `${debrief}${zone}`;
  const left = daysLeft(examDate, todayISO);
  const planned = day?.totalMinutes ?? 0;
  const done = Math.min(day?.doneMinutes ?? 0, planned);
  const owed = planned - done;
  const closed = msLeft !== null && msLeft <= 0;
  // Less clock than work left: the one moment this line should look urgent.
  const tight = msLeft !== null && !closed && owed > 0 && msLeft / 60000 < owed;

  return (
    <header className="flex flex-col gap-3 pb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.01em]">
          {longDay.format(new Date(`${todayISO}T00:00:00Z`))}
        </h1>
        <p className="text-muted-foreground text-[14px] tabular-nums">
          <span className="text-foreground text-[20px] font-semibold [font-stretch:87.5%]">{left}</span>{" "}
          {left === 1 ? "day" : "days"} to the exam
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-4 w-56 rounded-sm" />
          <Skeleton className="h-1.5 w-full max-w-md rounded-none" />
        </div>
      ) : (
        <div className="flex max-w-md flex-col gap-2">
          <p className="text-[14px] tabular-nums">
            {planned === 0 ? (
              <span className="text-muted-foreground">Nothing planned today</span>
            ) : (
              <>
                {minutesShort(planned)} planned, {minutesShort(done)} done
              </>
            )}
          </p>
          {planned > 0 ? (
            <Progress
              value={(done / planned) * 100}
              aria-label={`${minutesShort(done)} of ${minutesShort(planned)} done`}
              className="h-1.5 rounded-none [&>[data-slot=progress-indicator]]:motion-reduce:transition-none"
            />
          ) : null}
        </div>
      )}

      {/* Minutes, not a running seconds display: it updates without moving. */}
      <p
        className={cn(
          "text-[13px] tabular-nums",
          tight ? "text-alarm-ink" : "text-muted-foreground",
          msLeft === null && "invisible",
        )}
      >
        {closed
          ? `Day closed at ${at}${owed > 0 ? `, ${minutesShort(owed)} not done` : ""}`
          : `Day closes at ${at}, in ${clockLabel(msLeft ?? 0)}${tight ? ", less than the work left" : ""}`}
      </p>
    </header>
  );
}
