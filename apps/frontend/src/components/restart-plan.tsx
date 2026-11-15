"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import styles from "./restart-plan.module.css";

// Starting the plan over, from Settings.
//
// Collapsed, like Delete account: it throws away the schedule the candidate is
// following, so it should take a deliberate second click. It is not
// destructive, though. The old plan is retired, not deleted, so one
// confirmation is enough and no typed phrase is asked for.

// Must match the onboarding page's key, so setup opens at step one rather than
// resuming an earlier draft.
const DRAFT_KEY = "cfa-onboarding-draft";

export function RestartPlan({ planId }: { planId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestart() {
    setPending(true);
    setError(null);
    try {
      await api.post(`plans/${planId}/restart`, {});
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Storage blocked: setup just resumes the old draft, which is harmless.
      }
      // Every cached query belongs to the retired plan.
      queryClient.clear();
      router.replace("/onboarding");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Your plan was not restarted. Nothing changed.",
      );
      setPending(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Start your plan over</h2>
      <p className={styles.lede}>
        Set up your level, exam date, hours and packages again from the first step, as if you had
        just signed up.
      </p>

      <details
        className={styles.details}
        open={open}
        onToggle={(event) => {
          setOpen(event.currentTarget.open);
          setError(null);
        }}
      >
        <summary className={styles.summary}>Start over</summary>

        <ul className={styles.effects}>
          <li>Your current schedule stops and a new one is built from your answers.</li>
          <li>
            Work you logged stays saved and in your exports, but the new plan does not count it.
            Tell setup what you have already studied and it will.
          </li>
          <li>Your packages stay as they are.</li>
        </ul>

        <button className={styles.confirm} type="button" disabled={pending} onClick={handleRestart}>
          {pending ? "Starting over" : "Start over now"}
        </button>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </details>
    </section>
  );
}
