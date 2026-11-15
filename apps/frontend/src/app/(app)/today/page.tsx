"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";

import { DeviationSparkline, buildSeries } from "@/components/pace-field";
import { DayPlan } from "@/components/day-plan";
import { DayCountdown } from "@/components/day-countdown";
import { WeekStrip, weekOf, buildWeek } from "@/components/week-strip";
import { Countdown } from "@/components/countdown";
import {
  usePlan,
  useCurriculum,
  useProgress,
  useLogs,
  useHolidays,
  usePrescription,
  flattenCurriculum,
} from "@/lib/hooks";
import { readPace, remainingWeekSplit, startOfUTCDay, addUTCDays } from "@/lib/pace";
import { debriefTime } from "@/lib/day-end";
import styles from "./today.module.css";


const hours = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const plural = new Intl.PluralRules("en");
const outcomeWord = (n: number) => (plural.select(n) === "one" ? "outcome" : "outcomes");

export default function TodayPage() {

  const plan = usePlan();
  const planId = plan.data?.id;
  const curriculum = useCurriculum(plan.data?.levelId);
  const progress = useProgress(planId);
  const logs = useLogs(planId);
  const holidays = useHolidays(planId);

  // The candidate's own calendar day, formatted the way the API wants it.
  // en-CA is the shortest route to YYYY-MM-DD without pulling in a formatter.
  const todayISO = useMemo(() => new Intl.DateTimeFormat("en-CA").format(new Date()), []);

  // The whole week is fetched at once, not just today: the strip needs every
  // day's total, and seven days of tasks is a smaller payload than the
  // curriculum tree this screen already holds.
  const week = useMemo(() => weekOf(todayISO), [todayISO]);
  const prescription = usePrescription(planId, week[0], week[6]);
  const [selectedDate, setSelectedDate] = useState(todayISO);

  // The study day ends at the plan's debrief, when the server replans and
  // carries anything unstarted forward as Postponed. Refetch so it shows.
  const planZone = plan.data?.timeZone ?? "UTC";
  const debrief = debriefTime(plan.data?.coachSchedule);
  const refetchPrescription = prescription.refetch;
  const handleDayEnd = useCallback(() => void refetchPrescription(), [refetchPrescription]);
  const selectedDay = prescription.data?.days.find((d) => d.date === selectedDate);
  const todayDay = prescription.data?.days.find((d) => d.date === todayISO);

  const weekDays = useMemo(
    () =>
      buildWeek(
        week,
        prescription.data?.days,
        plan.data?.weeklyAvailability as Record<string, number> | undefined,
        todayISO,
      ),
    [week, prescription.data?.days, plan.data?.weeklyAvailability, todayISO],
  );

  // What this weekday is nominally worth, so the day can say when it is
  // running long rather than leaving the candidate to wonder.
  const selectedBudgetMinutes = weekDays.find((d) => d.date === selectedDate)?.budgetMinutes;

  const totalOutcomes = useMemo(
    () => flattenCurriculum(curriculum.data).length,
    [curriculum.data],
  );

  const ready = plan.data && logs.data && holidays.data && totalOutcomes > 0;

  const pace = useMemo(() => {
    if (!ready) return null;
    return readPace({
      plan: plan.data!,
      logs: logs.data!,
      totalOutcomes,
      holidays: holidays.data!,
    });
  }, [ready, plan.data, logs.data, totalOutcomes, holidays.data]);

  const series = useMemo(() => {
    if (!ready) return [];
    return buildSeries({
      plan: plan.data!,
      logs: logs.data!,
      totalOutcomes,
      holidays: holidays.data!,
    });
  }, [ready, plan.data, logs.data, totalOutcomes, holidays.data]);


  const split = plan.data ? remainingWeekSplit(plan.data.weeklyAvailability) : null;

  if (plan.isLoading || curriculum.isLoading) {
    return (
      <div className="mx-auto w-full max-w-[44rem] min-w-0 p-4 md:p-8">
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading today">
          <div className={styles.skelLine} />
          <div className={styles.skelBlock} />
          <div className={styles.skelRow} />
          <div className={styles.skelRow} />
        </div>
      </div>
    );
  }

  const examPassed =
    plan.data && startOfUTCDay(new Date(plan.data.examDate)) < startOfUTCDay(new Date());
  const examToday =
    plan.data &&
    startOfUTCDay(new Date(plan.data.examDate)).getTime() === startOfUTCDay(new Date()).getTime();

  return (
    <div className="mx-auto w-full max-w-[44rem] min-w-0 p-4 md:p-8">
      {/* First thing on the page, and the biggest: how long is left of today.
          Not tied to the day the candidate has selected below, because that
          selection is for reading a plan, and this is their own deadline. */}
      <DayCountdown
        remainingMinutes={Math.max(
          0,
          (todayDay?.totalMinutes ?? 0) - (todayDay?.doneMinutes ?? 0),
        )}
        totalMinutes={todayDay?.totalMinutes ?? 0}
        timeZone={planZone}
        debrief={debrief}
        onDayEnd={handleDayEnd}
      />

      {plan.data && <Countdown examDate={plan.data.examDate} startDate={plan.data.startDate} />}

      {examPassed ? (
        <section className={styles.endState}>
          <h1 className={styles.endTitle}>
            Your exam was on {new Date(plan.data!.examDate).toLocaleDateString()}.
          </h1>
          <p className={styles.endBody}>
            Start a new plan when you are ready. Your history stays readable.
          </p>
          <Link href="/onboarding" className={styles.endAction}>
            Start a new plan
          </Link>
        </section>
      ) : examToday ? (
        <section className={styles.endState}>
          <h1 className={styles.endTitle}>Your exam is today.</h1>
          <p className={styles.endBody}>Good luck.</p>
        </section>
      ) : (
        <>
          {pace && (
            <section className={styles.hero} aria-labelledby="pace-heading">
              <h1 id="pace-heading" className={styles.heroLine}>
                {pace.delta === 0 ? (
                  <>You are exactly on pace.</>
                ) : pace.delta < 0 ? (
                  <>
                    You are{" "}
                    <strong className={styles.behind}>
                      {Math.abs(pace.delta)} {outcomeWord(Math.abs(pace.delta))} behind
                    </strong>
                    , about {hours.format(pace.hoursBehind)} hours of work.
                  </>
                ) : (
                  <>
                    You are{" "}
                    <strong className={styles.ahead}>
                      {pace.delta} {outcomeWord(pace.delta)} ahead
                    </strong>
                    .
                  </>
                )}
              </h1>
              <DeviationSparkline series={series} />
            </section>
          )}

          {!pace?.realistic && pace && (
            <p className={styles.unrealistic} role="status">
              Finishing by {new Date(plan.data!.examDate).toLocaleDateString()} needs about{" "}
              {hours.format(pace.requiredDailyHours)} hours a day from here, more than your plan
              sets aside. Moving the exam date or adding study hours are the two things that change
              this.
            </p>
          )}

          {progress.data && (
            <section className={styles.split} aria-label="New coverage against review work">
              <SplitStack
                newCoverage={progress.data.today.newCoverage}
                reviewWork={progress.data.today.reviewWork}
              />
            </section>
          )}


          {split && split.totalHours > 0 && (
            <section className={styles.plan} aria-labelledby="next-heading">
              <h2 id="next-heading" className={styles.sectionTitle}>
                Next two hours
              </h2>
              <SplitBar content={split.contentHours} practice={split.practiceHours} />
              <p className={styles.planHint}>
                {hours.format(split.contentHours)} hours content and{" "}
                {hours.format(split.practiceHours)} hours practice is the suggested split of the{" "}
                {hours.format(split.totalHours)} hours left this week.
              </p>
            </section>
          )}

          <WeekStrip week={weekDays} selected={selectedDate} onSelect={setSelectedDate} />

          <DayPlan
            day={selectedDay}
            heading={
              selectedDate === todayISO
                ? "Today"
                : new Date(`${selectedDate}T00:00:00Z`).toLocaleDateString(undefined, {
                    weekday: "long",
                    timeZone: "UTC",
                  })
            }
            budgetMinutes={selectedBudgetMinutes}
            planId={plan.data?.id}
            submittable={selectedDate <= todayISO}
          />
        </>
      )}
    </div>
  );
}

/** Two quantities at one scale, so the proportion is the message. */
function SplitStack({ newCoverage, reviewWork }: { newCoverage: number; reviewWork: number }) {
  const total = Math.max(1, newCoverage + reviewWork);
  return (
    <div className={styles.stack}>
      <div className={styles.stackBar} aria-hidden="true">
        <span
          className={`${styles.stackNew} data-fill`}
          style={{ width: `${(newCoverage / total) * 100}%` }}
        />
        <span
          className={styles.stackReview}
          style={{ width: `${(reviewWork / total) * 100}%` }}
        />
      </div>
      <p className={styles.stackLabel}>
        <span className={`${styles.stackFigure} tnum`}>{newCoverage}</span> new
        <span className={styles.stackSep} />
        <span className={`${styles.stackFigure} tnum`}>{reviewWork}</span> review
      </p>
    </div>
  );
}

/** The 1 to 2 content-practice target for the remaining week. */
function SplitBar({ content, practice }: { content: number; practice: number }) {
  const total = Math.max(0.001, content + practice);
  return (
    <div className={styles.ratio} aria-hidden="true">
      <span className={styles.ratioContent} style={{ width: `${(content / total) * 100}%` }} />
      <span className={styles.ratioPractice} style={{ width: `${(practice / total) * 100}%` }} />
    </div>
  );
}
