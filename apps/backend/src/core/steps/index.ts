import { deriveState, type Declaration, type HistoryTask, type MockResult, type ModuleState } from "./state";
import { fitPlan, type FitReport } from "./fit";
import { buildWindows, computeMetrics, type DoneOn, type Metrics, type ModuleWindow } from "./metrics";
import type { MockSession } from "./mocks";
import type { DayCap, ReviewPolicy, ScheduledTask, StepOrder } from "./schedule";
import type { ModuleCatalog } from "./types";
import { remainingWork, type WorkItem } from "./work";

export type EngineInput = {
  today: string; // ISO date, UTC
  exam: string;
  catalog: ModuleCatalog[];
  history: HistoryTask[];
  declarations: Declaration[];
  mockResults: MockResult[];
  // One row per day from today to the day before the exam. minutes is the weekday cap;
  // a day with a holidayId counts as 0 unless the fit ladder cancels that holiday.
  caps: DayCap[];
  mockSessions: MockSession[]; // supply in priority order
  reviewPolicy: ReviewPolicy;
  reviewStartDate: string | null;
  order: StepOrder;
  belowPassAccepted: boolean;
  doneOn?: DoneOn; // readingId -> step -> date the step passed
};

export type PlanResult = {
  tasks: ScheduledTask[];
  fit: FitReport;
  windows: ModuleWindow[];
  metrics: Metrics;
  unplaced: WorkItem[];
  load: number;
  relaxedPolicy: boolean;
  state: Map<string, ModuleState>;
};

export function planSteps(input: EngineInput): PlanResult {
  const state = deriveState(input.catalog, input.history, input.declarations, input.mockResults);
  const allWork = remainingWork(input.catalog, state);
  const weights = new Map(input.catalog.map((m, index) => [m.readingId, { examWeight: m.examWeight, index }]));
  const { result, fit, work } = fitPlan({
    today: input.today, exam: input.exam, caps: input.caps, work: allWork,
    modules: input.catalog.map((m) => ({ readingId: m.readingId, topicOrder: m.topicOrder })),
    mockSessions: input.mockSessions, reviewPolicy: input.reviewPolicy, reviewStartDate: input.reviewStartDate,
    order: input.order, belowPassAccepted: input.belowPassAccepted, weights,
  });
  const windows = buildWindows({
    cat: input.catalog, state, tasks: result.tasks, today: input.today, exam: input.exam, doneOn: input.doneOn,
  });
  const metrics = computeMetrics({
    cat: input.catalog, state, windows, tasks: result.tasks, work, unplaced: result.unplaced,
    today: input.today, exam: input.exam,
  });
  return {
    tasks: result.tasks, fit, windows, metrics, unplaced: result.unplaced, load: result.load,
    relaxedPolicy: result.relaxedPolicy, state,
  };
}

export type { FitReport } from "./fit";
export type { Metrics, ModuleWindow, DoneOn, DayPlan } from "./metrics";
export type { MockSession } from "./mocks";
export type { DayCap, ScheduledTask, ReviewPolicy, StepOrder } from "./schedule";
