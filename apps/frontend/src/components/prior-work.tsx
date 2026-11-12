"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api, ApiError, messageForStatus } from "@/lib/api";
import { useCurriculum } from "@/lib/hooks";
import type { Plan } from "@/lib/types";
import styles from "./prior-work.module.css";

// What the candidate had already studied before the plan took over.
//
// This lives in Settings rather than only in onboarding on purpose. A planner
// that assumes nobody has deviated from it is a planner for a plan nobody has
// used: people arrive having read three topic areas on their own, and they also
// disappear for a fortnight in March and come back having ground question banks
// instead of following the schedule. Both are the same problem, and a form that
// only exists during sign-up can only solve the first.
//
// Declared per topic area, because that is the resolution anyone remembers.
// Nobody knows how many questions they answered against a particular learning
// outcome; they know they have been through Quantitative Methods and got about
// seven in ten right.
//
// Reading and questions are asked separately because they lead to opposite
// plans. Material read but not practised earns question-only days. Material
// practised but never read earns reading-only days, unless the practice was
// good enough to prove the reading would teach nothing, in which case it is
// dropped.

type Row = {
  read: boolean;
  questionsAnswered: string;
  accuracyPercent: string;
};

const emptyRow: Row = { read: false, questionsAnswered: "", accuracyPercent: "" };

export function PriorWork({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const curriculum = useCurriculum(plan.levelId);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  const topics = useMemo(
    () => (curriculum.data?.topics ?? []).slice().sort((a, b) => a.order - b.order),
    [curriculum.data],
  );

  const declared = topics.filter((topic) => {
    const row = rows[topic.id];
    if (!row) return false;
    return row.read || Number(row.questionsAnswered) > 0;
  });

  function update(topicId: string, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [topicId]: { ...emptyRow, ...prev[topicId], ...patch } }));
  }

  async function save() {
    setPending(true);
    try {
      await api.post(`plans/${plan.id}/prior-work`, {
        declarations: declared.map((topic) => {
          const row = rows[topic.id] ?? emptyRow;
          const answered = Number(row.questionsAnswered) || 0;
          const accuracy = row.accuracyPercent === "" ? null : Number(row.accuracyPercent);
          return {
            topicId: topic.id,
            read: row.read,
            questionsAnswered: answered,
            accuracyPercent: answered > 0 ? accuracy : null,
          };
        }),
      });
      toast.success(
        declared.length === 0
          ? "Cleared what you had already studied."
          : "Saved. The days ahead have been replanned around it.",
      );
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? messageForStatus(err.status) : "Could not save that. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>What you have already studied</h2>
      <p className={styles.lede}>
        Tell the planner what you got through before it took over, or during any stretch you went
        your own way. It stops the plan asking you to read something twice, and it puts your
        practice where there is already reading behind it.
      </p>

      <details className={styles.details} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className={styles.summary}>
          {declared.length === 0
            ? "Add what you have done"
            : `${declared.length} of ${topics.length} topic areas filled in`}
        </summary>

        {curriculum.isLoading && <p className={styles.note}>Loading the curriculum.</p>}

        {curriculum.isError && (
          <p className={styles.note}>
            The curriculum did not load, so there is nothing to declare against yet. Reload the
            page to try again.
          </p>
        )}

        {!curriculum.isLoading && !curriculum.isError && topics.length === 0 && (
          <p className={styles.note}>
            The curriculum for your level has not been loaded yet, so there is nothing to declare
            against.
          </p>
        )}

        {topics.length > 0 && (
          <>
            <p className={styles.note}>
              Rough figures are fine and far better than none. Leave a topic area blank if you have
              not touched it.
            </p>

            <ul className={styles.list}>
              {topics.map((topic) => {
                const row = rows[topic.id] ?? emptyRow;
                const answered = Number(row.questionsAnswered) || 0;
                const readId = `prior-read-${topic.id}`;
                const answeredId = `prior-answered-${topic.id}`;
                const accuracyId = `prior-accuracy-${topic.id}`;

                return (
                  <li key={topic.id} className={styles.row}>
                    <h3 className={styles.topic}>{topic.name}</h3>

                    <div className={styles.controls}>
                      <div className={styles.check}>
                        <input
                          id={readId}
                          type="checkbox"
                          checked={row.read}
                          disabled={pending}
                          onChange={(event) => update(topic.id, { read: event.target.checked })}
                        />
                        <label htmlFor={readId}>I have read it</label>
                      </div>

                      <div className={styles.field}>
                        <label className={styles.fieldLabel} htmlFor={answeredId}>
                          Questions answered
                        </label>
                        <input
                          className={styles.number}
                          id={answeredId}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={100000}
                          step={1}
                          placeholder="0"
                          value={row.questionsAnswered}
                          disabled={pending}
                          onChange={(event) =>
                            update(topic.id, { questionsAnswered: event.target.value })
                          }
                        />
                      </div>

                      <div className={styles.field}>
                        <label className={styles.fieldLabel} htmlFor={accuracyId}>
                          About how many right
                        </label>
                        <div className={styles.percentWrap}>
                          <input
                            className={styles.number}
                            id={accuracyId}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={100}
                            step={1}
                            placeholder="70"
                            value={row.accuracyPercent}
                            disabled={pending || answered === 0}
                            aria-describedby={answered === 0 ? `${accuracyId}-why` : undefined}
                            onChange={(event) =>
                              update(topic.id, { accuracyPercent: event.target.value })
                            }
                          />
                          <span className={styles.percent}>%</span>
                        </div>
                        {answered === 0 && (
                          <p className={styles.why} id={`${accuracyId}-why`}>
                            Needs a question count first.
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className={styles.actions}>
              <button className={styles.save} type="button" disabled={pending} onClick={save}>
                {pending ? "Saving" : "Save and replan"}
              </button>
              <p className={styles.caution}>
                This replaces whatever you declared before, rather than adding to it. Work you have
                logged inside the app is never touched.
              </p>
            </div>
          </>
        )}
      </details>
    </section>
  );
}
