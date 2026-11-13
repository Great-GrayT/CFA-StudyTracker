"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useSubmitTask, type TaskSubmission } from "@/lib/hooks";
import { ConfidenceMeter, ConfidencePicker } from "./confidence";
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

type Submit = (submission: TaskSubmission) => Promise<unknown>;
type SubmitFor = (taskId: string, submission: TaskSubmission) => Promise<unknown>;

function SubmitControl({ task, submit }: { task: PrescribedTask; submit: Submit }) {
  const done = task.status === "done" || task.status === "completed";
  const partial = task.status === "partial";
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(String(task.estimatedMinutes));
  const [confidence, setConfidence] = useState(task.confidence ?? 0);
  // Question tasks also record how many were answered, prefilled with the
  // task's own count since that is what was set.
  const isPractice = task.kind === "questions";
  const setCount = task.materials.find((m) => m.questionCount !== null)?.questionCount ?? null;
  const [answered, setAnswered] = useState(setCount !== null ? String(setCount) : "");
  const [correct, setCorrect] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  // Set when this control caused the status change, so focus follows the
  // swapped button instead of falling to the page body. A refetch from
  // elsewhere must not steal focus.
  const acted = useRef(false);
  const panelId = useId();
  const inputId = useId();

  useEffect(() => {
    if (open) inputRef.current?.select();
  }, [open]);

  useEffect(() => {
    if (task.status === "pending") setMinutes(String(task.estimatedMinutes));
    if (!acted.current) return;
    acted.current = false;
    (task.status === "pending" ? toggleRef : undoRef).current?.focus();
  }, [task.status, task.estimatedMinutes]);

  async function send(submission: TaskSubmission) {
    setBusy(true);
    setError(null);
    try {
      acted.current = true;
      await submit(submission);
      setOpen(false);
    } catch (err) {
      acted.current = false;
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function sendWithMinutes(status: "done" | "partial") {
    const value = Number(minutes);
    if (!Number.isInteger(value) || value < 1 || value > 600) {
      setError("Enter whole minutes between 1 and 600.");
      inputRef.current?.focus();
      return;
    }
    if (confidence < 1) {
      setError("Rate how it went, 1 to 5.");
      return;
    }
    const answeredNum = Number(answered) || 0;
    const correctNum = Number(correct) || 0;
    if (isPractice && correctNum > answeredNum) {
      setError("Correct answers cannot exceed questions answered.");
      return;
    }
    void send({
      status,
      actualMinutes: value,
      confidence,
      ...(isPractice ? { questionsAnswered: answeredNum, questionsCorrect: correctNum } : {}),
    });
  }

  function close() {
    setOpen(false);
    setError(null);
    toggleRef.current?.focus();
  }

  function onPanelKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") close();
  }

  if (done || partial) {
    return (
      <div className={styles.submitted}>
        <p className={styles.status}>
          {done
            ? `Done, ${minutesLabel(task.actualMinutes ?? task.estimatedMinutes)}`
            : `Partway, ${task.actualMinutes ?? 0} of ${minutesLabel(task.estimatedMinutes)}`}
        </p>
        {task.confidence !== null ? <ConfidenceMeter value={task.confidence} label="Recorded at" /> : null}
        <button
          ref={undoRef}
          type="button"
          className={styles.textButton}
          disabled={busy}
          onClick={() => void send({ status: "pending" })}
        >
          Undo
        </button>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className={styles.markButton}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Record
      </button>
      {open ? (
        <div id={panelId} className={styles.panel} onKeyDown={onPanelKey}>
          <label className={styles.field} htmlFor={inputId}>
            <span>Minutes spent</span>
            <input
              ref={inputRef}
              id={inputId}
              className={`${styles.input} tnum`}
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              step={1}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </label>
          <div className={styles.field}>
            <span id={`${inputId}-how`}>How it went</span>
            <ConfidencePicker
              name={`${inputId}-confidence`}
              legend="How it went"
              value={confidence}
              onChange={setConfidence}
            />
          </div>
          {isPractice ? (
            <div className={styles.questionFields}>
              <label className={styles.field} htmlFor={`${inputId}-answered`}>
                <span>Answered</span>
                <input
                  id={`${inputId}-answered`}
                  className={`${styles.input} tnum`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={1000}
                  value={answered}
                  onChange={(e) => setAnswered(e.target.value)}
                />
              </label>
              <label className={styles.field} htmlFor={`${inputId}-correct`}>
                <span>Correct</span>
                <input
                  id={`${inputId}-correct`}
                  className={`${styles.input} tnum`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={1000}
                  value={correct}
                  onChange={(e) => setCorrect(e.target.value)}
                />
              </label>
            </div>
          ) : null}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => sendWithMinutes("done")}
            >
              Finished
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => sendWithMinutes("partial")}
            >
              Got partway
            </button>
            <button type="button" className={styles.textButton} onClick={close}>
              Cancel
            </button>
          </div>
          <p className={styles.hint}>
            Recording also updates your study log and scores. Got partway keeps the rest on your
            plan for a later day.
          </p>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function TaskRow({ task, onSubmit }: { task: PrescribedTask; onSubmit?: SubmitFor }) {
  const submit: Submit | undefined = onSubmit ? (s) => onSubmit(task.id, s) : undefined;
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
                  ? material.action === "Review answers"
                    ? `answers to ${material.questionCount} questions`
                    : `${material.questionCount} questions`
                  : null}
                {material.questionCount !== null && material.packageName ? ", " : null}
                {material.packageName}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <span className={`${styles.minutes} tnum`}>{minutesLabel(task.estimatedMinutes)}</span>
      {submit ? (
        <div className={styles.submit}>
          <SubmitControl task={task} submit={submit} />
        </div>
      ) : null}
    </li>
  );
}

export function DayPlan({
  day,
  heading,
  budgetMinutes,
  planId,
  submittable = false,
}: {
  day: PrescribedDay | undefined;
  heading: string;
  /** What the candidate said this weekday is worth, for the comparison line. */
  budgetMinutes?: number;
  planId?: string;
  /** True for today and earlier: work cannot be submitted for a day not yet lived. */
  submittable?: boolean;
}) {
  const submitTask = useSubmitTask(planId);
  const onSubmit: SubmitFor | undefined =
    submittable && planId
      ? (taskId, submission) => submitTask.mutateAsync({ taskId, ...submission })
      : undefined;

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
          <TaskRow key={task.id} task={task} onSubmit={onSubmit} />
        ))}
      </ul>
    </section>
  );
}
