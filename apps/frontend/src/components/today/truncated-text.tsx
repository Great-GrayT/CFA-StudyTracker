"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** True while the element's text is cut by its ellipsis. */
export function useIsCut(ref: RefObject<HTMLElement | null>, text: string): boolean {
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 1px slack: subpixel widths can report a cut that is not visible.
    const measure = () => setCut(el.scrollWidth - el.clientWidth > 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, text]);
  return cut;
}

/**
 * One line, cut with an ellipsis. Only when it is actually cut does it become
 * a tab stop with the full text in a tooltip, so short names add no stops.
 * The tree never changes shape, so the observed node is never remounted.
 */
export function TruncatedText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const cut = useIsCut(ref, text);
  return (
    <Tooltip open={cut ? undefined : false}>
      <TooltipTrigger asChild>
        <span
          ref={ref}
          tabIndex={cut ? 0 : undefined}
          className={cn(
            "focus-visible:ring-ring min-w-0 truncate rounded-sm outline-hidden focus-visible:ring-2",
            className,
          )}
        >
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}
