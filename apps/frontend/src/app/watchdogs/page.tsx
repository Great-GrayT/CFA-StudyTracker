"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { useCronStatus, usePushDevices } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { isPushSupported, getExistingSubscription, subscribeToPush, unsubscribeFromPush, getPermission } from "@/lib/push";
import { getVapidPublicKey } from "@/lib/vapid";
import { toast } from "sonner";
import styles from "./watchdogs.module.css";

const numbers = new Intl.NumberFormat("en");
const plural = new Intl.PluralRules("en");

type CronRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  plansProcessed: number;
  plansFailed: number;
  plansSkipped: number;
  manual: boolean;
  error: string | null;
};

export default function WatchdogsPage() {
  const cronStatus = useCronStatus();
  const pushDevices = usePushDevices();
  const [currentSubscription, setCurrentSubscription] = useState<PushSubscription | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [unsubscribing, setUnsubscribing] = useState<string | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [missedDayAlerts, setMissedDayAlerts] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [iosNotInstalled, setIosNotInstalled] = useState(false);

  useEffect(() => {
    async function loadCurrentSubscription() {
      const sub = await getExistingSubscription();
      setCurrentSubscription(sub);
    }
    if (isPushSupported()) {
      loadCurrentSubscription();
    }
  }, []);

  const nightGrid = useMemo(() => {
    if (!cronStatus.data?.runs) return [];
    const runs = cronStatus.data.runs;
    const today = new Date();
    const nights: Array<{ date: Date; run: CronRun | null }> = [];

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      const run = runs.find((r) => r.startedAt.split("T")[0] === dateStr) || null;
      nights.push({ date, run });
    }

    return nights;
  }, [cronStatus.data?.runs]);

  async function handleRunNow() {
    setRunLoading(true);
    try {
      await api.post<CronRun>("cron/run", {});
      toast.success("Run finished. Check the grid below.");
      cronStatus.refetch?.();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Run failed.";
      toast.error(msg);
    } finally {
      setRunLoading(false);
    }
  }

  async function handleAddDevice() {
    setPermissionDenied(false);
    setIosNotInstalled(false);

    if (!isPushSupported()) {
      setIosNotInstalled(true);
      return;
    }

    const permission = await getPermission();
    if (permission === "denied") {
      setPermissionDenied(true);
      return;
    }

    setSubscribing(true);
    try {
      const vapidKey = getVapidPublicKey();
      if (!vapidKey) {
        throw new Error("Push not configured.");
      }
      await subscribeToPush(vapidKey);
      const sub = await getExistingSubscription();
      setCurrentSubscription(sub);
      toast.success("Device added. You will get notifications.");
      pushDevices.refetch?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to subscribe.";
      if (msg.includes("permission")) {
        setPermissionDenied(true);
      } else {
        toast.error(msg);
      }
    } finally {
      setSubscribing(false);
    }
  }

  async function handleRemoveDevice(endpoint: string) {
    setUnsubscribing(endpoint);
    try {
      if (endpoint === currentSubscription?.endpoint) {
        await unsubscribeFromPush();
        setCurrentSubscription(null);
      } else {
        await api.del<void>("push/subscribe", { endpoint });
      }
      toast.success("Device removed.");
      pushDevices.refetch?.();
    } catch (err) {
      toast.error("Failed to remove device.");
    } finally {
      setUnsubscribing(null);
    }
  }

  const lastRun = cronStatus.data?.runs?.[0];
  const nextRunAt = cronStatus.data?.nextRunAt;
  const schedule = cronStatus.data?.schedule;
  const isStalled = cronStatus.data?.stalled ?? false;

  const planWord = plural.select(lastRun?.plansProcessed ?? 0) === "one" ? "plan" : "plans";
  const failWord = plural.select(lastRun?.plansFailed ?? 0) === "one" ? "plan" : "plans";

  return (
    <AppShell>
      <div className={styles.page}>
        <h1 className={styles.title}>System health</h1>

        {cronStatus.isLoading ? (
          <div className={styles.skeleton} aria-busy="true" aria-label="Loading cron status">
            <div className={styles.skelBlock} />
            <div className={styles.skelBlock} />
          </div>
        ) : (
          <>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Nightly snapshot</h2>
              {lastRun ? (
                <div className={styles.summary}>
                  <p className={styles.summaryText}>
                    Ran at {new Date(lastRun.startedAt).toLocaleTimeString([], { timeStyle: "short" })} UTC today.
                  </p>
                  <p className={styles.summaryText}>
                    {numbers.format(lastRun.plansProcessed)} {planWord} recorded
                    {lastRun.plansFailed > 0 && `, ${numbers.format(lastRun.plansFailed)} ${failWord} failed`}.
                  </p>
                </div>
              ) : (
                <p className={styles.summaryText}>No nightly runs recorded yet. The first one lands at 3:00 UTC.</p>
              )}
            </section>

            <NightGrid nights={nightGrid} />

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Next run</h2>
              {isStalled ? (
                <p className={styles.warning}>
                  No run recorded for more than 48 hours. The scheduler on the server may be stopped.
                </p>
              ) : nextRunAt ? (
                <Countdown targetDate={nextRunAt} />
              ) : null}

              <div className={styles.schedule}>
                <p className={styles.scheduleLabel}>Schedule (set on the server, not here)</p>
                <code className={styles.cron}>{schedule || "0 3 * * *"}</code>
              </div>

              <button
                type="button"
                className={styles.actionButton}
                onClick={handleRunNow}
                disabled={runLoading}
              >
                Run now
              </button>
            </section>

            {isPushSupported() && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Push notifications</h2>

                {pushDevices.data?.subscriptions && pushDevices.data.subscriptions.length > 0 && (
                  <div className={styles.deviceList}>
                    {pushDevices.data.subscriptions.map((device) => {
                      const isThisDevice = currentSubscription?.endpoint === device.endpoint;
                      return (
                        <div key={device.id} className={styles.device}>
                          <div className={styles.deviceInfo}>
                            <span className={styles.deviceName}>
                              {isThisDevice && <span className={styles.badge}>This device</span>}
                            </span>
                            <span className={styles.deviceDate}>
                              Added {new Date(device.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <button
                            type="button"
                            className={styles.removeButton}
                            onClick={() => handleRemoveDevice(device.endpoint)}
                            disabled={unsubscribing === device.endpoint}
                            aria-label={`Remove device ${isThisDevice ? "this device" : ""}`}
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {permissionDenied && (
                  <p className={styles.error}>
                    Notifications are blocked for this site. Your browser settings control that.
                  </p>
                )}

                {iosNotInstalled && (
                  <p className={styles.error}>
                    Add this app to your home screen first. iOS only allows notifications for installed apps.
                  </p>
                )}

                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={handleAddDevice}
                  disabled={subscribing || !!currentSubscription}
                >
                  {currentSubscription ? "Added" : "Add this device"}
                </button>
              </section>
            )}

            <section className={styles.section}>
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
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}

function NightGrid({ nights }: { nights: Array<{ date: Date; run: CronRun | null }> }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>30 night grid</h2>
      <div className={styles.grid} role="img" aria-label={gridAriaLabel(nights)}>
        {nights.map((night, idx) => (
          <NightCell key={idx} night={night} />
        ))}
      </div>
      <div className={styles.gridLegend}>
        <div className={styles.legendItem}>
          <div className={`${styles.mark} ${styles.markRecorded}`} />
          <span>Recorded</span>
        </div>
        <div className={styles.legendItem}>
          <div className={`${styles.mark} ${styles.markMissing}`} />
          <span>Missing</span>
        </div>
        <div className={styles.legendItem}>
          <div className={`${styles.mark} ${styles.markFailed}`} />
          <span>Failed</span>
        </div>
      </div>
    </section>
  );
}

function NightCell({ night }: { night: { date: Date; run: CronRun | null } }) {
  const { date, run } = night;
  const dateStr = date.toISOString().split("T")[0];
  const title = date.toLocaleDateString([], { month: "short", day: "numeric" });

  if (run) {
    if (run.ok) {
      return (
        <div
          className={`${styles.cell} ${styles.cellRecorded}`}
          title={`${title}: recorded`}
          role="cell"
        />
      );
    } else {
      return (
        <div
          className={`${styles.cell} ${styles.cellFailed}`}
          title={`${title}: failed`}
          role="cell"
        />
      );
    }
  }

  return (
    <MissingNightCell date={date} dateStr={dateStr} title={title} />
  );
}

function MissingNightCell({ date, dateStr, title }: { date: Date; dateStr: string; title: string }) {
  const [showDetails, setShowDetails] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  async function handleBackfill() {
    setBackfilling(true);
    try {
      await api.post<CronRun>("cron/run", {});
      toast.success("Backfill started.");
    } catch (err) {
      toast.error("Backfill failed.");
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.cell} ${styles.cellMissing}`}
        title={`${title}: missing`}
        onClick={() => setShowDetails(!showDetails)}
        aria-label={`${title}: missing snapshot`}
      />
      {showDetails && (
        <div className={styles.missingDetails} role="region" aria-live="polite">
          <p className={styles.missingText}>
            {title} is missing. That night has no frozen snapshot, so its behind or ahead number is estimated, not stored.
          </p>
          <button
            type="button"
            className={styles.actionButton}
            onClick={handleBackfill}
            disabled={backfilling}
          >
            Backfill that night
          </button>
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => setShowDetails(false)}
            aria-label="Close details"
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}

function Countdown({ targetDate }: { targetDate: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    function updateCountdown() {
      const now = new Date();
      const target = new Date(targetDate);
      const diff = target.getTime() - now.getTime();

      if (diff <= 0) {
        setRemaining("Running now");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 0) {
        setRemaining(`Next run in ${hours}h ${minutes}m`);
      } else {
        setRemaining(`Next run in ${minutes}m`);
      }
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 30_000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return <p className={styles.summaryText}>{remaining}</p>;
}

function gridAriaLabel(nights: Array<{ date: Date; run: CronRun | null }>): string {
  const recorded = nights.filter((n) => n.run?.ok).length;
  const failed = nights.filter((n) => n.run && !n.run.ok).length;
  const missing = nights.filter((n) => !n.run).length;
  return `30 night grid: ${recorded} recorded, ${missing} missing, ${failed} failed`;
}
