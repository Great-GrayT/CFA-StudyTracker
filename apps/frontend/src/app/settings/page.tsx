"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { usePlan, useLogs, useMocks } from "@/lib/hooks";
import { api, signOut } from "@/lib/api";
import { toast } from "sonner";
import styles from "./settings.module.css";
import { SecuritySettings } from "@/components/security-settings";
import { CoachSettings, LocationSettings } from "@/components/coach-settings";
import { PlannerSettings } from "@/components/planner-settings";
import { PriorWork } from "@/components/prior-work";

const numbers = new Intl.NumberFormat("en");
const plural = new Intl.PluralRules("en");

type User = { email: string; twoStepEnabled?: boolean; hasPassword?: boolean };

export default function SettingsPage() {
  const router = useRouter();
  const plan = usePlan();
  const logs = useLogs(plan.data?.id);
  const mocks = useMocks(plan.data?.id);
  const [user, setUser] = useState<User | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  const dataCounts = useMemo(() => {
    if (!logs.data || !mocks.data) return null;
    const uniqueDates = new Set(logs.data.map((log) => log.date.split("T")[0]));
    return {
      logCount: logs.data.length,
      mockCount: mocks.data.length,
      historyDays: uniqueDates.size,
    };
  }, [logs.data, mocks.data]);

  useEffect(() => {
    async function loadUser() {
      try {
        const data = await api.get<User>("auth/me");
        setUser(data);
      } catch (err) {
        console.error("Failed to load user:", err);
      } finally {
        setUserLoading(false);
      }
    }
    loadUser();
  }, []);

  useEffect(() => {
    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setInstallPrompt(e);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);

    if (newPassword.length < 8) {
      setPasswordError("Use at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    if (!currentPassword) {
      setPasswordError("Enter your current password.");
      return;
    }

    setPasswordLoading(true);
    try {
      await api.post<void>("auth/password", {
        currentPassword,
        newPassword,
      });
      toast.success("Password changed. Signing out on all devices.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordForm(false);
      await signOut();
      router.replace("/login");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleExport(type: "all" | "log") {
    setExportLoading(true);
    try {
      const endpoint = type === "all" ? "export/all" : "export/log";
      const response = await fetch(`/api/proxy/${endpoint}`);

      if (!response.ok) {
        throw new Error("Export failed");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cfa-tracker-${type}-${new Date().toISOString().split("T")[0]}.${type === "all" ? "json" : "csv"}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success("File saved.");
    } catch (err) {
      toast.error("Export failed.");
    } finally {
      setExportLoading(false);
    }
  }

  function handleInstall() {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then(() => {
        setInstallPrompt(null);
      });
    }
  }

  const logWord = plural.select(dataCounts?.logCount ?? 0) === "one" ? "log" : "logs";
  const mockWord = plural.select(dataCounts?.mockCount ?? 0) === "one" ? "exam" : "exams";
  const dayWord = plural.select(dataCounts?.historyDays ?? 0) === "one" ? "day" : "days";

  return (
    <AppShell>
      <div className={styles.page}>
        <h1 className={styles.title}>Settings</h1>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Account</h2>
          {userLoading ? (
            <div className={styles.skeleton} />
          ) : user ? (
            <>
              <p className={styles.email}>{user.email}</p>
              {!showPasswordForm ? (
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => setShowPasswordForm(true)}
                >
                  Change password
                </button>
              ) : (
                <form onSubmit={handlePasswordChange} className={styles.form}>
                  <p className={styles.warning}>
                    Changing your password signs you out on every device. You will need to sign in
                    again.
                  </p>
                  <label htmlFor="current-password" className={styles.label}>
                    Current password
                  </label>
                  <input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className={styles.input}
                    autoComplete="current-password"
                  />

                  <label htmlFor="new-password" className={styles.label}>
                    New password
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={styles.input}
                    autoComplete="new-password"
                  />

                  <label htmlFor="confirm-password" className={styles.label}>
                    Confirm password
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={styles.input}
                  />

                  {passwordError && (
                    <p className={styles.error} role="alert">
                      {passwordError}
                    </p>
                  )}

                  <div className={styles.buttonGroup}>
                    <button
                      type="submit"
                      className={styles.actionButton}
                      disabled={passwordLoading}
                    >
                      Save changes
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => {
                        setShowPasswordForm(false);
                        setPasswordError(null);
                        setCurrentPassword("");
                        setNewPassword("");
                        setConfirmPassword("");
                      }}
                      disabled={passwordLoading}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : null}
        </section>

        {/* Appearance is not here any more. It is an icon in the navigation,
            because changing the theme is a thing people do at a moment, when
            the room gets dark, not a setting they come to this page to
            configure. */}

        {plan.isLoading ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Study coach</h2>
            <div className={styles.skeleton} />
          </section>
        ) : plan.data ? (
          <>
            <PlannerSettings plan={plan.data} onSaved={() => plan.refetch()} />
            <PriorWork plan={plan.data} onSaved={() => plan.refetch()} />
            <CoachSettings plan={plan.data} onSaved={() => plan.refetch()} />
            <LocationSettings plan={plan.data} onSaved={() => plan.refetch()} />
          </>
        ) : (
          /* Rendered rather than omitted. These preferences live on the plan,
             so with no plan there is genuinely nothing to set, but an absent
             section is indistinguishable from a missing feature: somebody
             hunting for where to switch the emails off would find nothing at
             all and conclude the setting does not exist. */
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Study coach</h2>
            <p className={styles.hint}>
              The coach writes you a plan each morning, a nudge in the evening, and a summary at
              night. Its settings live with your study plan, so they appear here once you have
              one. <Link href="/onboarding">Create a plan</Link> to turn it on.
            </p>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Devices</h2>
          <p className={styles.hint}>
            Phone notifications go to every device you have added. Add or remove one on{" "}
            <Link href="/watchdogs">System health</Link>.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Your data</h2>
          {logs.isLoading || mocks.isLoading ? (
            <div className={styles.skeleton} />
          ) : dataCounts ? (
            <>
              <p className={styles.dataSummary}>
                {numbers.format(dataCounts.logCount)} {logWord}, {numbers.format(dataCounts.mockCount)}{" "}
                mock {mockWord}, {numbers.format(dataCounts.historyDays)} {dayWord} of history.
              </p>
              {/* The counts were already here; the pages behind them were not
                  linked from anywhere in the app. This is their natural home on
                  a phone, where the bottom bar has no room for them. */}
              <p className={styles.hint}>
                Browse your <Link href="/logs">study log</Link> or your{" "}
                <Link href="/mocks">mock exams</Link>.
              </p>
              <div className={styles.buttonGroup}>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => handleExport("all")}
                  disabled={exportLoading}
                >
                  Export everything, JSON
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => handleExport("log")}
                  disabled={exportLoading}
                >
                  Export log, CSV
                </button>
              </div>
            </>
          ) : null}
        </section>

        {installPrompt && (
          <section className={styles.section}>
            <button
              type="button"
              className={styles.actionButton}
              onClick={handleInstall}
            >
              Install on this device
            </button>
          </section>
        )}

        <section className={styles.section}>
          <Link href="/watchdogs" className={styles.link}>
            System health
          </Link>
        </section>

        {/* Inside the page container, not after it. Rendered as a sibling it
            only picked up main's padding and sat 24px wider on each side than
            every other card on the screen. */}
        <SecuritySettings twoStepEnabled={user?.twoStepEnabled ?? false} />
      </div>
    </AppShell>
  );
}
