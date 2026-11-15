"use client";

import type { LogEntry, Reading } from "@/lib/types";
import { fillStyle } from "./syllabus-map";

/**
 * One segment per outcome, filled like the map: ramp by latest rating, hatch
 * when untouched. A half-finished reading reads at a glance, and 80 readings
 * fit on a phone where 700 outcome tiles would not.
 */
export function StatusStrip({ reading, byLos }: { reading: Reading; byLos: Map<string, LogEntry[]> }) {
  return (
    <span aria-hidden="true" className="flex h-2.5 w-full min-w-0 gap-px">
      {reading.los.map((l) => (
        <span
          key={l.id}
          className="min-w-[2px] flex-1"
          style={{
            ...fillStyle(byLos.get(l.id)?.[0]?.confidence ?? null),
            // A 10px segment holds barely one hatch line; the outline says "empty".
            boxShadow: byLos.has(l.id) ? undefined : "inset 0 0 0 1px var(--rule-strong)",
          }}
        />
      ))}
    </span>
  );
}
