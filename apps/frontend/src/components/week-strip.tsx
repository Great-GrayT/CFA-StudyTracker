"use client";

import type { PrescribedDay } from "@/lib/types";
import styles from "./week-strip.module.css";

/**
 * The week as seven bars: how long each day's plan runs, against the hours
 * the candidate said that weekday is worth.
 *
 * One measure, not seven categories, so there is one fill colour and no
 * legend; the heading names it. The budget is a reference marker per bar
 * rather than a second series, because "is this day bigger than I agreed to"
 * is a comparison against a line, not a race between two quantities.
 *
 * Days are clickable because the bar answers "how much" and the candidate's
 * next question is always "of what".
 */

const DAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

function minutesLabel(minutes: number): string {
  if (minutes === 0) return "nothing";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export type WeekDay = {
  date: string;
  plannedMinutes: number;
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
    return {
      date,
      plannedMinutes: byDate.get(date)?.totalMinutes ?? 0,
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
          {minutesLabel(plannedTotal)} planned of {minutesLabel(budgetTotal)}
        </p>
      </div>

      <ol className={styles.strip}>
        {week.map((day, i) => {
          const over = day.budgetMinutes > 0 && day.plannedMinutes > day.budgetMinutes;
          const barHeight = (day.plannedMinutes / ceiling) * 100;
          const markerAt = (day.budgetMinutes / ceiling) * 100;
          const isSelected = day.date === selected;

          return (
            <li key={day.date} className={styles.col}>
              <button
                type="button"
                className={isSelected ? styles.daySelected : styles.day}
                onClick={() => onSelect(day.date)}
                aria-pressed={isSelected}
                aria-label={`${day.date}, ${minutesLabel(day.plannedMinutes)} planned${
                  day.budgetMinutes > 0 ? ` of ${minutesLabel(day.budgetMinutes)}` : ""
                }${over ? ", over your usual hours" : ""}`}
              >
                <span className={styles.plot}>
                  <span
                    className={
                      over ? styles.barOver : day.isPast ? styles.barPast : styles.bar
                    }
                    style={{ height: `${barHeight}%` }}
                  />
                  {day.budgetMinutes > 0 ? (
                    <span className={styles.marker} style={{ bottom: `${markerAt}%` }} />
                  ) : null}
                </span>
                <span className={day.isToday ? styles.labelToday : styles.label}>
                  {DAY_INITIALS[i]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* The marker is the only thing on the plot that is not the measure, so
          it is the only thing that needs naming. */}
      <p className={styles.key}>
        <span className={styles.keyMark} aria-hidden="true" /> your usual hours for that day
      </p>
    </section>
  );
}
