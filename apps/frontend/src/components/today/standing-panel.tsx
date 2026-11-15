"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PaceReading } from "@/lib/pace";
import type { MockExam } from "@/lib/types";
import { RegionError } from "@/components/states/region-states";

const hours = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const outcomes = (n: number) => `${n} ${n === 1 ? "outcome" : "outcomes"}`;

// Recharts is most of this page's weight; the line arrives after the figures.
// A chunk that cannot load offline drops the line, never the page.
const PaceSpark = dynamic(() => import("./pace-spark").then((m) => m.PaceSpark, () => () => null), {
  ssr: false,
  loading: () => <Skeleton className="h-10 w-full rounded-none" />,
});

type Query = { error: unknown; onRetry: () => void };

export function StandingPanel({
  pace,
  paceEmpty,
  spark,
  paceQuery,
  coveragePercent,
  coverageQuery,
  mocks,
  mocksQuery,
  missed,
  examDate,
  todayISO,
  online,
}: {
  pace: PaceReading | null;
  /** The syllabus loaded with no outcomes, so there is nothing to pace against. */
  paceEmpty: boolean;
  /** Ahead or behind per day over the last 30, oldest first. */
  spark: { date: string; delta: number }[];
  paceQuery: Query;
  coveragePercent: number | undefined;
  coverageQuery: Query;
  mocks: MockExam[] | undefined;
  mocksQuery: Query;
  /** Study days without a log in the last seven; null while unknown. */
  missed: number | null;
  examDate: string;
  todayISO: string;
  online: boolean;
}) {
  return (
    <section aria-labelledby="standing" className="flex flex-col gap-4">
      <h2 id="standing" className="text-[16px] font-semibold">
        Standing
      </h2>

      {paceEmpty ? (
        <p className="text-muted-foreground text-[14px]">
          Pace appears once your syllabus has outcomes.{" "}
          <Link href="/syllabus" className="text-claimed-ink underline underline-offset-4">
            Open the syllabus
          </Link>
        </p>
      ) : (
        <Figure query={paceQuery} ready={!!pace} online={online} skeleton={<PaceSkeleton />}>
          {pace ? <Pace pace={pace} spark={spark} /> : null}
        </Figure>
      )}

      {pace && !pace.realistic ? (
        // Default variant: the destructive one sets white text on a light ground.
        // role status: a standing warning, not an interruption.
        <Alert role="status" className="border-destructive/60 bg-card rounded-lg px-3 py-2.5">
          <AlertDescription className="text-foreground text-[13px]">
            <p>
              Finishing by {fullDate.format(new Date(`${examDate.slice(0, 10)}T00:00:00Z`))} needs about{" "}
              {hours.format(pace.requiredDailyHours)} hours a day, more than your plan sets aside.
            </p>
            <Link href="/plan?tab=setup" className="text-claimed-ink underline underline-offset-4">
              Change the exam date or your hours
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <Figure
        query={coverageQuery}
        ready={coveragePercent !== undefined}
        online={online}
        skeleton={<Skeleton className="h-5 w-32 rounded-sm" />}
      >
        <FigureLink href="/syllabus" label="Coverage">
          <span className="tabular-nums">{Math.round(coveragePercent ?? 0)}%</span>
        </FigureLink>
      </Figure>

      <Figure query={mocksQuery} ready={!!mocks} online={online} skeleton={<Skeleton className="h-5 w-40 rounded-sm" />}>
        <MockLine mocks={mocks ?? []} todayISO={todayISO} />
      </Figure>

      {missed !== null ? (
        <p className="text-muted-foreground text-[13px] tabular-nums">
          {missed === 0
            ? "No missed study days in the last week"
            : `${missed} missed study ${missed === 1 ? "day" : "days"} in the last week`}
        </p>
      ) : null}
    </section>
  );
}

function Figure({
  query,
  ready,
  online,
  skeleton,
  children,
}: {
  query: Query;
  ready: boolean;
  online: boolean;
  skeleton: React.ReactNode;
  children: React.ReactNode;
}) {
  if (ready) return <>{children}</>;
  if (query.error) return <RegionError error={query.error} online={online} onRetry={query.onRetry} />;
  return <div aria-hidden="true">{skeleton}</div>;
}

function FigureLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group hover:bg-accent focus-visible:ring-ring -mx-2 flex min-h-11 items-baseline justify-between gap-3 rounded-sm px-2 py-1.5 outline-hidden focus-visible:ring-2 md:min-h-9"
    >
      <span className="text-muted-foreground text-[13px]">{label}</span>
      <span className="text-[16px] font-semibold">{children}</span>
    </Link>
  );
}

function PaceSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-6 w-44 rounded-sm" />
      <Skeleton className="h-10 w-full rounded-none" />
    </div>
  );
}

function Pace({ pace, spark }: { pace: PaceReading; spark: { date: string; delta: number }[] }) {
  const behind = pace.delta < 0;
  return (
    <Link
      href="/progress?tab=pace"
      className="hover:bg-accent focus-visible:ring-ring -mx-2 flex flex-col gap-1.5 rounded-sm px-2 py-1.5 outline-hidden focus-visible:ring-2"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "text-[20px] leading-tight font-semibold tabular-nums [font-stretch:87.5%]",
            pace.delta > 0 && "text-strong",
            behind && "text-alarm-ink",
          )}
        >
          {pace.delta === 0 ? "On pace" : `${outcomes(Math.abs(pace.delta))} ${behind ? "behind" : "ahead"}`}
        </span>
        {behind ? (
          <span className="text-muted-foreground text-[13px] tabular-nums">
            about {hours.format(pace.hoursBehind)}h of work
          </span>
        ) : null}
      </span>
      {spark.length > 1 ? (
        <>
          <PaceSpark data={spark} />
          <span className="text-muted-foreground text-[12px]">Pace, last {spark.length} days</span>
        </>
      ) : null}
    </Link>
  );
}

function MockLine({ mocks, todayISO }: { mocks: MockExam[]; todayISO: string }) {
  const day = (m: MockExam) => m.date.slice(0, 10);
  const sorted = [...mocks].sort((a, b) => day(a).localeCompare(day(b)));
  const next = sorted.find((m) => day(m) >= todayISO);
  const last = [...sorted].reverse().find((m) => day(m) < todayISO);
  const fmt = (m: MockExam) => dayMonth.format(new Date(`${day(m)}T00:00:00Z`));

  if (next) {
    return (
      <FigureLink href="/progress?tab=mocks" label="Next mock">
        <span className="tabular-nums">{fmt(next)}</span>
      </FigureLink>
    );
  }
  if (last) {
    return (
      <FigureLink href="/progress?tab=mocks" label={`Last mock, ${fmt(last)}`}>
        <span className="tabular-nums">{Math.round(last.scorePercent)}%</span>
      </FigureLink>
    );
  }
  return (
    <FigureLink href="/progress?tab=mocks" label="Mocks">
      <span className="text-muted-foreground text-[13px] font-normal">None recorded yet</span>
    </FigureLink>
  );
}
