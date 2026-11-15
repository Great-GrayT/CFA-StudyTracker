"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useCreateSession,
  usePlanPackages,
  usePrescription,
  type SessionKind,
} from "@/lib/hooks";
import type { Curriculum, PackageRole, StudyPackage } from "@/lib/types";
import { ApiError } from "@/lib/api";
import { minutesLabel } from "./day-plan";
import styles from "./composer.module.css";
import { ConfidencePicker } from "./confidence";

// Recording study, in the shape of a plan cell: section, module, what kind of
// work, which package, how long. The plan speaks in cells, so a session the
// candidate logs is one too: the engine credits it exactly as it credits
// planned work, and the day view shows it beside the plan's own.
//
// When the day's plan already has a cell for this module and kind, the
// record settles that cell instead, so studying something is entered once,
// wherever it is entered.

const KINDS: { value: SessionKind; label: string; verb: string }[] = [
  { value: "content-notes", label: "Read notes", verb: "Read" },
  { value: "content-video", label: "Watch video", verb: "Watch" },
  { value: "eocq", label: "End of chapter questions", verb: "Questions" },
  { value: "questions", label: "Question bank", verb: "Questions" },
  { value: "review", label: "Review", verb: "Review" },
];

const QUESTION_KINDS = new Set<SessionKind>(["eocq", "questions"]);

// Which package role a kind draws on, so the package picker opens on the one
// the plan would have used.
function roleFor(kind: SessionKind): PackageRole {
  return QUESTION_KINDS.has(kind) ? "questions" : "content";
}

// The candidate's own calendar day, as the API wants it.
function localToday(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

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
  const topics = useMemo(
    () => [...(curriculum?.topics ?? [])].sort((a, b) => a.order - b.order),
    [curriculum],
  );
  const planPackages = usePlanPackages(planId);

  const [topicId, setTopicId] = useState("");
  const [readingId, setReadingId] = useState("");
  const [kind, setKind] = useState<SessionKind>("content-notes");
  const [packageId, setPackageId] = useState("");
  const [packageTouched, setPackageTouched] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [confidence, setConfidence] = useState(3);
  const [answered, setAnswered] = useState("");
  const [correct, setCorrect] = useState("");
  const [date, setDate] = useState(localToday);
  const [note, setNote] = useState("");
  const [attach, setAttach] = useState(true);
  const [finished, setFinished] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sectionRef = useRef<HTMLSelectElement>(null);
  const moduleRef = useRef<HTMLSelectElement>(null);
  const createSession = useCreateSession(planId);

  const topic = topics.find((t) => t.id === topicId);
  const readings = useMemo(
    () => [...(topic?.readings ?? [])].sort((a, b) => a.order - b.order),
    [topic],
  );
  const reading = readings.find((r) => r.id === readingId);
  const kindMeta = KINDS.find((k) => k.value === kind)!;
  const asksQuestions = QUESTION_KINDS.has(kind);

  // The plan's packages first, named; any other package the candidate owns
  // after them, so a session in something untagged can still be recorded.
  const packageOptions = useMemo(() => {
    const tagged = planPackages.data ?? [];
    const nameOf = (id: string) => packages.find((p) => p.id === id)?.name;
    const onPlan = tagged
      .map((pp) => ({ id: pp.packageId, name: pp.name ?? nameOf(pp.packageId) ?? "Package", roles: pp.roles }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const rest = packages
      .filter((p) => !onPlan.some((o) => o.id === p.id))
      .map((p) => ({ id: p.id, name: p.name, roles: [] as PackageRole[] }));
    return { onPlan, rest };
  }, [planPackages.data, packages]);

  // Follow the kind to the package the plan uses for it, until the candidate
  // picks one themselves.
  useEffect(() => {
    if (packageTouched) return;
    const wanted = packageOptions.onPlan.find((p) => p.roles.includes(roleFor(kind)));
    setPackageId(wanted?.id ?? "");
  }, [kind, packageOptions, packageTouched]);

  // The plan for the record's day, to find the cell this session is.
  const dayPlan = usePrescription(planId, date, date);
  const matchedTask = useMemo(() => {
    if (!readingId) return undefined;
    const tasks = dayPlan.data?.days[0]?.tasks ?? [];
    return tasks.find(
      (t) => !t.offPlan && t.status === "pending" && t.kind === kind && t.readingIds.includes(readingId),
    );
  }, [dayPlan.data, readingId, kind]);
  useEffect(() => {
    setAttach(true);
    setFinished(true);
    if (matchedTask) setMinutes((m) => m || String(matchedTask.estimatedMinutes));
  }, [matchedTask]);
  const recordsTask = matchedTask !== undefined && attach;

  // Opening from an outcome page starts on that outcome's module.
  useEffect(() => {
    if (!open) return;
    setError(null);
    const found = suggestedLosId
      ? topics.flatMap((t) => t.readings.map((r) => ({ t, r }))).find(({ r }) => r.los.some((l) => l.id === suggestedLosId))
      : undefined;
    if (found) {
      setTopicId(found.t.id);
      setReadingId(found.r.id);
    }
    queueMicrotask(() => sectionRef.current?.focus());
  }, [open, suggestedLosId, topics]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const minutesNum = Number(minutes);
  const minutesValid = Number.isInteger(minutesNum) && minutesNum >= 1 && minutesNum <= 600;
  const answeredNum = Number(answered) || 0;
  const correctNum = Number(correct) || 0;
  const accuracy = asksQuestions && answeredNum > 0 ? (correctNum / answeredNum) * 100 : null;
  const correctTooHigh = asksQuestions && correctNum > answeredNum;
  const packageName = [...packageOptions.onPlan, ...packageOptions.rest].find((p) => p.id === packageId)?.name;

  async function submit(andNext: boolean) {
    if (!readingId) {
      setError("Choose a section and module first.");
      return;
    }
    if (!minutesValid) {
      setError("Enter whole minutes between 1 and 600.");
      return;
    }
    if (correctTooHigh) {
      setError("Correct answers cannot exceed questions answered.");
      return;
    }
    setError(null);
    try {
      await createSession.mutateAsync({
        readingId,
        kind,
        minutes: minutesNum,
        confidence,
        date,
        ...(packageId ? { packageId } : {}),
        ...(asksQuestions ? { questionsAnswered: answeredNum, questionsCorrect: correctNum } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(recordsTask ? { taskId: matchedTask!.id, finished } : {}),
      });
      toast.success(
        recordsTask
          ? "Recorded against your plan. Your plan is updated."
          : "Recorded. Your plan is updated around it.",
      );
      onLogged?.();
      setMinutes("");
      setAnswered("");
      setCorrect("");
      setNote("");
      if (andNext) {
        // Same section, package and day: the next session is usually the
        // next module of the same sitting.
        setReadingId("");
        queueMicrotask(() => moduleRef.current?.focus());
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that. Nothing was recorded.");
    }
  }

  if (!open) return null;

  const busy = createSession.isPending;
  const ready = !!readingId && minutesValid && !correctTooHigh;

  return (
    <div className={styles.scrim} onPointerDown={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="composer-title" className={styles.title}>
            Record study
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.pair}>
            <div>
              <label className={styles.label} htmlFor="session-section">
                Section
              </label>
              <select
                id="session-section"
                ref={sectionRef}
                className={styles.input}
                value={topicId}
                onChange={(e) => {
                  setTopicId(e.target.value);
                  setReadingId("");
                }}
              >
                <option value="">Choose a section</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.label} htmlFor="session-module">
                Module
              </label>
              <select
                id="session-module"
                ref={moduleRef}
                className={styles.input}
                value={readingId}
                disabled={!topic}
                onChange={(e) => setReadingId(e.target.value)}
              >
                <option value="">{topic ? "Choose a module" : "Choose a section first"}</option>
                {readings.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>Type</legend>
            <div className={styles.kinds}>
              {KINDS.map((k) => (
                <label key={k.value} className={styles.kind}>
                  <input
                    type="radio"
                    name="session-kind"
                    value={k.value}
                    checked={kind === k.value}
                    onChange={() => setKind(k.value)}
                  />
                  <span>{k.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className={styles.pair}>
            <div>
              <label className={styles.label} htmlFor="session-package">
                Package
              </label>
              <select
                id="session-package"
                className={styles.input}
                value={packageId}
                onChange={(e) => {
                  setPackageTouched(true);
                  setPackageId(e.target.value);
                }}
              >
                <option value="">Not in a package</option>
                {packageOptions.onPlan.length > 0 && (
                  <optgroup label="On your plan">
                    {packageOptions.onPlan.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {packageOptions.rest.length > 0 && (
                  <optgroup label="Other packages">
                    {packageOptions.rest.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label className={styles.label} htmlFor="session-minutes">
                Minutes
              </label>
              <input
                id="session-minutes"
                className={styles.input}
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                value={minutes}
                aria-invalid={minutes !== "" && !minutesValid}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </div>
          </div>

          {matchedTask ? (
            <fieldset className={styles.fieldset}>
              <legend className={styles.label}>On your plan</legend>
              <label className={styles.planMatch}>
                <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
                <span>
                  This is the planned {kindMeta.label.toLowerCase()} for this module (
                  {minutesLabel(matchedTask.estimatedMinutes)})
                </span>
              </label>
              {attach ? (
                <div className={styles.planChoice} role="radiogroup" aria-label="How much of it">
                  <label>
                    <input type="radio" name="task-finished" checked={finished} onChange={() => setFinished(true)} />{" "}
                    Finished
                  </label>
                  <label>
                    <input type="radio" name="task-finished" checked={!finished} onChange={() => setFinished(false)} />{" "}
                    Got partway
                  </label>
                </div>
              ) : null}
            </fieldset>
          ) : null}

          {asksQuestions ? (
            <>
              <div className={styles.pair}>
                <div>
                  <label className={styles.label} htmlFor="answered">
                    Questions answered
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
              {/* Shown while typing, not after saving, so the review flag is
                  never a surprise. */}
              {accuracy !== null && (
                <p className={accuracy < 60 ? styles.accuracyWarn : styles.accuracy}>
                  <span aria-hidden="true" className={styles.arc} style={{ ["--pct" as string]: `${accuracy}%` }} />
                  {Math.round(accuracy)}% accuracy
                  {accuracy < 60 ? ". Below 60% flags this for review." : ""}
                </p>
              )}
            </>
          ) : null}

          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>Confidence</legend>
            <ConfidencePicker name="composer-confidence" value={confidence} onChange={setConfidence} />
          </fieldset>

          <div className={styles.pair}>
            <div>
              <label className={styles.label} htmlFor="log-date">
                Date
              </label>
              <input
                id="log-date"
                className={styles.input}
                type="date"
                value={date}
                max={localToday()}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <label className={styles.label} htmlFor="note">
                Note
              </label>
              <input
                id="note"
                className={styles.input}
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          {/* The cell this record becomes, drawn the way the day view will
              draw it, so the form's result is never a guess. */}
          {reading ? (
            <div className={styles.preview} aria-live="polite">
              <span className={styles.previewSpine} aria-hidden="true" />
              <div className={styles.previewBody}>
                <p className={styles.previewModule}>
                  {topic?.name}
                  <span className={styles.previewModuleName}>{reading.name}</span>
                  <span className={styles.previewTag}>{recordsTask ? "On plan" : "Off plan"}</span>
                </p>
                <p className={styles.previewMaterial}>
                  <span className={styles.previewVerb}>{kindMeta.verb}</span>{" "}
                  {packageName ?? "Not in a package"}
                </p>
              </div>
              <span className={`${styles.previewMinutes} tnum`}>
                {minutesValid ? minutesLabel(minutesNum) : "Minutes?"}
              </span>
            </div>
          ) : null}

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
            disabled={busy || !ready}
          >
            Record and next
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => submit(false)}
            disabled={busy || !ready}
          >
            Record
          </button>
        </footer>
      </div>
    </div>
  );
}
