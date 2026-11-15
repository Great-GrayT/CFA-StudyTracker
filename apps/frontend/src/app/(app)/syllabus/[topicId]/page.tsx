"use client";

import { use, useMemo, useRef } from "react";
import Link from "next/link";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusStrip } from "@/components/syllabus/status-strip";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { useRecord } from "@/components/record/record-provider";
import { useCurriculum, useLogs, usePlan } from "@/lib/hooks";
import { logsByLos, outcomeStatus, type OutcomeStatus } from "@/lib/syllabus";
import { weightedCoveragePercent } from "@/lib/coverage";
import { useOnline } from "@/hooks/use-online";
import { useOutcomeParam } from "@/hooks/use-outcome-param";
import { useIsCut } from "@/components/states/truncated-text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { LogEntry, Reading } from "@/lib/types";
import { cn } from "@/lib/utils";

const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const STATUS_WORD: Record<OutcomeStatus, string> = {
  untouched: "Not started",
  logged: "Recorded",
  confident: "Confident",
  flagged: "Flagged",
};

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[880px] min-w-0 px-4 py-6 md:px-8 md:py-8">{children}</div>;
}

export default function TopicPage({ params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = use(params);
  const online = useOnline();
  const record = useRecord();
  const [, setLos] = useOutcomeParam();
  const plan = usePlan();
  const curriculum = useCurriculum(plan.data?.levelId);
  const logs = useLogs(plan.data?.id);

  const byLos = useMemo(() => logsByLos(logs.data ?? []), [logs.data]);
  const topic = curriculum.data?.topics.find((t) => t.id === topicId);
  const readings = useMemo(() => [...(topic?.readings ?? [])].sort((a, b) => a.order - b.order), [topic]);

  const failed = [plan, curriculum, logs].map(regionState).find((s) => s.error)?.error;
  const retry = () => void (plan.isError ? plan.refetch() : curriculum.isError ? curriculum.refetch() : logs.refetch());

  if (!curriculum.data || !logs.data) {
    if (failed) {
      return (
        <Shell>
          <RegionError error={failed} online={online} onRetry={retry} />
        </Shell>
      );
    }
    return <TopicSkeleton />;
  }

  if (!topic) {
    return (
      <Shell>
        <div className="flex flex-col items-start gap-3 py-8">
          <p className="text-[14px]">That topic is not in your level&apos;s current curriculum.</p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/syllabus">Open the syllabus</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  const ids = readings.flatMap((r) => r.los.map((l) => l.id));
  const covered = ids.filter((id) => byLos.has(id)).length;
  const coverage = weightedCoveragePercent([
    { topicId, name: topic.name, weightMin: topic.examWeightMin, weightMax: topic.examWeightMax, covered, total: ids.length },
  ]);

  return (
    <Shell>
      <header className="flex flex-col gap-1">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-balance">{topic.name}</h1>
        <p className="text-muted-foreground text-[14px] tabular-nums">
          {topic.examWeightMin} to {topic.examWeightMax}% of the exam. {covered} of {ids.length} outcomes covered (
          {pct.format(coverage)}%).
        </p>
        {!online ? <OfflineLine /> : null}
      </header>

      {readings.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-[14px]">This topic has no readings in the current curriculum.</p>
      ) : (
        <Accordion type="multiple" className="border-border mt-6 border-t">
          {readings.map((reading) => (
            <ReadingItem
              key={reading.id}
              reading={reading}
              byLos={byLos}
              onOpen={setLos}
              onRecord={(losId) => record.open({ losId })}
              href={(losId) => `/syllabus/${encodeURIComponent(topicId)}?los=${encodeURIComponent(losId)}`}
            />
          ))}
        </Accordion>
      )}
    </Shell>
  );
}

function ReadingItem({
  reading,
  byLos,
  onOpen,
  onRecord,
  href,
}: {
  reading: Reading;
  byLos: Map<string, LogEntry[]>;
  onOpen: (losId: string) => void;
  onRecord: (losId: string) => void;
  href: (losId: string) => string;
}) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const cut = useIsCut(nameRef, reading.name);
  const statuses = reading.los.map((l) => outcomeStatus(byLos.get(l.id) ?? []));
  const done = statuses.filter((s) => s !== "untouched").length;
  const flagged = statuses.filter((s) => s === "flagged").length;
  return (
    <AccordionItem value={reading.id} className="border-border">
      <AccordionTrigger
        className="items-center gap-3 rounded-none py-2.5 hover:no-underline focus-visible:ring-2 focus-visible:ring-inset max-md:min-h-11 [&>svg]:translate-y-0"
        aria-label={`${reading.name}, ${done} of ${reading.los.length} covered${flagged ? `, ${flagged} flagged` : ""}`}
      >
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_7rem_3rem] items-center gap-x-4 max-sm:grid-cols-[minmax(0,1fr)_3rem]">
          {/* On the name, not the trigger: a Slot'd tooltip trigger would
              overwrite the accordion's data-state and freeze the chevron.
              The trigger's aria-label carries the full title for keyboards. */}
          <Tooltip open={cut ? undefined : false}>
            <TooltipTrigger asChild>
              <span ref={nameRef} className="font-prose min-w-0 truncate text-[16px] font-normal">
                {reading.name}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="max-w-xs">
              {reading.name}
            </TooltipContent>
          </Tooltip>
          <span className="max-sm:hidden">
            <StatusStrip reading={reading} byLos={byLos} />
          </span>
          <span className="text-right text-[13px] font-normal tabular-nums">
            {done}/{reading.los.length}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-2">
        <ul>
          {[...reading.los]
            .sort((a, b) => a.order - b.order)
            .map((los) => {
              const status = outcomeStatus(byLos.get(los.id) ?? []);
              return (
                <li key={los.id} className="border-border flex items-start gap-3 border-t py-2 first:border-t-0">
                  <Link
                    href={href(los.id)}
                    scroll={false}
                    // A plain click opens through the sheet's history handling;
                    // the href stays for a new tab or a copied link.
                    onClick={(e) => {
                      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      onOpen(los.id);
                    }}
                    className="focus-visible:ring-ring hover:bg-accent -mx-1 flex min-w-0 flex-1 flex-col gap-0.5 rounded-sm px-1 py-0.5 outline-hidden focus-visible:ring-2"
                  >
                    <span className="font-prose text-[16px] leading-snug">{los.text}</span>
                    <span
                      className={cn(
                        "text-[12px]",
                        status === "flagged" ? "text-foreground font-medium" : "text-muted-foreground",
                      )}
                    >
                      {STATUS_WORD[status]}
                    </span>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 max-md:h-11"
                    onClick={() => onRecord(los.id)}
                    aria-label={`Record study for ${los.text}`}
                  >
                    Record
                  </Button>
                </li>
              );
            })}
        </ul>
      </AccordionContent>
    </AccordionItem>
  );
}

function TopicSkeleton() {
  return (
    <Shell>
      <div aria-busy="true" aria-label="Loading the topic" className="flex flex-col gap-1">
        <Skeleton className="h-8 w-72 max-w-full rounded-sm" />
        <Skeleton className="mt-1 h-4 w-96 max-w-full rounded-sm" />
        <div className="border-border mt-6 border-t">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="border-border flex items-center gap-4 border-b py-3">
              <Skeleton className="h-4 flex-1 rounded-sm" />
              <Skeleton className="h-2.5 w-28 rounded-none max-sm:hidden" />
              <Skeleton className="h-4 w-8 rounded-sm" />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
