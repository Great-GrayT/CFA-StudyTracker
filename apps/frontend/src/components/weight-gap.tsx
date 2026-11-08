"use client";

import { useId, useState } from "react";
import {
  uncoveredWeightPoints,
  sortByStake,
  type TopicCoverage,
} from "@/lib/coverage";
import styles from "./weight-gap.module.css";

// The hero: which heavily weighted material is still untouched.
//
// Encoding is position on a common scale (bar length), which is the most
// accurately decoded visual channel there is. An earlier design used a 3D
// surface encoding weight as area and coverage as height: two channels that are
// both harder to read, on a canvas that cannot be focused or labelled.
//
// Sorting by uncovered weight points is what does the real work. A heavily
// weighted untouched topic reaches the top by construction, so the question
// "what is at stake" is answered by the order, not by reading every row.

const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export function WeightGap({
  topics,
  onSelect,
}: {
  topics: TopicCoverage[];
  onSelect?: (topicId: string) => void;
}) {
  const [asTable, setAsTable] = useState(false);
  const headingId = useId();
  const sorted = sortByStake(topics);

  if (topics.length === 0) {
    return (
      <p className={styles.empty}>
        Nothing covered yet. Every topic will appear here, biggest exam weight first.
      </p>
    );
  }

  // The widest bar sets the scale, so the comparison stays relative to what is
  // actually in front of the user rather than to an abstract maximum.
  const max = Math.max(...sorted.map(uncoveredWeightPoints), 0.001);

  return (
    <section aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.heading}>
          Uncovered weight
        </h2>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
        >
          {asTable ? "Chart" : "Table"}
        </button>
      </div>

      {asTable ? (
        <table className={`${styles.table} tnum`}>
          <caption className="visually-hidden">
            Topics by uncovered exam weight, largest first
          </caption>
          <thead>
            <tr>
              <th scope="col">Topic</th>
              <th scope="col">Uncovered</th>
              <th scope="col">Outcomes</th>
              <th scope="col">Exam weight</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.topicId}>
                <th scope="row">{t.name}</th>
                <td>{pct.format(uncoveredWeightPoints(t))} pts</td>
                <td>
                  {t.covered} of {t.total}
                </td>
                <td>
                  {t.weightMin} to {t.weightMax}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className={styles.list}>
          {sorted.map((t) => {
            const points = uncoveredWeightPoints(t);
            const coveredFraction = t.total === 0 ? 0 : t.covered / t.total;
            const label = `${t.name}, ${pct.format(points)} weight points uncovered, ${t.covered} of ${t.total} outcomes, exam weight ${t.weightMin} to ${t.weightMax} percent`;
            return (
              <li key={t.topicId}>
                <button
                  type="button"
                  className={styles.row}
                  onClick={() => onSelect?.(t.topicId)}
                  aria-label={label}
                >
                  <span className={styles.name}>{t.name}</span>
                  <span
                    className={`${styles.track} data-surface`}
                    style={{ ["--bar" as string]: `${(points / max) * 100}%` }}
                    aria-hidden="true"
                  >
                    <span className={styles.bar}>
                      <span
                        className={`${styles.covered} data-fill`}
                        style={{ ["--covered" as string]: `${coveredFraction * 100}%` }}
                      />
                    </span>
                  </span>
                  <span className={`${styles.figure} tnum`} aria-hidden="true">
                    {pct.format(points)}
                  </span>
                  <span className={`${styles.range} tnum`} aria-hidden="true">
                    {t.weightMin}-{t.weightMax}%
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
