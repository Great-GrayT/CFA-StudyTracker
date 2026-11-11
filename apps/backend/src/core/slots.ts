// Pure email slot scheduling engine. No DB, no HTTP, no framework.
// Timezone-aware local time resolution for candidate emails.

export type Slot = "prescription" | "nudge" | "debrief";

export const SLOT_LOCAL_TIMES: Record<Slot, { hour: number; minute: number }> = {
  prescription: { hour: 6, minute: 30 },
  nudge: { hour: 20, minute: 0 },
  debrief: { hour: 22, minute: 30 },
};

// Slots in chronological order so due slots naturally sort correctly.
const SLOTS_ORDERED: Slot[] = ["prescription", "nudge", "debrief"];

/**
 * The candidate's local date as an ISO string, or throws if the timezone is invalid.
 * Intl.DateTimeFormat throws RangeError on unknown timezones.
 */
export function localDateFor(instant: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(instant);
  const partMap = new Map(parts.map((p) => [p.type, p.value]));

  const year = partMap.get("year");
  const month = partMap.get("month");
  const day = partMap.get("day");

  if (!year || !month || !day) {
    throw new Error("Failed to format date parts");
  }

  return `${year}-${month}-${day}`;
}

/**
 * Which email slots are due now for this candidate.
 * A slot is due if its local time has already passed today and it hasn't been sent.
 * Returns slots in chronological order.
 */
export function dueSlots(instant: Date, timeZone: string, alreadySent: Slot[]): Slot[] {
  // Get the candidate's local time
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(instant);
  const partMap = new Map(parts.map((p) => [p.type, p.value]));

  const hourStr = partMap.get("hour");
  const minuteStr = partMap.get("minute");

  if (!hourStr || !minuteStr) {
    throw new Error("Failed to format time parts");
  }

  const localHour = parseInt(hourStr, 10);
  const localMinute = parseInt(minuteStr, 10);
  const localTime = localHour * 60 + localMinute; // minutes since midnight

  const alreadySentSet = new Set(alreadySent);

  const result: Slot[] = [];
  for (const slot of SLOTS_ORDERED) {
    if (alreadySentSet.has(slot)) continue;

    const { hour, minute } = SLOT_LOCAL_TIMES[slot];
    const slotTime = hour * 60 + minute;

    if (localTime >= slotTime) {
      result.push(slot);
    }
  }

  return result;
}
