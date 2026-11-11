"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./day-countdown.module.css";

/**
 * How long is left to finish today. The first thing on the screen, and the
 * biggest.
 *
 * It counts to 22:30 local, the coach's night debrief, because that is the
 * moment the day is judged: it is the message that says what was and was not
 * done. Counting to midnight would be counting to nothing.
 *
 * Hundredths, not seconds. A clock that ticks once a second reads as a
 * status line; one that never stops moving reads as time running out, which
 * is the entire point of putting it here.
 */

// 22:30, the night debrief. Mirrored from the coach's slots.
const DEADLINE_HOUR = 22;
const DEADLINE_MINUTE = 30;

function msUntilDeadline(now: number): number {
  const deadline = new Date(now);
  deadline.setHours(DEADLINE_HOUR, DEADLINE_MINUTE, 0, 0);
  return deadline.getTime() - now;
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
  const [left, setLeft] = useState<number | null>(null);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    // requestAnimationFrame, not setInterval(10): hundredths need roughly
    // 60fps to look continuous, and rAF stops when the tab is hidden instead
    // of burning a timer in the background.
    const tick = () => {
      setLeft(msUntilDeadline(Date.now()));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, []);

  // Nothing planned, nothing to count down to.
  if (totalMinutes === 0) return null;

  // Held before the clock mounts, so the page does not jump when it arrives.
  // The server and the browser are in different time zones often enough that
  // rendering a time on the server guarantees a hydration mismatch.
  if (left === null) return <div className={styles.placeholder} aria-hidden="true" />;

  const done = remainingMinutes <= 0;
  const expired = left <= 0;
  const minutesLeft = Math.floor(left / 60000);
  const tight = !done && !expired && minutesLeft < remainingMinutes;

  if (done) {
    return (
      <section className={styles.wrap} aria-label="Today is finished">
        <p className={`${styles.clock} ${styles.clockDone} tnum`}>00:00:00</p>
        <p className={styles.note}>Done</p>
      </section>
    );
  }

  if (expired) {
    return (
      <section className={styles.wrap} aria-label="Past the coach's deadline">
        <p className={`${styles.clock} ${styles.clockLate} tnum`}>00:00:00</p>
        <p className={styles.note}>{minutesLabel(remainingMinutes)} unfinished</p>
      </section>
    );
  }

  const total = Math.floor(left / 10); // hundredths
  const hh = Math.floor(total / 360000);
  const mm = Math.floor((total % 360000) / 6000);
  const ss = Math.floor((total % 6000) / 100);
  const cs = total % 100;
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <section className={styles.wrap} aria-label={`${minutesLeft} minutes until the coach writes`}>
      {/* aria-hidden: a figure changing sixty times a second must never reach
          a screen reader. The section's own label carries the meaning. */}
      <p
        className={`${styles.clock} ${tight ? styles.clockTight : ""} tnum`}
        aria-hidden="true"
      >
        {pad(hh)}:{pad(mm)}:{pad(ss)}
        <span className={styles.fraction}>.{pad(cs)}</span>
      </p>
      <p className={styles.note}>
        {minutesLabel(remainingMinutes)} left
        {tight ? ", more than the clock" : ""}
      </p>
    </section>
  );
}
