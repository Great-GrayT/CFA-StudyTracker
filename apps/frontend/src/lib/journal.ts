import type { LogEntry } from "./types";

// The journal's filters and day grouping, kept pure so they can be tested
// without a DOM (the test environment is node).

export type JournalFilter = { topicId?: string; packageId?: string; from?: string; to?: string };

/** Calendar day of a log. Dates arrive as either YYYY-MM-DD or a full ISO stamp. */
export const logDay = (l: LogEntry): string => l.date.slice(0, 10);

/**
 * Every filter given must match; the date range is inclusive at both ends.
 * Returns a new array, newest first, ties kept in id order so rows never shuffle.
 */
export function filterJournal(
  logs: LogEntry[],
  f: JournalFilter,
  losToTopic: Map<string, string>,
): LogEntry[] {
  return logs
    .filter((l) => {
      const day = logDay(l);
      if (f.topicId && losToTopic.get(l.losId) !== f.topicId) return false;
      if (f.packageId && l.packageId !== f.packageId) return false;
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      return true;
    })
    .sort((a, b) => logDay(b).localeCompare(logDay(a)) || b.id.localeCompare(a.id));
}

export type JournalDay = { day: string; entries: LogEntry[] };

/** Groups consecutive entries by calendar day, keeping the order given. */
export function groupJournalByDay(logs: LogEntry[]): JournalDay[] {
  const out: JournalDay[] = [];
  for (const l of logs) {
    const day = logDay(l);
    const last = out[out.length - 1];
    if (last && last.day === day) last.entries.push(l);
    else out.push({ day, entries: [l] });
  }
  return out;
}
