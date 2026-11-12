"use client";

import { useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { flattenCurriculum } from "@/lib/hooks";
import { hoursBetween, startOfUTCDay } from "@/lib/pace";
import type { Curriculum, WeeklyAvailability } from "@/lib/types";
import styles from "./backfill-picker.module.css";
import { ConfidenceMeter, ConfidencePicker } from "./confidence";

// Declaring what you have already covered.
//
// The hard constraint is scale: a mid-stream Level II candidate may have
// covered 200 of 700 outcomes, and asking them to tick 200 boxes loses them.
// So "by reading" is the default, because one tap covers 11 to 16 outcomes and
// it matches how candidates actually remember progress ("I finished Quant
// through hypothesis testing").

export type BackfillEntry = { losId: string; confidence: number; questionsAnswered: number };

const fmt = new Intl.NumberFormat("en");
const plural = new Intl.PluralRules("en");

export function BackfillPicker({
  curriculum,
  startDate,
  availability,
  examDate,
  value,
  onChange,
}: {
  curriculum: Curriculum | undefined;
  startDate: string;
  availability: WeeklyAvailability;
  examDate: string;
  value: BackfillEntry[];
  onChange: (next: BackfillEntry[]) => void;
}) {
  const [mode, setMode] = useState<"reading" | "outcome">("reading");
  const [confidence, setConfidence] = useState(3);
  const [query, setQuery] = useState("");

  const all = useMemo(() => flattenCurriculum(curriculum), [curriculum]);
  const selected = useMemo(() => new Map(value.map((v) => [v.losId, v])), [value]);

  const totalOutcomes = all.length;
  const avgConfidence =
    value.length > 0 ? value.reduce((s, v) => s + v.confidence, 0) / value.length : 0;

  // What the marked work means against the plan's own pace, which is the whole
  // reason the start date is collected before this step.
  const standing = useMemo(() => {
    if (!startDate || !examDate || totalOutcomes === 0) return null;
    const start = startOfUTCDay(new Date(startDate));
    const exam = startOfUTCDay(new Date(examDate));
    const today = startOfUTCDay(new Date());
    if (today.getTime() <= start.getTime()) return null;

    const totalHours = hoursBetween(availability, start, exam);
    if (totalHours <= 0) return null;
    const rate = totalOutcomes / totalHours;
    const elapsed = hoursBetween(availability, start, today);
    const target = Math.round(rate * elapsed);
    return { target, delta: value.length - target };
  }, [startDate, examDate, availability, totalOutcomes, value.length]);

  function setReading(readingId: string, on: boolean) {
    const ids = all.filter((l) => l.readingId === readingId).map((l) => l.id);
    const without = value.filter((v) => !ids.includes(v.losId));
    onChange(
      on ? [...without, ...ids.map((losId) => ({ losId, confidence, questionsAnswered: 0 }))] : without,
    );
  }

  function toggleOutcome(losId: string) {
    const existing = selected.get(losId);
    onChange(
      existing
        ? value.filter((v) => v.losId !== losId)
        : [...value, { losId, confidence, questionsAnswered: 0 }],
    );
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    const terms = q.split(/\s+/);
    return all.filter((l) =>
      terms.every((t) => `${l.text} ${l.topicName} ${l.readingName}`.toLowerCase().includes(t)),
    );
  }, [all, query]);

  if (!curriculum) {
    return <p className={styles.muted}>Loading the curriculum.</p>;
  }

  return (
    <section>
      <h2 className={styles.h2}>What have you already done?</h2>
      <p className={styles.muted}>
        Mark whole readings, or pick single outcomes. Skip if you are starting fresh.
      </p>

      <div className={styles.segmented} role="tablist" aria-label="How to mark your progress">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "reading"}
          className={mode === "reading" ? styles.segOn : styles.seg}
          onClick={() => setMode("reading")}
        >
          By reading
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "outcome"}
          className={mode === "outcome" ? styles.segOn : styles.seg}
          onClick={() => setMode("outcome")}
        >
          By outcome
        </button>
      </div>

      <fieldset className={styles.confidenceWrap}>
        <legend className={styles.label}>Confidence for what you mark</legend>
        <ConfidencePicker
          name="backfill-confidence"
          value={confidence}
          onChange={setConfidence}
          legend="Confidence for what you mark"
        />
      </fieldset>

      {mode === "reading" ? (
        <div className={styles.tree}>
          {curriculum.topics.map((topic) => (
            <details key={topic.id} className={styles.topic}>
              <summary className={styles.topicSummary}>
                <span>{topic.name}</span>
                <span className={styles.topicWeight}>
                  {topic.examWeightMin}-{topic.examWeightMax}%
                </span>
              </summary>
              <ul className={styles.readingList}>
                {topic.readings.map((reading) => {
                  const ids = reading.los.map((l) => l.id);
                  const marked = ids.filter((id) => selected.has(id)).length;
                  const all_ = marked === ids.length && ids.length > 0;
                  return (
                    <li key={reading.id}>
                      <label className={styles.readingRow}>
                        <input
                          type="checkbox"
                          checked={all_}
                          ref={(el) => {
                            // Partially marked readings read as indeterminate
                            // rather than as unchecked, which would be a lie.
                            if (el) el.indeterminate = marked > 0 && !all_;
                          }}
                          onChange={(e) => setReading(reading.id, e.target.checked)}
                        />
                        <span className={styles.readingName}>{reading.name}</span>
                        <span className={`${styles.readingCount} tnum`}>
                          {marked > 0 ? `${marked}/${ids.length}` : ids.length}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
      ) : (
        <div className={styles.outcomeMode}>
          <label className={styles.label} htmlFor="backfill-search">
            Search outcomes
          </label>
          <input
            id="backfill-search"
            type="search"
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          <div className={styles.results}>
            <Virtuoso
              style={{ height: 320 }}
              data={results}
              itemContent={(_, l) => (
                <label className={styles.outcomeRow}>
                  <input
                    type="checkbox"
                    checked={selected.has(l.id)}
                    onChange={() => toggleOutcome(l.id)}
                  />
                  <span className={styles.outcomeText}>
                    <span className="prose">{l.text}</span>
                    <span className={styles.outcomeMeta}>
                      {l.topicName}, {l.readingName}
                    </span>
                  </span>
                </label>
              )}
            />
          </div>
        </div>
      )}

      <div className={styles.tally} role="status">
        <p className={styles.tallyMain}>
          <span className="tnum">{fmt.format(value.length)}</span> of{" "}
          <span className="tnum">{fmt.format(totalOutcomes)}</span>{" "}
          {plural.select(totalOutcomes) === "one" ? "outcome" : "outcomes"} marked
          {value.length > 0 ? (
            <>
              , average confidence{" "}
              {/* The fractional case this component exists for: an average of
                  several ratings is rarely a whole number, and rounding 3.5 up
                  to 4 overstates what was marked. */}
              <ConfidenceMeter value={avgConfidence} label="Average confidence" />
            </>
          ) : null}
          .
        </p>
        {standing && (
          <p className={styles.tallyMeta}>
            Since {new Date(startDate).toLocaleDateString()} that is{" "}
            {standing.delta === 0
              ? "exactly on"
              : `${Math.abs(standing.delta)} ${standing.delta > 0 ? "ahead of" : "behind"}`}{" "}
            the pace your plan needs.
          </p>
        )}
      </div>
    </section>
  );
}
