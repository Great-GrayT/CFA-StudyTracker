"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useLevels, useCurriculum, usePackages, usePlan, keys } from "@/lib/hooks";
import { hoursBetween, toISODate, startOfUTCDay } from "@/lib/pace";
import { WEEKDAYS, type WeeklyAvailability, type PackageRole } from "@/lib/types";
import { Mark } from "@/components/mark";
import { HoursEditor } from "@/components/plan/hours-editor";
import { PackagesEditor } from "@/components/plan/packages-editor";
import { BackfillPicker } from "@/components/backfill-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

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

const noteClass = "text-muted-foreground text-[13px] leading-5";
const errorClass = "text-alarm-ink text-[13px] leading-5";
const questionClass = "text-[20px] leading-7 font-semibold";

export default function OnboardingPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [draft, dispatch] = useReducer(reducer, emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const levels = useLevels();
  const curriculum = useCurriculum(draft.levelId ?? undefined);
  const packages = usePackages();
  const plan = usePlan();

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
      const created = await api.post<{ id: string }>("plans", {
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
          await api.post(`plans/${created.id}/packages`, p);
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

  const percent = ((draft.step + 1) / STEPS.length) * 100;

  return (
    <main id="main" className="bg-background text-foreground flex min-h-dvh flex-col">
      <header className="border-border flex h-14 items-center gap-3 border-b px-4 md:px-8">
        <Mark size={24} />
        <h1 className="text-[16px] leading-6 font-semibold">Set up your plan</h1>
        {!plan.isSuccess && (
          <p className="text-muted-foreground ml-auto text-[13px] tabular-nums">
            Step {draft.step + 1} of {STEPS.length}
          </p>
        )}
      </header>

      {/* A filled rule, not numbered markers: the numbers would add nothing the
          proportion does not already say. */}
      {!plan.isSuccess && (
        <Progress
          value={percent}
          className="h-[3px] rounded-none"
          aria-label="Setup progress"
          aria-valuetext={`Step ${draft.step + 1} of ${STEPS.length}, ${STEPS[draft.step]}`}
        />
      )}

      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
        {plan.isSuccess ? (
          <section className="flex flex-col gap-4">
            <h2 className={questionClass}>You already have a plan</h2>
            <p className={noteClass}>
              Your plan is set up. Open it to see today, or start a new one from Settings.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/plan">Open your plan</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/settings#start-over">Start a new plan</Link>
              </Button>
            </div>
          </section>
        ) : (
          <>
            {draft.step === 0 && (
              <section className="flex flex-col gap-4">
                <h2 className={questionClass}>Which level are you sitting?</h2>
                {levels.isLoading && <p className={noteClass}>Loading levels.</p>}
                <ul className="border-border flex flex-col border-y">
                  {levels.data?.levels.map((l) => {
                    const on = draft.levelId === l.id;
                    return (
                      <li key={l.id} className="border-border border-b last:border-b-0">
                        <button
                          type="button"
                          className={cn(
                            "flex min-h-11 w-full flex-col gap-2 px-1 py-3 text-left disabled:opacity-50 md:min-h-9",
                            on && "bg-primary/10",
                          )}
                          onClick={() => dispatch({ type: "set", patch: { levelId: l.id } })}
                          disabled={!l.available}
                          aria-pressed={on}
                        >
                          <span className="flex items-baseline justify-between gap-3">
                            <span className={cn("text-[14px] font-medium", on && "text-primary")}>
                              Level {l.id}
                            </span>
                            <span className="text-muted-foreground text-[13px] tabular-nums">
                              {l.available
                                ? `${l.topicCount} topics, ${l.losCount} outcomes`
                                : "Not available yet"}
                            </span>
                          </span>
                          {/* Weight bars, from the 2KB summary endpoint. Pulling the
                              full tree for three levels before a choice is made
                              would be close to a megabyte. */}
                          {l.available && (
                            <span className="flex h-1 w-full gap-px" aria-hidden="true">
                              {l.topics.map((t) => (
                                <span
                                  key={t.id}
                                  className={on ? "bg-primary" : "bg-muted-foreground/40"}
                                  style={{ flexGrow: (t.examWeightMin + t.examWeightMax) / 2 }}
                                  title={`${t.name}, ${t.examWeightMin} to ${t.examWeightMax}%`}
                                />
                              ))}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {draft.step === 1 && (
              <section className="flex flex-col gap-4">
                <h2 className={questionClass}>When is your exam?</h2>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="exam-date">Exam date</Label>
                  <Input
                    id="exam-date"
                    type="date"
                    className="max-w-[240px]"
                    value={draft.examDate}
                    min={toISODate(startOfUTCDay(new Date()))}
                    onChange={(e) => dispatch({ type: "set", patch: { examDate: e.target.value } })}
                  />
                </div>
                {draft.examDate && (
                  <p className={noteClass}>
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
              <section className="flex flex-col gap-4">
                <h2 className={questionClass}>When did you start studying?</h2>
                <p className={noteClass}>
                  If you are already part way through, set the date you actually began. Your progress
                  is measured from there.
                </p>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="start-date">Start date</Label>
                  <Input
                    id="start-date"
                    type="date"
                    className="max-w-[240px]"
                    value={draft.startDate}
                    max={toISODate(startOfUTCDay(new Date()))}
                    onChange={(e) => dispatch({ type: "set", patch: { startDate: e.target.value } })}
                  />
                </div>
              </section>
            )}

            {draft.step === 3 && (
              <section className="flex flex-col gap-4">
                <h2 className={questionClass}>How many hours a week?</h2>
                <HoursEditor
                  value={draft.availability}
                  onChange={(availability) => dispatch({ type: "set", patch: { availability } })}
                />
                <p className="text-[14px] tabular-nums">
                  {weeklyHours} hours a week
                  {hoursToExam !== null
                    ? ` leaves about ${hoursFmt.format(hoursToExam)} hours before the exam.`
                    : "."}
                </p>
                {selectedLevel && hoursToExam !== null && hoursToExam > 0 && (
                  <p className={noteClass}>
                    That is about {(hoursToExam / selectedLevel.losCount).toFixed(1)} hours per outcome
                    across {selectedLevel.losCount} outcomes.
                  </p>
                )}
              </section>
            )}

            {draft.step === 4 && (
              <section className="flex flex-col gap-4">
                <h2 className={questionClass}>Which study packages do you use?</h2>
                <p className={noteClass}>
                  Tag each one with what you use it for. The app uses this to tell content time from
                  practice time, and to notice when all your questions come from one source.
                </p>
                <PackagesEditor
                  selected={draft.packages}
                  onChange={(packages) => dispatch({ type: "set", patch: { packages } })}
                />
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
              <p className={errorClass} role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>

      {!plan.isSuccess && (
        <footer className="border-border bg-background sticky bottom-0 border-t px-4 py-3 md:px-8">
          <div className="mx-auto flex w-full max-w-[640px] items-center justify-between gap-3">
            {draft.step > 0 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => dispatch({ type: "step", delta: -1 })}
              >
                Back
              </Button>
            ) : (
              <span />
            )}
            {draft.step < 5 ? (
              <Button
                type="button"
                disabled={!canAdvance}
                onClick={() => dispatch({ type: "step", delta: 1 })}
              >
                Continue
              </Button>
            ) : (
              <Button type="button" disabled={submitting} onClick={createPlan}>
                {submitting ? "Creating" : "Create plan"}
              </Button>
            )}
          </div>
        </footer>
      )}
    </main>
  );
}
