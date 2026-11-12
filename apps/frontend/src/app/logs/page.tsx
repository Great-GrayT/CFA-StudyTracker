"use client";

import { useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { AppShell } from "@/components/app-shell";
import { useLogs, useCurriculum, usePlan, useDeleteLog, flattenCurriculum } from "@/lib/hooks";
import { startOfUTCDay, addUTCDays } from "@/lib/pace";
import type { LogEntry } from "@/lib/types";
import styles from "./logs.module.css";
import { ConfidenceMeter } from "@/components/confidence";

const plural = new Intl.PluralRules("en");
const logWord = (n: number) => (plural.select(n) === "one" ? "session" : "sessions");

export default function LogsPage() {
  const plan = usePlan();
  const planId = plan.data?.id;
  const logs = useLogs(planId);
  const curriculum = useCurriculum(plan.data?.levelId);

  const ready = logs.data && curriculum.data;

  if (logs.isLoading || curriculum.isLoading) {
    return (
      <AppShell>
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading log history">
          <div className={styles.skelLine} />
          <div className={styles.skelRow} />
          <div className={styles.skelRow} />
          <div className={styles.skelRow} />
        </div>
      </AppShell>
    );
  }

  if (!logs.data || !curriculum.data || !planId) return null;

  const flat = flattenCurriculum(curriculum.data!);
  const losMap = new Map(flat.map((l) => [l.id, l]));

  const grouped = groupLogsByDay(logs.data!, losMap);

  if (logs.data!.length === 0) {
    return (
      <AppShell>
        <div>
          <h1 className={styles.title}>Log history</h1>
          <p className={styles.empty}>No sessions logged yet.</p>
        </div>
      </AppShell>
    );
  }

  type VirtualItem =
    | { type: "heading"; dayLabel: string; dayKey: string }
    | { type: "log"; entry: LogEntry; losInfo?: any };

  const items: VirtualItem[] = grouped.flatMap((day) => [
    { type: "heading" as const, dayLabel: day.label, dayKey: day.key },
    ...day.entries.map((entry) => ({ type: "log" as const, entry, losInfo: losMap.get(entry.losId) })),
  ]);

  return (
    <AppShell>
      <div>
        <h1 className={styles.title}>Log history</h1>

        <Virtuoso
          style={{ height: "calc(100dvh - 200px)", width: "100%" }}
          data={items}
          itemContent={(_, item: VirtualItem) => {
            if (item.type === "heading") {
              return <DayHeading label={item.dayLabel} />;
            }
            return (
              <LogRow
                entry={item.entry}
                losInfo={item.losInfo}
                planId={planId}
              />
            );
          }}
        />
      </div>
    </AppShell>
  );
}

interface LogDay {
  key: string;
  label: string;
  entries: LogEntry[];
}

function groupLogsByDay(logs: LogEntry[], losMap: Map<string, any>): LogDay[] {
  const days = new Map<string, LogEntry[]>();

  const sorted = [...logs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  for (const log of sorted) {
    const key = log.date;
    if (!days.has(key)) {
      days.set(key, []);
    }
    days.get(key)!.push(log);
  }

  const today = startOfUTCDay(new Date());
  const result: LogDay[] = [];

  for (const [dateStr, entries] of days) {
    const date = new Date(dateStr);
    const dayStart = startOfUTCDay(date);
    const daysAgo = Math.floor((today.getTime() - dayStart.getTime()) / (1000 * 60 * 60 * 24));

    let label = "";
    if (daysAgo === 0) {
      label = "Today";
    } else if (daysAgo === 1) {
      label = "Yesterday";
    } else if (daysAgo < 7) {
      label = dayStart.toLocaleDateString("en", { weekday: "long" });
    } else {
      label = dayStart.toLocaleDateString("en", { month: "short", day: "numeric" });
    }

    result.push({
      key: dateStr,
      label,
      entries,
    });
  }

  return result;
}

function DayHeading({ label }: { label: string }): React.ReactElement {
  return <div className={styles.dayHeading}>{label}</div>;
}

function LogRow({
  entry,
  losInfo,
  planId,
}: {
  entry: LogEntry;
  losInfo?: any;
  planId: string;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteLog = useDeleteLog(planId);

  const handleDelete = () => {
    if (confirmDelete) {
      deleteLog.mutate(entry.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
    }
  };

  const unmatched = !losInfo;
  const outcome = losInfo?.text ?? "Outcome not in current curriculum";
  const topicName = losInfo?.topicName ?? "";
  const answeredWord = plural.select(entry.questionsAnswered) === "one" ? "question" : "questions";

  return (
    <div className={`${styles.row} ${unmatched ? styles.rowUnmatched : ""}`} role="listitem">
      <div className={styles.rowContent}>
        <div className={styles.outcome}>{outcome}</div>
        {topicName && <div className={styles.topic}>{topicName}</div>}
        {unmatched && (
          <div className={styles.warning}>
            This outcome is not in the current curriculum. It may have been renumbered in a yearly update.
          </div>
        )}
        <div className={styles.meta}>
          <ConfidenceMeter value={entry.confidence} />
          {entry.questionsCorrect} of {entry.questionsAnswered} {answeredWord}
        </div>
      </div>
      <button
        type="button"
        className={styles.deleteBtn}
        onClick={handleDelete}
        disabled={deleteLog.isPending}
        aria-label={confirmDelete ? "Confirm delete" : "Delete log"}
      >
        {confirmDelete ? "Confirm" : "⋮"}
      </button>
    </div>
  );
}
