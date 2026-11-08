"use client";

import { startOfUTCDay } from "@/lib/pace";
import styles from "./countdown.module.css";

// Time remaining, shown as distance rather than counted.
//
// Deliberately small and in the header. A countdown that dominates the screen
// is pressure, not information, and this app refuses to trade anxiety for
// engagement. The filled portion is time already spent, so the eye reads how
// much ground is left rather than a number ticking down.
const plural = new Intl.PluralRules("en");

export function Countdown({ examDate, startDate }: { examDate: string; startDate: string }) {
  const today = startOfUTCDay(new Date());
  const exam = startOfUTCDay(new Date(examDate));
  const start = startOfUTCDay(new Date(startDate));

  const dayMs = 24 * 60 * 60 * 1000;
  const daysLeft = Math.max(0, Math.round((exam.getTime() - today.getTime()) / dayMs));
  const totalDays = Math.max(1, Math.round((exam.getTime() - start.getTime()) / dayMs));
  const elapsed = Math.min(1, Math.max(0, (totalDays - daysLeft) / totalDays));

  const label = `${daysLeft} ${plural.select(daysLeft) === "one" ? "day" : "days"} left`;

  return (
    <div className={styles.wrap}>
      <div
        className={`${styles.horizon} data-surface`}
        role="img"
        aria-label={`${label} until the exam on ${exam.toLocaleDateString()}`}
      >
        <span className={styles.elapsed} style={{ width: `${elapsed * 100}%` }} />
        {/* The exam is a fixed post at the end of the ground, never a moving
            target: more study hours fill more ground, they do not move the date. */}
        <span className={styles.post} aria-hidden="true" />
      </div>
      <p className={`${styles.label} tnum`}>{label}</p>
    </div>
  );
}
