// Contract of GET /api/plans/:id/coverage (spec 2026-11-19, section C).
export type VideoTotals = { count: number; watched: number; seconds: number; watchedSeconds: number };
export type QuestionTotals = { total: number; answered: number; correct: number; numbered: number };
export type VideoStatus = "watched" | "partial" | "not-started";

export type CoverageUnit = {
  unitId: string;
  ref: string;
  title: string;
  readingIds: string[];
  readingNames: string[];
  videos: { resourceId: string; title: string; seconds: number; status: VideoStatus }[];
  questions: { total: number; answered: number; correct: number; numbered: number[]; unnumbered: number; left: number[] | null };
  los: { losId: string | null; label: string; text: string; questionCount: number | null; answered: number; correct: number }[];
};

export type CoverageTopic = {
  topicId: string;
  name: string;
  order: number;
  videos: VideoTotals;
  questions: QuestionTotals;
  units: CoverageUnit[];
};

export type CoveragePackage = {
  packageId: string;
  name: string;
  slug: string | null;
  year: string;
  videos: VideoTotals;
  questions: QuestionTotals;
  topics: CoverageTopic[];
};

export type Coverage = { packages: CoveragePackage[] };
