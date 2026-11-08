"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useLevels, useCurriculum, usePackages, keys } from "@/lib/hooks";
import { hoursBetween, toISODate, startOfUTCDay } from "@/lib/pace";
import { WEEKDAYS, WEEKDAY_LABELS, type WeeklyAvailability, type PackageRole } from "@/lib/types";
import { Mark } from "@/components/mark";
import { AvailabilityEditor } from "@/components/availability-editor";
import { BackfillPicker } from "@/components/backfill-picker";
import styles from "./onboarding.module.css";

// Six steps, resumable.
//
// Step 3 (start date) exists because without it a mid-stream candidate's
// backfilled outcomes all date to today, and the app reports them as a large
// surplus. That broke the exact user the backfill screen was built for.

const DRAFT_KEY = "cfa-onboarding-draft";

type Draft = {
  step: number;
  levelId: "I" | "II" | "III" | null;
  examDate: string;
  startDate: string;
  availability: WeeklyAvailability;
  packages: Array<{ packageId: string; roles: PackageRole[] }>;
  backfill: Array<{ losId: string; confidence: number; questionsAnswered: number }>;
};

const emptyDraft: Draft = {
  step: 0,
  levelId: null,
  examDate: "",
  startDate: toISODate(startOfUTCDay(new Date())),
  availability: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
  packages: [],
  backfill: [],
};

type Action =
  | { type: "set"; patch: Partial<Draft> }
  | { type: "restore"; draft: Draft }
  | { type: "step"; delta: number };

function reducer(state: Draft, action: Action): Draft {
  switch (action.type) {
    case "set":
      return { ...state, ...action.patch };
    case "restore":
      return action.draft;
    case "step":
      return { ...state, step: Math.max(0, Math.min(5, state.step + action.delta)) };
  }
}

const STEPS = ["Level", "Exam date", "Start date", "Availability", "Packages", "Starting point"];
const hoursFmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function OnboardingPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [draft, dispatch] = useReducer(reducer, emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const levels = useLevels();
  const curriculum = useCurriculum(draft.levelId ?? undefined);
  const packages = usePackages();

  // Resumable: closing the tab mid-setup must not restart a flow whose last
  // step can take ten minutes.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) dispatch({ type: "restore", draft: { ...emptyDraft, ...JSON.parse(raw) } });
    } catch {
      // A corrupt draft is not worth failing setup over.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Private mode or a full quota: setup still works, it just will not resume.
    }
  }, [draft]);

  const weeklyHours = WEEKDAYS.reduce((sum, d) => sum + (draft.availability[d] ?? 0), 0);

  const hoursToExam = useMemo(() => {
    if (!draft.examDate || !draft.startDate) return null;
    const from = startOfUTCDay(new Date());
    const to = startOfUTCDay(new Date(draft.examDate));
    if (to.getTime() < from.getTime()) return 0;
    return hoursBetween(draft.availability, from, to);
  }, [draft.availability, draft.examDate, draft.startDate]);

  const selectedLevel = levels.data?.levels.find((l) => l.id === draft.levelId);

  const canAdvance = (() => {
    switch (draft.step) {
      case 0:
        return !!draft.levelId && selectedLevel?.available !== false;
      case 1:
        return !!draft.examDate && new Date(draft.examDate) > new Date();
      case 2:
        return !!draft.startDate && new Date(draft.startDate) <= new Date();
      case 3:
        return weeklyHours > 0;
      default:
        return true;
    }
  })();

  async function createPlan() {
    if (!draft.levelId) return;
    setSubmitting(true);
    setError(null);
    try {
      const plan = await api.post<{ id: string }>("plans", {
        levelId: draft.levelId,
        examDate: draft.examDate,
        startDate: draft.startDate,
        weeklyAvailability: draft.availability,
        ...(draft.backfill.length > 0 ? { initialLogs: draft.backfill } : {}),
      });

      // Package roles are a separate resource, so they are attached after the
      // plan exists. A failure here leaves a usable plan rather than no plan.
      for (const p of draft.packages) {
        try {
          await api.post(`plans/${plan.id}/packages`, p);
        } catch {
          toast.warning("The plan was created, but one package could not be saved.");
        }
      }

      localStorage.removeItem(DRAFT_KEY);
      qc.invalidateQueries({ queryKey: keys.plan });
      toast.success("Plan created.");
      router.replace("/today");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the plan.");
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Mark size={24} />
        <h1 className={styles.title}>Set up your plan</h1>
      </header>

      {/* A filled rule, not numbered markers: the numbers would add nothing the
          proportion does not already say. */}
      <div
        className={styles.progress}
        role="progressbar"
        aria-valuenow={draft.step + 1}
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuetext={`Step ${draft.step + 1} of ${STEPS.length}, ${STEPS[draft.step]}`}
      >
        <span style={{ width: `${((draft.step + 1) / STEPS.length) * 100}%` }} />
      </div>
      <p className={styles.stepName}>{STEPS[draft.step]}</p>

      <div className={styles.body}>
        {draft.step === 0 && (
          <section>
            <h2 className={styles.h2}>Which level are you sitting?</h2>
            {levels.isLoading && <p className={styles.muted}>Loading levels.</p>}
            <ul className={styles.levelList}>
              {levels.data?.levels.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    className={draft.levelId === l.id ? styles.levelOn : styles.level}
                    onClick={() => dispatch({ type: "set", patch: { levelId: l.id } })}
                    disabled={!l.available}
                    aria-pressed={draft.levelId === l.id}
                  >
                    <span className={styles.levelName}>Level {l.id}</span>
                    <span className={styles.levelMeta}>
                      {l.available
                        ? `${l.topicCount} topics, ${l.losCount} outcomes`
                        : "Not available yet"}
                    </span>
                    {/* Weight bars, from the 2KB summary endpoint. Pulling the
                        full tree for three levels before a choice is made
                        would be close to a megabyte. */}
                    {l.available && (
                      <span className={styles.weights} aria-hidden="true">
                        {l.topics.map((t) => (
                          <span
                            key={t.id}
                            className={styles.weight}
                            style={{
                              flexGrow: (t.examWeightMin + t.examWeightMax) / 2,
                            }}
                            title={`${t.name}, ${t.examWeightMin} to ${t.examWeightMax}%`}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {draft.step === 1 && (
          <section>
            <h2 className={styles.h2}>When is your exam?</h2>
            <label className={styles.label} htmlFor="exam-date">
              Exam date
            </label>
            <input
              id="exam-date"
              type="date"
              className={styles.input}
              value={draft.examDate}
              min={toISODate(startOfUTCDay(new Date()))}
              onChange={(e) => dispatch({ type: "set", patch: { examDate: e.target.value } })}
            />
            {draft.examDate && (
              <p className={styles.muted}>
                {Math.max(
                  0,
                  Math.round(
                    (startOfUTCDay(new Date(draft.examDate)).getTime() -
                      startOfUTCDay(new Date()).getTime()) /
                      86_400_000,
                  ),
                )}{" "}
                days from today.
              </p>
            )}
          </section>
        )}

        {draft.step === 2 && (
          <section>
            <h2 className={styles.h2}>When did you start studying?</h2>
            <p className={styles.muted}>
              If you are already part way through, set the date you actually began. Your progress
              is measured from there.
            </p>
            <label className={styles.label} htmlFor="start-date">
              Start date
            </label>
            <input
              id="start-date"
              type="date"
              className={styles.input}
              value={draft.startDate}
              max={toISODate(startOfUTCDay(new Date()))}
              onChange={(e) => dispatch({ type: "set", patch: { startDate: e.target.value } })}
            />
          </section>
        )}

        {draft.step === 3 && (
          <section>
            <h2 className={styles.h2}>How many hours a week?</h2>
            <AvailabilityEditor
              value={draft.availability}
              onChange={(availability) => dispatch({ type: "set", patch: { availability } })}
            />
            <p className={styles.health}>
              {weeklyHours} hours a week
              {hoursToExam !== null
                ? ` leaves about ${hoursFmt.format(hoursToExam)} hours before the exam.`
                : "."}
            </p>
            {selectedLevel && hoursToExam !== null && hoursToExam > 0 && (
              <p className={styles.muted}>
                That is about {(hoursToExam / selectedLevel.losCount).toFixed(1)} hours per outcome
                across {selectedLevel.losCount} outcomes.
              </p>
            )}
          </section>
        )}

        {draft.step === 4 && (
          <section>
            <h2 className={styles.h2}>Which study packages do you use?</h2>
            <p className={styles.muted}>
              Tag each one with what you use it for. The app uses this to tell content time from
              practice time, and to notice when all your questions come from one source.
            </p>
            <ul className={styles.packageList}>
              {packages.data?.map((pkg) => {
                const entry = draft.packages.find((p) => p.packageId === pkg.id);
                return (
                  <li key={pkg.id} className={styles.packageRow}>
                    <span className={styles.packageName}>{pkg.name}</span>
                    <span className={styles.roles}>
                      {(["content", "questions", "mocks"] as PackageRole[]).map((role) => {
                        const on = entry?.roles.includes(role) ?? false;
                        return (
                          <button
                            key={role}
                            type="button"
                            className={on ? styles.roleOn : styles.role}
                            aria-pressed={on}
                            onClick={() => {
                              const others = draft.packages.filter((p) => p.packageId !== pkg.id);
                              const roles = on
                                ? (entry?.roles ?? []).filter((r) => r !== role)
                                : [...(entry?.roles ?? []), role];
                              dispatch({
                                type: "set",
                                patch: {
                                  packages:
                                    roles.length > 0
                                      ? [...others, { packageId: pkg.id, roles }]
                                      : others,
                                },
                              });
                            }}
                          >
                            {role}
                          </button>
                        );
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {draft.step === 5 && (
          <BackfillPicker
            curriculum={curriculum.data}
            startDate={draft.startDate}
            availability={draft.availability}
            examDate={draft.examDate}
            value={draft.backfill}
            onChange={(backfill) => dispatch({ type: "set", patch: { backfill } })}
          />
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className={styles.footer}>
        {draft.step > 0 && (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => dispatch({ type: "step", delta: -1 })}
          >
            Back
          </button>
        )}
        {draft.step < 5 ? (
          <button
            type="button"
            className={styles.primary}
            disabled={!canAdvance}
            onClick={() => dispatch({ type: "step", delta: 1 })}
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            disabled={submitting}
            onClick={createPlan}
          >
            {submitting ? "Creating" : "Create plan"}
          </button>
        )}
      </footer>
    </main>
  );
}
