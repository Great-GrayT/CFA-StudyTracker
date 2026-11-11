"use client";

import type { PrescribedDay } from "@/lib/types";
import styles from "./week-strip.module.css";

/**
 * The week as seven bars: how long each day's plan runs, how much of it is
 * done, and where that sits against the hours the candidate said that weekday
 * is worth.
 *
 * The planner balances across the week rather than holding each day to its own
 * figure, so a day over its line is working as designed. That makes the
 * divergence the most important thing on the chart, not a footnote: without it
 * a candidate who set two hours and sees three reads a bug.
 *
 * One measure with a completed portion inside it, not two series. The budget
 * is a reference marker, because "is this longer than I agreed to" is a
 * comparison against a line.
 */

const DAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

function minutesLabel(minutes: number): string {
  if (minutes === 0) return "nothing";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** "+35 min" / "35 min under", always from the candidate's own figure. */
function divergenceLabel(planned: number, budget: number): string | null {
  if (budget <= 0) return null;
  const delta = planned - budget;
  if (Math.abs(delta) < 5) return "on your hours";
  return delta > 0 ? `${minutesLabel(delta)} over` : `${minutesLabel(-delta)} under`;
}

export type WeekDay = {
  date: string;
  plannedMinutes: number;
  doneMinutes: number;
  doneTasks: number;
  totalTasks: number;
  offPlanLogs: number;
  budgetMinutes: number;
  isToday: boolean;
  isPast: boolean;
};

/** Monday-first week containing `todayISO`, as plain calendar dates. */
export function weekOf(todayISO: string): string[] {
  const today = new Date(`${todayISO}T00:00:00Z`);
  // getUTCDay is Sunday-indexed; the strip reads Monday first, which is how a
  // study week is actually described.
  const offsetToMonday = (today.getUTCDay() + 6) % 7;
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() - offsetToMonday);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export function buildWeek(
  dates: string[],
  days: PrescribedDay[] | undefined,
  weeklyAvailability: Record<string, number> | undefined,
  todayISO: string,
): WeekDay[] {
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  return dates.map((date) => {
    const weekday = keys[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const hours = weeklyAvailability?.[weekday];
    const day = byDate.get(date);
    return {
      date,
      plannedMinutes: day?.totalMinutes ?? 0,
      doneMinutes: day?.doneMinutes ?? 0,
      doneTasks: day?.doneTasks ?? 0,
      totalTasks: day?.totalTasks ?? 0,
      offPlanLogs: day?.offPlanLogs ?? 0,
      budgetMinutes: typeof hours === "number" ? Math.round(hours * 60) : 0,
      isToday: date === todayISO,
      isPast: date < todayISO,
    };
  });
}

export function WeekStrip({
  week,
  selected,
  onSelect,
}: {
  week: WeekDay[];
  selected: string;
  onSelect: (date: string) => void;
}) {
  const plannedTotal = week.reduce((sum, d) => sum + d.plannedMinutes, 0);
  const budgetTotal = week.reduce((sum, d) => sum + d.budgetMinutes, 0);
  const doneTotal = week.reduce((sum, d) => sum + d.doneMinutes, 0);
  const doneTasksTotal = week.reduce((sum, d) => sum + d.doneTasks, 0);
  const offPlanTotal = week.reduce((sum, d) => sum + d.offPlanLogs, 0);
  const weekDelta = plannedTotal - budgetTotal;

  // One scale across the whole strip, so bar heights are comparable between
  // days. The budget is in the max so its marker never sits off the top.
  const ceiling = Math.max(
    60,
    ...week.map((d) => Math.max(d.plannedMinutes, d.budgetMinutes)),
  );

  return (
    <section className={styles.section} aria-labelledby="week-strip">
      <div className={styles.head}>
        <h2 id="week-strip" className={styles.heading}>
          This week
        </h2>
        <p className={`${styles.total} tnum`}>
          {minutesLabel(plannedTotal)} planned of the {minutesLabel(budgetTotal)} you set
        </p>
      </div>

      {/* The divergence, said once for the week in the candidate's own terms.
          The planner spends the week's hours, not each day's, so this is the
          number that tells them whether the plan matches what they agreed to. */}
      {budgetTotal > 0 ? (
        <p className={styles.divergence}>
          {Math.abs(weekDelta) < 15
            ? "That matches the hours you set."
            : weekDelta > 0
              ? `${minutesLabel(weekDelta)} more than you set, spread across the week.`
              : `${minutesLabel(-weekDelta)} less than you set. There is room for more.`}
        </p>
      ) : null}

      <ol className={styles.strip}>
        {week.map((day, i) => {
          const over = day.budgetMinutes > 0 && day.plannedMinutes > day.budgetMinutes;
          const barHeight = (day.plannedMinutes / ceiling) * 100;
          const doneHeight =
            day.plannedMinutes > 0
              ? (Math.min(day.doneMinutes, day.plannedMinutes) / ceiling) * 100
              : 0;
          const markerAt = (day.budgetMinutes / ceiling) * 100;
          const isSelected = day.date === selected;
          const diverge = divergenceLabel(day.plannedMinutes, day.budgetMinutes);

          return (
            <li key={day.date} className={styles.col}>
              <button
                type="button"
                className={isSelected ? styles.daySelected : styles.day}
                onClick={() => onSelect(day.date)}
                aria-pressed={isSelected}
                aria-label={[
                  day.date,
                  `${minutesLabel(day.plannedMinutes)} planned`,
                  day.budgetMinutes > 0 ? `against ${minutesLabel(day.budgetMinutes)} set` : "",
                  diverge ?? "",
                  day.totalTasks > 0 ? `${day.doneTasks} of ${day.totalTasks} done` : "",
                  day.offPlanLogs > 0 ? `${day.offPlanLogs} logged off plan` : "",
                ]
                  .filter(Boolean)
                  .join(", ")}
              >
                <span className={styles.plot}>
                  <span
                    className={over ? styles.barOver : day.isPast ? styles.barPast : styles.bar}
                    style={{ height: `${barHeight}%` }}
                  />
                  {/* Finished work, drawn inside the planned bar rather than
                      beside it: it is a portion of that bar, not a rival to it. */}
                  {doneHeight > 0 ? (
                    <span className={styles.done} style={{ height: `${doneHeight}%` }} />
                  ) : null}
                  {day.budgetMinutes > 0 ? (
                    <span className={styles.marker} style={{ bottom: `${markerAt}%` }} />
                  ) : null}
                  {/* Work the candidate chose themselves. A tick above the bar,
                      because it is not part of the plan's height and stacking it
                      there would overstate the day. */}
                  {day.offPlanLogs > 0 ? <span className={styles.offPlan} /> : null}
                </span>
                <span className={day.isToday ? styles.labelToday : styles.label}>
                  {DAY_INITIALS[i]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <dl className={styles.key}>
        <div className={styles.keyRow}>
          <dt>
            <span className={styles.keyDone} aria-hidden="true" />
            Done on plan
          </dt>
          <dd className="tnum">
            {minutesLabel(doneTotal)}, {doneTasksTotal} {doneTasksTotal === 1 ? "task" : "tasks"}
          </dd>
        </div>
        <div className={styles.keyRow}>
          <dt>
            <span className={styles.keyOffPlan} aria-hidden="true" />
            Logged off plan
          </dt>
          {/* Outcomes, not minutes: a log entry never records how long it took. */}
          <dd className="tnum">
            {offPlanTotal} {offPlanTotal === 1 ? "outcome" : "outcomes"}
          </dd>
        </div>
        <div className={styles.keyRow}>
          <dt>
            <span className={styles.keyMark} aria-hidden="true" />
            Your usual hours
          </dt>
          <dd className="tnum">{minutesLabel(budgetTotal)} a week</dd>
        </div>
      </dl>
    </section>
  );
}
