"use client";

import { usePrescription, useSubmitTask } from "@/lib/hooks";
import { missedTasks, missedWindow } from "@/lib/day-end";
import { minutesLabel, TaskRow, type SubmitFor } from "./day-plan";
import type { PrescribedTask } from "@/lib/types";
import styles from "./missed-tasks.module.css";

/**
 * Work from the past week that was never started, kept in view until it is
 * recorded. The plan has already moved it forward; this is the record of what
 * was skipped, and the place to record what was done but never logged.
 */
export function MissedTasks({
  planId,
  todayISO,
  closed,
}: {
  planId: string | undefined;
  todayISO: string;
  /** Today's debrief has passed, so today's unstarted work is owed too. */
  closed: boolean;
}) {
  const { from, to } = missedWindow(todayISO, closed);
  const prescription = usePrescription(planId, from, to);
  const submitTask = useSubmitTask(planId);
  const onSubmit: SubmitFor = (taskId, submission) => submitTask.mutateAsync({ taskId, ...submission });

  const missed = missedTasks(prescription.data?.days ?? [], todayISO, closed);
  if (missed.length === 0) return null;

  const owed = missed.reduce((sum, m) => sum + m.task.estimatedMinutes, 0);
  const byDay = new Map<string, PrescribedTask[]>();
  for (const { date, task } of missed) byDay.set(date, [...(byDay.get(date) ?? []), task]);

  return (
    <section className={styles.section} aria-labelledby="missed-heading">
      <div className={styles.head}>
        <h2 id="missed-heading" className={styles.heading}>
          Not done
        </h2>
        <p className={`${styles.owed} tnum`}>{minutesLabel(owed)} owed</p>
      </div>
      <p className={styles.note}>
        {missed.length === 1 ? "One task" : `${missed.length} tasks`} you planned and did not
        start. If you did one and forgot to record it, record it now and the plan rebuilds.
      </p>

      {[...byDay].map(([date, tasks]) => (
        <div key={date} className={styles.day}>
          <h3 className={styles.dayName}>
            {date === todayISO
              ? "Today"
              : new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                })}
          </h3>
          <ul className={styles.list}>
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onSubmit={onSubmit} missed />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
