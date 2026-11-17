import type { Projection } from "./types";

type Fit = Projection["fit"];
type Hol = Projection["holidays"][number];

/** ok: fits. warn: cannot fit and not yet consented. below-pass: consented, kept as a badge. */
export function fitState(fit: Fit, accepted: boolean): "ok" | "warn" | "below-pass" {
  if (fit.feasible && !fit.belowPass) return "ok";
  return accepted ? "below-pass" : "warn";
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const day = (iso: string) => dayFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

/** The ladder steps already taken: crash pace and holidays given up. */
export function fitNotes(fit: Fit, holidays: Hol[]): string[] {
  const out: string[] = [];
  if (fit.crash > 1) out.push(`Planned at ${Number(fit.crash.toFixed(2))}x pace`);
  for (const id of fit.cancelledHolidayIds) {
    const h = holidays.find((x) => x.id === id);
    if (h) out.push(`Cancelled holiday ${day(h.start)} to ${day(h.end)}`);
  }
  return out;
}
