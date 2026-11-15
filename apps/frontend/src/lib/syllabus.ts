// Syllabus maths for the map, the table, the topic page and the outcome sheet.
// Pure functions so the encoding rules are tested, not eyeballed.

import type { TreemapDataItem } from "@/components/ui/tree-map";
import { weightedCoveragePercent, type TopicCoverage } from "./coverage";
import type { Curriculum, LogEntry, Reading } from "./types";

export const STALE_DAYS = 30;
const DAY_MS = 86_400_000;
const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export type NodeKind = "topic" | "reading" | "los";
export type NodeMeta = {
  confidence: number | null;
  covered: number;
  total: number;
  accuracy: number | null;
  kind: NodeKind;
  /** Topic weight range, carried down so every tooltip can print it. */
  weightMin: number;
  weightMax: number;
  /** Outcomes in the topic: the topic's weight is split this many ways. */
  topicTotal: number;
};

type Tally = { answered: number; correct: number };
const accuracyOf = (t: Tally) => (t.answered > 0 ? (t.correct / t.answered) * 100 : null);

/** Logs grouped by outcome, newest first. */
export function logsByLos(logs: LogEntry[]): Map<string, LogEntry[]> {
  const map = new Map<string, LogEntry[]>();
  for (const l of logs) {
    const list = map.get(l.losId);
    if (list) list.push(l);
    else map.set(l.losId, [l]);
  }
  for (const list of map.values()) list.sort((a, b) => b.date.localeCompare(a.date));
  return map;
}

/** Latest rating per outcome, and question totals. */
function outcomeFacts(mine: LogEntry[] | undefined) {
  const tally: Tally = { answered: 0, correct: 0 };
  for (const l of mine ?? []) {
    tally.answered += l.questionsAnswered;
    tally.correct += l.questionsCorrect;
  }
  return { confidence: mine?.[0]?.confidence ?? null, tally };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * The map's tree. Area is the topic's midpoint exam weight; below topic level
 * the curriculum has no weights, so each outcome gets an equal share and a
 * reading's area is its outcome count. Parent confidence averages only the
 * outcomes that have a rating, so untouched work shows as hatch, not as low.
 */
export function syllabusTree(curriculum: Curriculum, logs: LogEntry[]): TreemapDataItem[] {
  const byLos = logsByLos(logs);
  return [...curriculum.topics]
    .sort((a, b) => a.order - b.order)
    .map((topic) => {
      const value = (topic.examWeightMin + topic.examWeightMax) / 2;
      const count = topic.readings.reduce((s, r) => s + r.los.length, 0);
      const share = count > 0 ? value / count : 0;
      const weights = { weightMin: topic.examWeightMin, weightMax: topic.examWeightMax, topicTotal: count };
      const topicConf: number[] = [];
      const topicTally: Tally = { answered: 0, correct: 0 };
      let topicCovered = 0;

      const readings = [...topic.readings]
        .sort((a, b) => a.order - b.order)
        .map((reading): TreemapDataItem => {
          const conf: number[] = [];
          const tally: Tally = { answered: 0, correct: 0 };
          let covered = 0;
          const outcomes = [...reading.los]
            .sort((a, b) => a.order - b.order)
            .map((los): TreemapDataItem => {
              const f = outcomeFacts(byLos.get(los.id));
              if (f.confidence !== null) {
                conf.push(f.confidence);
                covered++;
              }
              tally.answered += f.tally.answered;
              tally.correct += f.tally.correct;
              const meta: NodeMeta = {
                confidence: f.confidence,
                covered: f.confidence === null ? 0 : 1,
                total: 1,
                accuracy: accuracyOf(f.tally),
                kind: "los",
                ...weights,
              };
              return { id: los.id, name: los.text, value: share, metadata: meta };
            });
          topicConf.push(...conf);
          topicCovered += covered;
          topicTally.answered += tally.answered;
          topicTally.correct += tally.correct;
          const meta: NodeMeta = {
            confidence: mean(conf),
            covered,
            total: reading.los.length,
            accuracy: accuracyOf(tally),
            kind: "reading",
            ...weights,
          };
          return { id: reading.id, name: reading.name, value: share * reading.los.length, metadata: meta, children: outcomes };
        });

      const meta: NodeMeta = {
        confidence: mean(topicConf),
        covered: topicCovered,
        total: count,
        accuracy: accuracyOf(topicTally),
        kind: "topic",
        ...weights,
      };
      return { id: topic.id, name: topic.name, value, metadata: meta, children: readings };
    });
}

/**
 * Confidence is 1 to 5 and the ramp has four steps. Unlike the Record sheet,
 * a rating of 1 still fills (conf-1, shared with 2): on the map any rating
 * means touched, and only hatch may mean untouched.
 */
export function confidenceFill(c: number | null): string {
  if (c === null) return "untouched";
  const step = Math.min(4, Math.max(1, Math.round(c) - 1));
  return `var(--conf-${step})`;
}

/**
 * The tooltip's weight line. Only a topic has an official weight; a reading
 * or outcome is named as its share of the topic's, never as the range itself.
 */
export function weightLine(m: NodeMeta): string {
  const range = `${m.weightMin} to ${m.weightMax}%`;
  if (m.kind === "topic") return `${range} of the exam`;
  if (m.kind === "reading") {
    const noun = m.topicTotal === 1 ? "outcome" : "outcomes";
    return `${m.total} of the topic's ${m.topicTotal} ${noun}. The topic is ${range} of the exam, split equally.`;
  }
  if (m.topicTotal === 1) return `The topic's only outcome, so all of its ${range} of the exam.`;
  return `One of ${m.topicTotal} outcomes sharing the topic's ${range} of the exam.`;
}

/** Label for a cell this wide, or null when no label fits. About 7px a character at 12px Archivo. */
export function cellLabel(name: string, widthPx: number): string | null {
  if (widthPx < 48) return null;
  const max = Math.floor(widthPx / 7);
  if (name.length <= max) return name;
  return `${name.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export type OutcomeStatus = "confident" | "logged" | "flagged" | "untouched";

/** Status for the strip; the same three flag rules the outcome sheet names. */
export function outcomeStatus(mine: LogEntry[], nowMs = Date.now()): OutcomeStatus {
  if (mine.length === 0) return "untouched";
  if (flagReasons(mine, nowMs).length > 0) return "flagged";
  const latest = mine.reduce((a, b) => (a.date > b.date ? a : b));
  return latest.confidence >= 4 ? "confident" : "logged";
}

/**
 * Why an outcome is flagged, one clause per rule, because "flagged" without a
 * reason is what the outcome sheet exists to fix.
 */
export function flagReasons(mine: LogEntry[], nowMs = Date.now()): string[] {
  if (mine.length === 0) return [];
  const latest = mine.reduce((a, b) => (a.date > b.date ? a : b));
  const answered = mine.reduce((s, l) => s + l.questionsAnswered, 0);
  const correct = mine.reduce((s, l) => s + l.questionsCorrect, 0);
  const days = daysSince(latest.date, nowMs);
  const reasons: string[] = [];
  if (latest.confidence <= 2) reasons.push(`you rated it ${latest.confidence}`);
  if (answered >= 3 && correct / answered < 0.6) reasons.push(`your accuracy is ${pct.format((correct / answered) * 100)}%`);
  if (days >= STALE_DAYS) reasons.push(`it was last studied ${days} days ago`);
  return reasons;
}

export function daysSince(iso: string, nowMs = Date.now()): number {
  return Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / DAY_MS));
}

export type Source = { id: string; name: string; count: number };

/** Questions answered per package, largest first. */
export function questionSources(mine: LogEntry[], names: Map<string, string>): Source[] {
  const byPackage = new Map<string, number>();
  for (const l of mine) {
    if (!l.packageId || l.questionsAnswered === 0) continue;
    byPackage.set(l.packageId, (byPackage.get(l.packageId) ?? 0) + l.questionsAnswered);
  }
  return [...byPackage.entries()]
    .map(([id, count]) => ({ id, name: names.get(id) ?? "Unknown", count }))
    .sort((a, b) => b.count - a.count);
}

/** Twenty or more questions from one bank while still not sure: worth a nudge. */
export function isMonoculture(sources: Source[], latestConfidence: number | undefined): boolean {
  const total = sources.reduce((s, x) => s + x.count, 0);
  return total >= 20 && sources.length === 1 && (latestConfidence ?? 5) < 4;
}

export type TopicRow = {
  id: string;
  name: string;
  weightMin: number;
  weightMax: number;
  covered: number;
  total: number;
  accuracy: number | null;
  answered: number;
  weakestReading: { id: string; name: string; confidence: number } | null;
  readings: Array<{ reading: Reading; covered: number; confidence: number | null; accuracy: number | null }>;
};

/** One row per topic for the table, the accessible twin of the map. */
export function topicRows(curriculum: Curriculum, logs: LogEntry[]): TopicRow[] {
  const tree = syllabusTree(curriculum, logs);
  const topics = [...curriculum.topics].sort((a, b) => a.order - b.order);
  return topics.map((topic, i) => {
    const node = tree[i];
    const meta = node.metadata as NodeMeta;
    const readings = [...topic.readings]
      .sort((a, b) => a.order - b.order)
      .map((reading, j) => {
        const m = node.children![j].metadata as NodeMeta;
        return { reading, covered: m.covered, confidence: m.confidence, accuracy: m.accuracy };
      });
    // Weakest means lowest average rating among readings already started;
    // untouched readings are a coverage gap, which the coverage column shows.
    let weakest: TopicRow["weakestReading"] = null;
    for (const r of readings) {
      if (r.confidence === null) continue;
      if (!weakest || r.confidence < weakest.confidence) {
        weakest = { id: r.reading.id, name: r.reading.name, confidence: r.confidence };
      }
    }
    let answered = 0;
    const ids = new Set(topic.readings.flatMap((r) => r.los.map((l) => l.id)));
    for (const l of logs) if (ids.has(l.losId)) answered += l.questionsAnswered;
    return {
      id: topic.id,
      name: topic.name,
      weightMin: topic.examWeightMin,
      weightMax: topic.examWeightMax,
      covered: meta.covered,
      total: meta.total,
      accuracy: meta.accuracy,
      answered,
      weakestReading: weakest,
      readings,
    };
  });
}

export function toCoverage(rows: TopicRow[]): TopicCoverage[] {
  return rows.map((r) => ({
    topicId: r.id,
    name: r.name,
    weightMin: r.weightMin,
    weightMax: r.weightMax,
    covered: r.covered,
    total: r.total,
  }));
}

/** The header's two figures. */
export function syllabusTotals(curriculum: Curriculum, logs: LogEntry[]) {
  const rows = topicRows(curriculum, logs);
  const answered = logs.reduce((s, l) => s + l.questionsAnswered, 0);
  const correct = logs.reduce((s, l) => s + l.questionsCorrect, 0);
  return {
    coverage: weightedCoveragePercent(toCoverage(rows)),
    accuracy: answered > 0 ? (correct / answered) * 100 : null,
    answered,
  };
}
