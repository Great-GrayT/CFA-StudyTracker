"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExpandSheet } from "./expand-sheet";

/** One bento tile: heading, optional maximise button that opens the full view in a sheet. */
export function Tile({
  title,
  hint,
  className,
  controls,
  expanded,
  expandedHint,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  /** Zoom chips and the like, right under the heading. */
  controls?: React.ReactNode;
  /** Rendered in the sheet. Omit for a tile with no larger view. */
  expanded?: React.ReactNode;
  expandedHint?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = `tile-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className={cn("border-border bg-card flex min-w-0 flex-col rounded-lg border p-3", className)}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <h2 id={id} className="text-[14px] leading-snug font-semibold">
          {title}
        </h2>
        {expanded ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Maximise ${title}`}
            className="border-border text-muted-foreground hover:bg-accent -mt-1 -mr-1 inline-grid size-8 shrink-0 place-items-center rounded-md border max-md:size-11"
          >
            <Maximize2 className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      {hint ? <p className="text-muted-foreground mb-2 text-[12px]">{hint}</p> : null}
      {controls ? <div className="mb-2">{controls}</div> : null}
      {children}
      {expanded ? (
        <ExpandSheet open={open} onOpenChange={setOpen} title={title} description={expandedHint ?? hint ?? title}>
          {expanded}
        </ExpandSheet>
      ) : null}
    </section>
  );
}
