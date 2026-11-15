"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLogs, useMocks } from "@/lib/hooks";
import { exportEverything } from "@/components/shell/shell-actions";
import { RegionError, OfflineLine, regionState } from "@/components/states/region-states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOnline } from "@/hooks/use-online";
import { SettingsSection } from "./section";

const numbers = new Intl.NumberFormat("en");
const plural = new Intl.PluralRules("en");
const HINT = "text-muted-foreground text-[13px] leading-relaxed";

export type DataCounts = { logCount: number; mockCount: number; historyDays: number };

/** Counts for this plan. Shared by this section and the delete-account dialog. */
export function useDataCounts(planId: string | undefined) {
  const logs = useLogs(planId);
  const mocks = useMocks(planId);
  const counts = useMemo<DataCounts | null>(() => {
    if (!logs.data || !mocks.data) return null;
    const uniqueDates = new Set(logs.data.map((log) => log.date.split("T")[0]));
    return { logCount: logs.data.length, mockCount: mocks.data.length, historyDays: uniqueDates.size };
  }, [logs.data, mocks.data]);
  return { logs, mocks, counts };
}

export function YourDataSection({ planId }: { planId: string | undefined }) {
  const online = useOnline();
  const { logs, mocks, counts } = useDataCounts(planId);
  const a = regionState(logs);
  const b = regionState(mocks);
  const error = a.error ?? b.error;
  const loading = a.loading || b.loading;

  const logWord = plural.select(counts?.logCount ?? 0) === "one" ? "log" : "logs";
  const mockWord = plural.select(counts?.mockCount ?? 0) === "one" ? "exam" : "exams";
  const dayWord = plural.select(counts?.historyDays ?? 0) === "one" ? "day" : "days";

  return (
    <SettingsSection
      id="data"
      title="Your data"
      lede="Everything you have logged. Export it as one JSON file."
    >
      {!planId ? (
        <p className={HINT}>Your record appears here once you have a plan.</p>
      ) : loading ? (
        <Skeleton className="h-5 w-72 rounded-sm" />
      ) : error ? (
        <RegionError error={error} online={online} onRetry={() => { void logs.refetch(); void mocks.refetch(); }} />
      ) : counts ? (
        <>
          {!online && <OfflineLine />}
          <p className="text-[14px] tabular-nums">
            {numbers.format(counts.logCount)} {logWord}, {numbers.format(counts.mockCount)} mock{" "}
            {mockWord}, {numbers.format(counts.historyDays)} {dayWord} of history.
          </p>
          <p className={HINT}>
            Browse your{" "}
            <Link href="/logs" className="text-primary underline underline-offset-4">
              study record
            </Link>{" "}
            or your{" "}
            <Link href="/mocks" className="text-primary underline underline-offset-4">
              mock exams
            </Link>
            .
          </p>
          <div>
            <Button variant="outline" onClick={() => void exportEverything()}>
              Export everything, JSON
            </Button>
          </div>
        </>
      ) : null}
    </SettingsSection>
  );
}
