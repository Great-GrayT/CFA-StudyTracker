"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  flattenCurriculum,
  useCurriculum,
  useLogs,
  usePackages,
  usePlan,
} from "@/lib/hooks";
import { usePaged } from "@/lib/paging";
import {
  STALE_DAYS,
  confidenceFill,
  daysSince,
  flagReasons,
  isMonoculture,
  questionSources,
} from "@/lib/syllabus";
import type { LogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/ui/use-mobile";
import { useOnline } from "@/hooks/use-online";
import { useOutcomeParam } from "@/hooks/use-outcome-param";
import { useRecord } from "@/components/record/record-provider";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";

const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const plural = new Intl.PluralRules("en");
// UTC: a log's date is a calendar day, and a local zone west of UTC would shift it back.
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const CONF_WORD = ["Shaky", "Unsure", "Fair", "Solid", "Sure"];

/**
 * One outcome in full, over whatever page set `?los=`. The old /los page's
 * content in the spec's order. It exists so no review flag goes unexplained.
 */
export function OutcomeSheet() {
  const [losId, setLos] = useOutcomeParam({ syncHistory: true });
  const isMobile = useIsMobile();
  const record = useRecord();
  const open = losId !== null;
  const onOpenChange = (next: boolean) => {
    if (!next) setLos(null);
  };

  const title = "Learning outcome";
  const recordButton = (
    <Button className="max-md:h-11" disabled={!losId} onClick={() => losId && record.open({ losId })}>
      Record study
    </Button>
  );
  // Keyed so the history pager starts on page one for each outcome.
  const body = losId ? <OutcomeBody key={losId} losId={losId} /> : null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="bg-card data-[vaul-drawer-direction=bottom]:max-h-[92dvh] data-[vaul-drawer-direction=bottom]:rounded-t-xl">
          <DrawerHeader className="px-4 pt-2 pb-1 text-left">
            <DrawerTitle className="text-muted-foreground text-[13px] font-normal">{title}</DrawerTitle>
            <DrawerDescription className="sr-only">Ratings, accuracy and history for this outcome.</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{body}</div>
          <DrawerFooter className="border-border border-t pb-[max(1rem,env(safe-area-inset-bottom))]">
            {recordButton}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="bg-card w-full gap-0 sm:max-w-[480px]">
        <SheetHeader className="px-5 pt-5 pb-1">
          <SheetTitle className="text-muted-foreground text-[13px] font-normal">{title}</SheetTitle>
          <SheetDescription className="sr-only">Ratings, accuracy and history for this outcome.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{body}</div>
        <SheetFooter className="border-border flex-row justify-end border-t px-5 py-3">{recordButton}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function OutcomeBody({ losId }: { losId: string }) {
  const online = useOnline();
  const plan = usePlan();
  const curriculum = useCurriculum(plan.data?.levelId);
  const logs = useLogs(plan.data?.id);
  const packages = usePackages();

  const los = useMemo(() => flattenCurriculum(curriculum.data).find((l) => l.id === losId), [curriculum.data, losId]);
  const mine = useMemo(
    () => (logs.data ?? []).filter((l) => l.losId === losId).sort((a, b) => b.date.localeCompare(a.date)),
    [logs.data, losId],
  );
  // A re-drilled outcome can carry dozens of rows.
  const history = usePaged(mine, 8);
  const names = useMemo(() => new Map((packages.data ?? []).map((p) => [p.id, p.name])), [packages.data]);
  const sources = useMemo(() => questionSources(mine, names), [mine, names]);

  const states = [plan, curriculum, logs].map(regionState);
  const failed = states.find((s) => s.error);
  if (failed && (!curriculum.data || !logs.data)) {
    return (
      <RegionError
        error={failed.error}
        online={online}
        onRetry={() => void (plan.isError ? plan.refetch() : curriculum.isError ? curriculum.refetch() : logs.refetch())}
      />
    );
  }
  if (!curriculum.data || !logs.data) return <BodySkeleton />;
  if (!los) {
    return (
      <div className="flex flex-col items-start gap-3 py-4">
        <p className="text-[14px]">
          This outcome is not in the current curriculum. It may have been renumbered in a yearly update.
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/syllabus">Open the syllabus</Link>
        </Button>
      </div>
    );
  }

  const latest: LogEntry | undefined = mine[0];
  const answered = mine.reduce((s, l) => s + l.questionsAnswered, 0);
  const correct = mine.reduce((s, l) => s + l.questionsCorrect, 0);
  const accuracy = answered > 0 ? (correct / answered) * 100 : null;
  const reasons = flagReasons(mine);
  const days = latest ? daysSince(latest.date) : null;
  const sourceTotal = sources.reduce((s, x) => s + x.count, 0);
  const monoculture = isMonoculture(sources, latest?.confidence);

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <h2 className="font-prose text-[20px] leading-snug text-balance">{los.text}</h2>
        <p className="text-muted-foreground text-[13px]">
          <Link
            href={`/syllabus/${encodeURIComponent(los.topicId)}`}
            className="hover:text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-4 outline-hidden focus-visible:ring-2"
          >
            {los.topicName}
          </Link>
          , {los.readingName}
        </p>
        {!online ? <OfflineLine /> : null}
      </header>

      {reasons.length > 0 ? (
        <Alert role="status" className="border-input bg-card rounded-lg">
          <AlertDescription className="text-foreground text-[14px]">
            Flagged for review because {reasons.join(", and ")}.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="border-border grid grid-cols-2 gap-4 border-t pt-4">
        <section aria-labelledby="o-conf" className="flex min-w-0 flex-col gap-2">
          <h3 id="o-conf" className="text-[13px] font-medium">
            Confidence
          </h3>
          {latest ? (
            <>
              <Trend values={[...mine].reverse().map((l) => l.confidence)} />
              <Meter value={latest.confidence} />
              <p className="text-muted-foreground text-[12px] tabular-nums">
                {mine.length} {plural.select(mine.length) === "one" ? "rating" : "ratings"}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-[13px]">Not yet rated.</p>
          )}
        </section>
        <section aria-labelledby="o-acc" className="flex min-w-0 flex-col gap-2">
          <h3 id="o-acc" className="text-[13px] font-medium">
            Accuracy
          </h3>
          {accuracy === null ? (
            <p className="text-muted-foreground text-[13px]">No questions answered.</p>
          ) : (
            <>
              <p className="text-[26px] leading-none font-semibold tabular-nums">{pct.format(accuracy)}%</p>
              <p className="text-muted-foreground text-[12px] tabular-nums">
                {correct} of {answered} correct
              </p>
            </>
          )}
        </section>
      </div>

      {sources.length > 0 ? (
        <section aria-labelledby="o-src" className="border-border flex flex-col gap-2 border-t pt-4">
          <h3 id="o-src" className="text-[13px] font-medium">
            Question sources
          </h3>
          <div aria-hidden="true" className="flex h-2 w-full gap-px">
            {sources.map((s, i) => (
              <span
                key={s.id}
                className={i === 0 ? "bg-primary" : "bg-input"}
                style={{ width: `${(s.count / sourceTotal) * 100}%` }}
              />
            ))}
          </div>
          <p className="text-muted-foreground text-[12px] tabular-nums">
            {sources.map((s) => `${s.name} ${s.count}`).join(", ")}
          </p>
          {monoculture ? (
            <p className="text-[13px]">
              All {sourceTotal} of your questions here come from {sources[0].name}. Practising with a second source
              is associated with better retention than drilling one bank.
            </p>
          ) : null}
        </section>
      ) : null}

      {days !== null ? (
        <section aria-labelledby="o-fresh" className="border-border flex flex-col gap-2 border-t pt-4">
          <h3 id="o-fresh" className="text-[13px] font-medium">
            Freshness
          </h3>
          <div aria-hidden="true" className="bg-border relative h-1.5 w-full">
            <span
              className="bg-primary absolute inset-y-0 left-0"
              style={{ width: `${Math.min(100, (days / STALE_DAYS) * 100)}%` }}
            />
          </div>
          <p className="text-muted-foreground text-[12px] tabular-nums">
            {days === 0
              ? "Studied today."
              : `${days} ${plural.select(days) === "one" ? "day" : "days"} since the last session. Outcomes are flagged at ${STALE_DAYS}.`}
          </p>
        </section>
      ) : null}

      <section aria-labelledby="o-hist" className="border-border flex flex-col gap-2 border-t pt-4">
        <h3 id="o-hist" className="text-[13px] font-medium">
          History
        </h3>
        {mine.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">No sessions recorded for this outcome yet. Record one below.</p>
        ) : (
          <>
            <Table className="text-[13px] tabular-nums">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 px-0 text-left text-[12px]">Date</TableHead>
                  <TableHead className="h-8 text-left text-[12px]">Confidence</TableHead>
                  <TableHead className="h-8 px-0 text-right text-[12px]">Questions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.slice.map((l) => (
                  <TableRow key={l.id} className="hover:bg-transparent">
                    <TableCell className="px-0">{dayFmt.format(new Date(l.date))}</TableCell>
                    <TableCell>
                      {l.confidence} <span className="text-muted-foreground">{CONF_WORD[l.confidence - 1]}</span>
                    </TableCell>
                    <TableCell className="px-0 text-right">
                      {l.questionsAnswered > 0 ? `${l.questionsCorrect} of ${l.questionsAnswered}` : "None"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {history.pages > 1 ? (
              <Pagination aria-label="History pages" className="justify-between">
                <PaginationContent className="w-full justify-between">
                  <PaginationItem>
                    <Button
                      variant="outline"
                      size="sm"
                      className="max-md:h-11"
                      disabled={history.page === 0}
                      onClick={() => history.setPage(history.page - 1)}
                    >
                      Newer
                    </Button>
                  </PaginationItem>
                  <PaginationItem className="text-muted-foreground text-[12px] tabular-nums" aria-live="polite">
                    Page {history.page + 1} of {history.pages}
                  </PaginationItem>
                  <PaginationItem>
                    <Button
                      variant="outline"
                      size="sm"
                      className="max-md:h-11"
                      disabled={history.page >= history.pages - 1}
                      onClick={() => history.setPage(history.page + 1)}
                    >
                      Older
                    </Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            ) : null}
          </>
        )}
      </section>
    </article>
  );
}

/** Ratings over time; five steps, so the shape is the trend. */
function Trend({ values }: { values: number[] }) {
  const w = 160;
  const h = 32;
  const x = (i: number) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 6) + 3);
  const y = (v: number) => h - ((v - 1) / 4) * (h - 6) - 3;
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(v)}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-8 w-full max-w-40"
      role="img"
      aria-label={`Ratings, oldest first: ${values.join(", ")}`}
    >
      <path d={d} fill="none" stroke="var(--claimed)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="2" fill="var(--claimed)" />
      ))}
    </svg>
  );
}

/** Latest rating as five squares on the ramp. */
function Meter({ value }: { value: number }) {
  return (
    <p className="flex items-center gap-2 text-[13px]">
      <span aria-hidden="true" className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={cn("size-2.5", n > value && "border-input border")}
            style={n <= value ? { backgroundColor: confidenceFill(value) } : undefined}
          />
        ))}
      </span>
      <span className="tabular-nums">
        Latest {value} of 5, {CONF_WORD[value - 1]?.toLowerCase()}
      </span>
    </p>
  );
}

function BodySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the outcome" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-full rounded-sm" />
        <Skeleton className="h-5 w-4/5 rounded-sm" />
        <Skeleton className="h-3.5 w-1/2 rounded-sm" />
      </div>
      <div className="border-border grid grid-cols-2 gap-4 border-t pt-4">
        <Skeleton className="h-16 rounded-sm" />
        <Skeleton className="h-16 rounded-sm" />
      </div>
      <div className="border-border flex flex-col gap-2 border-t pt-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-7 rounded-sm" />
        ))}
      </div>
    </div>
  );
}
