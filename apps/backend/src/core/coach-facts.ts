// Pure derivation of the coach's engine facts from a projection. No DB, no clock.
import { coachStage, type CoachStage } from "./coach-ladder";

type Window = { step: number; status: string };
export type FactsInput = {
  asOf: string;
  fit: { feasible: boolean; belowPass: boolean };
  sections: Array<{ modules: Array<{ name: string; windows: Window[] }> }>;
  daily: Array<{ date: string; plannedMin: number; doneMin: number }>;
  extras: Array<{ reason: string; date: string | null }>;
  readiness: number;
  readinessPlanToday: number;
};

export type LadderFacts = {
  stage: CoachStage;
  daysBehind: number;
  belowPass: boolean;
  infeasible: boolean;
  overdueList: string;
  extraReason: string;
  readiness: number;
  readinessPlan: number;
};

const MAX_LISTED = 3;
const percent = (fraction: number) => Math.round(fraction * 100);

/**
 * daysBehind is the net shortfall on past days (planned minus credited, never
 * negative) divided by the average planned minutes of a planned day, rounded up.
 * Net rather than per day, so a long day made up on a later one is not counted twice.
 */
export function behindDays(daily: FactsInput["daily"], asOf: string): number {
  const shortfall = daily.filter((d) => d.date < asOf).reduce((a, d) => a + d.plannedMin - d.doneMin, 0);
  if (shortfall <= 0) return 0;
  const planned = daily.filter((d) => d.plannedMin > 0);
  if (planned.length === 0) return 0;
  const average = planned.reduce((a, d) => a + d.plannedMin, 0) / planned.length;
  return Math.ceil(shortfall / average);
}

export function ladderFacts(p: FactsInput, daysToExam: number, belowPassAccepted: boolean): LadderFacts {
  const modules = p.sections.flatMap((s) => s.modules);
  const passed = (m: (typeof modules)[number], step: number) =>
    m.windows.some((w) => w.step === step && w.status === "done");
  const stage = coachStage(
    modules.map((m) => ({ s1: passed(m, 1), s2: passed(m, 2), s3: passed(m, 3), s4: passed(m, 4) })),
    daysToExam,
  );

  const overdue = modules.flatMap((m) =>
    m.windows.filter((w) => w.status === "overdue").map((w) => `${m.name} (step ${w.step})`),
  );
  const listed = overdue.slice(0, MAX_LISTED).join("; ");
  const overdueList =
    overdue.length === 0 ? "nothing overdue" : overdue.length > MAX_LISTED ? `${listed}; and ${overdue.length - MAX_LISTED} more` : listed;

  const todayExtra = p.extras.find((e) => e.date === p.asOf) ?? p.extras[0];

  return {
    stage,
    daysBehind: behindDays(p.daily, p.asOf),
    belowPass: belowPassAccepted && p.fit.belowPass,
    infeasible: !p.fit.feasible && !belowPassAccepted,
    overdueList,
    extraReason: todayExtra?.reason ?? "none",
    readiness: percent(p.readiness),
    readinessPlan: percent(p.readinessPlanToday),
  };
}
