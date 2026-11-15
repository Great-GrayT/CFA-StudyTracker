"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useCronStatus } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import type { CronRun } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RegionError, OfflineLine, regionState } from "@/components/states/region-states";
import { useOnline } from "@/hooks/use-online";
import { SettingsSection } from "./section";

// The scheduled run that sends coach messages and freezes each night's numbers.
// Ported from the Watchdogs page, which redirects here.

const numbers = new Intl.NumberFormat("en");
const plural = new Intl.PluralRules("en");
const HINT = "text-muted-foreground text-[13px] leading-relaxed";

type Night = { date: Date; dateStr: string; run: CronRun | null };

export function SystemHealthSection() {
  const online = useOnline();
  const cron = useCronStatus();
  const { loading, error } = regionState(cron);
  const [runLoading, setRunLoading] = useState(false);

  const nights = useMemo<Night[]>(() => {
    if (!cron.data?.runs) return [];
    const runs = cron.data.runs;
    const today = new Date();
    const out: Night[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      const run = runs.find((r) => r.startedAt.split("T")[0] === dateStr) ?? null;
      out.push({ date, dateStr, run });
    }
    return out;
  }, [cron.data?.runs]);

  async function handleRunNow() {
    setRunLoading(true);
    try {
      await api.post<CronRun>("cron/run", {});
      toast.success("Run finished. Check the grid below.");
      cron.refetch?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Run failed.");
    } finally {
      setRunLoading(false);
    }
  }

  const lastRun = cron.data?.runs?.[0];
  const planWord = plural.select(lastRun?.plansProcessed ?? 0) === "one" ? "plan" : "plans";
  const failWord = plural.select(lastRun?.plansFailed ?? 0) === "one" ? "plan" : "plans";

  return (
    <SettingsSection id="system" title="System health" lede="Last night's run, the last 30 nights, and the schedule.">
      {loading ? (
        <div aria-busy="true" aria-label="Loading system health" className="flex flex-col gap-4">
          <Skeleton className="h-5 w-64 rounded-sm" />
          <Skeleton className="h-16 w-full rounded-none" />
        </div>
      ) : error ? (
        <RegionError error={error} online={online} onRetry={() => cron.refetch()} />
      ) : (
        <>
          {!online && <OfflineLine />}

          <div className="flex flex-col gap-1">
            <h3 className="text-[14px] font-medium">Last run</h3>
            {lastRun ? (
              <>
                <p className="text-[14px] tabular-nums">
                  Ran at {new Date(lastRun.startedAt).toLocaleTimeString([], { timeStyle: "short" })} UTC.
                </p>
                <p className="text-[14px] tabular-nums">
                  {numbers.format(lastRun.plansProcessed)} {planWord} recorded
                  {lastRun.plansFailed > 0 &&
                    `, ${numbers.format(lastRun.plansFailed)} ${failWord} failed`}
                  .
                </p>
              </>
            ) : (
              <p className={HINT}>
                No runs recorded yet. The scheduler ticks every 15 minutes, so the first one lands
                within the quarter hour.
              </p>
            )}
          </div>

          <NightGrid nights={nights} />

          <div className="flex flex-col gap-2">
            <h3 className="text-[14px] font-medium">Next run</h3>
            {cron.data?.stalled ? (
              <p role="alert" className="text-alarm-ink text-[13px]">
                No run recorded for more than 48 hours. The scheduler on the server may be stopped.
              </p>
            ) : cron.data?.nextRunAt ? (
              <Countdown targetDate={cron.data.nextRunAt} />
            ) : null}
            <p className={HINT}>
              Schedule, set on the server: <span className="text-foreground tabular-nums">{cron.data?.schedule || "*/15 * * * *"}</span>
            </p>
            <div>
              <Button variant="outline" onClick={handleRunNow} disabled={runLoading}>
                {runLoading ? "Running" : "Run now"}
              </Button>
            </div>
          </div>
        </>
      )}
    </SettingsSection>
  );
}

function NightGrid({ nights }: { nights: Night[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const picked = nights.find((n) => n.dateStr === selected && !n.run) ?? null;
  const recorded = nights.filter((n) => n.run?.ok).length;
  const failed = nights.filter((n) => n.run && !n.run.ok).length;
  const missing = nights.filter((n) => !n.run).length;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[14px] font-medium">Last 30 nights</h3>
      <ol
        aria-label={`Last 30 nights: ${recorded} recorded, ${missing} missing, ${failed} failed`}
        className="grid grid-cols-[repeat(15,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(30,minmax(0,1fr))]"
      >
        {nights.map((night) => {
          const title = night.date.toLocaleDateString([], { month: "short", day: "numeric" });
          if (night.run) {
            return (
              <li
                key={night.dateStr}
                title={`${title}: ${night.run.ok ? "recorded" : "failed"}`}
                className={`aspect-square ${night.run.ok ? "bg-primary" : "bg-foreground"}`}
              />
            );
          }
          const on = selected === night.dateStr;
          return (
            <li key={night.dateStr}>
              <button
                type="button"
                title={`${title}: missing`}
                aria-label={`${title}: missing`}
                aria-pressed={on}
                onClick={() => setSelected(on ? null : night.dateStr)}
                className={`border-border aspect-square w-full border focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none ${on ? "border-primary bg-primary/10" : "hover:border-foreground"}`}
              />
            </li>
          );
        })}
      </ol>
      <ul className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
        <li className="flex items-center gap-2">
          <span className="bg-primary inline-block size-3" aria-hidden="true" />
          Recorded
        </li>
        <li className="flex items-center gap-2">
          <span className="border-border inline-block size-3 border" aria-hidden="true" />
          Missing
        </li>
        <li className="flex items-center gap-2">
          <span className="bg-foreground inline-block size-3" aria-hidden="true" />
          Failed
        </li>
      </ul>

      {picked && <BackfillPanel night={picked} onClose={() => setSelected(null)} />}
    </div>
  );
}

function BackfillPanel({ night, onClose }: { night: Night; onClose: () => void }) {
  const [backfilling, setBackfilling] = useState(false);
  const title = night.date.toLocaleDateString([], { month: "short", day: "numeric" });

  async function handleBackfill() {
    setBackfilling(true);
    try {
      await api.post<CronRun>("cron/run", {});
      toast.success("Backfill started.");
    } catch {
      toast.error("Backfill failed.");
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <div role="region" aria-live="polite" aria-label={`${title} details`} className="border-border flex flex-col gap-3 border-l pl-4">
      <p className={HINT}>
        {title} is missing. That night has no frozen snapshot, so its behind or ahead number is
        estimated, not stored.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={handleBackfill} disabled={backfilling}>
          {backfilling ? "Backfilling" : "Backfill that night"}
        </Button>
        <Button variant="ghost" onClick={onClose} aria-label="Close details">
          Close
        </Button>
      </div>
    </div>
  );
}

function Countdown({ targetDate }: { targetDate: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    function update() {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("Running now");
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setRemaining(hours > 0 ? `Next run in ${hours}h ${minutes}m` : `Next run in ${minutes}m`);
    }
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return <p className="text-[14px] tabular-nums">{remaining}</p>;
}
