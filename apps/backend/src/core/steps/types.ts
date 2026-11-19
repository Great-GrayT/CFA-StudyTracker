import type { StepRules } from "./rules";
// Row shapes mirror the Prisma models (Reading+Topic, PackageUnit, PackageResource)
// with only the fields the engine reads, so core/steps stays free of db imports.
export type StepNo = 1 | 2 | 3 | 4;

export type ReadingRow = {
  id: string;
  topicId: string;
  order: number;
  topicOrder: number;
  examWeightMin: number;
  examWeightMax: number;
};

export type UnitRow = {
  id: string;
  packageSlug: string;
  packageId: string;
  notesPageCount: number | null;
  // PackageUnitReading bindings; several means a fan-out unit.
  readingIds: string[];
};

export type ResourceRow = {
  id: string;
  unitId: string | null;
  kind: string;
  durationSeconds: number | null;
  questionCount: number | null;
  wordCount: number | null;
};

export type SourceOption = {
  packageSlug: string;
  packageId: string;
  resourceIds: string[];
  kind: "read" | "questions";
  // read: total minutes for the module. questions: whole bank in minutes (0 when unlimited).
  minutes: number;
  questions?: number | null; // bank size; null = unlimited (LES)
  minutesPerQuestion?: number;
  answerReviewPerQuestion?: number;
  label: string;
};

export type ModuleCatalog = {
  readingId: string;
  topicId: string;
  topicOrder: number;
  readingOrder: number;
  examWeight: number; // midpoint of the topic range, 0..1
  options: Record<StepNo, SourceOption[]>;
  rules?: StepRules; // absent means DEFAULT_RULES
};

export type RoundState = {
  round: number;
  answered: number;
  correct: number;
  minutes: number;
  usedByPackage: Record<string, number>;
};
