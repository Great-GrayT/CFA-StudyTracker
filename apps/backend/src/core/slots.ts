// Pure email slot scheduling engine. No DB, no HTTP, no framework.
// Timezone-aware local time resolution for candidate emails.

export type Slot = "prescription" | "nudge" | "debrief";

export const SLOT_LOCAL_TIMES: Record<Slot, { hour: number; minute: number }> = {
  prescription: { hour: 6, minute: 30 },
  nudge: { hour: 20, minute: 0 },
  debrief: { hour: 22, minute: 30 },
};

// Slots in chronological order so due slots naturally sort correctly.
export const SLOTS_ORDERED: Slot[] = ["prescription", "nudge", "debrief"];

export type CoachSchedule = Record<Slot, { hour: number; minute: number }>;
/** As stored and sent: local "HH:MM" per slot. */
export type CoachScheduleTimes = Record<Slot, string>;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * A plan's stored schedule, or the defaults. The slots must stay in order:
 * the evening nudge asks about the morning's list and the debrief reports on
 * the whole day, so a debrief before the nudge would describe a day not yet
 * over. Anything unusable falls back whole rather than half-applied.
 */
export function parseSchedule(raw: unknown): CoachSchedule {
  if (typeof raw !== "object" || raw === null) return SLOT_LOCAL_TIMES;
  const out = {} as CoachSchedule;
  for (const slot of SLOTS_ORDERED) {
    const m = HHMM.exec(String((raw as Record<string, unknown>)[slot] ?? ""));
    if (!m) return SLOT_LOCAL_TIMES;
    out[slot] = { hour: Number(m[1]), minute: Number(m[2]) };
  }
  const at = (s: Slot) => out[s].hour * 60 + out[s].minute;
  if (!(at("prescription") < at("nudge") && at("nudge") < at("debrief"))) return SLOT_LOCAL_TIMES;
  return out;
}

export function formatSchedule(schedule: CoachSchedule): CoachScheduleTimes {
  const pad = (n: number) => String(n).padStart(2, "0");
  return Object.fromEntries(
    SLOTS_ORDERED.map((s) => [s, `${pad(schedule[s].hour)}:${pad(schedule[s].minute)}`]),
  ) as CoachScheduleTimes;
}

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
export function dueSlots(
  instant: Date,
  timeZone: string,
  alreadySent: Slot[],
  schedule: CoachSchedule = SLOT_LOCAL_TIMES,
): Slot[] {
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

    const { hour, minute } = schedule[slot];
    const slotTime = hour * 60 + minute;

    if (localTime >= slotTime) {
      result.push(slot);
    }
  }

  return result;
}
