"use client";

import { useEffect, useState } from "react";
import styles from "./day-countdown.module.css";

/**
 * How long is left to finish today, and whether that is actually enough.
 *
 * The deadline is the coach's night debrief at 22:30 local, because that is
 * the moment the day is judged: it is the message that tells the candidate
 * what they did and did not do. Counting to midnight would be counting to
 * nothing.
 *
 * The number that matters is not the clock, it is the clock MINUS the work
 * still owed. An hour left with twenty minutes of plan is a comfortable
 * evening; an hour left with ninety minutes of plan is a problem, and the
 * screen should say so before the coach does.
 */

// 22:30, the night debrief. Mirrored from the coach's slots.
const DEADLINE_HOUR = 22;
const DEADLINE_MINUTE = 30;

function msUntilDeadline(now: Date): number {
  const deadline = new Date(now);
  deadline.setHours(DEADLINE_HOUR, DEADLINE_MINUTE, 0, 0);
  return deadline.getTime() - now.getTime();
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function DayCountdown({
  remainingMinutes,
  totalMinutes,
}: {
  /** Planned minutes not yet finished today. */
  remainingMinutes: number;
  totalMinutes: number;
}) {
  // Rendered only after mount: the server and the browser are in different
  // time zones often enough that a server-rendered clock hydrates to a
  // different string and React throws it away.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) {
    return <div className={styles.placeholder} aria-hidden="true" />;
  }

  const left = msUntilDeadline(now);
  const minutesLeft = Math.floor(left / 60000);
  const slack = minutesLeft - remainingMinutes;

  if (totalMinutes === 0) {
    return null;
  }

  if (remainingMinutes <= 0) {
    return (
      <section className={styles.sectionDone} aria-labelledby="countdown">
        <p id="countdown" className={styles.label}>
          Today is done
        </p>
        <p className={styles.clockDone}>All {minutesLabel(totalMinutes)} of it.</p>
      </section>
    );
  }

  // Past the debrief with work outstanding. No countdown to show, and a
  // ticking zero would be worse than the plain fact.
  if (left <= 0) {
    return (
      <section className={styles.sectionLate} aria-labelledby="countdown">
        <p id="countdown" className={styles.label}>
          The coach has been
        </p>
        <p className={styles.clockLate}>{minutesLabel(remainingMinutes)} unfinished</p>
        <p className={styles.note}>It carries to tomorrow. Tomorrow gets heavier.</p>
      </section>
    );
  }

  const tight = slack < 0;
  const close = !tight && slack < 45;

  return (
    <section
      className={tight ? styles.sectionTight : styles.section}
      aria-labelledby="countdown"
    >
      <p id="countdown" className={styles.label}>
        {tight ? "Not enough time left" : "Left before the coach writes"}
      </p>

      {/* The clock is the hero: big, tabular, and the one thing readable from
          across a room. aria-live is off on purpose, because a figure that
          changes every second would be announced every second. */}
      <p className={`${styles.clock} tnum`} aria-live="off">
        {clock(left)}
      </p>

      <p className={styles.note}>
        {minutesLabel(remainingMinutes)} of today&rsquo;s plan still to do
        {tight
          ? `, and only ${minutesLabel(minutesLeft)} to do it in. Something gives tonight.`
          : close
            ? `. That leaves ${minutesLabel(slack)} spare. Start now.`
            : `, out of ${minutesLabel(totalMinutes)}.`}
      </p>
    </section>
  );
}
