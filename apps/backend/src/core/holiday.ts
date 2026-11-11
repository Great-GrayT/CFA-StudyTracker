/**
 * Facts about where today sits relative to the candidate's holiday blocks.
 * Pure: no DB, no clock. Callers pass the blocks and the day.
 *
 * This exists because "is today a holiday" was the only question the coach used
 * to ask, and it is the least interesting of the four. A break is a three-act
 * structure: the day before it is the last chance to bank anything, and the day
 * after it is the one that decides whether a planned rest quietly turned into a
 * missed-day streak. Both are higher-leverage than the break itself.
 *
 * Every date here is treated as a plain calendar day in the candidate's own
 * zone, already normalised to UTC midnight by the caller. No arithmetic in this
 * file may introduce a timezone conversion.
 */

const MS_PER_DAY = 86_400_000;

export type HolidayBlock = { startDate: Date; endDate: Date };

export type HolidayFacts = {
  isHoliday: boolean;
  holidayYesterday: boolean;
  holidayTomorrow: boolean;
  holidayStartsTomorrow: boolean;
  /**
   * Length in days of the block today sits in, or of the block starting
   * tomorrow when today is the last working day before one. Zero when neither
   * applies, so copy that names it is only reachable when it is real.
   */
  restDays: number;
  /** Which day of its block today is, 1-based. Zero when today is not a holiday. */
  dayOfBlock: number;
};

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function covers(block: HolidayBlock, day: Date): boolean {
  const from = startOfDay(block.startDate).getTime();
  // Inclusive at both ends: a holiday row for the 10th to the 12th is three
  // days off, not two. An exclusive end here would silently work the candidate
  // on the last day of every break they booked.
  const to = startOfDay(block.endDate).getTime();
  const t = startOfDay(day).getTime();
  return t >= from && t <= to;
}

function blockLength(block: HolidayBlock): number {
  const from = startOfDay(block.startDate).getTime();
  const to = startOfDay(block.endDate).getTime();
  return Math.round((to - from) / MS_PER_DAY) + 1;
}

export function holidayFacts(blocks: HolidayBlock[], today: Date): HolidayFacts {
  const t = startOfDay(today);
  const yesterday = new Date(t.getTime() - MS_PER_DAY);
  const tomorrow = new Date(t.getTime() + MS_PER_DAY);

  const current = blocks.find((b) => covers(b, t)) ?? null;
  const holidayYesterday = blocks.some((b) => covers(b, yesterday));
  const holidayTomorrow = blocks.some((b) => covers(b, tomorrow));

  // "Starts tomorrow" means tomorrow is off and today is not. Without the
  // second half, every day inside a break would also claim a break starts
  // tomorrow, and the last-chance copy would fire in the middle of a holiday.
  const holidayStartsTomorrow = holidayTomorrow && current === null;

  const upcoming = holidayStartsTomorrow
    ? (blocks.find((b) => covers(b, tomorrow)) ?? null)
    : null;
  const relevant = current ?? upcoming;

  return {
    isHoliday: current !== null,
    holidayYesterday,
    holidayTomorrow,
    holidayStartsTomorrow,
    restDays: relevant ? blockLength(relevant) : 0,
    dayOfBlock: current
      ? Math.round((t.getTime() - startOfDay(current.startDate).getTime()) / MS_PER_DAY) + 1
      : 0,
  };
}
