"use client";

import type { PrescribedDay, PrescribedTask } from "@/lib/types";
import styles from "./day-plan.module.css";

/**
 * A day's work, as things to open rather than outcomes to satisfy.
 *
 * The screen this replaces printed the Learning Outcome Statement, which is
 * what the exam will ask of the candidate, not what they can sit down and do:
 * "evaluate how well a multiple regression model explains the dependent
 * variable" is not an instruction, it is a standard. This says watch LM 2,
 * read pages 6 to 10, do eight questions, and links to each.
 */

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function TaskRow({ task }: { task: PrescribedTask }) {
  const done = task.status === "done" || task.status === "completed";

  return (
    <li className={done ? styles.rowDone : styles.row}>
      <span className={styles.spine} aria-hidden="true" />
      <div className={styles.body}>
        <p className={styles.module}>
          {task.topicName}
          {task.moduleTitle ? <span className={styles.moduleName}>{task.moduleTitle}</span> : null}
        </p>

        <ul className={styles.materials}>
          {task.materials.map((material, i) => (
            <li key={i} className={styles.material}>
              {material.action ? (
                <>
                  <span className={styles.action}>{material.action}</span>{" "}
                </>
              ) : null}
              {material.url ? (
                <a
                  className={styles.link}
                  href={material.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {material.label}
                </a>
              ) : (
                <span className={styles.plain}>{material.label}</span>
              )}
              <span className={styles.meta}>
                {material.questionCount !== null
                  ? `${material.questionCount} questions`
                  : null}
                {material.questionCount !== null && material.packageName ? ", " : null}
                {material.packageName}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <span className={`${styles.minutes} tnum`}>{minutesLabel(task.estimatedMinutes)}</span>
    </li>
  );
}

export function DayPlan({
  day,
  heading,
  budgetMinutes,
}: {
  day: PrescribedDay | undefined;
  heading: string;
  /** What the candidate said this weekday is worth, for the comparison line. */
  budgetMinutes?: number;
}) {
  if (!day || day.tasks.length === 0) {
    return (
      <section className={styles.section} aria-labelledby="day-plan">
        <h2 id="day-plan" className={styles.heading}>
          {heading}
        </h2>
        <p className={styles.empty}>
          Nothing scheduled. Set your available hours on the plan screen and the days fill
          themselves.
        </p>
      </section>
    );
  }

  // The planner balances across the week rather than holding each day to its
  // own figure, so a day that runs over is working as intended. Saying so is
  // better than letting the candidate discover it and assume a bug.
  const over =
    budgetMinutes !== undefined && budgetMinutes > 0 && day.totalMinutes > budgetMinutes;

  return (
    <section className={styles.section} aria-labelledby="day-plan">
      <div className={styles.head}>
        <h2 id="day-plan" className={styles.heading}>
          {heading}
        </h2>
        <p className={`${styles.total} tnum`}>{minutesLabel(day.totalMinutes)}</p>
      </div>

      {over ? (
        <p className={styles.note}>
          Longer than your usual {minutesLabel(budgetMinutes!)} today. The week still adds up
          to the hours you set.
        </p>
      ) : null}

      <ul className={styles.list}>
        {day.tasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </ul>
    </section>
  );
}
