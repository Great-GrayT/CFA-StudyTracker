"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";

import { DayHeader } from "@/components/today/day-header";
import { TodaysWork } from "@/components/today/todays-work";
import { WeekStrip, weekDates } from "@/components/today/week-strip";
import { StandingPanel } from "@/components/today/standing-panel";
import { FitBanner } from "@/components/plan/fit-banner";
import { StudyNext } from "@/components/today/study-next";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  flattenCurriculum,
  useCurriculum,
  useHolidays,
  useLogs,
  useMocks,
  usePlan,
  usePrescription,
  useProgress,
} from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { addUTCDays, buildSeries, missedDays, readPace, startOfUTCDay } from "@/lib/pace";
import { debriefTime, msUntilDayEnd } from "@/lib/day-end";
import { examPhase, studyNextRows } from "@/lib/today";
import { useOnline } from "@/hooks/use-online";

const fullDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Milliseconds until the study day closes at the plan's debrief, in the plan's
 * zone; null until mounted, since server and browser zones differ.
 */
function useDayClock(timeZone: string, debrief: string): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    // Checked each second, stored only when the shown minute changes, so the
    // page re-renders once a minute rather than every tick.
    const bucket = (ms: number) => (ms <= 0 ? 0 : Math.ceil(ms / 60000));
    const tick = () => {
      const next = msUntilDayEnd(Date.now(), timeZone, debrief);
      setLeft((prev) => (prev !== null && bucket(prev) === bucket(next) ? prev : next));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [timeZone, debrief]);
  return left;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1200px] min-w-0 px-4 py-6 md:px-8 md:py-8">{children}</div>;
}

export default function TodayPage() {
  const qc = useQueryClient();
  const online = useOnline();
  const plan = usePlan();
  const planId = plan.data?.id;
  const curriculum = useCurriculum(plan.data?.levelId);
  const progress = useProgress(planId);
  const logs = useLogs(planId);
  const holidays = useHolidays(planId);
  const mocks = useMocks(planId);

  // The candidate's calendar day; en-CA is the shortest route to YYYY-MM-DD.
  const todayISO = useMemo(() => new Intl.DateTimeFormat("en-CA").format(new Date()), []);
  const week = useMemo(() => weekDates(todayISO), [todayISO]);
  // The whole week in one request: the strip needs every day's totals.
  const prescription = usePrescription(planId, week[0], week[6]);
  const [selected, setSelected] = useState(todayISO);

  // The day closes at the debrief, when the server replans and carries
  // unstarted work forward as Postponed. Invalidate so it shows.
  const debrief = debriefTime(plan.data?.coachSchedule);
  const msLeft = useDayClock(plan.data?.timeZone ?? "UTC", debrief);
  const closed = msLeft !== null && msLeft <= 0;
  useEffect(() => {
    if (closed && planId) void qc.invalidateQueries({ queryKey: ["prescription", planId] });
  }, [closed, planId, qc]);

  const flat = useMemo(() => flattenCurriculum(curriculum.data), [curriculum.data]);
  const byId = useMemo(() => new Map(flat.map((l) => [l.id, l])), [flat]);
  const totalOutcomes = flat.length;
  const paceInputs = useMemo(
    () =>
      plan.data && logs.data && holidays.data && totalOutcomes > 0
        ? { plan: plan.data, logs: logs.data, holidays: holidays.data, totalOutcomes }
        : null,
    [plan.data, logs.data, holidays.data, totalOutcomes],
  );
  const pace = useMemo(() => (paceInputs ? readPace(paceInputs) : null), [paceInputs]);
  const spark = useMemo(
    () =>
      paceInputs
        ? buildSeries(paceInputs)
            .slice(-30)
            .map((p) => ({ date: p.date, delta: p.newCoverage - p.target }))
        : [],
    [paceInputs],
  );
  const missed = useMemo(() => {
    if (!paceInputs) return null;
    const today = startOfUTCDay(new Date(`${todayISO}T00:00:00Z`));
    return missedDays({ ...paceInputs, from: addUTCDays(today, -7), to: addUTCDays(today, -1) }).length;
  }, [paceInputs, todayISO]);

  const rows = useMemo(() => (progress.data ? studyNextRows(progress.data) : undefined), [progress.data]);

  const planState = regionState(plan);
  if (planState.loading) {
    return (
      <Shell>
        {/* Same two columns as the loaded page, so nothing jumps when it arrives. */}
        <div
          aria-busy="true"
          aria-label="Loading today"
          className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px]"
        >
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-8 w-64 rounded-sm" />
              <Skeleton className="h-4 w-48 rounded-sm" />
              <Skeleton className="h-1.5 w-full max-w-md rounded-none" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-32 rounded-sm" />
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9 w-full rounded-none" />
              ))}
            </div>
            <Skeleton className="h-14 w-full rounded-sm" />
          </div>
          <div className="border-border flex flex-col gap-4 border-t pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
            <Skeleton className="h-5 w-24 rounded-sm" />
            <Skeleton className="h-16 w-full rounded-none" />
            <Skeleton className="h-5 w-40 rounded-sm" />
            <Skeleton className="h-5 w-32 rounded-sm" />
          </div>
        </div>
      </Shell>
    );
  }

  // Only a 404 means no plan; any other miss is an error, never an invitation to start over.
  const noPlan = plan.error instanceof ApiError && plan.error.status === 404;
  if (noPlan) {
    return (
      <Shell>
        <PageState title="No study plan yet" body="Set your exam date and weekly hours, and Today fills with the day's work.">
          <Button asChild>
            <Link href="/onboarding">Set up a plan</Link>
          </Button>
        </PageState>
      </Shell>
    );
  }
  if (!plan.data) {
    return (
      <Shell>
        <RegionError error={planState.error} online={online} onRetry={() => void plan.refetch()} />
      </Shell>
    );
  }

  const phase = examPhase(plan.data.examDate, todayISO);
  if (phase === "exam-day") {
    return (
      <Shell>
        <PageState title="Your exam is today" body="Nothing to record. Good luck.">
          <Button asChild variant="outline">
            <Link href="/syllabus">Look over your weakest outcomes</Link>
          </Button>
        </PageState>
      </Shell>
    );
  }
  if (phase === "after") {
    return (
      <Shell>
        <PageState
          title={`Your exam was on ${fullDate.format(new Date(`${plan.data.examDate.slice(0, 10)}T00:00:00Z`))}`}
          body="Your history stays readable in Progress. Start a new plan when you are ready."
        >
          <Button asChild>
            <Link href="/settings#start-over">Start a new plan</Link>
          </Button>
        </PageState>
      </Shell>
    );
  }

  const days = prescription.data?.days;
  const work = regionState(prescription);
  const paceState = [logs, holidays, curriculum].map(regionState).find((r) => r.error) ?? { error: null };
  const nextState = [progress, curriculum].map(regionState);
  const retryPrescription = () => void prescription.refetch();
  const retryPace = () => {
    void logs.refetch();
    void holidays.refetch();
    void curriculum.refetch();
  };

  return (
    <Shell>
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-8">
          <div>
            <DayHeader
              todayISO={todayISO}
              examDate={plan.data.examDate}
              day={days?.find((d) => d.date === todayISO)}
              loading={work.loading}
              msLeft={msLeft}
              debrief={debrief}
              timeZone={plan.data.timeZone ?? "UTC"}
            />
            {!online ? <OfflineLine /> : null}
          </div>
          <FitBanner planId={plan.data.id} />
          <TodaysWork
            day={days?.find((d) => d.date === selected)}
            date={selected}
            todayISO={todayISO}
            planId={plan.data.id}
            loading={work.loading}
            error={work.error}
            online={online}
            onRetry={retryPrescription}
          />
          <WeekStrip
            dates={week}
            days={days}
            todayISO={todayISO}
            selected={selected}
            onSelect={setSelected}
            loading={work.loading}
          />
        </div>

        {/* Separated by a hairline and space, not boxed. */}
        <aside className="border-border flex min-w-0 flex-col gap-8 border-t pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
          <StandingPanel
            pace={pace}
            paceEmpty={!!curriculum.data && totalOutcomes === 0}
            spark={spark}
            paceQuery={{
              error: paceState.error,
              onRetry: retryPace,
            }}
            coveragePercent={progress.data?.coveragePercent}
            coverageQuery={{ error: regionState(progress).error, onRetry: () => void progress.refetch() }}
            mocks={mocks.data}
            mocksQuery={{ error: regionState(mocks).error, onRetry: () => void mocks.refetch() }}
            missed={missed}
            examDate={plan.data.examDate}
            todayISO={todayISO}
            online={online}
          />
          <StudyNext
            rows={rows}
            byId={byId}
            loading={nextState.some((r) => r.loading)}
            error={nextState.find((r) => r.error)?.error}
            online={online}
            onRetry={() => {
              void progress.refetch();
              void curriculum.refetch();
            }}
          />
        </aside>
      </div>
    </Shell>
  );
}

function PageState({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <section className="flex max-w-lg flex-col items-start gap-3 py-12">
      <h1 className="text-[26px] leading-tight font-semibold">{title}</h1>
      <p className="text-muted-foreground text-[14px]">{body}</p>
      {children}
    </section>
  );
}
