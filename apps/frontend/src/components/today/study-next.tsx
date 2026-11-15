"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FlatLos } from "@/lib/hooks";
import type { StudyNextRow } from "@/lib/today";
import { RegionError } from "./region-states";
import { useIsCut } from "./truncated-text";

export function StudyNext({
  rows,
  byId,
  loading,
  error,
  online,
  onRetry,
}: {
  rows: StudyNextRow[] | undefined;
  byId: Map<string, FlatLos>;
  loading: boolean;
  error: unknown;
  online: boolean;
  onRetry: () => void;
}) {
  // The outcome sheet opens from ?los= on whatever page the row lives on.
  const pathname = usePathname();

  return (
    <section aria-labelledby="study-next" className="flex flex-col gap-2">
      <h2 id="study-next" className="text-[16px] font-semibold">
        Study next
      </h2>
      {loading ? (
        <ol aria-hidden="true" className="flex flex-col">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex min-h-11 items-center gap-3 md:min-h-9">
              <Skeleton className="h-3.5 w-4 rounded-sm" />
              <Skeleton className="h-3.5 flex-1 rounded-sm" />
              <Skeleton className="h-3.5 w-14 rounded-sm" />
            </li>
          ))}
        </ol>
      ) : !rows && error ? (
        <RegionError error={error} online={online} onRetry={onRetry} />
      ) : !rows || rows.length === 0 ? (
        <p className="text-muted-foreground text-[14px]">
          Everything is covered at least once; weak outcomes appear here as they go stale.{" "}
          <Link href="/syllabus" className="text-claimed-ink underline underline-offset-4">
            Open the syllabus
          </Link>
        </p>
      ) : (
        <ol className="flex flex-col">
          {rows.map((row, i) => (
            <Row key={row.losId} row={row} index={i} los={byId.get(row.losId)} pathname={pathname} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Row({
  row,
  index,
  los,
  pathname,
}: {
  row: StudyNextRow;
  index: number;
  los: FlatLos | undefined;
  pathname: string;
}) {
  const text = los?.text ?? "This outcome is not in the current curriculum.";
  const textRef = useRef<HTMLSpanElement>(null);
  const cut = useIsCut(textRef, text);
  return (
    <li>
      {/* On the link, so focus alone shows the full outcome; only when it is cut,
          so whole text is never announced twice. */}
      <Tooltip open={cut ? undefined : false}>
        <TooltipTrigger asChild>
          <Link
            href={`${pathname}?los=${encodeURIComponent(row.losId)}`}
            scroll={false}
            className="hover:bg-accent focus-visible:ring-ring -mx-2 flex min-h-11 items-center gap-3 rounded-sm px-2 py-1 outline-hidden focus-visible:ring-2 md:min-h-9"
          >
            <span className="text-muted-foreground w-4 shrink-0 text-[13px] tabular-nums">{index + 1}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span ref={textRef} className="font-prose truncate text-[16px] leading-snug">
                {text}
              </span>
              {los ? <span className="text-muted-foreground truncate text-[12px]">{los.readingName}</span> : null}
            </span>
            <span
              className={cn(
                "shrink-0 text-right text-[12px] tabular-nums",
                row.reason === "untouched" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {row.label}
            </span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}
