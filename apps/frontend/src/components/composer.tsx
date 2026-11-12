"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import { useCreateLog, flattenCurriculum, type FlatLos } from "@/lib/hooks";
import { toISODate, startOfUTCDay } from "@/lib/pace";
import type { Curriculum, StudyPackage } from "@/lib/types";
import { ApiError } from "@/lib/api";
import styles from "./composer.module.css";
import { ConfidencePicker } from "./confidence";

// Logging a session.
//
// Outcome search is the FIRST field, always. An earlier design pre-filled from
// the study-next list and offered no alternative, which left the product's core
// verb unreachable for any outcome the list did not happen to suggest.


export function Composer({
  open,
  onClose,
  planId,
  curriculum,
  packages,
  suggestedLosId,
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  planId: string | undefined;
  curriculum: Curriculum | undefined;
  packages: StudyPackage[];
  suggestedLosId?: string;
  onLogged?: () => void;
}) {
  const all = useMemo(() => flattenCurriculum(curriculum), [curriculum]);
  const [query, setQuery] = useState("");
  const [losId, setLosId] = useState<string | undefined>(suggestedLosId);
  const [confidence, setConfidence] = useState(3);
  const [answered, setAnswered] = useState("");
  const [correct, setCorrect] = useState("");
  const [packageId, setPackageId] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(toISODate(startOfUTCDay(new Date())));
  const [showExtras, setShowExtras] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const createLog = useCreateLog(planId);

  useEffect(() => {
    if (open) {
      setLosId(suggestedLosId);
      setError(null);
      // Focus search, not the first control: picking the outcome is the step
      // that actually needs attention.
      queueMicrotask(() => searchRef.current?.focus());
    }
  }, [open, suggestedLosId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 200);
    const terms = q.split(/\s+/);
    return all
      .filter((l) => {
        const hay = `${l.text} ${l.topicName} ${l.readingName}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 200);
  }, [all, query]);

  const selected = losId ? all.find((l) => l.id === losId) : undefined;

  const answeredNum = Number(answered) || 0;
  const correctNum = Number(correct) || 0;
  const accuracy = answeredNum > 0 ? (correctNum / answeredNum) * 100 : null;
  const correctTooHigh = correctNum > answeredNum;

  async function submit(andNext: boolean) {
    if (!losId) {
      setError("Choose an outcome first.");
      return;
    }
    if (correctTooHigh) {
      setError("Correct answers cannot exceed questions answered.");
      return;
    }
    setError(null);
    try {
      await createLog.mutateAsync({
        losId,
        confidence,
        questionsAnswered: answeredNum,
        questionsCorrect: correctNum,
        ...(packageId ? { packageId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        date,
      });
      toast.success(andNext ? "Logged. Next outcome ready." : "Logged.");
      onLogged?.();
      setAnswered("");
      setCorrect("");
      setNote("");
      if (andNext) {
        setLosId(undefined);
        setQuery("");
        queueMicrotask(() => searchRef.current?.focus());
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that.");
    }
  }

  if (!open) return null;

  return (
    <div className={styles.scrim} onPointerDown={onClose}>
      <div
        ref={dialogRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="Log a session"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Log a session</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className={styles.body}>
          <label className={styles.label} htmlFor="los-search">
            Outcome
          </label>
          {selected ? (
            <div className={styles.selected}>
              <p className={`${styles.selectedText} prose`}>{selected.text}</p>
              <p className={styles.selectedMeta}>
                {selected.topicName}, {selected.readingName}
              </p>
              <button
                type="button"
                className={styles.change}
                onClick={() => {
                  setLosId(undefined);
                  queueMicrotask(() => searchRef.current?.focus());
                }}
              >
                Choose a different outcome
              </button>
            </div>
          ) : (
            <>
              <input
                id="los-search"
                ref={searchRef}
                className={styles.input}
                type="search"
                placeholder="Search outcomes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
              <div className={styles.results}>
                {results.length === 0 ? (
                  <p className={styles.noResults}>
                    No outcomes match. Try a shorter phrase, or browse by topic.
                  </p>
                ) : (
                  <Virtuoso
                    style={{ height: 240 }}
                    data={results}
                    itemContent={(_, l: FlatLos) => (
                      <button
                        type="button"
                        className={styles.result}
                        onClick={() => setLosId(l.id)}
                      >
                        <span className={`${styles.resultText} prose`}>{l.text}</span>
                        <span className={styles.resultMeta}>
                          {l.topicName}, {l.readingName}
                        </span>
                      </button>
                    )}
                  />
                )}
              </div>
            </>
          )}

          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>Confidence</legend>
            <ConfidencePicker
              name="composer-confidence"
              value={confidence}
              onChange={setConfidence}
            />
          </fieldset>

          <div className={styles.pair}>
            <div>
              <label className={styles.label} htmlFor="answered">
                Questions
              </label>
              <input
                id="answered"
                className={styles.input}
                type="number"
                inputMode="numeric"
                min={0}
                value={answered}
                onChange={(e) => setAnswered(e.target.value)}
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="correct">
                Correct
              </label>
              <input
                id="correct"
                className={styles.input}
                type="number"
                inputMode="numeric"
                min={0}
                value={correct}
                onChange={(e) => setCorrect(e.target.value)}
                aria-invalid={correctTooHigh}
              />
            </div>
          </div>

          {/* The threshold is shown while typing, not after saving, so the
              review flag is never a surprise. */}
          {accuracy !== null && (
            <p className={accuracy < 60 ? styles.accuracyWarn : styles.accuracy}>
              <span aria-hidden="true" className={styles.arc} style={{ ["--pct" as string]: `${accuracy}%` }} />
              {Math.round(accuracy)}% accuracy
              {accuracy < 60 ? ". Below 60% flags this for review." : ""}
            </p>
          )}

          <button
            type="button"
            className={styles.disclosure}
            onClick={() => setShowExtras((v) => !v)}
            aria-expanded={showExtras}
          >
            {showExtras ? "Hide" : "Add"} date, package, note
          </button>

          {showExtras && (
            <div className={styles.extras}>
              <label className={styles.label} htmlFor="log-date">
                Date
              </label>
              <input
                id="log-date"
                className={styles.input}
                type="date"
                value={date}
                max={toISODate(startOfUTCDay(new Date()))}
                onChange={(e) => setDate(e.target.value)}
              />

              <label className={styles.label} htmlFor="package">
                Package
              </label>
              <select
                id="package"
                className={styles.input}
                value={packageId}
                onChange={(e) => setPackageId(e.target.value)}
              >
                <option value="">None</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <label className={styles.label} htmlFor="note">
                Note
              </label>
              <textarea
                id="note"
                className={styles.input}
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => submit(true)}
            disabled={createLog.isPending || !losId}
          >
            Log and next
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => submit(false)}
            disabled={createLog.isPending || !losId}
          >
            Log
          </button>
        </footer>
      </div>
    </div>
  );
}
