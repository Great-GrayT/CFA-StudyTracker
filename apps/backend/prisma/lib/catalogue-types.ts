export type ResourceKind =
  | "lecture"
  | "eocq"
  | "review"
  | "seminar"
  | "update"
  | "orientation"
  | "notes"
  | "formula_sheet"
  | "worksheet"
  | "question_set"
  | "answer_set";

export interface ResourceFile {
  ref: string;
  kind: ResourceKind;
  externalId: string;
  sizeKb: number;
  durationSeconds?: number;
  sourceNote?: string;
  questionCount?: number;
  vignetteCount?: number;
  calcCount?: number;
  pageCount?: number;
  wordCount?: number;
  exhibitCount?: number;
}

export interface LosRefinement {
  sourceLabel: string;
  questionCount: number;
  retired?: boolean;
}

export interface UnitFile {
  ref: string;
  title: string;
  notesPageStart?: number;
  notesPageCount?: number;
  resources: ResourceFile[];
  losRefinements?: LosRefinement[];
}

export interface PackageFile {
  package: {
    slug: string;
    name: string;
  };
  edition: {
    levelId: string;
    year: string;
    sourceUrl?: string;
    snapshotDate?: string;
  };
  units: UnitFile[];
  editionResources: ResourceFile[];
}

export type ExtractResult<T> = {
  data: T | null;
  problems: string[];
};

/** One reading a provider unit is bound to, resolved by position and checked by name. */
export interface MapEntryReading {
  topicOrder: number;
  readingOrder: number;
  readingName: string;
}

export interface MapEntry {
  unitRef: string;
  readings: MapEntryReading[];
}

/** A curriculum reading with no provider coverage. A genuine content gap, never a mapping bug. */
export interface UncoveredEntry {
  topicOrder: number;
  readingOrder: number;
  readingName: string;
  reason?: string;
}

/**
 * Binds one provider outcome label to a curriculum outcome, or marks it
 * retired when the curriculum dropped it. There is no third shape: an entry
 * that is neither bound nor retired is what checkCrosswalk rejects.
 */
export type LosMapEntry =
  | {
      unitRef: string;
      sourceLabel: string;
      topicOrder: number;
      readingOrder: number;
      losOrder: number;
      losText: string;
    }
  | {
      unitRef: string;
      sourceLabel: string;
      retired: true;
    };

/**
 * The seeded, human-reviewed record of which curriculum readings each
 * provider unit covers. Never derived by name matching at load time: map and
 * uncovered together must account for every curriculum reading exactly once.
 */
export interface CrosswalkFile {
  levelId: string;
  version: string;
  packageSlug: string;
  map: MapEntry[];
  uncovered: UncoveredEntry[];
  losMap?: LosMapEntry[];
}
