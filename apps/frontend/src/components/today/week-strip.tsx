"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { minutesShort } from "@/lib/today";
import type { PrescribedDay } from "@/lib/types";

const initial = new Intl.DateTimeFormat("en-GB", { weekday: "narrow", timeZone: "UTC" });
const spoken = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** Monday-first week holding `todayISO`, as calendar dates. */
export function weekDates(todayISO: string): string[] {
  const today = new Date(`${todayISO}T00:00:00Z`);
  const monday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => new Date(monday + i * 86_400_000).toISOString().slice(0, 10));
}

// This week only: other weeks live in Plan.
export function WeekStrip({
  dates,
  days,
  todayISO,
  selected,
  onSelect,
  loading,
}: {
  dates: string[];
  days: PrescribedDay[] | undefined;
  todayISO: string;
  selected: string;
  onSelect: (date: string) => void;
  loading: boolean;
}) {
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));

  return (
    <section aria-labelledby="week-strip" className="flex flex-col gap-2">
      <h2 id="week-strip" className="text-[16px] font-semibold">
        This week
      </h2>
      <ol className="grid grid-cols-7 gap-1">
        {dates.map((date) => {
          const day = byDate.get(date);
          const planned = day?.totalMinutes ?? 0;
          const done = Math.min(day?.doneMinutes ?? 0, planned);
          const isSelected = date === selected;
          const isToday = date === todayISO;
          const label = [
            spoken.format(new Date(`${date}T00:00:00Z`)),
            isToday ? "today" : "",
            planned > 0 ? `${minutesShort(planned)} planned, ${minutesShort(done)} done` : "nothing planned",
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <li key={date} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(date)}
                aria-pressed={isSelected}
                aria-label={label}
                className={cn(
                  "flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-sm px-1 py-1.5 md:min-h-9",
                  "hover:bg-accent focus-visible:ring-ring outline-hidden focus-visible:ring-2",
                  // A ring as well as the tint: the tint alone is under 3:1 against the ground.
                  isSelected && "bg-accent ring-primary ring-1 ring-inset",
                )}
              >
                <span
                  className={cn(
                    "text-[13px] leading-none tabular-nums",
                    isToday ? "text-foreground font-semibold" : "text-muted-foreground",
                  )}
                >
                  {initial.format(new Date(`${date}T00:00:00Z`))}
                  <span className="ml-1 max-sm:hidden">{Number(date.slice(8))}</span>
                </span>
                {loading ? (
                  <Skeleton className="h-1 w-full rounded-none" />
                ) : (
                  // Done as a portion of planned; empty track when nothing is planned.
                  <span className={cn("relative block h-1 w-full", planned > 0 ? "bg-border" : "bg-border/40")} aria-hidden="true">
                    {planned > 0 ? (
                      <span
                        className="bg-primary absolute inset-y-0 left-0"
                        style={{ width: `${(done / planned) * 100}%` }}
                      />
                    ) : null}
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className={cn("h-0.5 w-3", isToday ? "bg-foreground" : "bg-transparent")}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
