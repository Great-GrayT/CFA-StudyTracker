"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { usePlan, useLogs, useMocks } from "@/lib/hooks";
import { api, signOut } from "@/lib/api";
import { toast } from "sonner";
import styles from "./settings.module.css";
import { SecuritySettings } from "@/components/security-settings";

const numbers = new Intl.NumberFormat("en");
const plural = new Intl.PluralRules("en");

type User = { email: string; twoStepEnabled?: boolean; hasPassword?: boolean };

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
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
  const [missedDayAlerts, setMissedDayAlerts] = useState(true);

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

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>
          <div className={styles.themeButtons}>
            <button
              type="button"
              className={theme === "system" ? styles.themeButtonActive : styles.themeButton}
              onClick={() => setTheme("system")}
            >
              System
            </button>
            <button
              type="button"
              className={theme === "light" ? styles.themeButtonActive : styles.themeButton}
              onClick={() => setTheme("light")}
            >
              Light
            </button>
            <button
              type="button"
              className={theme === "dark" ? styles.themeButtonActive : styles.themeButton}
              onClick={() => setTheme("dark")}
            >
              Dark
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Notifications</h2>
          <div className={styles.toggle}>
            <label htmlFor="missed-alerts" className={styles.toggleLabel}>
              Missed day alerts
            </label>
            <button
              id="missed-alerts"
              type="button"
              role="switch"
              aria-checked={missedDayAlerts}
              className={missedDayAlerts ? styles.switchOn : styles.switchOff}
              onClick={() => setMissedDayAlerts(!missedDayAlerts)}
              aria-label={missedDayAlerts ? "Alerts on" : "Alerts off"}
            >
              <span className={styles.switchThumb} />
            </button>
          </div>
          <p className={styles.hint}>
            Manage devices on <Link href="/watchdogs">System health</Link>.
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
      </div>
      <SecuritySettings twoStepEnabled={user?.twoStepEnabled ?? false} />

    </AppShell>
  );
}
