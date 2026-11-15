"use client";

import { useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Download, Ellipsis } from "lucide-react";
import { toast } from "sonner";
import { flattenCurriculum, useCurriculum, useDeleteLog, useLogs, usePackages, type FlatLos } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { filterJournal, groupJournalByDay, type JournalFilter } from "@/lib/journal";
import type { LogEntry, Plan } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useOutcomeParam } from "@/hooks/use-outcome-param";
import { useRecord } from "@/components/record/record-provider";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { useIsCut } from "@/components/states/truncated-text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ALL = "all"; // Radix Select reserves the empty string.
const plural = new Intl.PluralRules("en");
const recordWord = (n: number) => (plural.select(n) === "one" ? "record" : "records");
const CONF_WORD = ["Shaky", "Unsure", "Fair", "Solid", "Sure"];
const longDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });
// The candidate's calendar day, the same one records are made against.
const isoDay = (d: Date) => new Intl.DateTimeFormat("en-CA").format(d);
const dateOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function dayLabel(day: string, todayISO: string): string {
  const ms = Date.parse(`${todayISO}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`);
  const ago = Math.round(ms / 86_400_000);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago > 1 && ago < 7) return weekday.format(new Date(`${day}T00:00:00Z`));
  return longDay.format(new Date(`${day}T00:00:00Z`));
}

type Item = { kind: "day"; day: string; count: number } | { kind: "log"; entry: LogEntry };

export function JournalTab({ plan, online }: { plan: Plan; online: boolean }) {
  const logs = useLogs(plan.id);
  const curriculum = useCurriculum(plan.levelId);
  const packages = usePackages();
  const deleteLog = useDeleteLog(plan.id);
  const [, setLos] = useOutcomeParam();
  const record = useRecord();

  const [filter, setFilter] = useState<JournalFilter>({});
  const [deleting, setDeleting] = useState<LogEntry | null>(null);
  const [exporting, setExporting] = useState(false);

  const flat = useMemo(() => flattenCurriculum(curriculum.data), [curriculum.data]);
  const losById = useMemo(() => new Map(flat.map((l) => [l.id, l])), [flat]);
  const losToTopic = useMemo(() => new Map(flat.map((l) => [l.id, l.topicId])), [flat]);
  const topics = useMemo(
    () => [...(curriculum.data?.topics ?? [])].sort((a, b) => a.order - b.order),
    [curriculum.data],
  );
  // Only packages that appear in the journal: the rest would always filter to nothing.
  const usedPackages = useMemo(() => {
    const used = new Set((logs.data ?? []).map((l) => l.packageId).filter(Boolean));
    return (packages.data ?? []).filter((p) => used.has(p.id));
  }, [logs.data, packages.data]);

  const shown = useMemo(
    () => (logs.data ? filterJournal(logs.data, filter, losToTopic) : []),
    [logs.data, filter, losToTopic],
  );
  const items = useMemo<Item[]>(
    () =>
      groupJournalByDay(shown).flatMap((g) => [
        { kind: "day" as const, day: g.day, count: g.entries.length },
        ...g.entries.map((entry) => ({ kind: "log" as const, entry })),
      ]),
    [shown],
  );

  const todayISO = isoDay(new Date());
  const filtered = !!(filter.topicId || filter.packageId || filter.from || filter.to);
  const set = (patch: Partial<JournalFilter>) => setFilter((f) => ({ ...f, ...patch }));

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await fetch("/api/proxy/export/log");
      if (!res.ok) throw new ApiError(res.status, "Export failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `cfa-tracker-log-${todayISO}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Log exported");
    } catch {
      toast.error("The export did not download. Try again.");
    } finally {
      setExporting(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteLog.mutateAsync(deleting.id);
      toast.success("Record deleted");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete that record.");
    }
  }

  const states = [logs, curriculum].map(regionState);
  const failed = states.find((s) => s.error)?.error;
  const retry = () => {
    if (logs.isError) void logs.refetch();
    if (curriculum.isError) void curriculum.refetch();
  };

  if (!logs.data || !curriculum.data) {
    return failed ? <RegionError error={failed} online={online} onRetry={retry} /> : <JournalSkeleton />;
  }

  if (logs.data.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 py-8">
        <p className="text-[14px]">Every session you record appears here, grouped by day.</p>
        <Button size="sm" onClick={() => record.open()}>
          Record a session
        </Button>
      </div>
    );
  }

  const fieldCls = "h-8 w-full text-[13px] max-md:h-11";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="group" aria-label="Filter the journal" className="grid w-full grid-cols-2 gap-3 md:flex md:w-auto md:flex-wrap">
          <div className="grid min-w-0 gap-1 md:w-52">
            <Label htmlFor="journal-topic" className="text-muted-foreground text-[12px] font-normal">
              Topic
            </Label>
            <Select value={filter.topicId ?? ALL} onValueChange={(v) => set({ topicId: v === ALL ? undefined : v })}>
              <SelectTrigger id="journal-topic" className={cn(fieldCls, "min-w-0")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All topics</SelectItem>
                {topics.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 gap-1 md:w-44">
            <Label htmlFor="journal-package" className="text-muted-foreground text-[12px] font-normal">
              Package
            </Label>
            <Select
              value={filter.packageId ?? ALL}
              onValueChange={(v) => set({ packageId: v === ALL ? undefined : v })}
            >
              <SelectTrigger id="journal-package" className={cn(fieldCls, "min-w-0")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All packages</SelectItem>
                {usedPackages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 gap-1 md:w-40">
            <Label htmlFor="journal-from" className="text-muted-foreground text-[12px] font-normal">
              From
            </Label>
            <DatePicker
              id="journal-from"
              className="[&_button]:h-8 [&_button]:text-[13px] max-md:[&_button]:h-11"
              placeholder="Any day"
              value={filter.from ? dateOf(filter.from) : undefined}
              onChange={(d) => set({ from: d ? isoDay(d) : undefined })}
              max={filter.to ? dateOf(filter.to) : new Date()}
            />
          </div>
          <div className="grid min-w-0 gap-1 md:w-40">
            <Label htmlFor="journal-to" className="text-muted-foreground text-[12px] font-normal">
              To
            </Label>
            <DatePicker
              id="journal-to"
              className="[&_button]:h-8 [&_button]:text-[13px] max-md:[&_button]:h-11"
              placeholder="Any day"
              value={filter.to ? dateOf(filter.to) : undefined}
              onChange={(d) => set({ to: d ? isoDay(d) : undefined })}
              max={new Date()}
            />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting || !online}>
          <Download />
          {exporting ? "Exporting" : "Export log, CSV"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <p className="text-muted-foreground tabular-nums" aria-live="polite">
          {filtered
            ? `${shown.length} of ${logs.data.length} ${recordWord(logs.data.length)} match`
            : `${logs.data.length} ${recordWord(logs.data.length)}`}
        </p>
        {filtered ? (
          <Button variant="link" size="sm" className="h-auto px-0 text-[13px]" onClick={() => setFilter({})}>
            Clear filters
          </Button>
        ) : null}
        {!online ? <OfflineLine /> : null}
      </div>
      {failed ? <RegionError error={failed} online={online} onRetry={retry} /> : null}

      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-8">
          <p className="text-[14px]">No records match these filters.</p>
          <Button variant="outline" size="sm" onClick={() => setFilter({})}>
            Clear filters
          </Button>
        </div>
      ) : (
        // The page scrolls, not a box inside it: one scrollbar, and the list
        // grows with the window on a phone.
        <Virtuoso
          useWindowScroll
          data={items}
          computeItemKey={(_, item) => (item.kind === "day" ? `d-${item.day}` : item.entry.id)}
          itemContent={(_, item) =>
            item.kind === "day" ? (
              <h2 className="border-border flex items-baseline justify-between gap-3 border-b pt-5 pb-1.5 text-[13px] font-semibold">
                {dayLabel(item.day, todayISO)}
                <span className="text-muted-foreground text-[12px] font-normal tabular-nums">
                  {item.count} {recordWord(item.count)}
                </span>
              </h2>
            ) : (
              <JournalRow
                entry={item.entry}
                los={losById.get(item.entry.losId)}
                onOpen={setLos}
                onDelete={setDeleting}
              />
            )
          }
        />
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => (!o ? setDeleting(null) : undefined)}>
        <DialogContent className="gap-5 sm:max-w-md">
          <DialogHeader className="text-left sm:text-left">
            <DialogTitle className="text-[20px] font-semibold">Delete this record?</DialogTitle>
            <DialogDescription className="text-[13px]">
              It leaves your coverage, your pace and the outcome&apos;s history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleting ? (
            <p className="font-prose line-clamp-3 text-[14px] leading-snug">
              {losById.get(deleting.losId)?.text ?? "An outcome no longer in the curriculum"}
            </p>
          ) : null}
          <DialogFooter className="sm:justify-end">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleteLog.isPending}>
              {deleteLog.isPending ? "Deleting" : "Delete record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function JournalRow({
  entry,
  los,
  onOpen,
  onDelete,
}: {
  entry: LogEntry;
  los: FlatLos | undefined;
  onOpen: (id: string) => void;
  onDelete: (entry: LogEntry) => void;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const text = los?.text ?? "Outcome not in this year's curriculum";
  // The row is one button, so the tooltip hangs off the row rather than a
  // focusable span nested inside it.
  const cut = useIsCut(textRef, text);
  const questions = entry.questionsAnswered > 0 ? `${entry.questionsCorrect} of ${entry.questionsAnswered}` : "";
  const cells = (
    <>
      <span
        ref={textRef}
        className={cn("font-prose min-w-0 flex-1 truncate text-[14px]", !los && "text-muted-foreground")}
      >
        {text}
      </span>
      <span className="text-muted-foreground hidden w-44 min-w-0 truncate text-[13px] lg:block">{los?.topicName}</span>
      <span className="text-muted-foreground w-14 shrink-0 text-[13px] max-sm:hidden">
        {CONF_WORD[entry.confidence - 1] ?? entry.confidence}
      </span>
      <span className="w-16 shrink-0 text-right text-[13px] tabular-nums">{questions}</span>
    </>
  );

  return (
    <div className="border-border flex h-9 items-center gap-2 border-b max-md:h-11">
      {los ? (
        <Tooltip open={cut ? undefined : false}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onOpen(entry.losId)}
              aria-label={`Open outcome: ${text}`}
              className="hover:bg-accent focus-visible:ring-ring flex h-full min-w-0 flex-1 items-center gap-3 rounded-sm px-1 text-left outline-hidden focus-visible:ring-2"
            >
              {cells}
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm" align="start">
            {text}
          </TooltipContent>
        </Tooltip>
      ) : (
        <div className="flex h-full min-w-0 flex-1 items-center gap-3 px-1">{cells}</div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-8 shrink-0 rounded-sm max-md:size-11"
            aria-label="Record actions"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(entry)}>
            Delete record
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function JournalSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the journal" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {[52, 44, 40, 40].map((w, i) => (
          <Skeleton key={i} className="h-8 rounded-md" style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      <Skeleton className="h-4 w-24 rounded-sm" />
      {[0, 1].map((g) => (
        <div key={g} className="flex flex-col gap-1">
          <Skeleton className="mt-4 h-5 w-28 rounded-sm" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-full rounded-none" />
          ))}
        </div>
      ))}
    </div>
  );
}
